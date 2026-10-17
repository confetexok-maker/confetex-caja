import { readFileSync } from 'node:fs';
import { leer, actualizar, crearSiNoExiste, listar } from './store.js';

export const INICIO = '2026-10-01';
const CONFIG = 'caja/config.json';
const mesPath = (m) => `caja/movs/${m}.json`;

/* ---------------- datos iniciales ---------------- */

const CUENTAS = [
  ['Mercado Pago', 'billetera'], ['Pago Nube', 'billetera'], ['Efectivo', 'efectivo'], ['Santander', 'banco'], ['Brubank', 'banco'], ['BBVA', 'banco'],
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
  ['CLAD', 'Textil'], ['Neoxela', 'Textil'], ['Noely', 'Empleada'], ['Maylen', 'Empleada'], ['CM', 'Empleada'],
];
// [nombre, tipo, categoria, proveedor, cuenta destino, monto, dia]
const RECURRENTES = [
  ['Alquiler local', 'egreso', 'Alquiler local', null, null, 830000, 10],
  ['Monotributo', 'egreso', 'Monotributo e impuestos', null, null, 115000, 20],
  ['Contadora', 'egreso', 'Contadora', null, null, 60000, 20],
  ['Sueldo Noely', 'egreso', 'Sueldos', 'Noely', null, null, 28],
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
    cur = await leer(CONFIG);
  }
  if (!(cur.data.migraciones || []).includes('empleadas-1')) {
    // Noely, Maylen y CM son empleadas; corrige nombre y rubro de los datos iniciales
    await actualizar(CONFIG, (c) => {
      c.migraciones ||= [];
      if (c.migraciones.includes('empleadas-1')) return;
      for (const p of c.proveedores) {
        if (p.nombre === 'Noeli') p.nombre = 'Noely';
        if (['Noely', 'Maylen', 'CM'].includes(p.nombre)) p.rubro = 'Empleada';
      }
      for (const r of c.recurrentes) if (r.nombre === 'Sueldo Noeli') r.nombre = 'Sueldo Noely';
      c.migraciones.push('empleadas-1');
    }, configInicial);
  }
  if (!(cur.data.migraciones || []).includes('pago-nube-1')) {
    // Cuenta donde quedan retenidas las ventas cobradas con Pago Nube hasta pasarlas a Mercado Pago
    await actualizar(CONFIG, (c) => {
      c.migraciones ||= [];
      if (c.migraciones.includes('pago-nube-1')) return;
      let pn = c.cuentas.find((x) => x.nombre.toLowerCase() === 'pago nube');
      if (!pn) {
        c.seq.cuentas = (c.seq.cuentas || Math.max(0, ...c.cuentas.map((x) => x.id))) + 1;
        const mp = c.cuentas.find((x) => x.nombre === 'Mercado Pago');
        pn = { id: c.seq.cuentas, nombre: 'Pago Nube', tipo: 'billetera', orden: mp ? mp.orden : 0, activa: true };
        c.cuentas.push(pn);
      }
      if (c.tiendanube && !c.tiendanube.cuenta_pn_id) c.tiendanube.cuenta_pn_id = pn.id;
      c.migraciones.push('pago-nube-1');
    }, configInicial);
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

export const esFechaOk = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

/** Fecha de hoy en Argentina (AAAA-MM-DD). */
export function hoyAR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
}

const sumarMes = (m) => { let [y, mm] = m.split('-').map(Number); mm++; if (mm > 12) { mm = 1; y++; } return `${y}-${String(mm).padStart(2, '0')}`; };
const finDeMes = (m) => { const [y, mm] = m.split('-').map(Number); return new Date(y, mm, 0).getDate(); };

/**
 * Débitos automáticos: crea el movimiento de cada gasto fijo marcado como automático
 * cuando llega su día. No repite (referencia única por mes) y no lo vuelve a crear si alguien lo borró
 * o si ese mes ya se pagó a mano.
 */
export async function aplicarAutomaticos() {
  const cfg = await leerConfig();
  const recs = cfg.recurrentes.filter((r) => r.activo && r.automatico && r.monto > 0 && r.cuenta_id && r.auto_desde);
  if (!recs.length) return 0;
  const hoy = hoyAR();
  const porMes = {};
  for (const r of recs) {
    let m = (r.auto_desde > INICIO ? r.auto_desde : INICIO).slice(0, 7);
    while (m <= hoy.slice(0, 7)) {
      const fecha = `${m}-${String(Math.min(r.dia, finDeMes(m))).padStart(2, '0')}`;
      if (fecha >= r.auto_desde && fecha <= hoy) (porMes[m] ||= []).push({ r, fecha });
      m = sumarMes(m);
    }
  }
  let creados = 0;
  for (const [m, items] of Object.entries(porMes)) {
    const actuales = await leerMes(m);
    const falta = items.filter(({ r }) => !actuales.some((x) => x.origen_ref === `auto:${r.id}:${m}` || (x.recurrente_id === r.id && !x.borrado_en)));
    if (!falta.length) continue;
    await actualizarMes(m, (movs) => {
      for (const { r, fecha } of falta) {
        const ref = `auto:${r.id}:${m}`;
        if (movs.some((x) => x.origen_ref === ref || (x.recurrente_id === r.id && !x.borrado_en))) continue;
        movs.push({
          id: nuevoId() + creados, fecha, tipo: r.tipo, monto: r.monto,
          cuenta_id: r.cuenta_id, cuenta_destino_id: r.tipo === 'transferencia' ? r.cuenta_destino_id : null,
          categoria_id: r.tipo === 'egreso' ? r.categoria_id : null, proveedor_id: r.proveedor_id || null, recurrente_id: r.id,
          canal: '', detalle: `${r.nombre} (débito automático)`, facturado: false, grupo: null,
          origen: 'automatico', origen_ref: ref, pedido_ref: null, pedido_id: null,
          creado_por: null, creado_en: new Date().toISOString(), editado_por: null, editado_en: null, borrado_por: null, borrado_en: null,
        });
        creados++;
      }
    });
  }
  return creados;
}

export function nuevoId() {
  return Date.now() * 100 + Math.floor(Math.random() * 100);
}
