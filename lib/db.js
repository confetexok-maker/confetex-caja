import { readFileSync } from 'node:fs';
import { leer, actualizar, crearSiNoExiste, listar } from './store.js';

export const INICIO = '2026-10-01';
const CONFIG = 'caja/config.json';
const mesPath = (m) => `caja/movs/${m}.json`;

/* ---------------- datos iniciales ---------------- */

const CUENTAS = [
  ['Mercado Pago', 'billetera'], ['Efectivo', 'efectivo'], ['Santander', 'banco'], ['Brubank', 'banco'], ['BBVA', 'banco'],
  ['Tarjeta BBVA Visa', 'tarjeta'], ['Tarjeta BBVA Master', 'tarjeta'], ['Tarjeta Santander Visa', 'tarjeta'], ['Tarjeta Brubank', 'tarjeta'],
];
// tipo: ingreso | variable | fijo | ganancia | financiero | revisar
const CATEGORIAS = [
  ['Ventas', 'ingreso'], ['Envíos cobrados', 'ingreso'], ['Otros ingresos', 'ingreso'],
  ['Materiales', 'variable'], ['Producción', 'variable'], ['Envíos pagados', 'variable'], ['Packaging', 'variable'],
  ['Comisiones e impuestos MP', 'variable'], ['Marketing', 'variable'], ['Logística', 'variable'],
  ['Sueldos', 'fijo'], ['Alquiler local', 'fijo'], ['Servicios (luz, agua, internet)', 'fijo'], ['Software y apps', 'fijo'],
  ['Monotributo e impuestos', 'fijo'], ['Contadora', 'fijo'], ['Seguros', 'fijo'], ['Gastos del local', 'fijo'],
  ['Gastos bancarios y tarjetas', 'fijo'],
  ['Retiros Nicolas', 'ganancia'], ['Muebles y equipamiento', 'ganancia'], ['Devolución de préstamos', 'ganancia'],
  ['Préstamo recibido', 'financiero'], ['Ajuste de saldo', 'financiero'],
  ['Sin clasificar', 'revisar'],
];
const PROVEEDORES = [
  ['Ruth', 'Costura'], ['Tomas', 'Costura'], ['Nancy', 'Costura'], ['Roxana', 'Costura'], ['Aye', 'Costura'],
  ['Marilina', 'Modista'], ['Oscar', 'Corte'], ['Max', 'Estampado'], ['Mariano', 'Bordado'], ['Joaquin', 'Bordado'],
  ['CLAD', 'Textil'], ['Neoxela', 'Textil'], ['Noeli', 'Empleada'], ['Maylen', 'Empleada'], ['CM', 'Empleado'],
];
// [nombre, tipo, categoria, proveedor, cuenta destino, monto, dia]
const RECURRENTES = [
  ['Alquiler local', 'egreso', 'Alquiler local', null, null, 830000, 10],
  ['Monotributo', 'egreso', 'Monotributo e impuestos', null, null, 115000, 20],
  ['Contadora', 'egreso', 'Contadora', null, null, 60000, 20],
  ['Sueldo Noeli', 'egreso', 'Sueldos', 'Noeli', null, null, 28],
  ['Sueldo Maylen', 'egreso', 'Sueldos', 'Maylen', null, null, 5],
  ['Sueldo CM', 'egreso', 'Sueldos', 'CM', null, 400000, 18],
  ['Internet', 'egreso', 'Servicios (luz, agua, internet)', null, null, null, 10],
  ['Luz', 'egreso', 'Servicios (luz, agua, internet)', null, null, null, 15],
  ['Agua', 'egreso', 'Servicios (luz, agua, internet)', null, null, null, 15],
  ['Tiendanube', 'egreso', 'Software y apps', null, null, null, 5],
  ['Adobe', 'egreso', 'Software y apps', null, null, null, 6],
  ['Resumen BBVA Visa', 'transferencia', null, null, 'Tarjeta BBVA Visa', null, 7],
  ['Resumen BBVA Master', 'transferencia', null, null, 'Tarjeta BBVA Master', null, 9],
  ['Resumen Santander Visa', 'transferencia', null, null, 'Tarjeta Santander Visa', null, 9],
  ['Resumen Brubank', 'transferencia', null, null, 'Tarjeta Brubank', null, 6],
];

