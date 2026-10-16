// Servidor local para probar la app sin Vercel: base en memoria (PGlite) y pedidos de ejemplo.
// Uso: node scripts/dev.mjs  →  http://localhost:3000   (clave de alta: "prueba")
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { setRunner } from '../lib/db.js';

const root = fileURLToPath(new URL('..', import.meta.url));
process.env.CLAVE_ALTA ||= 'prueba';
process.env.PEDIDOS_MOCK ||= join(root, 'scripts', 'pedidos-ejemplo.json');

const pg = new PGlite();
setRunner(async (text, params) => {
  try {
    return (await pg.query(text, params)).rows;
  } catch (e) {
    if (e && e.code) throw e;
    throw e;
  }
});

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const mod = await import(join(root, url.pathname + '.js'));
      const fn = mod[req.method];
      if (!fn) { res.writeHead(405); return res.end(); }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const headers = { ...req.headers };
      if (headers.cookie) headers.cookie = headers.cookie; // las cookies Secure funcionan en localhost
      const request = new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
      const r = await fn(request);
      res.writeHead(r.status, Object.fromEntries(r.headers));
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const data = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ERR_MODULE_NOT_FOUND') { res.writeHead(404); return res.end('No encontrado'); }
    console.error(e);
    res.writeHead(500); res.end(String(e));
  }
}).listen(process.env.PORT || 3000, () => console.log('Caja local en http://localhost:' + (process.env.PORT || 3000)));
