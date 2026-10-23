import { list, get } from '@vercel/blob';
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

export async function listarPedidos() {
  if (process.env.PEDIDOS_MOCK) return JSON.parse(readFileSync(process.env.PEDIDOS_MOCK, 'utf8')).map(resumenFinanciero);
  const token = pedidosToken();
  if (!token) return null;
  if (cache.data && Date.now() - cache.t < 60_000) return cache.data;

  // La app de pedidos guarda los pedidos en curso en un solo archivo (archivo/activos.json).
  // Solo si todavía no existe (formato anterior: un archivo por pedido) se recorren los archivos sueltos.
  const out = [];
  const leerJson = async (path) => {
    const r = await get(path, { access: 'private', token, useCache: false }).catch(() => null);
    return r && r.statusCode === 200 && r.stream ? JSON.parse(await new Response(r.stream).text()) : null;
  };
  const activos = await leerJson('archivo/activos.json');
  if (activos) {
    for (const p of activos.pedidos || []) out.push(resumenFinanciero(p));
  } else {
    const blobs = [];
    for (const prefix of ['pedidos/activos/', 'pedidos/entregados/']) {
      let cursor;
      do {
        const r = await list({ prefix, cursor, limit: 1000, token });
        blobs.push(...r.blobs);
        cursor = r.hasMore ? r.cursor : undefined;
      } while (cursor);
    }
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(10, blobs.length) }, async () => {
      while (i < blobs.length) {
        const b = blobs[i++];
        try { const d = await leerJson(b.pathname); if (d) out.push(resumenFinanciero(d)); } catch { /* pedido ilegible: se omite */ }
      }
    }));
  }
  // Pedidos entregados guardados todos juntos en un solo archivo (formato nuevo de la app de pedidos).
  // Se excluyen las ventas de Tiendanube (TN-…), que la caja ya trae directo de Tiendanube, y el
  // historial importado de la planilla (historico), cuyos pagos ya entraron con la carga inicial de la caja.
  try {
    const r = await get('archivo/entregados.json', { access: 'private', token, useCache: false });
    if (r && r.statusCode === 200 && r.stream) {
      const ya = new Set(out.map((p) => p.id));
      const data = JSON.parse(await new Response(r.stream).text());
      for (const p of data.pedidos || []) {
        if (p.origen === 'tiendanube' || String(p.id).startsWith('TN-') || p.historico || ya.has(p.id)) continue;
        out.push(resumenFinanciero(p));
      }
    }
  } catch { /* sin archivo de entregados */ }
  cache = { t: Date.now(), data: out };
  return out;
}

export function limpiarCache() { cache = { t: 0, data: null }; }
