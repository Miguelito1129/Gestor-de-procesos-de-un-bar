const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'gestionbar.sqlite'));
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS negocios (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, emoji TEXT DEFAULT '🏢',
  color TEXT DEFAULT '#f59e0b', tipo TEXT DEFAULT 'bar', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL, negocios TEXT DEFAULT 'all', password_hash TEXT NOT NULL,
  salt TEXT NOT NULL, password_hash_local TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY, negocio_id TEXT NOT NULL, name TEXT NOT NULL,
  rol TEXT NOT NULL, pay TEXT NOT NULL, activo INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS productos (
  id TEXT PRIMARY KEY, negocio_id TEXT NOT NULL, name TEXT NOT NULL,
  cat TEXT NOT NULL, price INTEGER DEFAULT 0, stock INTEGER DEFAULT 0,
  min INTEGER DEFAULT 0, courtesy TEXT, sort_order INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS promociones (
  id TEXT PRIMARY KEY,
  negocio_id TEXT NOT NULL,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL,
  producto_principal_id TEXT NOT NULL,
  producto_cortesia_id TEXT,
  productos_combo TEXT DEFAULT '[]',
  precio_promocional INTEGER,
  cantidad_compra INTEGER NOT NULL DEFAULT 2,
  cantidad_cortesia INTEGER NOT NULL DEFAULT 1,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS planillas (
  id TEXT PRIMARY KEY, negocio_id TEXT NOT NULL, fecha TEXT NOT NULL,
  apertura TEXT, cierre TEXT, base_caja INTEGER DEFAULT 0, ventas INTEGER DEFAULT 0,
  bancos INTEGER DEFAULT 0, gastos INTEGER DEFAULT 0, personal INTEGER DEFAULT 0,
  extras INTEGER DEFAULT 0, pendientes INTEGER DEFAULT 0, neto INTEGER DEFAULT 0,
  diferencia INTEGER DEFAULT 0, novedades TEXT, estado TEXT DEFAULT 'abierta',
  checklist TEXT DEFAULT '{}', personal_detalle TEXT DEFAULT '[]',
  banco_detalle TEXT DEFAULT '{}', movimientos TEXT DEFAULT '[]',
  gastos_detalle TEXT DEFAULT '[]', created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT
);
CREATE TABLE IF NOT EXISTS gastos_fijos (
  id TEXT PRIMARY KEY, negocio_id TEXT NOT NULL, desc TEXT NOT NULL,
  monto INTEGER NOT NULL, dia INTEGER DEFAULT 0, activo INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS transferencias (
  id TEXT PRIMARY KEY, planilla_id TEXT, negocio_id TEXT NOT NULL, plataforma TEXT NOT NULL,
  monto INTEGER NOT NULL, foto_url TEXT, descripcion TEXT, verificada INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS gastos (
  id TEXT PRIMARY KEY, negocio_id TEXT NOT NULL, planilla_id TEXT, fecha TEXT NOT NULL,
  desc TEXT NOT NULL, monto INTEGER NOT NULL, cat TEXT DEFAULT 'Otros', foto_url TEXT,
  procesado INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS cxc (
  id TEXT PRIMARY KEY, negocio_id TEXT NOT NULL, deudor TEXT NOT NULL,
  monto INTEGER NOT NULL, fecha TEXT, concepto TEXT, pagado INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS turnos (
  id TEXT PRIMARY KEY, negocio_id TEXT NOT NULL, fecha_apertura TEXT DEFAULT CURRENT_TIMESTAMP,
  fecha_cierre TEXT, modo_operacion TEXT DEFAULT 'discoteca', base_caja INTEGER DEFAULT 0,
  estado TEXT DEFAULT 'abierto', inventario_apertura TEXT DEFAULT '[]',
  inventario_cierre TEXT DEFAULT '[]', efectivo_contado INTEGER, transferencias_contadas INTEGER,
  diferencia_caja INTEGER, novedades_apertura TEXT, novedades_cierre TEXT,
  abierto_por TEXT, cerrado_por TEXT, barra_id TEXT, meseros_ids TEXT DEFAULT '[]',
  legacy_planilla_id TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS comandas (
  id TEXT PRIMARY KEY, turno_id TEXT NOT NULL, mesa TEXT NOT NULL, mesero_id TEXT NOT NULL,
  consecutivo INTEGER, mesero_nombre TEXT,
  estado TEXT DEFAULT 'enviada', modo_pago TEXT, subtotal INTEGER DEFAULT 0,
  descuento INTEGER DEFAULT 0, total INTEGER DEFAULT 0, creado_en TEXT DEFAULT CURRENT_TIMESTAMP,
  confirmado_en TEXT, despachado_en TEXT, pagado_en TEXT,
  pago_confirmado INTEGER DEFAULT 0, pago_registrado_por TEXT, pago_registrado_en TEXT
);
CREATE TABLE IF NOT EXISTS comanda_items (
  id TEXT PRIMARY KEY, comanda_id TEXT NOT NULL, producto_id TEXT NOT NULL,
  cantidad INTEGER NOT NULL, precio_unitario INTEGER NOT NULL, descuento INTEGER DEFAULT 0,
  es_cortesia INTEGER DEFAULT 0, autorizado_por TEXT
);
CREATE TABLE IF NOT EXISTS pagos (
  id TEXT PRIMARY KEY, comanda_id TEXT NOT NULL, tipo TEXT NOT NULL,
  monto INTEGER NOT NULL, referencia TEXT, verificado INTEGER DEFAULT 0,
  registrado_en TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS movimientos_inventario (
  id TEXT PRIMARY KEY, negocio_id TEXT NOT NULL, turno_id TEXT, producto_id TEXT NOT NULL,
  tipo TEXT NOT NULL, cantidad INTEGER NOT NULL, motivo TEXT, comprobante_url TEXT, creado_por TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS gastos_turno (
  id TEXT PRIMARY KEY, turno_id TEXT NOT NULL, tipo TEXT NOT NULL, concepto TEXT NOT NULL,
  monto INTEGER NOT NULL, tiene_factura INTEGER DEFAULT 0, autorizado_por TEXT,
  registrado_por TEXT, legacy_gasto_id TEXT UNIQUE, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS descorches (
  id TEXT PRIMARY KEY, turno_id TEXT NOT NULL, producto_descripcion TEXT NOT NULL,
  valor_cobrado INTEGER NOT NULL, registrado_por TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS novedades (
  id TEXT PRIMARY KEY, turno_id TEXT, cierre_semanal_id TEXT, texto TEXT NOT NULL,
  creado_por TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS gastos_semanales (
  id TEXT PRIMARY KEY, negocio_id TEXT NOT NULL, semana_inicio TEXT NOT NULL,
  semana_fin TEXT NOT NULL, concepto TEXT NOT NULL, categoria TEXT NOT NULL,
  monto INTEGER NOT NULL, registrado_por TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS cierres_semanales (
  id TEXT PRIMARY KEY, negocio_id TEXT NOT NULL, semana_inicio TEXT NOT NULL,
  semana_fin TEXT NOT NULL, turnos_incluidos TEXT DEFAULT '[]', total_ventas INTEGER DEFAULT 0,
  total_descorches INTEGER DEFAULT 0, total_gastos_turnos INTEGER DEFAULT 0,
  total_gastos_semanales INTEGER DEFAULT 0, utilidad_neta INTEGER DEFAULT 0,
  novedades TEXT, cerrado_por TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

const userColumns = db.prepare('PRAGMA table_info(usuarios)').all().map(column => column.name);
if (!userColumns.includes('password_hash_local')) {
  db.exec('ALTER TABLE usuarios ADD COLUMN password_hash_local TEXT');
}

const promotionColumns = db.prepare('PRAGMA table_info(promociones)').all().map(column => column.name);
if (!promotionColumns.includes('productos_combo')) {
  db.exec("ALTER TABLE promociones ADD COLUMN productos_combo TEXT DEFAULT '[]'");
}
if (!promotionColumns.includes('precio_promocional')) {
  db.exec('ALTER TABLE promociones ADD COLUMN precio_promocional INTEGER');
}

const comandaColumns = db.prepare('PRAGMA table_info(comandas)').all().map(column => column.name);
if (!comandaColumns.includes('consecutivo')) {
  db.exec('ALTER TABLE comandas ADD COLUMN consecutivo INTEGER');
}
if (!comandaColumns.includes('mesero_nombre')) {
  db.exec('ALTER TABLE comandas ADD COLUMN mesero_nombre TEXT');
}
if (!comandaColumns.includes('pago_confirmado')) {
  db.exec('ALTER TABLE comandas ADD COLUMN pago_confirmado INTEGER DEFAULT 0');
}
if (!comandaColumns.includes('pago_registrado_por')) {
  db.exec('ALTER TABLE comandas ADD COLUMN pago_registrado_por TEXT');
}
if (!comandaColumns.includes('pago_registrado_en')) {
  db.exec('ALTER TABLE comandas ADD COLUMN pago_registrado_en TEXT');
}

const movementColumns = db.prepare('PRAGMA table_info(movimientos_inventario)').all().map(column => column.name);
if (!movementColumns.includes('comprobante_url')) {
  db.exec('ALTER TABLE movimientos_inventario ADD COLUMN comprobante_url TEXT');
}

function encode(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (typeof value !== 'string') return [key, value];
    if (['checklist', 'personal_detalle', 'banco_detalle', 'movimientos', 'gastos_detalle',
      'inventario_apertura', 'inventario_cierre', 'meseros_ids', 'turnos_incluidos', 'negocios', 'productos_combo'].includes(key)) {
      try { return [key, JSON.parse(value)]; } catch { return [key, value]; }
    }
    return [key, value];
  }));
}

function decode(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => {
    if (typeof value === 'boolean') return [key, value ? 1 : 0];
    if (value && typeof value === 'object' && ['checklist', 'personal_detalle', 'banco_detalle', 'movimientos',
      'gastos_detalle', 'inventario_apertura', 'inventario_cierre', 'meseros_ids', 'turnos_incluidos', 'negocios', 'productos_combo'].includes(key)) {
      return [key, JSON.stringify(value)];
    }
    return [key, value];
  }));
}

module.exports = { db, encode, decode };
