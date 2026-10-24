import octubre2026 from './octubre-2026.json' with { type: 'json' };
import { leer, actualizar, crearSiNoExiste } from './store.js';

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
  tabla('usuarios', [['Nicolas', 'admin'], ['Noely', 'carga']].map(([nombre, rol]) => ({ nombre, rol, pin_hash: null, activo: true })));
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
  const rows = octubre2026;
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
    await escribirMes('2026-10', (movs) => {
      const ya = new Set(movs.map((m) => m.origen_ref).filter(Boolean));
      for (const f of filas) if (!ya.has(f.origen_ref)) movs.push(f);
    });
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
  if (!(cur.data.migraciones || []).includes('roles-1')) {
    // Nicolas administra; el resto carga movimientos (sin panel, saldos ni totales)
    await actualizar(CONFIG, (c) => {
      c.migraciones ||= [];
      if (c.migraciones.includes('roles-1')) return;
      for (const u of c.usuarios) u.rol = u.nombre === 'Nicolas' ? 'admin' : (u.rol || 'carga');
      c.migraciones.push('roles-1');
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

/* ---------------- movimientos: una fila por movimiento en D1 ----------------
 * Así saldos, búsquedas y reportes se calculan en la base de datos y cada pedido a la app usa muy poco
 * procesamiento (el plan gratis de Cloudflare permite 10 ms por pedido). Se mantiene la misma forma de
 * trabajar de antes: leerMes(mes) y actualizarMes(mes, fn(lista)).
 */
const dbx = () => {
  const d = globalThis.__DB;
  if (!d) throw new Error('Falta la base de datos D1 (binding DB).');
  return d;
};
let esquemaListo = false;
async function esquemaMovs() {
  if (esquemaListo) return;
  const d = dbx();
  await d.batch([
    d.prepare(`CREATE TABLE IF NOT EXISTS movs (id INTEGER PRIMARY KEY, mes TEXT NOT NULL, fecha TEXT, tipo TEXT, monto REAL, cuenta_id INTEGER, cuenta_destino_id INTEGER,
      borrado INTEGER NOT NULL DEFAULT 0, origen_ref TEXT, pedido_ref TEXT, materiales_ref TEXT, grupo TEXT, canal TEXT, detalle TEXT, json TEXT NOT NULL)`),
    d.prepare('CREATE INDEX IF NOT EXISTS movs_mes ON movs (mes)'),
    d.prepare('CREATE INDEX IF NOT EXISTS movs_fecha ON movs (fecha)'),
    d.prepare('CREATE INDEX IF NOT EXISTS movs_pedido_ref ON movs (pedido_ref)'),
    d.prepare('CREATE INDEX IF NOT EXISTS movs_origen_ref ON movs (origen_ref)'),
    d.prepare('CREATE INDEX IF NOT EXISTS movs_grupo ON movs (grupo)'),
    d.prepare('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)'),
  ]);
  esquemaListo = true;
}
const filaMov = (mes, m) => [m.id, mes, m.fecha || null, m.tipo || null, m.monto ?? 0, m.cuenta_id ?? null, m.cuenta_destino_id ?? null, m.borrado_en ? 1 : 0,
  m.origen_ref || null, m.pedido_ref || null, m.materiales_ref || null, m.grupo || null, m.canal || null, m.detalle || null, JSON.stringify(m)];
const SQL_UPSERT = `INSERT INTO movs (id, mes, fecha, tipo, monto, cuenta_id, cuenta_destino_id, borrado, origen_ref, pedido_ref, materiales_ref, grupo, canal, detalle, json)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET mes=excluded.mes, fecha=excluded.fecha, tipo=excluded.tipo, monto=excluded.monto, cuenta_id=excluded.cuenta_id,
  cuenta_destino_id=excluded.cuenta_destino_id, borrado=excluded.borrado, origen_ref=excluded.origen_ref, pedido_ref=excluded.pedido_ref, materiales_ref=excluded.materiales_ref,
  grupo=excluded.grupo, canal=excluded.canal, detalle=excluded.detalle, json=excluded.json`;
const subeMeta = () => dbx().prepare('INSERT INTO meta (k, v) VALUES (?, 1) ON CONFLICT(k) DO UPDATE SET v = v + 1').bind('movs');

async function escribirMes(m, fn) {
  await esquemaMovs();
  const d = dbx();
  const { results } = await d.prepare('SELECT id, json FROM movs WHERE mes=? ORDER BY id').bind(m).all();
  const antes = new Map(results.map((r) => [r.id, r.json]));
  const lista = results.map((r) => JSON.parse(r.json));
  const res = await fn(lista);
  // se guardan solo las filas nuevas o modificadas (dos personas editando movimientos distintos no se pisan)
  const stmts = [];
  const vistos = new Set();
  for (const x of lista) {
    vistos.add(x.id);
    const txt = JSON.stringify(x);
    if (antes.get(x.id) !== txt) stmts.push(d.prepare(SQL_UPSERT).bind(...filaMov(m, x)));
  }
  for (const id of antes.keys()) if (!vistos.has(id)) stmts.push(d.prepare('DELETE FROM movs WHERE id=? AND mes=?').bind(id, m));
  if (stmts.length) {
    stmts.push(subeMeta());
    for (let i = 0; i < stmts.length; i += 50) await d.batch(stmts.slice(i, i + 50));
  }
  return res;
}

export async function meses() {
  await asegurar(); await esquemaMovs();
  const { results } = await dbx().prepare('SELECT DISTINCT mes FROM movs ORDER BY mes').all();
  return results.map((r) => r.mes).filter((m) => /^\d{4}-\d{2}$/.test(m));
}

export async function leerMes(m) {
  await asegurar(); await esquemaMovs();
  const { results } = await dbx().prepare('SELECT json FROM movs WHERE mes=? ORDER BY id').bind(m).all();
  return results.map((r) => JSON.parse(r.json));
}

export async function actualizarMes(m, fn) {
  await asegurar();
  return escribirMes(m, fn);
}

/** Movimientos (no borrados) entre dos fechas, o todos. */
export async function movimientos(desde, hasta) {
  await asegurar(); await esquemaMovs();
  const q = desde
    ? dbx().prepare('SELECT json FROM movs WHERE borrado=0 AND fecha>=? AND fecha<=? ORDER BY id').bind(desde, hasta)
    : dbx().prepare('SELECT json FROM movs WHERE borrado=0 ORDER BY id');
  return (await q.all()).results.map((r) => JSON.parse(r.json));
}

/** Saldo de cada cuenta, calculado en la base de datos. */
export async function saldosPorCuenta() {
  await asegurar(); await esquemaMovs();
  const { results } = await dbx().prepare('SELECT tipo, cuenta_id, cuenta_destino_id, SUM(monto) AS total FROM movs WHERE borrado=0 GROUP BY tipo, cuenta_id, cuenta_destino_id').all();
  const saldo = {};
  for (const r of results) {
    if (r.tipo === 'ingreso') saldo[r.cuenta_id] = (saldo[r.cuenta_id] || 0) + r.total;
    else saldo[r.cuenta_id] = (saldo[r.cuenta_id] || 0) - r.total;
    if (r.tipo === 'transferencia') saldo[r.cuenta_destino_id] = (saldo[r.cuenta_destino_id] || 0) + r.total;
  }
  return saldo;
}

/** { pedido_ref → id } de los pagos de pedidos que ya están en la caja. */
export async function pagosEnCaja() {
  await asegurar(); await esquemaMovs();
  const { results } = await dbx().prepare('SELECT pedido_ref, id FROM movs WHERE borrado=0 AND pedido_ref IS NOT NULL').all();
  return Object.fromEntries(results.map((r) => [r.pedido_ref, r.id]));
}

/** Un movimiento no borrado por id → { mes, x } (o null). */
export async function buscarMov(id) {
  await asegurar(); await esquemaMovs();
  const r = await dbx().prepare('SELECT mes, json FROM movs WHERE id=? AND borrado=0').bind(id).first();
  return r ? { mes: r.mes, x: JSON.parse(r.json) } : null;
}

/** Consulta libre de movimientos (con parámetros): devuelve los movimientos completos. */
export async function consultarMovs(where, params = []) {
  await asegurar(); await esquemaMovs();
  const { results } = await dbx().prepare(`SELECT json FROM movs WHERE ${where}`).bind(...params).all();
  return results.map((r) => JSON.parse(r.json));
}
/** Igual pero devolviendo columnas livianas (sin leer el JSON entero). */
export async function consultarCols(cols, where, params = []) {
  await asegurar(); await esquemaMovs();
  return (await dbx().prepare(`SELECT ${cols} FROM movs WHERE ${where}`).bind(...params).all()).results;
}
/** Ejecuta fn solo si "valor" cambió desde la última vez que se ejecutó (evita revisar todo en cada pantalla). */
export async function siCambio(nombre, valor, fn) {
  await esquemaMovs();
  const k = 'gate_' + nombre;
  const r = await dbx().prepare('SELECT v FROM meta WHERE k=?').bind(k).first();
  if (valor != null && r && String(r.v) === String(valor)) return null;
  const out = await fn();
  if (valor != null) await dbx().prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(k, String(valor)).run();
  return out;
}
/** Versión (etag) de un archivo guardado, sin leerlo. */
export async function etagArchivo(path) {
  try { const r = await dbx().prepare('SELECT etag FROM kv WHERE path=?').bind(path).first(); return r ? r.etag : null; } catch { return null; }
}
export async function versionMovs() {
  await esquemaMovs();
  const r = await dbx().prepare("SELECT v FROM meta WHERE k='movs'").first();
  return r ? r.v : 0;
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
    const actuales = await consultarCols("origen_ref, borrado, json_extract(json,'$.recurrente_id') AS rid", 'mes=?', [m]);
    const falta = items.filter(({ r }) => !actuales.some((x) => x.origen_ref === `auto:${r.id}:${m}` || (x.rid === r.id && !x.borrado)));
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
