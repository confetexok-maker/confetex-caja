// Copia los archivos estáticos a /public (lo que sirve Cloudflare).
import { mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
rmSync('public', { recursive: true, force: true });
mkdirSync('public', { recursive: true });
for (const f of ['index.html', 'migrar.html', 'manifest.json', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png']) {
  if (existsSync(f)) copyFileSync(f, `public/${f}`);
}
