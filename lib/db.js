import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

let runner = null;
let ready = null;

/** Solo para desarrollo local: reemplaza la conexión por otra (PGlite). */
export function setRunner(fn) {
  runner = fn;
  ready = null;
}

function getRunner() {
  if (runner) return runner;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    const e = new Error('Falta conectar la base de datos (DATABASE_URL) en Vercel.');
    e.code = 'NO_DB';
    throw e;
  }
  const sql = neon(url);
  runner = (text, params) => sql.query(text, params);
  return runner;
}

export async function q(text, params = []) {
  const run = getRunner();
  if (!ready) ready = ensureSchema(run).catch((e) => { ready = null; throw e; });
  await ready;
  return run(text, params);
}

export async function one(text, params = []) {
  const rows = await q(text, params);
  return rows[0] || null;
}

/* ---------------- esquema ---------------- */

export const INICIO = '2026-10-01';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (k text PRIMARY KEY, v text)`,
  `CREATE TABLE IF NOT EXISTS usuarios (
     id serial PRIMARY KEY, nombre text UNIQUE NOT NULL, pin_hash text,
     activo boolean NOT NULL DEFAULT true, creado timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS cuentas (
     id serial PRIMARY KEY, nombre text UNIQUE NOT NULL, tipo text NOT NULL DEFAULT 'banco',
     orden int NOT NULL DEFAULT 0, activa boolean NOT NULL DEFAULT true)`,
  `CREATE TABLE IF NOT EXISTS categorias (
     id serial PRIMARY KEY, nombre text UNIQUE NOT NULL, tipo text NOT NULL,
     orden int NOT NULL DEFAULT 0, activa boolean NOT NULL DEFAULT true)`,
  `CREATE TABLE IF NOT EXISTS proveedores (
     id serial PRIMARY KEY, nombre text UNIQUE NOT NULL, rubro text NOT NULL DEFAULT '',
     telefono text NOT NULL DEFAULT '', notas text NOT NULL DEFAULT '', activo boolean NOT NULL DEFAULT true)`,
  `CREATE TABLE IF NOT EXISTS recurrentes (
     id serial PRIMARY KEY, nombre text UNIQUE NOT NULL, tipo text NOT NULL DEFAULT 'egreso',
     categoria_id int REFERENCES categorias(id), proveedor_id int REFERENCES proveedores(id),
     cuenta_id int REFERENCES cuentas(id), cuenta_destino_id int REFERENCES cuentas(id),
     monto numeric(14,2), dia int NOT NULL DEFAULT 1, activo boolean NOT NULL DEFAULT true)`,
  `CREATE TABLE IF NOT EXISTS movimientos (
     id serial PRIMARY KEY,
     fecha date NOT NULL,
     tipo text NOT NULL CHECK (tipo IN ('ingreso','egreso','transferencia')),
     monto numeric(14,2) NOT NULL CHECK (monto > 0),
     cuenta_id int NOT NULL REFERENCES cuentas(id),
     cuenta_destino_id int REFERENCES cuentas(id),
     categoria_id int REFERENCES categorias(id),
     proveedor_id int REFERENCES proveedores(id),
     recurrente_id int REFERENCES recurrentes(id),
     canal text NOT NULL DEFAULT '',
     detalle text NOT NULL DEFAULT '',
     facturado boolean NOT NULL DEFAULT false,
     grupo text,
     origen text NOT NULL DEFAULT 'manual',
     origen_ref text UNIQUE,
     pedido_ref text UNIQUE,
     pedido_id text,
     creado_por int REFERENCES usuarios(id),
     creado_en timestamptz NOT NULL DEFAULT now(),
     editado_por int REFERENCES usuarios(id),
     editado_en timestamptz,
     borrado_por int REFERENCES usuarios(id),
     borrado_en timestamptz)`,
  `CREATE INDEX IF NOT EXISTS movimientos_fecha ON movimientos (fecha)`,
  `CREATE TABLE IF NOT EXISTS pagos_ignorados (
     ref text PRIMARY KEY, por int REFERENCES usuarios(id), en timestamptz NOT NULL DEFAULT now())`,
];

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

async function ensureSchema(run) {
  for (const s of SCHEMA) await run(s, []);
  const done = await run(`SELECT v FROM meta WHERE k = 'seed'`, []);
  if (done.length) return;
  await seed(run);
}

async function seed(run) {
  for (const n of ['Nicolas', 'Noely']) await run(`INSERT INTO usuarios (nombre) VALUES ($1) ON CONFLICT DO NOTHING`, [n]);
  for (const [i, [n, t]] of CUENTAS.entries()) await run(`INSERT INTO cuentas (nombre, tipo, orden) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [n, t, i]);
  for (const [i, [n, t]] of CATEGORIAS.entries()) await run(`INSERT INTO categorias (nombre, tipo, orden) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [n, t, i]);
  for (const [n, r] of PROVEEDORES) await run(`INSERT INTO proveedores (nombre, rubro) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [n, r]);

  const ids = async (tabla) => Object.fromEntries((await run(`SELECT id, nombre FROM ${tabla}`, [])).map((r) => [r.nombre, r.id]));
  const cu = await ids('cuentas'), ca = await ids('categorias'), pr = await ids('proveedores');

  for (const [n, t, c, p, d, m, dia] of RECURRENTES) {
    await run(
      `INSERT INTO recurrentes (nombre, tipo, categoria_id, proveedor_id, cuenta_id, cuenta_destino_id, monto, dia) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [n, t, c ? ca[c] : null, p ? pr[p] : null, cu['Mercado Pago'], d ? cu[d] : null, m, dia],
    );
  }

  const rows = JSON.parse(readFileSync(new URL('./octubre-2026.json', import.meta.url), 'utf8'));
  for (const r of rows) {
    await run(
      `INSERT INTO movimientos (fecha, tipo, monto, cuenta_id, cuenta_destino_id, categoria_id, proveedor_id, canal, detalle, origen, origen_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'planilla',$10) ON CONFLICT DO NOTHING`,
      [r.fecha, r.tipo, r.monto, cu[r.cuenta], r.cuentaDestino ? cu[r.cuentaDestino] : null,
        r.categoria ? ca[r.categoria] : null, r.proveedor ? pr[r.proveedor] : null, r.canal || '', r.detalle || '', `planilla:${r.fila}`],
    );
  }
  await run(`INSERT INTO meta (k, v) VALUES ('seed', $1) ON CONFLICT DO NOTHING`, [new Date().toISOString()]);
}
