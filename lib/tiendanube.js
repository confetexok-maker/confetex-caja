import { createHmac, timingSafeEqual } from 'node:crypto';
import { leerConfig, actualizarConfig, actualizarMes, nuevoId, hoyAR, consultarCols } from './db.js';
import { leerPedidosJson, escribirPedidosJson } from './pedidos-store.js';

// La conexión con Tiendanube se comparte con la app de pedidos (archivo config/tiendanube-token.json de su almacenamiento):
// Tiendanube deja una sola conexión válida por app y tienda, así que si una de las dos apps se reconecta, la otra toma el token nuevo.
const TOKEN_COMPARTIDO = 'config/tiendanube-token.json';
async function adoptarTokenCompartido(cfgTn) {
  const t = await leerPedidosJson(TOKEN_COMPARTIDO).catch(() => null);
  if (!t || !t.access_token || t.access_token === cfgTn.access_token || String(t.user_id) !== String(cfgTn.store_id)) return false;
  cfgTn.access_token = t.access_token;
  await actualizarConfig((c) => { if (c.tiendanube) { c.tiendanube.access_token = t.access_token; c.tiendanube.ultimo_error = null; } });
  return true;
}

const API = 'https://api.tiendanube.com/v1';
const UA = 'ConfeTex Caja (confetex.ok@gmail.com)';

export const tnConfigurada = () => Boolean(process.env.TN_CLIENT_ID && process.env.TN_CLIENT_SECRET);

function falla(msg, status = 400) { const e = new Error(msg); e.publico = true; e.status = status; return e; }

async function tn(cfgTn, path, opts = {}, reintento = true) {
  const r = await fetch(`${API}/${cfgTn.store_id}${path}`, {
    ...opts,
    headers: { Authentication: `bearer ${cfgTn.access_token}`, 'User-Agent': UA, 'Content-Type': 'application/json; charset=utf-8', ...(opts.headers || {}) },
  });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    if (r.status === 401 && reintento && await adoptarTokenCompartido(cfgTn)) return tn(cfgTn, path, opts, false);
    const e = new Error(`Tiendanube respondió ${r.status}: ${typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200)}`);
    e.status = r.status; e.publico = true;
    throw e;
  }
  return data;
}

/** URL para autorizar la app en la tienda. */
export function urlAutorizar(state) {
  return `https://www.tiendanube.com/apps/${encodeURIComponent(process.env.TN_CLIENT_ID)}/authorize?state=${encodeURIComponent(state)}`;
}

/** Cambia el código de autorización por el token y guarda la conexión. */
export async function conectar(code, baseUrl) {
  const r = await fetch('https://www.tiendanube.com/apps/authorize/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.TN_CLIENT_ID, client_secret: process.env.TN_CLIENT_SECRET, grant_type: 'authorization_code', code }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw falla(`No se pudo conectar con Tiendanube (${d.error_description || d.error || r.status}).`, 502);
  const store_id = String(d.user_id || d.store_id);
  const cfg = await leerConfig();
  const mp = cfg.cuentas.find((c) => c.nombre === 'Mercado Pago') || cfg.cuentas.find((c) => c.tipo === 'billetera') || cfg.cuentas[0];
  const pn = cfg.cuentas.find((c) => c.nombre.toLowerCase() === 'pago nube');
  await actualizarConfig((c) => {
    const prev = c.tiendanube || {};
    c.tiendanube = {
      cuenta_id: prev.cuenta_id || mp.id, cuenta_pn_id: prev.cuenta_pn_id || (pn ? pn.id : mp.id), comision_pct: prev.comision_pct ?? 0, comision_mp_pct: prev.comision_mp_pct ?? 0, desde: prev.desde || hoyAR(),
      ...prev, store_id, access_token: d.access_token, scope: d.scope || '', conectado_en: new Date().toISOString(), ultimo_error: null,
    };
  });
  await escribirPedidosJson(TOKEN_COMPARTIDO, { access_token: d.access_token, user_id: store_id, scope: d.scope || '', conectado: new Date().toISOString(), origen: 'caja' }).catch((e) => console.error('token compartido', e));
  await registrarWebhooks(baseUrl);
}

export async function registrarWebhooks(baseUrl) {
  const t = (await leerConfig()).tiendanube;
  const url = `${baseUrl}/api/tiendanube-webhook`;
  const existentes = await tn(t, '/webhooks').catch(() => []);
  for (const event of ['order/paid', 'order/cancelled']) {
    const ya = (existentes || []).find((w) => w.event === event);
    if (ya && ya.url === url) continue;
    if (ya) await tn(t, `/webhooks/${ya.id}`, { method: 'DELETE' }).catch(() => {});
    await tn(t, '/webhooks', { method: 'POST', body: JSON.stringify({ event, url }) });
  }
}

export function firmaValida(rawBody, firma) {
  if (!firma || !process.env.TN_CLIENT_SECRET) return false;
  const calc = createHmac('sha256', process.env.TN_CLIENT_SECRET).update(rawBody).digest('hex');
  const a = Buffer.from(calc), b = Buffer.from(String(firma));
  return a.length === b.length && timingSafeEqual(a, b);
}

const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const r2 = (n) => Math.round(n * 100) / 100;
const fechaAR = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(iso));

