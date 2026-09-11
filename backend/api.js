const express = require('express');
const { db, encode, decode } = require('./db');

const router = express.Router();
const allowedTables = new Set([
  'negocios', 'usuarios', 'staff', 'productos', 'planillas', 'transferencias', 'gastos', 'gastos_fijos', 'cxc', 'turnos',
  'comandas', 'comanda_items', 'pagos', 'movimientos_inventario', 'gastos_turno',
  'descorches', 'novedades', 'gastos_semanales', 'cierres_semanales',
]);
const operators = new Set(['eq', 'gte', 'lte', 'gt', 'lt']);
const ident = value => /^[a-z_][a-z0-9_]*$/i.test(value);

function parseFilter(query) {
  return Object.entries(query).filter(([key]) => !['select', 'order', 'limit'].includes(key)).flatMap(([key, value]) => {
    const [operator, ...parts] = String(value).split('.');
    if (!ident(key) || !operators.has(operator) || !parts.length) return [];
    const parsed = parts.join('.');
    return { sql: `${key} ${operator === 'eq' ? '=' : operator === 'gte' ? '>=' : operator === 'lte' ? '<=' : operator === 'gt' ? '>' : '<'} ?`, value: parsed === 'true' ? 1 : parsed === 'false' ? 0 : parsed };
  });
}

function tableOrFail(req, res, next) {
  if (!allowedTables.has(req.params.table)) return res.status(404).json({ error: 'Tabla no disponible' });
  next();
}

router.get('/:table', tableOrFail, (req, res) => {
  const filters = parseFilter(req.query);
  let sql = `SELECT * FROM ${req.params.table}`;
  const params = [];
  if (filters.length) {
    sql += ` WHERE ${filters.map(item => item.sql).join(' AND ')}`;
    params.push(...filters.map(item => item.value));
  }
  if (req.query.order) {
    const [column, direction] = req.query.order.split('.');
    if (ident(column)) sql += ` ORDER BY ${column} ${direction === 'desc' ? 'DESC' : 'ASC'}`;
  }
  const limit = Number(req.query.limit);
  if (Number.isInteger(limit) && limit > 0) { sql += ' LIMIT ?'; params.push(limit); }
  try { res.json(db.prepare(sql).all(...params).map(encode)); } catch (error) { res.status(400).json({ error: error.message }); }
});

router.post('/:table', tableOrFail, (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : [req.body];
  if (!rows.length) return res.status(400).json({ error: 'Datos vacíos' });
  try {
    const columns = Object.keys(rows[0]).filter(ident);
    const statement = db.prepare(`INSERT OR REPLACE INTO ${req.params.table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
    db.exec('BEGIN');
    rows.forEach(row => statement.run(...columns.map(column => decode(row)[column] ?? null)));
    db.exec('COMMIT');
    res.status(201).json({ ok: true });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    res.status(400).json({ error: error.message });
  }
});

router.patch('/:table', tableOrFail, (req, res) => {
  const filters = parseFilter(req.query);
  const columns = Object.keys(req.body).filter(ident);
  if (!columns.length || !filters.length) return res.status(400).json({ error: 'Actualización inválida' });
  try {
    const sql = `UPDATE ${req.params.table} SET ${columns.map(column => `${column} = ?`).join(', ')} WHERE ${filters.map(item => item.sql).join(' AND ')}`;
    db.prepare(sql).run(...columns.map(column => decode(req.body)[column] ?? null), ...filters.map(item => item.value));
    res.json({ ok: true });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

router.delete('/:table', tableOrFail, (req, res) => {
  const filters = parseFilter(req.query);
  if (!filters.length) return res.status(400).json({ error: 'Eliminación inválida' });
  try {
    db.prepare(`DELETE FROM ${req.params.table} WHERE ${filters.map(item => item.sql).join(' AND ')}`).run(...filters.map(item => item.value));
    res.json({ ok: true });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

module.exports = router;
