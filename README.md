# ConfeTex · Caja

Caja diaria de ConfeTex: ingresos, egresos y transferencias por cuenta, proveedores, gastos fijos con vencimientos, cobros pendientes de pedidos y reporte mensual (ingresos → costos variables → margen → gastos fijos → resultado → retiros → lo que queda).

## Cómo está armada
- `index.html`: toda la interfaz (sin build).
- `api/`: funciones de Vercel (login, datos, movimientos, catálogos, pedidos).
- `lib/db.js` + `lib/store.js`: datos en un Vercel Blob privado (store `confetex-caja-datos`): `caja/config.json` (usuarios, cuentas, categorías, proveedores, vencimientos) y un archivo por mes en `caja/movs/AAAA-MM.json`. Cada escritura usa control de versiones para que dos personas no se pisen. La primera vez carga los datos iniciales y los movimientos del 1 al 15/10/2026 de la planilla (`lib/octubre-2026.json`).
- `lib/pedidos.js`: lee **solo la información financiera** (total, pagos, saldo) de la app de pedidos.

## Variables de entorno (Vercel)
- `BLOB_READ_WRITE_TOKEN`: lo crea Vercel al conectar el store `confetex-caja-datos`.
- `CLAVE_ALTA`: clave que se pide solo la primera vez que cada usuario elige su PIN (o al resetearlo).
- `PEDIDOS_READ_WRITE_TOKEN`: token del store de la app de pedidos (solo se usa para leer).

## Deploy
Cada push a `main` se publica automáticamente en Vercel (proyecto `confetex-caja`).

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
Usa datos en memoria y pedidos de ejemplo (`scripts/pedidos-ejemplo.json`).
