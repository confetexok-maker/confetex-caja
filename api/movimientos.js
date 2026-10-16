import { randomBytes } from 'node:crypto';
import { leerConfig, movimientos, actualizarMes, meses, leerMes, nuevoId } from '../lib/db.js';
import { json, body, protegido, falla, esFecha } from '../lib/util.js';

const CANALES = ['', 'Tiendanube', 'WhatsApp', 'Instagram', 'Local', 'Otro'];
const CAMPOS = ['fecha', 'tipo', 'monto', 'cuenta_id', 'cuenta_destino_id', 'categoria_id', 'proveedor_id', 'recurrente_id', 'canal', 'detalle', 'facturado'];
const mesDe = (f) => f.slice(0, 7);

function limpiar(x, cfg) {
  const tipo = x.tipo;
  if (!['ingreso', 'egreso', 'transferencia'].includes(tipo)) throw falla('Tipo de movimiento inválido.');
  if (!esFecha(x.fecha)) throw falla('La fecha no es válida.');
  const monto = Math.round(Number(x.monto) * 100) / 100;
  if (!(monto > 0)) throw falla('El monto tiene que ser mayor a cero.');
  const existe = (t, id) => cfg[t].some((y) => y.id === id);
  const cuenta_id = +x.cuenta_id || null;
  if (!cuenta_id || !existe('cuentas', cuenta_id)) throw falla('Elegí la cuenta.');
  const m = {
    fecha: x.fecha, tipo, monto, cuenta_id,
    cuenta_destino_id: null, categoria_id: null,
    proveedor_id: +x.proveedor_id && existe('proveedores', +x.proveedor_id) ? +x.proveedor_id : null,
    recurrente_id: +x.recurrente_id && existe('recurrentes', +x.recurrente_id) ? +x.recurrente_id : null,
    canal: CANALES.includes(x.canal) ? x.canal : '',
    detalle: String(x.detalle ?? '').trim().slice(0, 200),
    facturado: tipo === 'ingreso' && Boolean(x.facturado),
  };
  if (tipo === 'transferencia') {
    m.cuenta_destino_id = +x.cuenta_destino_id || null;
    if (!m.cuenta_destino_id || !existe('cuentas', m.cuenta_destino_id)) throw falla('Elegí la cuenta destino.');
    if (m.cuenta_destino_id === cuenta_id) throw falla('La cuenta de origen y destino no pueden ser la misma.');
    m.canal = '';
  } else {
    m.categoria_id = +x.categoria_id || null;
    if (!m.categoria_id || !existe('categorias', m.categoria_id)) throw falla('Elegí la categoría.');
  }
  return m;
}

const publico = (m) => { const { borrado_por, borrado_en, origen_ref, ...r } = m; return r; };

async function buscar(id) {
  for (const mes of (await meses()).reverse()) {
    const x = (await leerMes(mes)).find((m) => m.id === id && !m.borrado_en);
    if (x) return { mes, x };
  }
  return null;
}

async function refUsada(ref) {
  return (await movimientos()).some((m) => m.pedido_ref === ref);
}

export const GET = protegido(async (request) => {
  const u = new URL(request.url);
  const desde = u.searchParams.get('desde'), hasta = u.searchParams.get('hasta');
  if (!esFecha(desde) || !esFecha(hasta)) throw falla('Rango de fechas inválido.');
  const rows = (await movimientos(desde, hasta)).map(publico)
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creado_en.localeCompare(a.creado_en) || b.id - a.id);
  return json({ movimientos: rows });
});

