// Reemplazo de "@vercel/blob" para Cloudflare: mismo uso (put / get / list / del) pero guarda en D1.
// - Los archivos se parten en trozos de ~600 KB (D1 limita cada fila a 2 MB).
// - Cada versión tiene su "etag"; guardar con ifMatch falla si alguien guardó antes (control de concurrencia).
// - La base D1 llega por globalThis.__DB (la pone worker.js en cada pedido).
// - Archivos binarios (fotos) se guardan en base64.

export class BlobPreconditionFailedError extends Error {
  constructor(m = 'Precondition failed') { super(m); this.name = 'BlobPreconditionFailedError'; }
}
export class BlobNotFoundError extends Error {
  constructor(m = 'This blob does not exist.') { super(m); this.name = 'BlobNotFoundError'; }
}

const CHUNK = 600_000;
let listo = false;

function db() {
  const d = globalThis.__DB;
  if (!d) throw new Error('Falta la base de datos D1 (binding DB).');
  return d;
}
async function esquema() {
  if (listo) return;
  const d = db();
  await d.batch([
    d.prepare('CREATE TABLE IF NOT EXISTS kv (path TEXT PRIMARY KEY, etag TEXT NOT NULL, ctype TEXT, enc TEXT, size INTEGER, n INTEGER, updated TEXT)'),
    d.prepare('CREATE TABLE IF NOT EXISTS chunks (path TEXT NOT NULL, etag TEXT NOT NULL, i INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (path, etag, i))'),
  ]);
  listo = true;
}

