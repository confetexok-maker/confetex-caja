import { leerConfig, movimientos, INICIO } from '../lib/db.js';
import { json, protegido } from '../lib/util.js';
import { pedidosToken } from '../lib/pedidos.js';

export const GET = protegido(async (request, yo) => {
  const [c, movs] = await Promise.all([leerConfig(), movimientos()]);
  const saldo = {};
  for (const m of movs) {
    if (m.tipo === 'ingreso') saldo[m.cuenta_id] = (saldo[m.cuenta_id] || 0) + m.monto;
    else saldo[m.cuenta_id] = (saldo[m.cuenta_id] || 0) - m.monto;
    if (m.tipo === 'transferencia') saldo[m.cuenta_destino_id] = (saldo[m.cuenta_destino_id] || 0) + m.monto;
  }
  const r2 = (n) => Math.round((n || 0) * 100) / 100;
  const orden = (a, b) => (a.orden - b.orden) || (a.id - b.id);
  return json({
    yo, inicio: INICIO,
    usuarios: c.usuarios.map((u) => ({ id: u.id, nombre: u.nombre, activo: u.activo, tienePin: Boolean(u.pin_hash) })),
    cuentas: [...c.cuentas].sort(orden).map((x) => ({ ...x, saldo: r2(saldo[x.id]) })),
    categorias: [...c.categorias].sort(orden),
    proveedores: [...c.proveedores].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    recurrentes: [...c.recurrentes].sort((a, b) => (a.dia - b.dia) || (a.id - b.id)),
    pedidosConectado: Boolean(pedidosToken() || process.env.PEDIDOS_MOCK),
  });
});
