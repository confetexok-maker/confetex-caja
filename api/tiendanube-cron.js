import { json } from '../lib/util.js';
import { leerConfig } from '../lib/db.js';
import { sincronizar, importarOctubreTN, diagnosticoOrdenes } from '../lib/tiendanube.js';
import { importarPagosPedidos } from '../lib/pagos-pedidos.js';
import { importarComprasMateriales } from '../lib/compras-materiales.js';
import { registrarWebhooks } from '../lib/tiendanube.js';

// Revisión diaria (Vercel Cron) por si se perdió algún aviso de Tiendanube.
export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return json({ error: 'no' }, 401);
  if (new URL(request.url).searchParams.get('diag')) return json({ ordenes: await diagnosticoOrdenes() });
  await importarPagosPedidos().catch((e) => console.error('pagos pedidos', e));
  await importarComprasMateriales().catch((e) => console.error('compras materiales', e));
  const t = (await leerConfig()).tiendanube;
  if (!t || !t.access_token) return json({ ok: true, conectado: false });
  await registrarWebhooks(new URL(request.url).origin).catch((e) => console.error('webhooks', e)); // por si se perdieron al reconectar
  try { const oct = await importarOctubreTN(); return json({ ok: true, octubre: oct, ...(await sincronizar()) }); } catch (e) { return json({ error: e.message }, 500); }
}