const nuevoEtag = () => `"${[...crypto.getRandomValues(new Uint8Array(10))].map((b) => b.toString(16).padStart(2, '0')).join('')}"`;
const limpio = (e) => String(e || '').replace(/^W\//, '').replace(/"/g, '');

function aBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function deBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function aTexto(body) {
  if (typeof body === 'string') return { texto: body, enc: 'utf8', size: new TextEncoder().encode(body).length };
  let bytes;
  if (body instanceof Uint8Array) bytes = body;
  else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
  else if (body && typeof body.arrayBuffer === 'function') bytes = new Uint8Array(await body.arrayBuffer());
  else if (body && typeof body.getReader === 'function') bytes = new Uint8Array(await new Response(body).arrayBuffer());
  else throw new Error('Tipo de contenido no admitido');
  return { texto: aBase64(bytes), enc: 'b64', size: bytes.length };
}

export async function put(path, body, opts = {}) {
  await esquema();
  const d = db();
  const { texto, enc, size } = await aTexto(body);
  const etag = nuevoEtag();
  const trozos = [];
  for (let i = 0; i < Math.max(1, Math.ceil(texto.length / CHUNK)); i++) trozos.push(texto.slice(i * CHUNK, (i + 1) * CHUNK));
  const ins = trozos.map((t, i) => d.prepare('INSERT INTO chunks (path, etag, i, data) VALUES (?,?,?,?)').bind(path, etag, i, t));
  for (let i = 0; i < ins.length; i += 20) await d.batch(ins.slice(i, i + 20));

  const ahora = new Date().toISOString();
  const ctype = opts.contentType || 'application/octet-stream';
  const descartar = () => d.prepare('DELETE FROM chunks WHERE path=? AND etag=?').bind(path, etag).run().catch(() => {});
  let viejo = null;
  let r;
  if (opts.ifMatch) {
    viejo = limpio(opts.ifMatch);
    const cur = await d.prepare('SELECT etag FROM kv WHERE path=?').bind(path).first();
    // se compara sin comillas ni prefijo W/
    if (!cur || limpio(cur.etag) !== viejo) { await descartar(); throw new BlobPreconditionFailedError(); }
    r = await d.prepare('UPDATE kv SET etag=?, ctype=?, enc=?, size=?, n=?, updated=? WHERE path=? AND etag=?')
      .bind(etag, ctype, enc, size, trozos.length, ahora, path, cur.etag).run();
    if (!r.meta.changes) { await descartar(); throw new BlobPreconditionFailedError(); }
    viejo = cur.etag;
  } else if (opts.allowOverwrite) {
    const cur = await d.prepare('SELECT etag FROM kv WHERE path=?').bind(path).first();
    viejo = cur && cur.etag;
    await d.prepare('INSERT INTO kv (path, etag, ctype, enc, size, n, updated) VALUES (?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET etag=excluded.etag, ctype=excluded.ctype, enc=excluded.enc, size=excluded.size, n=excluded.n, updated=excluded.updated')
      .bind(path, etag, ctype, enc, size, trozos.length, ahora).run();
  } else {
    r = await d.prepare('INSERT INTO kv (path, etag, ctype, enc, size, n, updated) VALUES (?,?,?,?,?,?,?) ON CONFLICT(path) DO NOTHING')
      .bind(path, etag, ctype, enc, size, trozos.length, ahora).run();
    if (!r.meta.changes) { await descartar(); throw new BlobPreconditionFailedError('This blob already exists'); }
  }
  if (viejo) await d.prepare('DELETE FROM chunks WHERE path=? AND etag=?').bind(path, viejo).run().catch(() => {});
  return { pathname: path, url: `d1://${path}`, etag, contentType: ctype };
}

export async function get(path, opts = {}) {
  await esquema();
  const d = db();
  for (let intento = 0; intento < 3; intento++) {
    const m = await d.prepare('SELECT etag, ctype, enc, size, n FROM kv WHERE path=?').bind(path).first();
    if (!m) return null;
    const blob = { pathname: path, etag: m.etag, contentType: m.ctype, size: m.size };
    if (opts.ifNoneMatch && limpio(opts.ifNoneMatch) === limpio(m.etag)) return { statusCode: 304, stream: null, blob };
    const { results } = await d.prepare('SELECT data FROM chunks WHERE path=? AND etag=? ORDER BY i').bind(path, m.etag).all();
    if (results.length !== m.n) continue; // alguien guardó justo ahora: se vuelve a leer
    const texto = results.map((x) => x.data).join('');
    const bytes = m.enc === 'b64' ? deBase64(texto) : new TextEncoder().encode(texto);
    return { statusCode: 200, stream: new Response(bytes).body, blob };
  }
  return null;
}

export async function list({ prefix = '', cursor, limit = 1000 } = {}) {
  await esquema();
  const off = cursor ? parseInt(cursor, 10) || 0 : 0;
  const { results } = await db().prepare('SELECT path, etag, size, updated FROM kv WHERE path LIKE ? ESCAPE \'\\\' ORDER BY path LIMIT ? OFFSET ?')
    .bind(String(prefix).replace(/[\\%_]/g, '\\$&') + '%', limit + 1, off).all();
  const hasMore = results.length > limit;
  const blobs = results.slice(0, limit).map((x) => ({ pathname: x.path, etag: x.etag, size: x.size, uploadedAt: new Date(x.updated) }));
  return { blobs, hasMore, cursor: hasMore ? String(off + limit) : undefined };
}

export async function del(paths) {
  await esquema();
  const d = db();
  const lista = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  for (const p of lista) {
    await d.batch([d.prepare('DELETE FROM chunks WHERE path=?').bind(p), d.prepare('DELETE FROM kv WHERE path=?').bind(p)]);
  }
}

/** Mantenimiento: borra trozos huérfanos (de guardados que se cancelaron). */
export async function limpiarHuerfanos() {
  await esquema();
  await db().prepare('DELETE FROM chunks WHERE NOT EXISTS (SELECT 1 FROM kv WHERE kv.path=chunks.path AND kv.etag=chunks.etag)').run();
}

/** Copia de seguridad: todos los archivos JSON (texto) en un objeto { path: contenido }. */
export async function exportarTodo() {
  await esquema();
  const { results } = await db().prepare('SELECT path FROM kv ORDER BY path').all();
  const out = {};
  for (const { path } of results) {
    const r = await get(path);
    if (!r || !r.stream) continue;
    const buf = new Uint8Array(await new Response(r.stream).arrayBuffer());
    out[path] = r.blob.contentType && r.blob.contentType.startsWith('image/')
      ? { b64: aBase64(buf), contentType: r.blob.contentType }
      : { text: new TextDecoder().decode(buf), contentType: r.blob.contentType };
  }
  return out;
}
