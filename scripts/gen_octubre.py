import sys, json, datetime, openpyxl
src, out = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, data_only=True)
ws = wb['CAJA 2026']
CUENTA = {'MERCADOPAGO': 'Mercado Pago', 'EFECTIVO': 'Efectivo', 'SANTANDER': 'Santander', 'BRUBANK': 'Brubank', 'BANCO BBVA': 'BBVA'}
TARJ = {'tarj brub': 'Tarjeta Brubank', 'bbva': 'Tarjeta BBVA Visa', 'stdr': 'Tarjeta Santander Visa'}
rows = []
n = 0
for i, r in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
    medio, _, fecha, extra, det, _, concepto, monto = r[:8]
    if not (isinstance(fecha, datetime.datetime) and fecha >= datetime.datetime(2026, 10, 1) and isinstance(monto, (int, float))):
        continue
    extra = '' if extra is None else str(extra).strip()
    if extra.endswith('.0'): extra = extra[:-2]
    det = (det or '').strip()
    m = round(abs(float(monto)), 2)
    tipo = 'ingreso' if monto > 0 else 'egreso'
    o = {'fila': i, 'fecha': fecha.strftime('%Y-%m-%d'), 'tipo': tipo, 'monto': m, 'cuenta': CUENTA[medio],
         'categoria': None, 'proveedor': None, 'canal': None, 'detalle': det, 'cuentaDestino': None}
    num = extra.isdigit()
    if concepto == 'Ingresos':
        o['categoria'] = 'Ventas'
        if num: o['canal'] = 'Tiendanube'; o['detalle'] = f'Venta web #{extra}'
        elif det == 'Seña': o['canal'] = 'WhatsApp'; o['detalle'] = f'Seña {extra}'.strip()
        else: o['detalle'] = f'Venta {extra}'.strip()
    elif concepto == 'Envios':
        o['categoria'] = 'Envíos cobrados'; o['canal'] = 'Tiendanube' if num else None
        o['detalle'] = f'Envío web #{extra}' if num else 'Envío cobrado'
    elif concepto == 'Impuesto MP':
        o['categoria'] = 'Comisiones e impuestos MP'; o['detalle'] = f'Impuesto MP #{extra}' if num else 'Impuesto MP'
    elif concepto == 'NICOLAS':
        o['categoria'] = 'Retiros Nicolas'; o['detalle'] = ('Retiro Nicolas ' + extra).strip()
    elif concepto == 'Produccion':
        o['categoria'] = 'Producción'
        if ' - ' in det:
            a, b = det.split(' - ', 1); o['proveedor'] = b.strip()
        else: o['detalle'] = det
    elif concepto == 'Materiales':
        o['categoria'] = 'Materiales'
        if extra == 'clad': o['proveedor'] = 'CLAD'; o['detalle'] = 'Textil'
        else: o['detalle'] = (det + ' ' + extra).strip()
    elif concepto == 'Sueldos':
        o['categoria'] = 'Sueldos'; o['proveedor'] = {'Maylen': 'Maylen', 'CM': 'CM', 'Noeli': 'Noeli'}.get(det, det)
        o['detalle'] = 'Sueldo ' + det
    elif concepto == 'Local':
        o['categoria'] = 'Alquiler local' if det == 'Alquiler' else 'Gastos del local'
    elif concepto == 'MARKETING':
        o['categoria'] = 'Marketing'; o['detalle'] = 'Meta Ads' if det == 'Facebook' else det
    elif concepto == 'Packaging':
        o['categoria'] = 'Packaging'
    elif concepto == 'Revisar':
        if det == 'Pago tarjeta':
            o['tipo'] = 'transferencia'; o['cuentaDestino'] = TARJ[extra]; o['detalle'] = 'Pago resumen ' + TARJ[extra]
        elif det == 'imp tarjeta':
            o['categoria'] = 'Gastos bancarios y tarjetas'; o['detalle'] = 'Impuestos tarjeta'
        else:
            o['categoria'] = 'Sin clasificar'
    else:
        raise SystemExit(f'concepto no mapeado {concepto} fila {i}')
    rows.append(o)
json.dump(rows, open(out, 'w'), ensure_ascii=False, indent=0)
print(len(rows))
