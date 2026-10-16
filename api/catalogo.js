import { q, one } from '../lib/db.js';
import { json, body, protegido, falla, hashPin, pinValido, pinOk, claveAltaOk } from '../lib/util.js';

const TIPOS_CUENTA = ['billetera', 'banco', 'efectivo', 'tarjeta'];
const TIPOS_CATEGORIA = ['ingreso', 'variable', 'fijo', 'ganancia', 'financiero', 'revisar'];

const texto = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const entero = (v) => (v === null || v === '' || v === undefined ? null : Number.isFinite(+v) ? Math.trunc(+v) : null);
const montoOpc = (v) => (v === null || v === '' || v === undefined ? null : Number.isFinite(+v) && +v >= 0 ? Math.round(+v * 100) / 100 : null);
const bool = (v) => v !== false && v !== 'false' && v !== 0;

const TABLAS = {
  cuentas: {
    campos: (x) => {
      const nombre = texto(x.nombre, 60);
      if (!nombre) throw falla('La cuenta necesita un nombre.');
      if (!TIPOS_CUENTA.includes(x.tipo)) throw falla('Tipo de cuenta inválido.');
      return { nombre, tipo: x.tipo, orden: entero(x.orden) ?? 0, activa: bool(x.activa) };
    },
  },
  categorias: {
    campos: (x) => {
      const nombre = texto(x.nombre, 60);
      if (!nombre) throw falla('La categoría necesita un nombre.');
      if (!TIPOS_CATEGORIA.includes(x.tipo)) throw falla('Tipo de categoría inválido.');
      return { nombre, tipo: x.tipo, orden: entero(x.orden) ?? 0, activa: bool(x.activa) };
    },
  },
  proveedores: {
    campos: (x) => {
      const nombre = texto(x.nombre, 80);
      if (!nombre) throw falla('El proveedor necesita un nombre.');
      return { nombre, rubro: texto(x.rubro, 60), telefono: texto(x.telefono, 40), notas: texto(x.notas, 500), activo: bool(x.activo) };
    },
  },
  recurrentes: {
    campos: (x) => {
      const nombre = texto(x.nombre, 80);
      if (!nombre) throw falla('El vencimiento necesita un nombre.');
      const tipo = x.tipo === 'transferencia' ? 'transferencia' : 'egreso';
      const dia = entero(x.dia);
      if (!dia || dia < 1 || dia > 31) throw falla('El día de vencimiento va de 1 a 31.');
      if (tipo === 'egreso' && !entero(x.categoria_id)) throw falla('Elegí la categoría del gasto.');
      if (tipo === 'transferencia' && !entero(x.cuenta_destino_id)) throw falla('Elegí la tarjeta o cuenta destino.');
      return {
        nombre, tipo, dia, monto: montoOpc(x.monto), activo: bool(x.activo),
        categoria_id: tipo === 'egreso' ? entero(x.categoria_id) : null,
        proveedor_id: entero(x.proveedor_id), cuenta_id: entero(x.cuenta_id),
        cuenta_destino_id: tipo === 'transferencia' ? entero(x.cuenta_destino_id) : null,
      };
    },
  },
};

// { tabla, item }  → crea (sin id) o actualiza (con id)
export const POST = protegido(async (request, yo) => {
  const b = await body(request);
  if (b.tabla === 'usuarios') return usuarios(b, yo);
  const t = TABLAS[b.tabla];
  if (!t || !b.item) throw falla('Pedido inválido.');
  const c = t.campos(b.item);
  const keys = Object.keys(c);
  const vals = keys.map((k) => c[k]);
  let row;
  if (b.item.id) {
    row = await one(
      `UPDATE ${b.tabla} SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1} RETURNING id`,
      [...vals, +b.item.id],
    );
    if (!row) throw falla('No se encontró el registro.', 404);
  } else {
    row = await one(
      `INSERT INTO ${b.tabla} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      vals,
    );
  }
  return json({ ok: true, id: row.id });
});

async function usuarios(b, yo) {
  if (b.accion === 'cambiarPin') {
    const u = await one(`SELECT pin_hash FROM usuarios WHERE id = $1`, [yo.id]);
    if (!pinOk(b.actual, u && u.pin_hash)) throw falla('El PIN actual no es correcto.', 401);
    if (!pinValido(b.nuevo)) throw falla('El PIN nuevo tiene que tener entre 4 y 8 números.');
    await q(`UPDATE usuarios SET pin_hash = $1 WHERE id = $2`, [hashPin(b.nuevo), yo.id]);
    return json({ ok: true });
  }
  if (b.accion === 'resetearPin') {
    if (!claveAltaOk(b.claveAlta)) throw falla('La clave de alta no es correcta.', 401);
    await q(`UPDATE usuarios SET pin_hash = NULL WHERE id = $1`, [+b.id || 0]);
    return json({ ok: true });
  }
  if (b.accion === 'agregar') {
    const nombre = texto(b.nombre, 40);
    if (!nombre) throw falla('Escribí el nombre.');
    const r = await one(`INSERT INTO usuarios (nombre) VALUES ($1) RETURNING id`, [nombre]);
    return json({ ok: true, id: r.id });
  }
  if (b.accion === 'activo') {
    if (+b.id === yo.id) throw falla('No podés desactivar tu propio usuario.');
    await q(`UPDATE usuarios SET activo = $1 WHERE id = $2`, [bool(b.activo), +b.id || 0]);
    return json({ ok: true });
  }
  throw falla('Acción inválida.');
}
