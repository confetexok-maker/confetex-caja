import { leerConfig, actualizarConfig, movimientos, INICIO } from '../lib/db.js';
import { json, body, protegido, falla } from '../lib/util.js';
import { listarPedidos, limpiarCache } from '../lib/pedidos.js';

export const GET = protegido(async (request) => {
  if (new URL(request.url).searchParams.get('fresco')) limpiarCache();
  const pedidos = await listarPedidos();
  if (!pedidos) return json({ conectado: false, pedidos: [], pendientes: [] });

  const [movs, cfg] = await Promise.all([movimientos(), leerConfig()]);
  const enCaja = Object.fromEntries(movs.filter((m) => m.pedido_ref).map((m) => [m.pedido_ref, m.id]));
  const ign = cfg.ignorados || {};

  const pendientes = [];
  for (const p of pedidos) {
    for (const x of p.pagos) {
      x.movimientoId = enCaja[x.ref] || null;
      x.ignorado = Boolean(ign[x.ref]);
      if (!x.movimientoId && !x.ignorado && x.fecha >= INICIO) {
        pendientes.push({ ...x, pedidoId: p.id, cliente: p.empresa || p.contacto || p.codigoCliente, codigoCliente: p.codigoCliente });
      }
    }
  }
  pendientes.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return json({ conectado: true, pedidos, pendientes });
});

// Marcar un pago del pedido como "no va a la caja" (o deshacerlo)
export const POST = protegido(async (request, yo) => {
  const b = await body(request);
  const ref = typeof b.ref === 'string' ? b.ref.slice(0, 200) : '';
  if (!ref) throw falla('Falta el pago.');
  await actualizarConfig((cfg) => {
    cfg.ignorados ||= {};
    if (b.deshacer) delete cfg.ignorados[ref];
    else cfg.ignorados[ref] = { por: yo.id, en: new Date().toISOString() };
  });
  return json({ ok: true });
});