// { movimientos: [..] } (1 a 3 líneas que se guardan juntas)  ·  { pedido: { ref, id } } opcional
export const POST = protegido(async (request, yo) => {
  const b = await body(request);
  if (b.accion === 'vincularPedido') return vincular(b, yo);
  const lista = Array.isArray(b.movimientos) ? b.movimientos : [];
  if (!lista.length || lista.length > 5) throw falla('No hay movimientos para guardar.');
  const cfg = await leerConfig();
  const filas = lista.map((x) => limpiar(x, cfg));
  const grupo = filas.length > 1 ? randomBytes(6).toString('hex') : null;
  const pedidoRef = b.pedido && typeof b.pedido.ref === 'string' ? b.pedido.ref.slice(0, 200) : null;
  const pedidoId = b.pedido && typeof b.pedido.id === 'string' ? b.pedido.id.slice(0, 60) : null;
  if (pedidoRef && await refUsada(pedidoRef)) throw falla('Ese pago del pedido ya está registrado en la caja.', 409);

  const ahora = new Date().toISOString();
  const base = nuevoId();
  const nuevos = filas.map((f, i) => ({
    id: base + i, ...f, grupo, origen: pedidoRef ? 'pedido' : 'manual', origen_ref: null,
    pedido_ref: i === 0 ? pedidoRef : null, pedido_id: pedidoId,
    creado_por: yo.id, creado_en: ahora, editado_por: null, editado_en: null, borrado_por: null, borrado_en: null,
  }));
  const porMes = {};
  for (const n of nuevos) (porMes[mesDe(n.fecha)] ||= []).push(n);
  for (const [mes, ns] of Object.entries(porMes)) await actualizarMes(mes, (movs) => { movs.push(...ns); });
  return json({ ok: true, ids: nuevos.map((n) => n.id) });
});

export const PUT = protegido(async (request, yo) => {
  const b = await body(request);
  const id = +b.id || 0;
  const cfg = await leerConfig();
  const f = limpiar(b, cfg);
  const found = await buscar(id);
  if (!found) throw falla('El movimiento ya no existe.', 404);
  const ahora = new Date().toISOString();
  const cambios = { ...Object.fromEntries(CAMPOS.map((k) => [k, f[k]])), editado_por: yo.id, editado_en: ahora };
  const nuevoMes = mesDe(f.fecha);
  if (nuevoMes === found.mes) {
    await actualizarMes(found.mes, (movs) => {
      const x = movs.find((m) => m.id === id && !m.borrado_en);
      if (!x) throw falla('El movimiento ya no existe.', 404);
      Object.assign(x, cambios);
    });
  } else {
    // cambió de mes: se agrega en el mes nuevo y se quita del anterior
    let copia;
    await actualizarMes(found.mes, (movs) => {
      const i = movs.findIndex((m) => m.id === id && !m.borrado_en);
      if (i < 0) throw falla('El movimiento ya no existe.', 404);
      copia = { ...movs[i], ...cambios };
      movs.splice(i, 1);
    });
    await actualizarMes(nuevoMes, (movs) => { movs.push(copia); });
  }
  return json({ ok: true });
});

export const DELETE = protegido(async (request, yo) => {
  const id = +new URL(request.url).searchParams.get('id') || 0;
  const found = await buscar(id);
  if (!found) throw falla('El movimiento ya no existe.', 404);
  await actualizarMes(found.mes, (movs) => {
    const x = movs.find((m) => m.id === id && !m.borrado_en);
    if (!x) throw falla('El movimiento ya no existe.', 404);
    x.borrado_en = new Date().toISOString(); x.borrado_por = yo.id; x.pedido_ref = null;
  });
  return json({ ok: true });
});

async function vincular(b, yo) {
  const id = +b.id || 0;
  const ref = typeof b.ref === 'string' ? b.ref.slice(0, 200) : '';
  if (!ref) throw falla('Falta el pago del pedido.');
  if (await refUsada(ref)) throw falla('Ese pago del pedido ya está registrado en la caja.', 409);
  const found = await buscar(id);
  if (!found) throw falla('El movimiento ya no existe.', 404);
  await actualizarMes(found.mes, (movs) => {
    const x = movs.find((m) => m.id === id && !m.borrado_en);
    if (!x) throw falla('El movimiento ya no existe.', 404);
    if (x.pedido_ref) throw falla('Ese movimiento ya está vinculado a otro pago.', 409);
    x.pedido_ref = ref; x.pedido_id = String(b.pedidoId || '').slice(0, 60);
    x.editado_por = yo.id; x.editado_en = new Date().toISOString();
  });
  return json({ ok: true });
}
