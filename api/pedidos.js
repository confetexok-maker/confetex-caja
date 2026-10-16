import { q, INICIO } from '../lib/db.js';
import { json, body, protegido, falla } from '../lib/util.js';
import { listarPedidos, limpiarCache } from '../lib/pedidos.js';

export const GET = protegido(async (request) => {
  if (new URL(request.url).searchParams.get('fresco')) limpiarCache();
  const pedidos = await listarPedidos();
  if (!pedidos) return json({ conectado: false, pedidos: [], pendientes: [] });

  const [vinculados, ignorados] = await Promise.all([
    q(`SELECT pedido_ref, id FROM movimientos WHERE pedido_ref IS NOT NULL AND borrado_en IS NULL`),
    q(`SELECT ref FROM pagos_ignorados`),
  ]);
  const enCaja = Object.fromEntries(vinculados.map((r) => [r.pedido_ref, r.id]));
  const ign = new Set(ignorados.map((r) => r.ref));

  const pendientes = [];
  for (const p of pedidos) {
    for (const x of p.pagos) {
      x.movimientoId = enCaja[x.ref] || null;
      x.ignorado = ign.has(x.ref);
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
  if (b.deshacer) await q(`DELETE FROM pagos_ignorados WHERE ref = $1`, [ref]);
  else await q(`INSERT INTO pagos_ignorados (ref, por) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [ref, yo.id]);
  return json({ ok: true });
});
