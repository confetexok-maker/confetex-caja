import { leerConfig, meses, leerMes, actualizarMes, nuevoId, INICIO } from './db.js';
import { leerPedidosJson, escribirPedidosJson } from './pedidos-store.js';

// Compras de tela cargadas en la pestaña Materiales de la app de pedidos → egresos en la caja.
// - Una compra (factura) = un egreso por el total de la factura, categoría "Materiales", en la fecha de la factura.
// - Si ya hay un egreso igual cargado a mano (mismo monto, ±3 días) lo vincula en vez de duplicar.
// - Si la compra cambia en la app de pedidos, actualiza el egreso (solo si nadie lo editó a mano en la caja).
// - Si el egreso se borró en la caja, no lo vuelve a crear.
// También publica la lista de cuentas de la caja para que la app de pedidos la muestre al cargar una compra.

const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
const dias = (a, b) => Math.abs((new Date(a + 'T12:00') - new Date(b + 'T12:00')) / 864e5);
const norm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const subItem = (it) => num(it.cantidad) * num(it.precio);
const totalCompra = (c) => (c.items || []).reduce((a, it) => a + subItem(it), 0) + num(c.flete) + num(c.impuestos);

function detalleCompra(c, prov) {
  const telas = (c.items || []).filter((it) => num(it.cantidad) > 0)
    .map((it) => `${[it.categoria, it.variante].filter(Boolean).join(' ')}${it.color ? ' ' + it.color : ''} ${num(it.cantidad)}${it.unidad === 'm' ? 'm' : 'kg'}`);
  return `Compra de tela${prov ? ' ' + prov : ''}${c.factura ? ' · ' + c.factura : ''}${telas.length ? ' · ' + telas.join(', ') : ''}`.slice(0, 300);
}

async function publicarCuentas(cfg) {
  const cuentas = cfg.cuentas.filter((c) => c.activa !== false).map((c) => c.nombre);
  const prev = await leerPedidosJson('materiales/caja-cuentas.json');
  if (prev && JSON.stringify(prev.cuentas) === JSON.stringify(cuentas)) return;
  await escribirPedidosJson('materiales/caja-cuentas.json', { cuentas, actualizado: new Date().toISOString() });
}

export async function importarComprasMateriales() {
  const cfg = await leerConfig();
  await publicarCuentas(cfg).catch((e) => console.error('publicar cuentas', e));
  const datos = await leerPedidosJson('materiales/datos.json');
  if (!datos || !Array.isArray(datos.compras)) return { creados: 0, actualizados: 0, vinculados: 0 };

  const provMat = new Map((datos.proveedores || []).map((p) => [p.id, p]));
  const cat = (cfg.categorias.find((c) => norm(c.nombre) === 'materiales') || {}).id || null;
  const cuentaPor = (n) => (n ? cfg.cuentas.find((c) => norm(c.nombre) === norm(n)) : null);
  const mp = cuentaPor('mercado pago') || cfg.cuentas[0];

  // todos los movimientos, incluidos los borrados (para no recrear lo que se borró a mano)
  const porMes = {};
  for (const m of await meses()) porMes[m] = await leerMes(m);
  const todos = Object.values(porMes).flat();
  const porRef = new Map(todos.filter((x) => x.materiales_ref).map((x) => [x.materiales_ref, x]));
  const usados = new Set();

  const crear = {}, cambiar = {}, vincular = {};
  for (const c of datos.compras) {
    if (!c.fecha || c.fecha < INICIO || !/^\d{4}-\d{2}-\d{2}$/.test(c.fecha)) continue;
    const monto = Math.round(totalCompra(c));
    if (!(monto > 0)) continue;
    const ref = `materiales:${c.id}`;
    const pm = provMat.get(c.proveedorId);
    const provCaja = pm ? cfg.proveedores.find((p) => norm(p.nombre) === norm(pm.nombre)) : null;
    const cuenta = cuentaPor(c.cuentaCaja) || mp;
    const detalle = detalleCompra(c, pm && pm.nombre) + (cuentaPor(c.cuentaCaja) ? '' : ' (revisar cuenta)');
    const ya = porRef.get(ref);
    if (ya) {
      if (ya.borrado_en || ya.editado_por || ya.fecha.slice(0, 7) !== c.fecha.slice(0, 7)) continue;
      if (ya.origen !== 'materiales') continue; // vinculado a un egreso cargado a mano: no se toca
      if (ya.monto !== monto || ya.fecha !== c.fecha || ya.detalle !== detalle || ya.cuenta_id !== cuenta.id || ya.proveedor_id !== (provCaja ? provCaja.id : null)) {
        (cambiar[ya.fecha.slice(0, 7)] ||= []).push({ id: ya.id, monto, fecha: c.fecha, detalle, cuenta_id: cuenta.id, proveedor_id: provCaja ? provCaja.id : null });
      }
      continue;
    }
    const dup = todos.find((m) => !m.borrado_en && m.tipo === 'egreso' && !m.materiales_ref && !m.pedido_ref && ['manual', 'planilla'].includes(m.origen || 'manual') && !usados.has(m.id) && Math.round(m.monto) === monto && dias(m.fecha, c.fecha) <= 3);
    if (dup) { usados.add(dup.id); (vincular[dup.fecha.slice(0, 7)] ||= []).push({ id: dup.id, ref }); continue; }
    (crear[c.fecha.slice(0, 7)] ||= []).push({
      fecha: c.fecha, tipo: 'egreso', monto, cuenta_id: cuenta.id, cuenta_destino_id: null,
      categoria_id: cat, proveedor_id: provCaja ? provCaja.id : null, recurrente_id: null, canal: '',
      detalle, facturado: false, grupo: null, origen: 'materiales', origen_ref: ref, materiales_ref: ref, pedido_ref: null, pedido_id: null,
      creado_por: null, creado_en: new Date().toISOString(), editado_por: null, editado_en: null, borrado_por: null, borrado_en: null,
    });
  }

  let creados = 0, actualizados = 0, vinculados = 0;
  for (const [mes, nuevos] of Object.entries(crear)) {
    await actualizarMes(mes, (lista) => {
      const refs = new Set(lista.map((m) => m.materiales_ref).filter(Boolean));
      let i = 0;
      for (const n of nuevos) if (!refs.has(n.materiales_ref)) { lista.push({ id: nuevoId() + i++, ...n }); creados++; }
    });
  }
  for (const [mes, items] of Object.entries(cambiar)) {
    await actualizarMes(mes, (lista) => {
      for (const it of items) {
        const m = lista.find((y) => y.id === it.id && !y.borrado_en && !y.editado_por);
        if (m) { Object.assign(m, { monto: it.monto, fecha: it.fecha, detalle: it.detalle, cuenta_id: it.cuenta_id, proveedor_id: it.proveedor_id }); actualizados++; }
      }
    });
  }
  for (const [mes, items] of Object.entries(vincular)) {
    await actualizarMes(mes, (lista) => {
      for (const it of items) {
        const m = lista.find((y) => y.id === it.id && !y.borrado_en && !y.materiales_ref);
        if (m) { m.materiales_ref = it.ref; vinculados++; }
      }
    });
  }
  return { creados, actualizados, vinculados };
}
