import { leerConfig, movimientos, aplicarAutomaticos, INICIO } from '../lib/db.js';
import { json, protegido } from '../lib/util.js';
import { pedidosToken } from '../lib/pedidos.js';
import { tnConfigurada, importarOctubreTN } from '../lib/tiendanube.js';
import { importarPagosPedidos } from '../lib/pagos-pedidos.js';
import { importarComprasMateriales } from '../lib/compras-materiales.js';

export const GET = protegido(async (request, yo) => {
  await aplicarAutomaticos().catch((e) => console.error('automaticos', e));
  await importarOctubreTN().catch((e) => console.error('tn octubre', e));
  await importarPagosPedidos().catch((e) => console.error('pagos pedidos', e));
  await importarComprasMateriales().catch((e) => console.error('compras materiales', e));
  const [c, movs] = await Promise.all([leerConfig(), movimientos()]);
  const saldo = {};
  for (const m of movs) {
    if (m.tipo === 'ingreso') saldo[m.cuenta_id] = (saldo[m.cuenta_id] || 0) + m.monto;
    else saldo[m.cuenta_id] = (saldo[m.cuenta_id] || 0) - m.monto;
    if (m.tipo === 'transferencia') saldo[m.cuenta_destino_id] = (saldo[m.cuenta_destino_id] || 0) + m.monto;
  }
  const r2 = (n) => Math.round((n || 0) * 100) / 100;
  const admin = yo.rol === 'admin';
  const orden = (a, b) => (a.orden - b.orden) || (a.id - b.id);
  return json({
    yo, inicio: INICIO,
    usuarios: c.usuarios.map((u) => ({ id: u.id, nombre: u.nombre, activo: u.activo, rol: u.rol === 'carga' ? 'carga' : 'admin', tienePin: Boolean(u.pin_hash) })),
    cuentas: [...c.cuentas].sort(orden).map((x) => ({ ...x, saldo: admin ? r2(saldo[x.id]) : null })),
    categorias: [...c.categorias].sort(orden),
    proveedores: [...c.proveedores].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    recurrentes: [...c.recurrentes].sort((a, b) => (a.dia - b.dia) || (a.id - b.id)),
    pedidosConectado: Boolean(pedidosToken() || process.env.PEDIDOS_MOCK),
    tiendanube: (() => {
      const t = admin ? c.tiendanube : null;
      return { configurada: tnConfigurada(), conectada: Boolean(t && t.access_token), store_id: t ? t.store_id : null, desde: t ? t.desde : null,
        cuenta_id: t ? t.cuenta_id : null, cuenta_pn_id: t ? t.cuenta_pn_id : null, comision_pct: t ? t.comision_pct : null, comision_mp_pct: t ? t.comision_mp_pct : null, ultima_sync: t ? t.ultima_sync : null, ultimo_error: t ? t.ultimo_error : null };
    })(),
  });
});

