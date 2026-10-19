import { leerConfig, movimientos, actualizarMes, nuevoId, INICIO } from './db.js';
import { listarPedidos } from './pedidos.js';

const dias = (a, b) => Math.abs((new Date(a + 'T12:00') - new Date(b + 'T12:00')) / 864e5);

/**
 * Carga en la caja los pagos registrados en la app de pedidos (desde el inicio de la caja).
 * - Si ya hay un ingreso igual cargado a mano (mismo monto, ±3 días) lo vincula en vez de duplicar.
 * - No vuelve a cargar pagos marcados "no va a la caja" ni pagos cuyo movimiento se borró.
 */
export async function importarPagosPedidos() {
  const pedidos = await listarPedidos();
  if (!pedidos) return { creados: 0, vinculados: 0 };
  const cfg = await leerConfig();
  const ign = cfg.ignorados || {};
  const movs = await movimientos();
  const enCaja = new Set(movs.filter((m) => m.pedido_ref).map((m) => m.pedido_ref));
  const usados = new Set();
  const cuentaPor = (n) => (cfg.cuentas.find((c) => c.nombre.toLowerCase() === n) || {}).id;
  const mp = cuentaPor('mercado pago') || cfg.cuentas[0].id;
  const efectivo = cuentaPor('efectivo') || mp;
  const ventas = (cfg.categorias.find((c) => c.nombre === 'Ventas') || {}).id;

  const crear = {}, vincular = {};
  for (const p of pedidos) {
    const cliente = p.empresa || p.contacto || p.codigoCliente || 'cliente';
    for (const x of p.pagos) {
      if (!x.fecha || x.fecha < INICIO || enCaja.has(x.ref) || ign[x.ref]) continue;
      const dup = movs.find((m) => m.tipo === 'ingreso' && !m.pedido_ref && !usados.has(m.id) && Math.round(m.monto) === x.monto && dias(m.fecha, x.fecha) <= 3);
      if (dup) {
        usados.add(dup.id);
        (vincular[dup.fecha.slice(0, 7)] ||= []).push({ id: dup.id, ref: x.ref, pedidoId: p.id });
        continue;
      }
      const seña = /seña|sena/i.test(x.nota || '');
      (crear[x.fecha.slice(0, 7)] ||= []).push({
        fecha: x.fecha, tipo: 'ingreso', monto: x.monto,
        cuenta_id: /efectivo/i.test(x.medio || '') ? efectivo : mp, cuenta_destino_id: null,
        categoria_id: ventas, proveedor_id: null, recurrente_id: null, canal: 'WhatsApp',
        detalle: `${seña ? 'Seña' : 'Pago'} ${cliente}${p.codigoCliente ? ` (${p.codigoCliente})` : ''}${x.nota && !/^seña$/i.test(x.nota.trim()) ? ` · ${x.nota}` : ''}`,
        facturado: false, grupo: null, origen: 'pedido', origen_ref: null, pedido_ref: x.ref, pedido_id: p.id,
        creado_por: null, creado_en: new Date().toISOString(), editado_por: null, editado_en: null, borrado_por: null, borrado_en: null,
      });
    }
  }

  let creados = 0, vinculados = 0;
  for (const [mes, nuevos] of Object.entries(crear)) {
    await actualizarMes(mes, (lista) => {
      const ya = new Set(lista.filter((m) => m.pedido_ref).map((m) => m.pedido_ref));
      let i = 0;
      for (const n of nuevos) if (!ya.has(n.pedido_ref)) { lista.push({ id: nuevoId() + i++, ...n }); creados++; }
    });
  }
  for (const [mes, items] of Object.entries(vincular)) {
    await actualizarMes(mes, (lista) => {
      for (const it of items) {
        const m = lista.find((y) => y.id === it.id && !y.borrado_en && !y.pedido_ref);
        if (m) { m.pedido_ref = it.ref; m.pedido_id = it.pedidoId; vinculados++; }
      }
    });
  }
  return { creados, vinculados };
}
