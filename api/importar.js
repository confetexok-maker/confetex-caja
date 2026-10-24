import { put } from '@vercel/blob';
import { protegido, json } from '../lib/util.js';
import { actualizarMes } from '../lib/db.js';

// Importación única de los datos que había en Vercel (la usa /migrar.html).
// Los PIN de la caja se pedían con un cifrado muy pesado para el plan gratis de Cloudflare:
// al importar se borran y cada usuario elige su PIN de nuevo (con la clave de alta).
export const POST = protegido(async (request) => {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const items = Array.isArray(body.items) ? body.items : [];
  let archivos = 0, movimientos = 0;
  for (const it of items) {
    const path = String(it.path || '');
    if (!path.startsWith('caja/') || path.includes('..') || typeof it.text !== 'string') continue;
    let texto = it.text;
    // Movimientos de un mes: en la app nueva viven como filas de la tabla "movs" (no como archivo).
    // Se reemplazan por completo los de ese mes por los que había en Vercel.
    const mm = path.match(/^caja\/movs\/(\d{4}-\d{2})\.json$/);
    if (mm) {
      const lista = (JSON.parse(texto).movs) || [];
      await actualizarMes(mm[1], (actual) => { actual.length = 0; actual.push(...lista); });
      movimientos += lista.length;
      archivos++;
      continue;
    }
    if (path === 'caja/config.json') {
      const c = JSON.parse(texto);
      for (const u of c.usuarios || []) u.pin_hash = null;
      texto = JSON.stringify(c);
    }
    await put(path, texto, { contentType: 'application/json', allowOverwrite: true });
    archivos++;
  }
  return json({ ok: true, archivos, movimientos });
}, { soloAdmin: true });
