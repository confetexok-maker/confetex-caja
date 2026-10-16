import { leerConfig } from '../lib/db.js';
import { json } from '../lib/util.js';
import { firmaValida, procesarEvento } from '../lib/tiendanube.js';

// Avisos de Tiendanube (order/paid, order/cancelled). Se verifica la firma con el secreto de la app.
export async function POST(request) {
  const raw = await request.text();
  if (!firmaValida(raw, request.headers.get('x-linkedstore-hmac-sha256'))) return json({ error: 'firma' }, 401);
  let d; try { d = JSON.parse(raw); } catch { return json({ error: 'json' }, 400); }
  const t = (await leerConfig()).tiendanube;
  if (!t || String(d.store_id) !== String(t.store_id)) return json({ ok: true, ignorado: true });
  try {
    const r = await procesarEvento(d.event, d.id);
    return json({ ok: true, r });
  } catch (e) {
    console.error('webhook tiendanube', e);
    return json({ error: 'reintentar' }, 500);
  }
}
