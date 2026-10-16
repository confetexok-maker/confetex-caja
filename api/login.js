import { q, one } from '../lib/db.js';
import { json, body, usuarioDe, sessionCookie, hashPin, pinOk, pinValido, claveAltaOk, espera, errorJson } from '../lib/util.js';

export async function GET(request) {
  try {
    const yo = await usuarioDe(request);
    const usuarios = await q(`SELECT id, nombre, (pin_hash IS NOT NULL) AS "tienePin" FROM usuarios WHERE activo ORDER BY id`);
    return json({ usuario: yo, usuarios, claveConfigurada: Boolean(process.env.CLAVE_ALTA) });
  } catch (e) {
    return errorJson(e);
  }
}

// { usuarioId, pin }  ·  primera vez: { usuarioId, pin, claveAlta }
export async function POST(request) {
  try {
    const b = await body(request);
    const u = await one(`SELECT id, nombre, pin_hash FROM usuarios WHERE id = $1 AND activo`, [+b.usuarioId || 0]);
    if (!u) return json({ error: 'Elegí un usuario.' }, 400);

    if (!u.pin_hash) {
      if (!process.env.CLAVE_ALTA) return json({ error: 'Falta configurar CLAVE_ALTA en Vercel.' }, 500);
      if (!claveAltaOk(b.claveAlta)) { await espera(700); return json({ error: 'La clave de alta no es correcta.' }, 401); }
      if (!pinValido(b.pin)) return json({ error: 'El PIN tiene que tener entre 4 y 8 números.' }, 400);
      await q(`UPDATE usuarios SET pin_hash = $1 WHERE id = $2`, [hashPin(b.pin), u.id]);
    } else if (!pinOk(b.pin, u.pin_hash)) {
      await espera(700);
      return json({ error: 'PIN incorrecto.' }, 401);
    }
    return json({ usuario: { id: u.id, nombre: u.nombre } }, 200, { 'set-cookie': sessionCookie(u.id) });
  } catch (e) {
    return errorJson(e);
  }
}

export async function DELETE() {
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(0, true) });
}
