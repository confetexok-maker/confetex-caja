import { q, INICIO } from '../lib/db.js';
import { json, protegido } from '../lib/util.js';
import { pedidosToken } from '../lib/pedidos.js';

export const GET = protegido(async (request, yo) => {
  const [usuarios, cuentas, categorias, proveedores, recurrentes, saldos] = await Promise.all([
    q(`SELECT id, nombre, activo, (pin_hash IS NOT NULL) AS "tienePin" FROM usuarios ORDER BY id`),
    q(`SELECT id, nombre, tipo, orden, activa FROM cuentas ORDER BY orden, id`),
    q(`SELECT id, nombre, tipo, orden, activa FROM categorias ORDER BY orden, id`),
    q(`SELECT id, nombre, rubro, telefono, notas, activo FROM proveedores ORDER BY lower(nombre)`),
    q(`SELECT id, nombre, tipo, categoria_id, proveedor_id, cuenta_id, cuenta_destino_id, monto::float8 AS monto, dia, activo
       FROM recurrentes ORDER BY dia, id`),
    q(`SELECT c.id,
         COALESCE(SUM(CASE WHEN m.tipo = 'ingreso' AND m.cuenta_id = c.id THEN m.monto
                           WHEN m.tipo = 'egreso' AND m.cuenta_id = c.id THEN -m.monto
                           WHEN m.tipo = 'transferencia' AND m.cuenta_id = c.id THEN -m.monto
                           WHEN m.tipo = 'transferencia' AND m.cuenta_destino_id = c.id THEN m.monto
                           ELSE 0 END), 0)::float8 AS saldo
       FROM cuentas c
       LEFT JOIN movimientos m ON m.borrado_en IS NULL AND (m.cuenta_id = c.id OR m.cuenta_destino_id = c.id)
       GROUP BY c.id`),
  ]);
  const s = Object.fromEntries(saldos.map((r) => [r.id, r.saldo]));
  for (const c of cuentas) c.saldo = s[c.id] || 0;
  return json({
    yo, inicio: INICIO, usuarios, cuentas, categorias, proveedores, recurrentes,
    pedidosConectado: Boolean(pedidosToken() || process.env.PEDIDOS_MOCK),
  });
});
