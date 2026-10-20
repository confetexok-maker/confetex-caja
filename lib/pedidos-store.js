import { get, put } from '@vercel/blob';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pedidosToken } from './pedidos.js';

// Lectura/escritura de archivos JSON en el almacenamiento de la app de pedidos.
// Para pruebas locales: PEDIDOS_MOCK_STORE=<carpeta> usa archivos en disco.

export async function leerPedidosJson(path) {
  const dir = process.env.PEDIDOS_MOCK_STORE;
  if (dir) { try { return JSON.parse(await readFile(join(dir, path), 'utf8')); } catch { return null; } }
  const token = pedidosToken();
  if (!token) return null;
  try {
    const r = await get(path, { access: 'private', token, useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    return JSON.parse(await new Response(r.stream).text());
  } catch { return null; }
}

export async function escribirPedidosJson(path, data) {
  const dir = process.env.PEDIDOS_MOCK_STORE;
  if (dir) { await mkdir(dirname(join(dir, path)), { recursive: true }); await writeFile(join(dir, path), JSON.stringify(data)); return true; }
  const token = pedidosToken();
  if (!token) return false;
  await put(path, JSON.stringify(data), { access: 'private', token, contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
  return true;
}
