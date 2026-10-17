import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { leerConfig } from './db.js';

const COOKIE = 'cc';
const DIAS_SESION = 60;

function secret() {
  return createHash('sha256')
    .update('confetex-caja:' + (process.env.CLAVE_ALTA || '') + ':' + (process.env.BLOB_READ_WRITE_TOKEN || 'local'))
    .digest();
}

const firmar = (payload) => createHmac('sha256', secret()).update(payload).digest('hex');

export function sessionCookie(userId, clear = false) {
  if (clear) return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  const exp = Date.now() + DIAS_SESION * 864e5;
  const payload = `${userId}.${exp}`;
  return `${COOKIE}=${payload}.${firmar(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DIAS_SESION * 86400}`;
}

/** Devuelve el usuario logueado o null. */
export async function usuarioDe(request) {
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)cc=(\d+)\.(\d+)\.([a-f0-9]{64})/);
  if (!m) return null;
  const [, id, exp, sig] = m;
  if (+exp < Date.now()) return null;
  const a = Buffer.from(sig), b = Buffer.from(firmar(`${id}.${exp}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const u = (await leerConfig()).usuarios.find((x) => x.id === +id && x.activo && x.pin_hash);
  return u ? { id: u.id, nombre: u.nombre, rol: u.rol === 'carga' ? 'carga' : 'admin' } : null;
}

export function hashPin(pin) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(String(pin), salt, 32).toString('hex')}`;
}

export function pinOk(pin, stored) {
  if (!stored) return false;
  const [s, h] = stored.split(':');
  const calc = scryptSync(String(pin), Buffer.from(s, 'hex'), 32);
  const ref = Buffer.from(h, 'hex');
  return calc.length === ref.length && timingSafeEqual(calc, ref);
}

export function claveAltaOk(clave) {
  const env = String(process.env.CLAVE_ALTA || '');
  if (!env) return false;
  const a = createHash('sha256').update(String(clave || '')).digest();
  const b = createHash('sha256').update(env).digest();
  return timingSafeEqual(a, b);
}

export const pinValido = (pin) => /^\d{4,8}$/.test(String(pin || ''));

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export const unauthorized = () => json({ error: 'auth' }, 401);
export const espera = (ms) => new Promise((r) => setTimeout(r, ms));

export async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

/** Envuelve un handler: exige sesión y traduce errores a JSON. */
export function protegido(fn, { soloAdmin = false } = {}) {
  return async (request) => {
    try {
      const u = await usuarioDe(request);
      if (!u) return unauthorized();
      if (soloAdmin && u.rol !== 'admin') return json({ error: 'Tu usuario no tiene permiso para esto.' }, 403);
      return await fn(request, u);
    } catch (e) {
      return errorJson(e);
    }
  };
}

export function errorJson(e) {
  if (e && e.code === 'NO_DB') return json({ error: e.message }, 500);
  if (e && e.publico) return json({ error: e.message }, e.status || 400);
  console.error(e);
  const blob = e && /^Blob|blob/.test(`${e.constructor && e.constructor.name} ${e.message}`);
  return json({ error: blob ? `Error del almacenamiento: ${e.message}` : 'Error inesperado del servidor.' }, 500);
}

export function falla(msg, status = 400) {
  const e = new Error(msg);
  e.publico = true;
  e.status = status;
  return e;
}

export const esFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