/** Lo que ya está cargado de Tiendanube (consulta liviana a la base, sin leer los movimientos enteros). */
async function yaCargado() {
  const [refs, dets, grupos] = await Promise.all([
    consultarCols('origen_ref', "origen_ref LIKE 'tn:%'"),
    consultarCols('detalle', "borrado=0 AND tipo='ingreso' AND canal='Tiendanube'"),
    consultarCols('DISTINCT grupo', "borrado=0 AND grupo LIKE 'tn%'"),
  ]);
  return { refs: new Set(refs.map((r) => r.origen_ref)), detalles: dets.map((r) => r.detalle || ''), grupos: new Set(grupos.map((r) => r.grupo)) };
}

/** Crea los movimientos de una orden pagada (venta, envío y comisión). No duplica. Devuelve true si creó. */
export async function importarOrden(orden, cfgTn, existentes) {
  // Con reembolso parcial Tiendanube cambia el estado de pago a "partially_refunded": la venta existió, se carga marcada para revisar el monto.
  const parcial = Boolean(orden) && orden.payment_status === 'partially_refunded';
  if (!orden || (orden.payment_status !== 'paid' && !parcial) || orden.status === 'cancelled' || orden.cancelled_at) return false;
  const fecha = fechaAR(orden.paid_at || orden.created_at);
  if (fecha < cfgTn.desde) return false;
  const ref = `tn:${orden.id}`;
  const ya = existentes || await yaCargado();
  if (ya.refs.has(ref)) return false;
  // ya cargada a mano o desde la planilla con su número (ej: "Venta web #265")
  const marca = new RegExp(`#${orden.number}(?!\\d)`);
  if (ya.detalles.some((d) => marca.test(d))) return false;

  const total = num(orden.total);
  const envio = num(orden.shipping_cost_customer);
  const venta = r2(total - envio);
  const pasarela = `${orden.gateway || ''} ${orden.gateway_name || ''} ${orden.payment_details && orden.payment_details.method || ''}`.toLowerCase();
  const esMP = pasarela.includes('mercado');
  const esPN = !esMP && /nube|nuvem/.test(pasarela);
  // pagos personalizados / transferencia: sin comisión
  const pct = esMP ? num(cfgTn.comision_mp_pct) : esPN ? num(cfgTn.comision_pct) : 0;
  const comision = r2(total * pct / 100);
  // Pago Nube retiene la plata unas horas: entra en su propia cuenta y después se transfiere a Mercado Pago
  const cuentaId = esPN && cfgTn.cuenta_pn_id ? cfgTn.cuenta_pn_id : cfgTn.cuenta_id;
  const cfg = await leerConfig();
  const cat = (n) => (cfg.categorias.find((c) => c.nombre === n) || {}).id;
  const cliente = orden.customer && orden.customer.name ? ` · ${orden.customer.name}` : '';
  const base = {
    fecha, cuenta_id: cuentaId, cuenta_destino_id: null, proveedor_id: null, recurrente_id: null,
    canal: 'Tiendanube', facturado: false, grupo: `tn${orden.id}`, origen: 'tiendanube', pedido_ref: null, pedido_id: null,
    creado_por: null, creado_en: new Date().toISOString(), editado_por: null, editado_en: null, borrado_por: null, borrado_en: null,
  };
  const id0 = nuevoId();
  const nuevos = [{ ...base, id: id0, tipo: 'ingreso', monto: venta > 0 ? venta : total, categoria_id: cat('Ventas'), detalle: `Venta web #${orden.number}${cliente}${parcial ? ' (reembolso parcial: revisar monto)' : ''}`, origen_ref: ref }];
  if (envio > 0 && venta > 0) nuevos.push({ ...base, id: id0 + 1, tipo: 'ingreso', monto: envio, categoria_id: cat('Envíos cobrados'), detalle: `Envío web #${orden.number}`, origen_ref: `${ref}:envio` });
  if (comision > 0) nuevos.push({ ...base, id: id0 + 2, tipo: 'egreso', canal: '', monto: comision, categoria_id: cat('Comisiones e impuestos MP'), detalle: `Comisión web #${orden.number} (${esMP ? 'Mercado Pago' : 'Pago Nube'} ${pct}%)`, origen_ref: `${ref}:comision` });

  let creado = false;
  await actualizarMes(fecha.slice(0, 7), (movs) => {
    if (movs.some((x) => x.origen_ref === ref)) return;
    movs.push(...nuevos); creado = true;
  });
  if (creado) { ya.refs.add(ref); ya.grupos.add(base.grupo); for (const n of nuevos) if (n.tipo === 'ingreso') ya.detalles.push(n.detalle); }
  return creado;
}

