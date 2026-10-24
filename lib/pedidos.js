import { readFileSync } from 'node:fs';

/** Token del Blob store de la app de pedidos (conectado a este proyecto con prefijo PEDIDOS). */
export function pedidosToken() {
  return process.env.PEDIDOS_READ_WRITE_TOKEN || process.env.PEDIDOS_BLOB_READ_WRITE_TOKEN || process.env.PEDIDOS_BLOB_TOKEN || '';
}

const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
const sumaTalles = (it) => Object.values(it.talles || {}).reduce((a, b) => a + num(b), 0);
const cantItem = (it) => { const t = sumaTalles(it); return t > 0 ? t : num(it.cantidad); };
const totalItem = (it) => Math.round(cantItem(it) * num(it.precioUnit) * (1 - Math.min(100, num(it.descuento)) / 100));

/** Solo la información financiera de un pedido (mismas cuentas que la app de pedidos). */
export function resumenFinanciero(p) {
  const total = (p.items || []).reduce((a, it) => a + totalItem(it), 0);
  const vistos = {};
  const pagos = (p.pagos || [])
    .filter((x) => num(x.monto) > 0)
    .map((x) => {
      const base = `${p.id}|${x.fecha || ''}|${Math.round(num(x.monto))}|${x.medio || ''}`;
      vistos[base] = (vistos[base] || 0) + 1;
      return { ref: `${base}|${vistos[base]}`, fecha: x.fecha || '', medio: x.medio || '', monto: Math.round(num(x.monto)), nota: x.nota || '' };
    });
  const pagado = pagos.reduce((a, x) => a + x.monto, 0);
  const productos = [...new Set((p.items || []).map((it) => it.producto || it.categoria).filter(Boolean))].join(', ');
  const unidades = (p.items || []).reduce((a, it) => a + cantItem(it), 0);
  return {
    id: p.id, codigoCliente: p.codigoCliente || '', empresa: p.empresa || '', contacto: p.contacto || '',
    estado: p.estado || '', fechaIngreso: p.fechaIngreso || '', productos, unidades,
    total, pagado, saldo: total - pagado, pagos,
  };
}

let cache = { t: 0, data: null };

/**
 * Pedidos con su información financiera. La app de pedidos y la caja comparten la misma base D1:
 * se leen directamente las filas de la tabla "pedidos" (en curso + entregados que no son de Tiendanube ni del historial).
 */
export async function listarPedidos() {
  if (process.env.PEDIDOS_MOCK) return JSON.parse(readFileSync(process.env.PEDIDOS_MOCK, 'utf8')).map(resumenFinanciero);
  const d = globalThis.__DB;
  if (!d) return null;
  if (cache.data && Date.now() - cache.t < 30_000) return cache.data;
  let rows = [];
  try {
    rows = (await d.prepare("SELECT json FROM pedidos WHERE grupo='activos' OR (origen<>'tiendanube' AND historico=0 AND id NOT LIKE 'TN-%')").all()).results;
  } catch { rows = []; } // la tabla se crea la primera vez que se abre la app de pedidos
  const out = rows.map((r) => resumenFinanciero(JSON.parse(r.json)));
  cache = { t: Date.now(), data: out };
  return out;
}

/** Versión de los pedidos (cambia cada vez que se guarda uno): sirve para no revisar si no hubo cambios. */
export async function versionPedidos() {
  const d = globalThis.__DB;
  if (!d) return null;
  try {
    const { results } = await d.prepare("SELECT k, v FROM meta WHERE k IN ('ped_activos','ped_entregados')").all();
    return results.reduce((a, r) => a + r.v, 0);
  } catch { return null; }
}

export function limpiarCache() { cache = { t: 0, data: null }; }
