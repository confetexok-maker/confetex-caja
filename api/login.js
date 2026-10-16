import { leerConfig, actualizarConfig } from '../lib/db.js';
import { json, body, usuarioDe, sessionCookie, hashPin, pinOk, pinValido, claveAltaOk, espera, errorJson, falla } from '../lib/util.js';

export async function GET(request) {
  try {
    const yo = await usuarioDe(request);
    const c = await leerConfig();
    const usuarios = c.usuarios.filter((u) => u.activo).map((u) => ({ id: u.id, nombre: u.nombre, tienePin: Boolean(u.pin_hash) }));
    return json({ usuario: yo, usuarios, claveConfigurada: Boolean(process.env.CLAVE_ALTA) });
  } catch (e) {
    return errorJson(e);
  }
}

// { usuarioId, pin }  ·  primera vez: { usuarioId, pin, claveAlta }
export async function POST(request) {
  try {
    const b = await body(request);
    const c = await leerConfig();
    const u = c.usuarios.find((x) => x.id === +b.usuarioId && x.activo);
    if (!u) return json({ error: 'Elegí un usuario.' }, 400);

    if (!u.pin_hash) {
      if (!process.env.CLAVE_ALTA) return json({ error: 'Falta configurar CLAVE_ALTA en Vercel.' }, 500);
      if (!claveAltaOk(b.claveAlta)) { await espera(700); return json({ error: 'La clave de alta no es correcta.' }, 401); }
      if (!pinValido(b.pin)) return json({ error: 'El PIN tiene que tener entre 4 y 8 números.' }, 400);
      const hash = hashPin(b.pin);
      await actualizarConfig((cfg) => {
        const x = cfg.usuarios.find((y) => y.id === u.id);
        if (x.pin_hash) throw falla('Este usuario ya eligió su PIN. Entrá con ese PIN.', 409);
        x.pin_hash = hash;
      });
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