/** Orden cancelada: se borran sus movimientos (queda registrado). */
export async function anularOrden(ordenId) {
  const grupo = `tn${ordenId}`;
  const filas = await consultarCols('DISTINCT mes', 'grupo=? AND borrado=0', [grupo]);
  for (const m of filas.map((x) => x.mes)) {
    await actualizarMes(m, (movs) => {
      for (const x of movs) if (x.grupo === grupo && !x.borrado_en) { x.borrado_en = new Date().toISOString(); x.detalle += ' (orden cancelada en Tiendanube)'; }
    });
  }
  return filas.length > 0;
}

export async function procesarEvento(evento, ordenId) {
  const cfgTn = (await leerConfig()).tiendanube;
  if (!cfgTn || !cfgTn.access_token) return 'sin conexión';
  if (evento === 'order/cancelled') return (await anularOrden(ordenId)) ? 'anulada' : 'sin cambios';
  const orden = await tn(cfgTn, `/orders/${ordenId}`);
  return (await importarOrden(orden, cfgTn)) ? 'importada' : 'sin cambios';
}

/** Revisa las órdenes desde la fecha de inicio y carga las que falten (por si se perdió algún aviso). */
// Si la caja tiene una conexión que funciona, la deja disponible para la app de pedidos (que lee el mismo archivo).
async function publicarTokenCompartido(cfgTn) {
  try {
    const t = await leerPedidosJson(TOKEN_COMPARTIDO);
    if (t && t.access_token === cfgTn.access_token) return;
    await escribirPedidosJson(TOKEN_COMPARTIDO, { access_token: cfgTn.access_token, user_id: String(cfgTn.store_id), scope: cfgTn.scope || '', conectado: new Date().toISOString(), origen: 'caja' });
  } catch (e) { console.error('token compartido', e); }
}

