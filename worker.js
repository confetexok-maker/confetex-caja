// Servidor en Cloudflare Workers: reparte /api/* a las mismas funciones que usaba Vercel.
import * as actualizar from './api/actualizar.js';
import * as catalogo from './api/catalogo.js';
import * as datos from './api/datos.js';
import * as login from './api/login.js';
import * as movimientos from './api/movimientos.js';
import * as pedidos from './api/pedidos.js';
import * as tiendanubeCron from './api/tiendanube-cron.js';
import * as tiendanubeWebhook from './api/tiendanube-webhook.js';
import * as tiendanube from './api/tiendanube.js';
import * as importar from './api/importar.js';
import { limpiarHuerfanos } from './lib/blob-compat.js';

const RUTAS = {
  actualizar, catalogo, datos, login, movimientos, pedidos,
  'tiendanube-cron': tiendanubeCron, 'tiendanube-webhook': tiendanubeWebhook, tiendanube, importar,
};

export default {
  async fetch(request, env) {
    globalThis.__DB = env.DB;
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/api\/([a-z-]+)\/?$/);
    const mod = m && RUTAS[m[1]];
    if (!mod) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('No encontrado', { status: 404 });
    const fn = mod[request.method] || (request.method === 'HEAD' ? mod.GET : null);
    if (!fn) return new Response('Método no permitido', { status: 405 });
    try {
      return await fn(request);
    } catch (e) {
      console.error(m[1], e && e.stack || e);
      return new Response(JSON.stringify({ error: (e && e.message) || 'Error interno' }), { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } });
    }
  },

  // Revisión diaria de Tiendanube y mantenimiento de la base
  async scheduled(event, env, ctx) {
    globalThis.__DB = env.DB;
    const req = new Request('https://cron.local/api/tiendanube-cron', { headers: { authorization: `Bearer ${env.CRON_SECRET || ''}` } });
    ctx.waitUntil((async () => {
      try { await tiendanubeCron.GET(req); } catch (e) { console.error('cron tiendanube', e); }
      try { await limpiarHuerfanos(); } catch (e) { console.error('cron limpieza', e); }
    })());
  },
};
