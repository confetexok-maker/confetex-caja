import { leerConfig, aplicarAutomaticos } from '../lib/db.js';
import { json, protegido } from '../lib/util.js';
import { sincronizar } from '../lib/tiendanube.js';
import { importarPagosPedidos } from '../lib/pagos-pedidos.js';
import { limpiarCache } from '../lib/pedidos.js';
import { importarComprasMateriales } from '../lib/compras-materiales.js';

// Botón "Actualizar": trae lo nuevo de Tiendanube y de la app de pedidos y aplica débitos automáticos.
export const POST = protegido(async () => {
  const r = { tiendanube: null, pedidos: null, errores: [] };
  const cfg = await leerConfig();
  if (cfg.tiendanube && cfg.tiendanube.access_token) {
    try { r.tiendanube = await sincronizar(); } catch (e) { r.errores.push('Tiendanube: ' + e.message); }
  }
  try { limpiarCache(); r.pedidos = await importarPagosPedidos(); } catch (e) { r.errores.push('Pedidos: ' + e.message); }
  try { r.materiales = await importarComprasMateriales(); } catch (e) { r.errores.push('Compras de tela: ' + e.message); }
  await aplicarAutomaticos().catch(() => {});
  return json(r);
});
