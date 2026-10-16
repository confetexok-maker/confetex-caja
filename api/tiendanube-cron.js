import { json } from '../lib/util.js';
import { leerConfig } from '../lib/db.js';
import { sincronizar } from '../lib/tiendanube.js';

// Revisión diaria (Vercel Cron) por si se perdió algún aviso de Tiendanube.
export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return json({ error: 'no' }, 401);
  const t = (await leerConfig()).tiendanube;
  if (!t || !t.access_token) return json({ ok: true, conectado: false });
  try { return json({ ok: true, ...(await sincronizar()) }); } catch (e) { return json({ error: e.message }, 500); }
}
