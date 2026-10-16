import { get, list, head } from '@vercel/blob';
import { claveAltaOk, json } from '../lib/util.js';

// Diagnóstico temporal del almacenamiento (requiere la clave de alta)
export async function GET(request) {
  const u = new URL(request.url);
  if (!claveAltaOk(u.searchParams.get('k'))) return json({ error: 'no' }, 401);
  const out = {};
  const t = async (k, fn) => { try { out[k] = await fn(); } catch (e) { out[k] = { err: `${e.constructor && e.constructor.name}: ${e.message}` }; } };
  await t('list', async () => (await list({ prefix: 'caja/' })).blobs.map((b) => ({ p: b.pathname, s: b.size, at: b.uploadedAt })));
  await t('head', async () => { const h = await head('caja/config.json'); return { etag: h.etag, size: h.size }; });
  await t('get', async () => { const r = await get('caja/config.json', { access: 'private', useCache: false }); return r ? { status: r.statusCode, etag: r.blob && r.blob.etag, hasStream: Boolean(r.stream) } : null; });
  await t('getMes', async () => { const r = await get('caja/movs/2026-10.json', { access: 'private', useCache: false }); return r ? { status: r.statusCode, etag: r.blob && r.blob.etag } : null; });
  return json(out);
}
