import { put, get, list, BlobPreconditionFailedError } from '@vercel/blob';

// Almacenamiento: archivos JSON en un Vercel Blob privado, con control de versiones (etag)
// para que dos personas cargando al mismo tiempo no se pisen.

let mem = null;
/** Solo para desarrollo local: guarda todo en memoria. */
export function usarMemoria() { mem = new Map(); }

const CONFLICTO = Symbol('conflicto');
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function sinStore() {
  const e = new Error('Falta conectar el almacenamiento (BLOB_READ_WRITE_TOKEN) en Vercel.');
  e.code = 'NO_DB';
  return e;
}

export async function leer(path) {
  if (mem) {
    const v = mem.get(path);
    return v ? { data: JSON.parse(v.body), etag: v.etag } : null;
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw sinStore();
  let r;
  try {
    r = await get(path, { access: 'private', useCache: false });
  } catch (e) {
    if (e && /not.?found/i.test(`${e.name} ${e.message}`)) return null;
    throw e;
  }
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  return { data: JSON.parse(await new Response(r.stream).text()), etag: r.blob.etag };
}

async function escribir(path, data, etag) {
  const body = JSON.stringify(data);
  if (mem) {
    const cur = mem.get(path);
    if (etag ? !cur || cur.etag !== etag : cur) throw CONFLICTO;
    const nuevo = Math.random().toString(36).slice(2);
    mem.set(path, { body, etag: nuevo });
    return nuevo;
  }
  const opts = { access: 'private', contentType: 'application/json', addRandomSuffix: false };
  try {
    const r = await put(path, body, etag ? { ...opts, ifMatch: etag } : { ...opts, allowOverwrite: false });
    return r.etag;
  } catch (e) {
    if (e instanceof BlobPreconditionFailedError) throw CONFLICTO;
    if (!etag && e && /exist/i.test(e.message || '')) throw CONFLICTO;
    throw e;
  }
}

/** Lee, aplica `fn` (que modifica los datos) y guarda. Si otro guardó en el medio, reintenta. */
export async function actualizar(path, fn, inicial) {
  for (let i = 0; i < 8; i++) {
    const cur = await leer(path);
    const data = cur ? cur.data : inicial();
    const res = await fn(data);
    try {
      await escribir(path, data, cur && cur.etag);
      return res;
    } catch (e) {
      if (e !== CONFLICTO) throw e;
      await espera(80 * (i + 1) + Math.random() * 120);
    }
  }
  const e = new Error('Hay mucha actividad en este momento. Probá de nuevo.');
  e.publico = true; e.status = 409;
  throw e;
}

/** Crea el archivo solo si no existe. Devuelve false si ya existía. */
export async function crearSiNoExiste(path, data) {
  try { await escribir(path, data, null); return true; } catch (e) { if (e === CONFLICTO) return false; throw e; }
}

export async function listar(prefix) {
  if (mem) return [...mem.keys()].filter((k) => k.startsWith(prefix));
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw sinStore();
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix, cursor, limit: 1000 });
    out.push(...r.blobs.map((b) => b.pathname));
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}
