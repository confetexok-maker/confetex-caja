import { randomBytes } from 'node:crypto';
import { actualizarConfig, leerConfig, esFechaOk } from '../lib/db.js';
import { json, body, protegido, falla, usuarioDe, errorJson } from '../lib/util.js';
import { tnConfigurada, urlAutorizar, conectar, sincronizar, registrarWebhooks } from '../lib/tiendanube.js';

const base = (request) => `https://${request.headers.get('x-forwarded-host') || request.headers.get('host')}`;
const redir = (to, cookie) => new Response(null, { status: 302, headers: { location: to, ...(cookie ? { 'set-cookie': cookie } : {}) } });

// GET ?accion=conectar → va a Tiendanube a autorizar · GET ?code=…&state=… → vuelta de Tiendanube
export async function GET(request) {
  try {
    const u = new URL(request.url);
    const yo = await usuarioDe(request);
    if (!yo) return redir('/?tn=login');
    if (!tnConfigurada()) return redir('/?tn=sin-app');
    if (u.searchParams.get('accion') === 'conectar') {
      const state = randomBytes(16).toString('hex');
      return redir(urlAutorizar(state), `tns=${state}; Path=/api/tiendanube; HttpOnly; Secure; SameSite=Lax; Max-Age=900`);
    }
    const code = u.searchParams.get('code');
    const state = u.searchParams.get('state');
    const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)tns=([a-f0-9]{32})/);
    if (!code) return redir('/?tn=error');
    if (state && m && state !== m[1]) return redir('/?tn=error');
    await conectar(code, base(request));
    try { await sincronizar(); } catch { /* se puede reintentar desde Ajustes */ }
    return redir('/?tn=ok', 'tns=; Path=/api/tiendanube; Max-Age=0');
  } catch (e) {
    console.error(e);
    return redir('/?tn=error&msg=' + encodeURIComponent(String(e.message || '').slice(0, 150)));
  }
}

// { accion: 'config' | 'sincronizar' | 'webhooks' | 'desconectar', ... }
export const POST = protegido(async (request) => {
  const b = await body(request);
  if (b.accion === 'sincronizar') return json({ ok: true, ...(await sincronizar()) });
  if (b.accion === 'webhooks') { await registrarWebhooks(base(request)); return json({ ok: true }); }
  if (b.accion === 'desconectar') { await actualizarConfig((c) => { delete c.tiendanube; }); return json({ ok: true }); }
  if (b.accion === 'config') {
    const cfg = await leerConfig();
    if (!cfg.tiendanube) throw falla('Tiendanube no está conectado.');
    const pct = Number(String(b.comision_pct ?? '').replace(',', '.'));
    const pctMp = Number(String(b.comision_mp_pct ?? '').replace(',', '.'));
    if (!(pct >= 0 && pct <= 30) || !(pctMp >= 0 && pctMp <= 30)) throw falla('La comisión tiene que estar entre 0 y 30 %.');
    if (!cfg.cuentas.some((c) => c.id === +b.cuenta_id)) throw falla('Elegí la cuenta donde entra la plata.');
    if (!cfg.cuentas.some((c) => c.id === +b.cuenta_pn_id)) throw falla('Elegí la cuenta donde entran los cobros de Pago Nube.');
    if (!esFechaOk(b.desde)) throw falla('La fecha de inicio no es válida.');
    await actualizarConfig((c) => { Object.assign(c.tiendanube, { comision_pct: Math.round(pct * 100) / 100, comision_mp_pct: Math.round(pctMp * 100) / 100, cuenta_id: +b.cuenta_id, cuenta_pn_id: +b.cuenta_pn_id, desde: b.desde }); });
    return json({ ok: true });
  }
  throw falla('Acción inválida.');
});
