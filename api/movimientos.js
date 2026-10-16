import { randomBytes } from 'node:crypto';
import { q, one } from '../lib/db.js';
import { json, body, protegido, falla, esFecha } from '../lib/util.js';

const CANALES = ['', 'Tiendanube', 'WhatsApp', 'Instagram', 'Local', 'Otro'];

const SELECT = `SELECT m.id, m.fecha::text AS fecha, m.tipo, m.monto::float8 AS monto, m.cuenta_id, m.cuenta_destino_id,
  m.categoria_id, m.proveedor_id, m.recurrente_id, m.canal, m.detalle, m.facturado, m.grupo, m.origen,
  m.pedido_ref, m.pedido_id, m.creado_por, m.creado_en, m.editado_por, m.editado_en
  FROM movimientos m`;

function limpiar(x) {
  const tipo = x.tipo;
  if (!['ingreso', 'egreso', 'transferencia'].includes(tipo)) throw falla('Tipo de movimiento inválido.');
  if (!esFecha(x.fecha)) throw falla('La fecha no es válida.');
  const monto = Math.round(Number(x.monto) * 100) / 100;
  if (!(monto > 0)) throw falla('El monto tiene que ser mayor a cero.');
  const cuenta_id = +x.cuenta_id || null;
  if (!cuenta_id) throw falla('Elegí la cuenta.');
  const m = {
    fecha: x.fecha, tipo, monto, cuenta_id,
    cuenta_destino_id: null, categoria_id: null, proveedor_id: +x.proveedor_id || null,
    recurrente_id: +x.recurrente_id || null,
    canal: CANALES.includes(x.canal) ? x.canal : '',
    detalle: String(x.detalle ?? '').trim().slice(0, 200),
    facturado: tipo === 'ingreso' && Boolean(x.facturado),
  };
  if (tipo === 'transferencia') {
    m.cuenta_destino_id = +x.cuenta_destino_id || null;
    if (!m.cuenta_destino_id) throw falla('Elegí la cuenta destino.');
    if (m.cuenta_destino_id === cuenta_id) throw falla('La cuenta de origen y destino no pueden ser la misma.');
    m.canal = '';
  } else {
    m.categoria_id = +x.categoria_id || null;
    if (!m.categoria_id) throw falla('Elegí la categoría.');
  }
  return m;
}

const CAMPOS = ['fecha', 'tipo', 'monto', 'cuenta_id', 'cuenta_destino_id', 'categoria_id', 'proveedor_id', 'recurrente_id', 'canal', 'detalle', 'facturado'];

export const GET = protegido(async (request) => {
  const u = new URL(request.url);
  const desde = u.searchParams.get('desde'), hasta = u.searchParams.get('hasta');
  if (!esFecha(desde) || !esFecha(hasta)) throw falla('Rango de fechas inválido.');
  const rows = await q(`${SELECT} WHERE m.borrado_en IS NULL AND m.fecha BETWEEN $1 AND $2 ORDER BY m.fecha DESC, m.id DESC`, [desde, hasta]);
  return json({ movimientos: rows });
});

// { movimientos: [..] } (1 a 3 líneas que se guardan juntas)  ·  { pedido: { ref, id } } opcional
export const POST = protegido(async (request, yo) => {
  const b = await body(request);
  if (b.accion === 'vincularPedido') return vincular(b, yo);
  const lista = Array.isArray(b.movimientos) ? b.movimientos : [];
  if (!lista.length || lista.length > 5) throw falla('No hay movimientos para guardar.');
  const filas = lista.map(limpiar);
  const grupo = filas.length > 1 ? randomBytes(6).toString('hex') : null;
  const pedidoRef = b.pedido && typeof b.pedido.ref === 'string' ? b.pedido.ref.slice(0, 200) : null;
  const pedidoId = b.pedido && typeof b.pedido.id === 'string' ? b.pedido.id.slice(0, 60) : null;

  const cols = [...CAMPOS, 'grupo', 'origen', 'pedido_ref', 'pedido_id', 'creado_por'];
  const params = [];
  const values = filas.map((f, i) => {
    const vals = [...CAMPOS.map((k) => f[k]), grupo, pedidoRef ? 'pedido' : 'manual', i === 0 ? pedidoRef : null, pedidoId, yo.id];
    const ph = vals.map((v) => { params.push(v); return `$${params.length}`; });
    return `(${ph.join(', ')})`;
  });
  let rows;
  try {
    rows = await q(`INSERT INTO movimientos (${cols.join(', ')}) VALUES ${values.join(', ')} RETURNING id`, params);
  } catch (e) {
    if (e && e.code === '23505') throw falla('Ese pago del pedido ya está registrado en la caja.', 409);
    throw e;
  }
  return json({ ok: true, ids: rows.map((r) => r.id) });
});

export const PUT = protegido(async (request, yo) => {
  const b = await body(request);
  const id = +b.id || 0;
  const prev = await one(`SELECT id FROM movimientos WHERE id = $1 AND borrado_en IS NULL`, [id]);
  if (!prev) throw falla('El movimiento ya no existe.', 404);
  const f = limpiar(b);
  const sets = CAMPOS.map((k, i) => `${k} = $${i + 1}`);
  await q(
    `UPDATE movimientos SET ${sets.join(', ')}, editado_por = $${CAMPOS.length + 1}, editado_en = now() WHERE id = $${CAMPOS.length + 2}`,
    [...CAMPOS.map((k) => f[k]), yo.id, id],
  );
  return json({ ok: true });
});

export const DELETE = protegido(async (request, yo) => {
  const id = +new URL(request.url).searchParams.get('id') || 0;
  const r = await one(
    `UPDATE movimientos SET borrado_en = now(), borrado_por = $1, pedido_ref = NULL WHERE id = $2 AND borrado_en IS NULL RETURNING id`,
    [yo.id, id],
  );
  if (!r) throw falla('El movimiento ya no existe.', 404);
  return json({ ok: true });
});

async function vincular(b, yo) {
  const id = +b.id || 0;
  const ref = typeof b.ref === 'string' ? b.ref.slice(0, 200) : '';
  if (!ref) throw falla('Falta el pago del pedido.');
  try {
    const r = await one(
      `UPDATE movimientos SET pedido_ref = $1, pedido_id = $2, editado_por = $3, editado_en = now()
       WHERE id = $4 AND borrado_en IS NULL AND pedido_ref IS NULL RETURNING id`,
      [ref, String(b.pedidoId || '').slice(0, 60), yo.id, id],
    );
    if (!r) throw falla('Ese movimiento ya está vinculado a otro pago.', 409);
  } catch (e) {
    if (e && e.code === '23505') throw falla('Ese pago del pedido ya está registrado en la caja.', 409);
    throw e;
  }
  return json({ ok: true });
}
