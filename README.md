# ConfeTex · Caja

Caja diaria de ConfeTex: ingresos, egresos y transferencias por cuenta, proveedores, gastos fijos con vencimientos, cobros pendientes de pedidos y reporte mensual (ingresos → costos variables → margen → gastos fijos → resultado → retiros → lo que queda).

## Cómo está armada
- `index.html`: toda la interfaz (sin build).
- `api/`: funciones de Vercel (login, datos, movimientos, catálogos, pedidos).
- `lib/db.js`: base Postgres (Neon). Crea las tablas solas la primera vez y carga categorías, cuentas, proveedores, vencimientos y los movimientos del 1 al 15/10/2026 de la planilla (`lib/octubre-2026.json`).
- `lib/pedidos.js`: lee **solo la información financiera** (total, pagos, saldo) de la app de pedidos.

## Puesta en marcha en Vercel (una sola vez)
1. **Proyecto**: Vercel → Add New → Project → importar `confetex-caja` → Deploy (Framework: Other).
2. **Base de datos**: en el proyecto → Storage → Create Database → **Neon** (plan gratis) → conectarla a `confetex-caja`. Esto crea la variable `DATABASE_URL`.
3. **Clave de alta**: Settings → Environment Variables → `CLAVE_ALTA` = una clave que elijas. Se pide solo la primera vez que cada usuario elige su PIN (o al resetearlo).
4. **Pedidos**: Storage → Blob store `confetex-pedidos-datos` → Connect Project → `confetex-caja` con prefijo **`PEDIDOS`** (crea `PEDIDOS_READ_WRITE_TOKEN`). La caja solo lee.
5. Deployments → Redeploy.

## Uso
- Usuarios: Nicolas y Noely. Cada uno elige su PIN la primera vez (con la clave de alta). Cada movimiento guarda quién lo cargó y quién lo editó o borró.
- Tarjetas: cada tarjeta es una cuenta. Las compras con tarjeta son egresos de esa cuenta; el pago del resumen es una transferencia desde el banco o Mercado Pago.
- Retiros personales (incluidos gastos personales) van en "Retiros Nicolas".
- Pagos de pedidos: se cargan en la app de pedidos y en **Cobros** se confirman en la caja (o se vinculan a un ingreso ya cargado).
- Saldos: la caja arrancó en cero el 1/10/2026. Usá **Ajustes → Ajustar saldo** para igualar cada cuenta con su saldo real.

## Prueba local
```
npm install
node scripts/dev.mjs   # http://localhost:3000 · clave de alta: prueba
```
Usa una base en memoria y pedidos de ejemplo (`scripts/pedidos-ejemplo.json`).