function configInicial() {
  const c = { version: 1, creado: new Date().toISOString(), seedMovs: false, seq: {}, ignorados: {} };
  const tabla = (nombre, filas) => { c[nombre] = filas.map((f, i) => ({ id: i + 1, ...f })); c.seq[nombre] = filas.length; };
  tabla('usuarios', ['Nicolas', 'Noely'].map((nombre) => ({ nombre, pin_hash: null, activo: true })));
  tabla('cuentas', CUENTAS.map(([nombre, tipo], orden) => ({ nombre, tipo, orden, activa: true })));
  tabla('categorias', CATEGORIAS.map(([nombre, tipo], orden) => ({ nombre, tipo, orden, activa: true })));
  tabla('proveedores', PROVEEDORES.map(([nombre, rubro]) => ({ nombre, rubro, telefono: '', notas: '', activo: true })));
  const id = (t, n) => (n ? c[t].find((x) => x.nombre === n).id : null);
  tabla('recurrentes', RECURRENTES.map(([nombre, tipo, cat, prov, dest, monto, dia]) => ({
    nombre, tipo, categoria_id: id('categorias', cat), proveedor_id: id('proveedores', prov),
    cuenta_id: id('cuentas', 'Mercado Pago'), cuenta_destino_id: id('cuentas', dest), monto, dia, activo: true,
  })));
  return c;
}

function movsPlanilla(cfg) {
  const id = (t, n) => (n ? cfg[t].find((x) => x.nombre === n).id : null);
  const rows = JSON.parse(readFileSync(new URL('./octubre-2026.json', import.meta.url), 'utf8'));
  return rows.map((r, i) => ({
    id: 1_000_000 + r.fila, fecha: r.fecha, tipo: r.tipo, monto: r.monto,
    cuenta_id: id('cuentas', r.cuenta), cuenta_destino_id: id('cuentas', r.cuentaDestino),
    categoria_id: id('categorias', r.categoria), proveedor_id: id('proveedores', r.proveedor), recurrente_id: null,
    canal: r.canal || '', detalle: r.detalle || '', facturado: false, grupo: null,
    origen: 'planilla', origen_ref: `planilla:${r.fila}`, pedido_ref: null, pedido_id: null,
    creado_por: null, creado_en: new Date(Date.UTC(2026, 9, 16) + i).toISOString(),
    editado_por: null, editado_en: null, borrado_por: null, borrado_en: null,
  }));
}

/* ---------------- acceso ---------------- */

let listo = false;
async function asegurar() {
  if (listo) return;
  let cur = await leer(CONFIG);
  if (!cur) { await crearSiNoExiste(CONFIG, configInicial()); cur = await leer(CONFIG); }
  if (!cur.data.seedMovs) {
    const filas = movsPlanilla(cur.data);
    await actualizar(mesPath('2026-10'), (d) => {
      const ya = new Set(d.movs.map((m) => m.origen_ref).filter(Boolean));
      for (const f of filas) if (!ya.has(f.origen_ref)) d.movs.push(f);
    }, () => ({ movs: [] }));
    await actualizar(CONFIG, (c) => { c.seedMovs = true; }, configInicial);
  }
  listo = true;
}

export async function leerConfig() {
  await asegurar();
  return (await leer(CONFIG)).data;
}

export async function actualizarConfig(fn) {
  await asegurar();
  return actualizar(CONFIG, fn, configInicial);
}

export async function meses() {
  await asegurar();
  return (await listar('caja/movs/')).map((p) => p.slice(10, 17)).filter((m) => /^\d{4}-\d{2}$/.test(m)).sort();
}

export async function leerMes(m) {
  await asegurar();
  const r = await leer(mesPath(m));
  return r ? r.data.movs : [];
}

export async function actualizarMes(m, fn) {
  await asegurar();
  return actualizar(mesPath(m), (d) => fn(d.movs), () => ({ movs: [] }));
}

/** Movimientos (no borrados) entre dos fechas, o de todos los meses. */
export async function movimientos(desde, hasta) {
  let ms = await meses();
  if (desde) ms = ms.filter((m) => m >= desde.slice(0, 7) && m <= hasta.slice(0, 7));
  const partes = await Promise.all(ms.map(leerMes));
  return partes.flat().filter((x) => !x.borrado_en && (!desde || (x.fecha >= desde && x.fecha <= hasta)));
}

export function nuevoId() {
  return Date.now() * 100 + Math.floor(Math.random() * 100);
}