export async function sincronizar({ completo = false } = {}) {
  const cfgTn = (await leerConfig()).tiendanube;
  if (!cfgTn || !cfgTn.access_token) throw falla('Tiendanube no está conectado.');
  const ya = await yaCargado();
  let creadas = 0, anuladas = 0;
  // Normalmente solo se revisan las órdenes modificadas desde la última revisión (con 1 día de margen);
  // los avisos (webhooks) cubren el resto. Con "completo" se revisan todas desde la fecha de inicio.
  const incremental = !completo && cfgTn.ultima_sync && cfgTn.desde === cfgTn.ultima_desde;
  try {
    for (let page = 1; page <= 20; page++) {
      const q = new URLSearchParams(incremental
        ? { updated_at_min: new Date(Date.parse(cfgTn.ultima_sync) - 864e5).toISOString(), per_page: '50', page: String(page) }
        : { created_at_min: `${cfgTn.desde}T00:00:00-03:00`, per_page: '100', page: String(page) });
      let lista;
      try { lista = await tn(cfgTn, `/orders?${q}`); } catch (e) { if (e.status === 404) break; throw e; }
      if (!Array.isArray(lista) || !lista.length) break;
      for (const o of lista) {
        if (o.status === 'cancelled' || o.cancelled_at) { if (ya.grupos.has(`tn${o.id}`)) { await anularOrden(o.id); ya.grupos.delete(`tn${o.id}`); anuladas++; } }
        else if (await importarOrden(o, cfgTn, ya)) creadas++;
      }
      if (lista.length < (incremental ? 50 : 100)) break;
    }
    await publicarTokenCompartido(cfgTn);
    await actualizarConfig((c) => { if (c.tiendanube) { c.tiendanube.ultima_sync = new Date().toISOString(); c.tiendanube.ultima_desde = c.tiendanube.desde; c.tiendanube.ultimo_error = null; } });
  } catch (e) {
    await actualizarConfig((c) => { if (c.tiendanube) c.tiendanube.ultimo_error = String(e.message).slice(0, 300); }).catch(() => {});
    throw e;
  }
  return { creadas, anuladas, modo: incremental ? 'nuevas' : 'completo' };
}

// Una sola vez: traer las órdenes de Tiendanube de octubre que no estaban en la planilla
// (Nicolas confirmó que las "Venta" sin número de la planilla son de otros canales).
export async function importarOctubreTN() {
  const c = await leerConfig();
  if (!c.tiendanube || !c.tiendanube.access_token || (c.migraciones || []).includes('tn-octubre')) return;
  let marcado = false;
  await actualizarConfig((cfg) => {
    cfg.migraciones ||= [];
    if (cfg.migraciones.includes('tn-octubre') || !cfg.tiendanube) return;
    cfg.migraciones.push('tn-octubre');
    cfg.tiendanube.desde = '2026-10-01';
    marcado = true;
  });
  return marcado ? sincronizar() : null;
}

/** Diagnóstico (solo lectura): últimas órdenes con su estado y si ya están en la caja. */
export async function diagnosticoOrdenes(n = 8) {
  const cfgTn = (await leerConfig()).tiendanube;
  if (!cfgTn || !cfgTn.access_token) return { conectado: false };
  const lista = await tn(cfgTn, `/orders?per_page=${n}&page=1`);
  const ya = await yaCargado();
  return (Array.isArray(lista) ? lista : []).map((o) => ({
    numero: o.number, estado: o.status, pago: o.payment_status, total: o.total, creada: o.created_at, pagada: o.paid_at, pasarela: o.gateway,
    claves_reembolso: Object.keys(o).filter((k) => /refund|devol|reemb/i.test(k)),
    reembolsos: Object.fromEntries(Object.entries(o).filter(([k]) => /refund|devol|reemb/i.test(k)).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : v])),
    en_caja: ya.refs.has(`tn:${o.id}`), desde: cfgTn.desde,
  }));
}
