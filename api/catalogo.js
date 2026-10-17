import { actualizarConfig, hoyAR } from '../lib/db.js';
import { json, body, protegido, falla, hashPin, pinValido, pinOk, claveAltaOk } from '../lib/util.js';

const TIPOS_CUENTA = ['billetera', 'banco', 'efectivo', 'tarjeta'];
const TIPOS_CATEGORIA = ['ingreso', 'variable', 'fijo', 'ganancia', 'financiero', 'revisar'];

const texto = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const entero = (v) => (v === null || v === '' || v === undefined ? null : Number.isFinite(+v) ? Math.trunc(+v) : null);
const montoOpc = (v) => (v === null || v === '' || v === undefined ? null : Number.isFinite(+v) && +v >= 0 ? Math.round(+v * 100) / 100 : null);
const bool = (v) => v !== false && v !== 'false' && v !== 0;

const TABLAS = {
  cuentas: {
    campos: (x) => {
      const nombre = texto(x.nombre, 60);
      if (!nombre) throw falla('La cuenta necesita un nombre.');
      if (!TIPOS_CUENTA.includes(x.tipo)) throw falla('Tipo de cuenta inválido.');
      return { nombre, tipo: x.tipo, orden: entero(x.orden) ?? 0, activa: bool(x.activa) };
    },
  },
  categorias: {
    campos: (x) => {
      const nombre = texto(x.nombre, 60);
      if (!nombre) throw falla('La categoría necesita un nombre.');
      if (!TIPOS_CATEGORIA.includes(x.tipo)) throw falla('Tipo de categoría inválido.');
      return { nombre, tipo: x.tipo, orden: entero(x.orden) ?? 0, activa: bool(x.activa) };
    },
  },
  proveedores: {
    campos: (x) => {
      const nombre = texto(x.nombre, 80);
      if (!nombre) throw falla('El proveedor necesita un nombre.');
      return { nombre, rubro: texto(x.rubro, 60), telefono: texto(x.telefono, 40), notas: texto(x.notas, 500), activo: bool(x.activo) };
    },
  },
  recurrentes: {
    campos: (x) => {
      const nombre = texto(x.nombre, 80);
      if (!nombre) throw falla('El vencimiento necesita un nombre.');
      const tipo = x.tipo === 'transferencia' ? 'transferencia' : 'egreso';
      const dia = entero(x.dia);
      if (!dia || dia < 1 || dia > 31) throw falla('El día de vencimiento va de 1 a 31.');
      if (tipo === 'egreso' && !entero(x.categoria_id)) throw falla('Elegí la categoría del gasto.');
      if (tipo === 'transferencia' && !entero(x.cuenta_destino_id)) throw falla('Elegí la tarjeta o cuenta destino.');
      const automatico = x.automatico === true || x.automatico === 'true' || x.automatico === 'on';
      if (automatico && !(montoOpc(x.monto) > 0)) throw falla('Para el débito automático poné el monto que se debita.');
      if (automatico && !entero(x.cuenta_id)) throw falla('Elegí desde qué cuenta o tarjeta se debita.');
      return {
        automatico,
        nombre, tipo, dia, monto: montoOpc(x.monto), activo: bool(x.activo),
        categoria_id: tipo === 'egreso' ? entero(x.categoria_id) : null,
        proveedor_id: entero(x.proveedor_id), cuenta_id: entero(x.cuenta_id),
        cuenta_destino_id: tipo === 'transferencia' ? entero(x.cuenta_destino_id) : null,
      };
    },
  },
};

