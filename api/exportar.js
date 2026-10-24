import { get, list } from '@vercel/blob';
import { leerConfig } from '../lib/db.js';
import { pinOk } from '../lib/util.js';

// EXPORTACIÓN TEMPORAL para mudar los datos a Cloudflare (se borra después). Pide el PIN de un usuario de la caja.
// POST { usuarioId, pin, desde } → { items: [{ path, contentType, text | b64 }], siguiente, total }
const ORIGEN = /^https:\/\/[a-z0-9.-]+\.(workers|pages)\.dev$/;
const cors = (request) => {
  const o = request.headers.get('origin') || '';
  return ORIGEN.test(o) ? { 'access-control-allow-origin': o, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' } : {};
};
const out = (request, data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors(request) } });

export async function OPTIONS(request) { return new Response(null, { status: 204, headers: cors(request) }); }

export async function POST(request) {
  let b = {};
  try { b = await request.json(); } catch {}
  const u = (await leerConfig()).usuarios.find((x) => x.id === +b.usuarioId && x.activo && x.pin_hash);
  if (!u || !pinOk(b.pin, u.pin_hash)) {
    await new Promise((r) => setTimeout(r, 800));
    return out(request, { error: 'PIN incorrecto' }, 401);
  }
  const paths = [];
  let cursor;
  do {
    const r = await list({ cursor, limit: 1000 });
    paths.push(...r.blobs.map((x) => x.pathname));
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  paths.sort();
  const items = [];
  let bytes = 0, i = Math.max(0, parseInt(b.desde, 10) || 0);
  for (; i < paths.length && bytes < 2.5e6 && items.length < 40; i++) {
    const r = await get(paths[i], { access: 'private', useCache: false }).catch(() => null);
    if (!r || r.statusCode !== 200 || !r.stream) continue;
    const buf = Buffer.from(await new Response(r.stream).arrayBuffer());
    const ct = r.blob.contentType || 'application/octet-stream';
    const it = ct.startsWith('image/') ? { path: paths[i], contentType: ct, b64: buf.toString('base64') } : { path: paths[i], contentType: ct, text: buf.toString('utf8') };
    bytes += buf.length * (it.b64 ? 1.4 : 1);
    items.push(it);
  }
  return out(request, { items, siguiente: i < paths.length ? i : null, total: paths.length });
}