// { tabla, item }  → crea (sin id) o actualiza (con id)
export const POST = protegido(async (request, yo) => {
  const b = await body(request);
  if (b.tabla === 'usuarios') return usuarios(b, yo);
  const t = TABLAS[b.tabla];
  // perfil carga: solo puede dar de alta categorías y proveedores
  if (yo.rol !== 'admin' && (!['categorias', 'proveedores'].includes(b.tabla) || (b.item && b.item.id))) throw falla('Tu usuario no tiene permiso para esto.', 403);
  if (!t || !b.item) throw falla('Pedido inválido.');
  const c = t.campos(b.item);
  const id = await actualizarConfig((cfg) => {
    const lista = cfg[b.tabla];
    const otro = lista.find((x) => x.nombre.toLowerCase() === c.nombre.toLowerCase() && x.id !== +b.item.id);
    if (otro) throw falla('Ya existe un registro con ese nombre.', 409);
    if (b.tabla === 'recurrentes') {
      if (c.categoria_id && !cfg.categorias.some((x) => x.id === c.categoria_id)) throw falla('Categoría inválida.');
      if (c.cuenta_destino_id && !cfg.cuentas.some((x) => x.id === c.cuenta_destino_id)) throw falla('Cuenta inválida.');
    }
    if (b.item.id) {
      const x = lista.find((y) => y.id === +b.item.id);
      if (!x) throw falla('No se encontró el registro.', 404);
      if (b.tabla === 'recurrentes' && c.automatico && !x.automatico) c.auto_desde = hoyAR();
      Object.assign(x, c);
      return x.id;
    }
    cfg.seq[b.tabla] = (cfg.seq[b.tabla] || Math.max(0, ...lista.map((x) => x.id))) + 1;
    if (b.tabla === 'recurrentes' && c.automatico) c.auto_desde = hoyAR();
    lista.push({ id: cfg.seq[b.tabla], ...c });
    return cfg.seq[b.tabla];
  });
  return json({ ok: true, id });
});

const usuarioCfg = (cfg, id) => { const u = cfg.usuarios.find((x) => x.id === +id); if (!u) throw falla('Usuario inválido.', 404); return u; };

async function usuarios(b, yo) {
  if (yo.rol !== 'admin' && b.accion !== 'cambiarPin') throw falla('Tu usuario no tiene permiso para esto.', 403);
  if (b.accion === 'rol') {
    if (+b.id === yo.id) throw falla('No podés cambiar tu propio perfil.');
    await actualizarConfig((cfg) => { usuarioCfg(cfg, b.id).rol = b.rol === 'admin' ? 'admin' : 'carga'; });
    return json({ ok: true });
  }
  if (b.accion === 'cambiarPin') {
    if (!pinValido(b.nuevo)) throw falla('El PIN nuevo tiene que tener entre 4 y 8 números.');
    const hash = hashPin(b.nuevo);
    await actualizarConfig((cfg) => {
      const u = usuarioCfg(cfg, yo.id);
      if (!pinOk(b.actual, u.pin_hash)) throw falla('El PIN actual no es correcto.', 401);
      u.pin_hash = hash;
    });
    return json({ ok: true });
  }
  if (b.accion === 'resetearPin') {
    if (!claveAltaOk(b.claveAlta)) throw falla('La clave de alta no es correcta.', 401);
    await actualizarConfig((cfg) => { usuarioCfg(cfg, b.id).pin_hash = null; });
    return json({ ok: true });
  }
  if (b.accion === 'agregar') {
    const nombre = texto(b.nombre, 40);
    if (!nombre) throw falla('Escribí el nombre.');
    const id = await actualizarConfig((cfg) => {
      if (cfg.usuarios.some((x) => x.nombre.toLowerCase() === nombre.toLowerCase())) throw falla('Ya existe un usuario con ese nombre.', 409);
      cfg.seq.usuarios = (cfg.seq.usuarios || cfg.usuarios.length) + 1;
      cfg.usuarios.push({ id: cfg.seq.usuarios, nombre, rol: 'carga', pin_hash: null, activo: true });
      return cfg.seq.usuarios;
    });
    return json({ ok: true, id });
  }
  if (b.accion === 'activo') {
    if (+b.id === yo.id) throw falla('No podés desactivar tu propio usuario.');
    await actualizarConfig((cfg) => { usuarioCfg(cfg, b.id).activo = bool(b.activo); });
    return json({ ok: true });
  }
  throw falla('Acción inválida.');
}
