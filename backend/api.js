const express = require('express');
const { execFile } = require('child_process');
const os = require('os');
const crypto = require('crypto');
const { db, encode, decode } = require('./db');
const { OWNER_EMAIL, activationRequest, isLicensed, saveLicense } = require('./license');

const router = express.Router();
const PRINTER_NAME = 'Printer001';
const PRINTER_PORT = process.env.PRINTER_PORT || 'COM3';
const PRINTER_BAUD_RATE = Number(process.env.PRINTER_BAUD_RATE || 9600);
let printQueue = Promise.resolve();
const allowedTables = new Set([
  'negocios', 'usuarios', 'staff', 'productos', 'promociones', 'planillas', 'transferencias', 'gastos', 'gastos_fijos', 'cxc', 'turnos',
  'comandas', 'comanda_items', 'pagos', 'movimientos_inventario', 'gastos_turno',
  'descorches', 'novedades', 'gastos_semanales', 'cierres_semanales',
]);
const operators = new Set(['eq', 'gte', 'lte', 'gt', 'lt']);
const ident = value => /^[a-z_][a-z0-9_]*$/i.test(value);
const APP_PEPPER = 'GESBAR_PROD_2024_X9mK';
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const failedLogins = new Map();

function localHash(value, rounds = 12000) {
  let hash = 2166136261;
  for (let round = 0; round < rounds; round += 1) {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index) + round;
      hash = Math.imul(hash, 16777619);
      hash >>>= 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}

function secureEqual(value, expected) {
  const actualBuffer = Buffer.from(String(value));
  const expectedBuffer = Buffer.from(String(expected));
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();
  db.prepare('INSERT INTO sesiones (token_hash, usuario_id, expira_en) VALUES (?, ?, ?)')
    .run(crypto.createHash('sha256').update(token).digest('hex'), userId, expiresAt);
  return { token, expiresAt };
}

function publicUser(account) {
  return encode({
    id: account.id,
    name: account.name,
    email: account.email,
    role: account.role,
    negocios: account.negocios,
  });
}

function isMasterUser(user) {
  return String(user?.role || '').toLowerCase() === 'administrador'
    && String(user?.email || '').toLowerCase() === OWNER_EMAIL;
}

function validateUserFields({ name, email, role, negocios, password }, { requirePassword = false } = {}) {
  const normalizedName = String(name || '').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedRole = String(role || '').trim().toLowerCase();
  const validRoles = new Set(['gerente', 'barra', 'mesero', 'dueño', 'auxiliar', 'jefe', 'barra_fija', 'mesero_fijo']);

  if (!normalizedName || normalizedName.length > 120) {
    return { error: 'El nombre es obligatorio y debe tener máximo 120 caracteres.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
    return { error: 'Escribe un correo electrónico válido.' };
  }
  if (!validRoles.has(normalizedRole)) {
    return { error: 'Selecciona un rol válido para el usuario.' };
  }
  if (requirePassword && (typeof password !== 'string' || password.length < 8 || password.length > 256)) {
    return { error: 'La contraseña debe tener entre 8 y 256 caracteres.' };
  }
  if (!requirePassword && password !== undefined && password !== ''
    && (typeof password !== 'string' || password.length < 8 || password.length > 256)) {
    return { error: 'La contraseña debe tener entre 8 y 256 caracteres.' };
  }

  let normalizedBusinesses = negocios;
  if (normalizedRole === 'dueño' || normalizedRole === 'jefe' || normalizedBusinesses === 'all') {
    normalizedBusinesses = 'all';
  } else if (Array.isArray(normalizedBusinesses)) {
    if (normalizedBusinesses.some(id => typeof id !== 'string' || !id.trim())) {
      return { error: 'La lista de negocios asignados no es válida.' };
    }
    normalizedBusinesses = [...new Set(normalizedBusinesses)];
  } else {
    return { error: 'Selecciona los negocios asignados o elige todos los negocios.' };
  }

  if (Array.isArray(normalizedBusinesses) && normalizedBusinesses.length) {
    const placeholders = normalizedBusinesses.map(() => '?').join(', ');
    const found = db.prepare(`SELECT id FROM negocios WHERE id IN (${placeholders})`)
      .all(...normalizedBusinesses).map(row => row.id);
    if (found.length !== normalizedBusinesses.length) {
      return { error: 'Uno o más negocios asignados ya no existen.' };
    }
  }

  return {
    value: {
      name: normalizedName,
      email: normalizedEmail,
      role: normalizedRole,
      negocios: normalizedBusinesses,
      password,
    },
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = crypto.pbkdf2Sync(password, salt + APP_PEPPER, 100000, 32, 'sha256').toString('hex');
  return { salt, passwordHash };
}

function isLocalRequest(req) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
}

router.get('/license/status', (req, res) => {
  res.json({ authorized: isLicensed() });
});

router.get('/license/request', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ error: 'La solicitud de licencia solo se puede descargar desde el computador servidor.' });
  try {
    res.json(activationRequest());
  } catch (error) {
    console.error('No fue posible crear la solicitud de licencia:', error);
    res.status(500).json({ error: error.message || 'No fue posible identificar este computador.' });
  }
});

router.post('/license/install', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ error: 'La licencia solo se puede instalar desde el computador servidor.' });
  try {
    saveLicense(req.body);
    res.json({ ok: true });
  } catch (error) {
    console.error('No fue posible instalar la licencia del equipo:', error);
    res.status(400).json({ error: error.message || 'La licencia no es válida para este equipo.' });
  }
});

router.use((req, res, next) => {
  if (!isLicensed()) return res.status(423).json({ error: 'Este computador aún no está autorizado para usar GestiónBar.' });
  next();
});

router.post('/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (email.length > 254 || password.length > 256) {
    return res.status(400).json({ error: 'El correo o la contraseña exceden el tamaño permitido.' });
  }
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const attemptKey = `${ip}:${email}`;
  const attempt = failedLogins.get(attemptKey) || { count: 0, lockedUntil: 0 };
  if (attempt.lockedUntil > Date.now()) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos antes de volver a intentarlo.' });
  }
  const account = db.prepare(`
    SELECT id, name, email, role, negocios, password_hash, password_hash_local, salt
    FROM usuarios WHERE lower(email) = ?
  `).get(email);
  const expected = account?.password_hash_local;
  const supplied = account?.salt ? localHash(`${account.salt}${APP_PEPPER}${password}`) : '';
  const localMatches = Boolean(expected && secureEqual(supplied, expected));
  const hashMatches = Boolean(account?.salt && account?.password_hash && (
    secureEqual(crypto.pbkdf2Sync(password, account.salt + APP_PEPPER, 100000, 32, 'sha256').toString('hex'), account.password_hash)
    || secureEqual(supplied, account.password_hash)
  ));
  if (!account || !password || !(localMatches || hashMatches)) {
    const count = attempt.count + 1;
    failedLogins.set(attemptKey, {
      count,
      lockedUntil: count >= 5 ? Date.now() + 15 * 60 * 1000 : 0,
    });
    return res.status(401).json({ error: 'Credenciales incorrectas.' });
  }
  failedLogins.delete(attemptKey);
  const session = createSession(account.id);
  res.json({
    ...session,
    user: publicUser(account),
  });
});

router.get('/setup/status', (req, res) => {
  const master = db.prepare('SELECT id FROM usuarios WHERE lower(email) = ?').get(OWNER_EMAIL);
  res.json({ required: !master });
});

router.post('/setup/master', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ error: 'La cuenta maestra se debe configurar desde el computador servidor.' });
  const existingMaster = db.prepare('SELECT id FROM usuarios WHERE lower(email) = ?').get(OWNER_EMAIL);
  if (existingMaster) return res.status(409).json({ error: 'La cuenta maestra ya está configurada.' });
  const name = String(req.body?.name || '').trim();
  const password = String(req.body?.password || '');
  if (!name || password.length < 12) {
    return res.status(400).json({ error: 'Escribe un nombre y una contraseña de al menos 12 caracteres.' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = crypto.pbkdf2Sync(password, salt + APP_PEPPER, 100000, 32, 'sha256').toString('hex');
  const id = crypto.randomUUID();
  try {
    db.prepare(`
      INSERT INTO usuarios (id, name, email, role, negocios, password_hash, salt)
      VALUES (?, ?, ?, 'administrador', 'all', ?, ?)
    `).run(id, name, OWNER_EMAIL, passwordHash, salt);
    const session = createSession(id);
    res.status(201).json({
      ...session,
      user: { id, name, email: OWNER_EMAIL, role: 'administrador', negocios: 'all' },
    });
  } catch (error) {
    console.error('No fue posible configurar la cuenta maestra:', error);
    res.status(500).json({ error: 'No fue posible crear la cuenta administradora maestra.' });
  }
});

router.use((req, res, next) => {
  const token = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.negocios, s.expira_en
    FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token_hash = ?
  `).get(tokenHash);
  if (!session || new Date(session.expira_en).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sesiones WHERE token_hash = ?').run(tokenHash);
    return res.status(401).json({ error: 'La sesión venció. Inicia sesión nuevamente.' });
  }
  req.authUser = session;
  next();
});

router.get('/auth/session', (req, res) => {
  res.json({
    user: publicUser(req.authUser),
    expiresAt: req.authUser.expira_en,
  });
});

router.post('/auth/logout', (req, res) => {
  const token = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('DELETE FROM sesiones WHERE token_hash = ?').run(tokenHash);
  res.json({ ok: true });
});

router.post('/users', (req, res) => {
  if (!isMasterUser(req.authUser)) {
    return res.status(403).json({ error: 'Solo el administrador maestro puede administrar usuarios.' });
  }
  const validated = validateUserFields(req.body || {}, { requirePassword: true });
  if (validated.error) return res.status(400).json({ error: validated.error });
  if (validated.value.email === OWNER_EMAIL) {
    return res.status(409).json({ error: 'El correo reservado al administrador maestro no se puede usar para otro usuario.' });
  }
  const existing = db.prepare('SELECT id FROM usuarios WHERE lower(email) = ?').get(validated.value.email);
  if (existing) return res.status(409).json({ error: 'Ya existe un usuario con ese correo.' });

  const { salt, passwordHash } = hashPassword(validated.value.password);
  const id = crypto.randomUUID();
  try {
    db.prepare(`
      INSERT INTO usuarios (id, name, email, role, negocios, password_hash, salt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      validated.value.name,
      validated.value.email,
      validated.value.role,
      JSON.stringify(validated.value.negocios),
      passwordHash,
      salt,
    );
    res.status(201).json(publicUser({ id, ...validated.value }));
  } catch (error) {
    if (String(error.message).includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Ya existe un usuario con ese correo.' });
    }
    console.error('No fue posible crear el usuario:', error);
    res.status(500).json({ error: 'No fue posible guardar el usuario en SQLite.' });
  }
});

router.patch('/users/:id', (req, res) => {
  if (!isMasterUser(req.authUser)) {
    return res.status(403).json({ error: 'Solo el administrador maestro puede administrar usuarios.' });
  }
  const account = db.prepare('SELECT id, name, email, role, negocios FROM usuarios WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ error: 'No se encontró el usuario.' });

  const isMaster = String(account.email).toLowerCase() === OWNER_EMAIL;
  const changes = req.body || {};
  const fields = isMaster
    ? { name: changes.name ?? account.name, email: account.email, role: account.role, negocios: account.negocios }
    : {
      name: changes.name ?? account.name,
      email: changes.email ?? account.email,
      role: changes.role ?? account.role,
      negocios: changes.negocios ?? decode({ negocios: account.negocios }).negocios,
    };
  if (isMaster && (changes.email !== undefined || changes.role !== undefined || changes.negocios !== undefined)) {
    return res.status(403).json({ error: 'El correo, el rol y los permisos del administrador maestro están protegidos.' });
  }
  const validated = validateUserFields({
    ...fields,
    role: isMaster ? 'gerente' : fields.role,
    password: changes.password,
  });
  if (validated.error) return res.status(400).json({ error: validated.error });
  if (!isMaster && validated.value.email === OWNER_EMAIL) {
    return res.status(409).json({ error: 'El correo reservado al administrador maestro no se puede asignar a otro usuario.' });
  }
  const duplicate = db.prepare('SELECT id FROM usuarios WHERE lower(email) = ? AND id != ?')
    .get(validated.value.email, account.id);
  if (duplicate) return res.status(409).json({ error: 'Ya existe un usuario con ese correo.' });

  try {
    const updates = isMaster
      ? { name: validated.value.name }
      : {
        name: validated.value.name,
        email: validated.value.email,
        role: validated.value.role,
        negocios: JSON.stringify(validated.value.negocios),
      };
    if (validated.value.password) {
      const credentials = hashPassword(validated.value.password);
      updates.password_hash = credentials.passwordHash;
      updates.salt = credentials.salt;
    }
    const columns = Object.keys(updates);
    db.prepare(`UPDATE usuarios SET ${columns.map(column => `${column} = ?`).join(', ')} WHERE id = ?`)
      .run(...columns.map(column => updates[column]), account.id);
    const updated = db.prepare('SELECT id, name, email, role, negocios FROM usuarios WHERE id = ?').get(account.id);
    res.json(publicUser(updated));
  } catch (error) {
    console.error('No fue posible actualizar el usuario:', error);
    res.status(500).json({ error: 'No fue posible guardar los cambios del usuario en SQLite.' });
  }
});

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
  const role = String(req.authUser?.role || '').toLowerCase();
  const isMaster = role === 'administrador' && req.authUser?.email.toLowerCase() === OWNER_EMAIL;
  const isManager = isMaster || role === 'gerente';
  const method = req.method;
  const table = req.params.table;
  if (table === 'usuarios' && method !== 'GET' && !isMaster) {
    return res.status(403).json({ error: 'Solo el administrador maestro puede administrar usuarios.' });
  }
  if (table === 'negocios' && method !== 'GET' && !isMaster) {
    return res.status(403).json({ error: 'Solo el administrador maestro puede administrar negocios.' });
  }
  if (!isManager) {
    if (table === 'negocios' && method === 'GET') return next();
    const allowed = ['mesero', 'mesero_fijo'].includes(role)
      ? { GET: ['usuarios', 'productos', 'promociones', 'turnos', 'comandas', 'comanda_items', 'pagos'], POST: ['comandas', 'comanda_items', 'pagos'], PATCH: ['comandas', 'comanda_items', 'pagos'], DELETE: ['comandas', 'comanda_items'] }
      : ['barra', 'barra_fija'].includes(role)
        ? { GET: ['usuarios', 'productos', 'promociones', 'turnos', 'comandas', 'comanda_items', 'pagos'], POST: ['movimientos_inventario', 'gastos_turno', 'descorches', 'novedades'], PATCH: ['productos', 'turnos', 'comandas'], DELETE: [] }
        : {};
    if (!allowed[method]?.includes(table)) {
      return res.status(403).json({ error: 'Tu rol no tiene permiso para realizar esta operación.' });
    }
  }
  if (['barra', 'barra_fija'].includes(role) && method === 'PATCH') {
    const columns = Object.keys(req.body || {});
    const allowedColumns = table === 'productos' ? ['stock']
      : table === 'turnos' ? ['meseros_ids']
        : table === 'comandas' ? ['estado', 'confirmado_en', 'despachado_en', 'actualizada_en']
          : [];
    if (columns.some(column => !allowedColumns.includes(column))) {
      return res.status(403).json({ error: 'La operación contiene campos fuera de los permisos de Barra.' });
    }
  }
  if (['mesero', 'mesero_fijo'].includes(role) && method === 'PATCH') {
    const columns = Object.keys(req.body || {});
    const allowedColumns = table === 'comandas'
      ? ['estado', 'pago_confirmado', 'modo_pago', 'pago_registrado_por', 'pago_registrado_en', 'pagado_en', 'actualizada_en', 'subtotal', 'descuento', 'total', 'mesa']
      : table === 'comanda_items' ? ['cantidad', 'descuento', 'precio_unitario']
        : table === 'pagos' ? ['verificado', 'referencia'] : [];
    if (columns.some(column => !allowedColumns.includes(column))) {
      return res.status(403).json({ error: 'La operación contiene campos fuera de los permisos de Mesero.' });
    }
  }
  next();
}

function rowsBelongToWaiter(table, rows, userId) {
  return rows.every(row => {
    if (table === 'comandas') return row.mesero_id === userId;
    if (table === 'comanda_items' || table === 'pagos') {
      if (!row.comanda_id) return false;
      const order = db.prepare('SELECT mesero_id FROM comandas WHERE id = ?').get(row.comanda_id);
      return order?.mesero_id === userId;
    }
    return false;
  });
}

function matchingRows(table, filters) {
  if (!filters.length) return [];
  return db.prepare(`SELECT * FROM ${table} WHERE ${filters.map(item => item.sql).join(' AND ')}`)
    .all(...filters.flatMap(item => item.values || [item.value]));
}

function accountBusinessIds(user) {
  const assigned = encode({ negocios: user?.negocios }).negocios;
  if (assigned === 'all') {
    return db.prepare('SELECT id FROM negocios').all().map(row => row.id);
  }
  if (!Array.isArray(assigned)) return [];
  return [...new Set(assigned.filter(id => typeof id === 'string'))]
    .filter(id => db.prepare('SELECT 1 FROM negocios WHERE id = ?').get(id));
}

function accessibleBusinessIds(user) {
  if (isMasterUser(user)) return null;
  const assignedIds = accountBusinessIds(user);
  const role = String(user?.role || '').toLowerCase();
  if (!['barra', 'barra_fija', 'mesero', 'mesero_fijo'].includes(role) || !assignedIds.length) {
    return assignedIds;
  }

  const activeTurns = db.prepare(`
    SELECT negocio_id, barra_id, meseros_ids FROM turnos
    WHERE estado = 'abierto' AND negocio_id IN (${assignedIds.map(() => '?').join(', ')})
  `).all(...assignedIds);
  const authorized = activeTurns.filter(turno => {
    if (['barra', 'barra_fija'].includes(role)) return turno.barra_id === user.id;
    try {
      const waiters = JSON.parse(turno.meseros_ids || '[]');
      return Array.isArray(waiters) && waiters.some(id => String(id) === String(user.id));
    } catch (error) {
      console.error(`No fue posible leer los meseros autorizados del turno ${turno.negocio_id}:`, error);
      return false;
    }
  });
  return [...new Set(authorized.map(turno => turno.negocio_id))];
}

function businessScope(table, user) {
  if (table === 'negocios' && !isMasterUser(user)) {
    const assignedBusinessIds = accountBusinessIds(user);
    if (!assignedBusinessIds.length) return { sql: '0 = 1', values: [] };
    return {
      sql: `id IN (${assignedBusinessIds.map(() => '?').join(', ')})`,
      values: assignedBusinessIds,
    };
  }

  const businessIds = accessibleBusinessIds(user);
  if (businessIds === null) return null;
  if (!businessIds.length) return { sql: '0 = 1', values: [] };

  const placeholders = businessIds.map(() => '?').join(', ');
  const scopeByTurn = `negocio_id IN (${placeholders})`;
  const role = String(user?.role || '').toLowerCase();
  const isWaiter = ['mesero', 'mesero_fijo'].includes(role);
  const isBar = ['barra', 'barra_fija'].includes(role);

  if (table === 'negocios') {
    return { sql: `id IN (${placeholders})`, values: businessIds };
  }
  if (['staff', 'productos', 'promociones', 'planillas', 'transferencias', 'gastos',
    'gastos_fijos', 'cxc', 'movimientos_inventario', 'gastos_semanales',
    'cierres_semanales'].includes(table)) {
    return { sql: `negocio_id IN (${placeholders})`, values: businessIds };
  }
  if (table === 'turnos') {
    return {
      sql: `negocio_id IN (${placeholders})${isBar ? ' AND barra_id = ?' : ''}`,
      values: isBar ? [...businessIds, user.id] : businessIds,
    };
  }
  if (table === 'comandas') {
    const turnConditions = [`negocio_id IN (${placeholders})`];
    const values = [...businessIds];
    if (isBar) {
      turnConditions.push('barra_id = ?');
      values.push(user.id);
    }
    const orderConditions = [`turno_id IN (SELECT id FROM turnos WHERE ${turnConditions.join(' AND ')})`];
    if (isWaiter) {
      orderConditions.push('mesero_id = ?');
      values.push(user.id);
    }
    return { sql: orderConditions.join(' AND '), values };
  }
  if (['comanda_items', 'pagos'].includes(table)) {
    const nestedConditions = [`t.${scopeByTurn}`];
    const values = [...businessIds];
    if (isWaiter) {
      nestedConditions.push('c.mesero_id = ?');
      values.push(user.id);
    } else if (isBar) {
      nestedConditions.push('t.barra_id = ?');
      values.push(user.id);
    }
    return {
      sql: `comanda_id IN (
        SELECT c.id FROM comandas c
        JOIN turnos t ON t.id = c.turno_id
        WHERE ${nestedConditions.join(' AND ')}
      )`,
      values,
    };
  }
  if (['gastos_turno', 'descorches'].includes(table)) {
    return { sql: `turno_id IN (SELECT id FROM turnos WHERE ${scopeByTurn})`, values: businessIds };
  }
  if (table === 'novedades') {
    return {
      sql: `(turno_id IN (SELECT id FROM turnos WHERE ${scopeByTurn})
        OR cierre_semanal_id IN (SELECT id FROM cierres_semanales WHERE negocio_id IN (${placeholders})))`,
      values: [...businessIds, ...businessIds],
    };
  }
  return { sql: '0 = 1', values: [] };
}

function referencedBusinessIds(table, row) {
  const businessIds = [];
  if (row.negocio_id !== undefined && row.negocio_id !== null) {
    businessIds.push(String(row.negocio_id));
  }
  if (table === 'negocios') businessIds.push(String(row.id || ''));

  if (row.turno_id) {
    const turn = db.prepare('SELECT negocio_id FROM turnos WHERE id = ?').get(row.turno_id);
    if (!turn) return null;
    businessIds.push(turn.negocio_id);
  }
  if (row.comanda_id) {
    const order = db.prepare(`
      SELECT t.negocio_id FROM comandas c
      JOIN turnos t ON t.id = c.turno_id
      WHERE c.id = ?
    `).get(row.comanda_id);
    if (!order) return null;
    businessIds.push(order.negocio_id);
  }
  if (row.cierre_semanal_id) {
    const closing = db.prepare('SELECT negocio_id FROM cierres_semanales WHERE id = ?').get(row.cierre_semanal_id);
    if (!closing) return null;
    businessIds.push(closing.negocio_id);
  }
  if (row.planilla_id) {
    const planilla = db.prepare('SELECT negocio_id FROM planillas WHERE id = ?').get(row.planilla_id);
    if (!planilla) return null;
    businessIds.push(planilla.negocio_id);
  }
  if (table === 'comandas' && row.turno_id && row.negocio_id) {
    const turn = db.prepare('SELECT negocio_id FROM turnos WHERE id = ?').get(row.turno_id);
    if (turn?.negocio_id !== row.negocio_id) return null;
  }
  return businessIds.length ? businessIds : null;
}

function rowIsInBusinessScope(table, row, user, accessibleIds = accessibleBusinessIds(user)) {
  if (isMasterUser(user)) return true;
  const permittedIds = new Set(accessibleIds);
  const referencedIds = referencedBusinessIds(table, row);
  return Boolean(referencedIds?.length
    && referencedIds.every(id => permittedIds.has(String(id)))
    && new Set(referencedIds.map(String)).size === 1);
}

function cleanReceiptText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '');
}

function wrapReceiptText(value, width) {
  const words = cleanReceiptText(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (word.length > width) {
      if (line) lines.push(line);
      line = '';
      for (let index = 0; index < word.length; index += width) {
        lines.push(word.slice(index, index + width));
      }
      continue;
    }
    if (line && `${line} ${word}`.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function formatReceiptMoney(value) {
  return `$${Math.round(Number(value) || 0).toLocaleString('es-CO')}`;
}

function buildComandaReceipt({ business, order, items, footer = 'COMPROBANTE INTERNO' }) {
  const width = 42;
  const lineBreak = '\r\n';
  const chunks = [];
  const command = (...bytes) => chunks.push(Buffer.from(bytes));
  const text = value => {
    const lines = String(value ?? '').split(/\r\n|\r|\n/).map(cleanReceiptText);
    chunks.push(Buffer.from(lines.join(lineBreak), 'ascii'));
  };
  const line = value => {
    for (const part of wrapReceiptText(value, width)) text(`${part}${lineBreak}`);
  };
  const indentedLines = (value, indentation = '  ') => {
    const contentWidth = width - indentation.length;
    for (const part of wrapReceiptText(value, contentWidth)) {
      text(`${indentation}${part}${lineBreak}`);
    }
  };
  const centered = value => {
    for (const part of wrapReceiptText(value, width)) {
      text(`${part.padStart(Math.floor((width + part.length) / 2)).padEnd(width)}${lineBreak}`);
    }
  };
  const separator = character => text(`${character.repeat(width)}${lineBreak}`);
  const labeledLine = (label, value) => line(`${label}: ${value}`);
  chunks.push(Buffer.from([0x1b, 0x40]));
  command(0x1b, 0x4d, 0x00);
  command(0x1b, 0x21, 0x00);
  command(0x1b, 0x32);
  command(0x1b, 0x61, 1);
  command(0x1b, 0x45, 1);
  centered(business.name || 'NEGOCIO');
  command(0x1b, 0x45, 0);
  command(0x1b, 0x21, 0x00);
  if (business.tipo) centered(String(business.tipo).toUpperCase());
  centered('COMANDA');
  command(0x1b, 0x61, 0);
  separator('=');
  labeledLine('Comanda', `#${order.consecutivo || order.id.slice(0, 8)}`);
  labeledLine('Fecha', formatReceiptDate(order.pagado_en || order.pago_registrado_en || order.creado_en));
  labeledLine('Atendio', order.mesero_nombre || 'Mesero');
  separator('-');

  let discounts = 0;
  const tableWidth = width;
  const printableRows = items.map(item => {
    const quantity = Math.max(0, Number(item.cantidad) || 0);
    const unitPrice = Math.max(0, Number(item.precio_unitario) || 0);
    const discount = Math.max(0, Number(item.descuento) || 0);
    return {
      name: item.product_name || 'Producto',
      quantity,
      discount,
      total: Math.max(0, unitPrice * quantity - discount),
    };
  });
  const quantityColumnWidth = Math.max(6, ...printableRows.map(item => String(item.quantity).length));
  const totalColumnWidth = Math.max(12, ...printableRows.map(item => formatReceiptMoney(item.total).length));
  const productColumnWidth = tableWidth - 2 - quantityColumnWidth - totalColumnWidth;
  if (productColumnWidth < 12) {
    throw new Error('Los importes de la comanda exceden el ancho imprimible de la factura.');
  }
  command(0x1b, 0x4d, 0x00);
  text(`  ${'Producto'.padEnd(productColumnWidth)}${'Cant.'.padStart(quantityColumnWidth)}${'Total'.padStart(totalColumnWidth)}${lineBreak}`);
  text(`  ${'-'.repeat(productColumnWidth)}${'-'.repeat(quantityColumnWidth)}${'-'.repeat(totalColumnWidth)}${lineBreak}`);
  for (const item of printableRows) {
    discounts += item.discount;
    const nameLines = wrapReceiptText(item.name, productColumnWidth);
    nameLines.forEach((name, index) => {
      const quantityCell = index === 0 ? String(item.quantity).padStart(quantityColumnWidth) : ' '.repeat(quantityColumnWidth);
      const totalCell = index === 0 ? formatReceiptMoney(item.total).padStart(totalColumnWidth) : ' '.repeat(totalColumnWidth);
      text(`  ${name.padEnd(productColumnWidth)}${quantityCell}${totalCell}${lineBreak}`);
    });
    if (item.discount > 0) {
      indentedLines(`Descuento: -${formatReceiptMoney(item.discount)}`);
    }
  }

  separator('-');
  if (discounts > 0) labeledLine('Descuentos', `-${formatReceiptMoney(discounts)}`);
  labeledLine('Total', formatReceiptMoney(order.total));
  separator('=');
  command(0x1b, 0x61, 1);
  centered(footer);
  command(0x1b, 0x61, 0);
  command(0x1b, 0x64, 0x03);
  command(0x1d, 0x56, 0x00);
  return Buffer.concat(chunks);
}

function formatReceiptDate(value) {
  if (!value) return 'Sin fecha';
  const dateValue = String(value);
  const date = new Date(dateValue.includes('T') ? dateValue : `${dateValue.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return cleanReceiptText(dateValue);
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function sendToBluetoothPrinter(receipt) {
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('La impresora Bluetooth configurada requiere que el backend se ejecute en Windows.'));
  }
  if (!/^COM\d+$/i.test(PRINTER_PORT) || !Number.isInteger(PRINTER_BAUD_RATE) || PRINTER_BAUD_RATE < 1200) {
    return Promise.reject(new Error('La configuración del puerto Bluetooth de la impresora no es válida.'));
  }

  const script = [
    '$ErrorActionPreference = "Stop"',
    '$port = New-Object System.IO.Ports.SerialPort',
    '$port.PortName = $env:GESTIONBAR_PRINTER_PORT',
    '$port.BaudRate = [int]$env:GESTIONBAR_PRINTER_BAUD_RATE',
    '$port.DataBits = 8',
    '$port.Parity = [System.IO.Ports.Parity]::None',
    '$port.StopBits = [System.IO.Ports.StopBits]::One',
    '$port.WriteTimeout = 10000',
    'try {',
    '  $port.Open()',
    '  $bytes = [Convert]::FromBase64String($env:GESTIONBAR_PRINTER_DATA)',
    '  $port.Write($bytes, 0, $bytes.Length)',
    '} finally {',
    '  if ($port.IsOpen) { $port.Close() }',
    '}',
  ].join('; ');

  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      timeout: 20000,
      windowsHide: true,
      env: {
        ...process.env,
        GESTIONBAR_PRINTER_PORT: PRINTER_PORT,
        GESTIONBAR_PRINTER_BAUD_RATE: String(PRINTER_BAUD_RATE),
        GESTIONBAR_PRINTER_DATA: receipt.toString('base64'),
      },
    }, (error, stdout, stderr) => {
      if (error) {
        const details = String(stderr || stdout || error.message).trim();
        reject(new Error(details || 'No fue posible conectar con Printer001.'));
        return;
      }
      resolve();
    });
  });
}

function enqueueInvoice(receipt) {
  const job = printQueue.then(() => sendToBluetoothPrinter(receipt));
  printQueue = job.catch(error => {
    console.error(`Error de impresión en ${PRINTER_NAME}:`, error);
  });
  return job;
}

router.post('/print/invoice', async (req, res) => {
  const { comanda_id: comandaId, user_id: userId } = req.body || {};
  if (typeof comandaId !== 'string' || !comandaId || typeof userId !== 'string' || !userId) {
    return res.status(400).json({ error: 'Falta identificar la comanda y la cuenta del mesero.' });
  }

  let order;
  let items;
  try {
    order = db.prepare(`
      SELECT c.*, t.negocio_id, n.name AS negocio_name, n.tipo AS negocio_tipo
      FROM comandas c
      JOIN turnos t ON t.id = c.turno_id
      JOIN negocios n ON n.id = t.negocio_id
      WHERE c.id = ?
    `).get(comandaId);
    if (order) {
      items = db.prepare(`
      SELECT ci.cantidad, ci.precio_unitario, ci.descuento, COALESCE(p.name, 'Producto') AS product_name
      FROM comanda_items ci
      LEFT JOIN productos p ON p.id = ci.producto_id
      WHERE ci.comanda_id = ?
      ORDER BY ci.rowid
    `).all(comandaId);
    }
  } catch (error) {
    console.error(`No fue posible consultar la comanda ${comandaId} para imprimir:`, error);
    return res.status(500).json({ error: 'No fue posible cargar los datos de la comanda para imprimir.' });
  }

  if (!order) return res.status(404).json({ error: 'No se encontró la comanda.' });
  if (order.estado !== 'pagada') return res.status(409).json({ error: 'Solo se pueden imprimir comandas pagadas.' });
  if (req.authUser.id !== userId || order.mesero_id !== userId) return res.status(403).json({ error: 'Esta comanda no pertenece a la cuenta del mesero autenticado.' });
  if (!items.length) return res.status(409).json({ error: 'La comanda no tiene productos para imprimir.' });

  let receipt;
  try {
    receipt = buildComandaReceipt({
      business: { name: order.negocio_name, tipo: order.negocio_tipo },
      order,
      items,
    });
  } catch (error) {
    console.error(`No fue posible preparar el comprobante para la comanda ${comandaId}:`, error);
    return res.status(500).json({ error: 'No fue posible preparar el comprobante de venta.' });
  }

  try {
    await enqueueInvoice(receipt);
    res.json({ ok: true, printer: PRINTER_NAME, message: `Comprobante enviado a ${PRINTER_NAME}.` });
  } catch (error) {
    console.error(`No fue posible imprimir la comanda ${comandaId} en ${PRINTER_NAME}:`, error);
    res.status(503).json({
      error: `Impresora sin conexión o puerto Bluetooth no disponible. Revisa que ${PRINTER_NAME} esté encendida y conectada a ${PRINTER_PORT}, y que el puerto no esté ocupado.`,
    });
  }
});

router.post('/print/order', async (req, res) => {
  const { comanda_id: comandaId, user_id: userId } = req.body || {};
  if (typeof comandaId !== 'string' || !comandaId || typeof userId !== 'string' || !userId) {
    return res.status(400).json({ error: 'Falta identificar la comanda y la cuenta del mesero.' });
  }

  let order;
  let items;
  try {
    order = db.prepare(`
      SELECT c.*, t.negocio_id, n.name AS negocio_name, n.tipo AS negocio_tipo
      FROM comandas c
      JOIN turnos t ON t.id = c.turno_id
      JOIN negocios n ON n.id = t.negocio_id
      WHERE c.id = ?
    `).get(comandaId);
    if (order) {
      items = db.prepare(`
        SELECT ci.cantidad, ci.precio_unitario, ci.descuento, COALESCE(p.name, 'Producto') AS product_name
        FROM comanda_items ci
        LEFT JOIN productos p ON p.id = ci.producto_id
        WHERE ci.comanda_id = ?
        ORDER BY ci.rowid
      `).all(comandaId);
    }
  } catch (error) {
    console.error(`No fue posible consultar la comanda ${comandaId} para imprimirla en barra:`, error);
    return res.status(500).json({ error: 'No fue posible cargar los datos del pedido para imprimir.' });
  }

  if (!order) return res.status(404).json({ error: 'No se encontró la comanda.' });
  if (order.estado !== 'enviada') return res.status(409).json({ error: 'Solo se pueden imprimir pedidos enviados a barra.' });
  if (req.authUser.id !== userId || order.mesero_id !== userId) return res.status(403).json({ error: 'Esta comanda no pertenece a la cuenta del mesero autenticado.' });
  if (!items.length) return res.status(409).json({ error: 'La comanda no tiene productos para imprimir.' });

  let receipt;
  try {
    receipt = buildComandaReceipt({
      business: { name: order.negocio_name, tipo: order.negocio_tipo },
      order,
      items,
      footer: 'COPIA PARA BARRA',
    });
  } catch (error) {
    console.error(`No fue posible preparar el pedido ${comandaId} para imprimir:`, error);
    return res.status(500).json({ error: 'No fue posible preparar el pedido para impresión.' });
  }

  try {
    await enqueueInvoice(receipt);
    res.json({ ok: true, printer: PRINTER_NAME, message: `Pedido enviado a imprimir en ${PRINTER_NAME}.` });
  } catch (error) {
    console.error(`No fue posible imprimir el pedido ${comandaId} en ${PRINTER_NAME}:`, error);
    res.status(503).json({
      error: `Impresora sin conexión o puerto Bluetooth no disponible. Revisa que ${PRINTER_NAME} esté encendida y conectada a ${PRINTER_PORT}, y que el puerto no esté ocupado.`,
    });
  }
});

router.delete('/negocios/:id', (req, res) => {
  if (req.authUser.role !== 'administrador' || req.authUser.email.toLowerCase() !== OWNER_EMAIL) {
    return res.status(403).json({ error: 'Solo el administrador maestro puede eliminar negocios.' });
  }
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'Identificador de negocio inválido' });

  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      const business = db.prepare('SELECT id FROM negocios WHERE id = ?').get(id);
      if (!business) {
        db.exec('ROLLBACK');
        return res.status(404).json({ error: 'No se encontró el negocio' });
      }

      const turnIds = db.prepare('SELECT id FROM turnos WHERE negocio_id = ?').all(id).map(row => row.id);
      const closingIds = db.prepare('SELECT id FROM cierres_semanales WHERE negocio_id = ?').all(id).map(row => row.id);
      const orderIds = turnIds.length
        ? db.prepare(`SELECT id FROM comandas WHERE turno_id IN (${turnIds.map(() => '?').join(',')})`).all(...turnIds).map(row => row.id)
        : [];

      const deleteMatching = (table, column, values) => {
        if (!values.length) return;
        db.prepare(`DELETE FROM ${table} WHERE ${column} IN (${values.map(() => '?').join(',')})`).run(...values);
      };

      deleteMatching('comanda_items', 'comanda_id', orderIds);
      deleteMatching('pagos', 'comanda_id', orderIds);
      deleteMatching('comandas', 'id', orderIds);
      deleteMatching('gastos_turno', 'turno_id', turnIds);
      deleteMatching('descorches', 'turno_id', turnIds);
      deleteMatching('novedades', 'turno_id', turnIds);
      deleteMatching('novedades', 'cierre_semanal_id', closingIds);

      for (const table of [
        'cierres_semanales',
        'gastos_semanales',
        'movimientos_inventario',
        'transferencias',
        'gastos',
        'gastos_fijos',
        'cxc',
        'promociones',
        'productos',
        'staff',
        'planillas',
        'turnos',
      ]) {
        db.prepare(`DELETE FROM ${table} WHERE negocio_id = ?`).run(id);
      }
      db.prepare('DELETE FROM negocios WHERE id = ?').run(id);

      const users = db.prepare('SELECT id, negocios FROM usuarios').all();
      const updateUserAccess = db.prepare('UPDATE usuarios SET negocios = ? WHERE id = ?');
      for (const user of users) {
        if (typeof user.negocios !== 'string') continue;
        let assignedBusinesses;
        try { assignedBusinesses = JSON.parse(user.negocios); } catch { continue; }
        if (Array.isArray(assignedBusinesses) && assignedBusinesses.includes(id)) {
          updateUserAccess.run(JSON.stringify(assignedBusinesses.filter(businessId => businessId !== id)), user.id);
        }
      }

      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('No fue posible eliminar el negocio:', error);
    res.status(500).json({ error: 'No fue posible eliminar el negocio y sus datos asociados' });
  }
});

router.get('/network/addresses', (req, res) => {
  if (!['administrador', 'gerente'].includes(String(req.authUser.role || '').toLowerCase())) {
    return res.status(403).json({ error: 'Solo el administrador maestro o un gerente pueden consultar los enlaces de acceso.' });
  }
  const port = Number(process.env.PORT) || 3000;
  const addresses = [...new Set(Object.values(os.networkInterfaces()).flatMap(interfaces =>
    (interfaces || [])
      .filter(network => (network.family === 'IPv4' || network.family === 4) && !network.internal)
      .map(network => network.address)
  ))].sort();
  res.json(addresses.map(address => ({
    address,
    url: `http://${address}:${port}`,
  })));
});

router.get('/:table', tableOrFail, (req, res) => {
  if (req.params.table === 'usuarios') {
    const accounts = db.prepare('SELECT id, name, email, role, negocios, created_at FROM usuarios').all();
    if (isMasterUser(req.authUser)) return res.json(accounts.map(encode));
    const allowedBusinesses = new Set(accessibleBusinessIds(req.authUser));
    const visibleAccounts = accounts.filter(account => {
      if (account.id === req.authUser.id) return true;
      const accountBusinesses = accountBusinessIds(account);
      return accountBusinesses.some(id => allowedBusinesses.has(id));
    });
    return res.json(visibleAccounts.map(encode));
  }
  const filters = parseFilter(req.query);
  let sql = `SELECT * FROM ${req.params.table}`;
  const params = [];
  const clauses = filters.map(item => item.sql);
  params.push(...filters.map(item => item.value));
  const scope = businessScope(req.params.table, req.authUser);
  if (scope) {
    clauses.push(scope.sql);
    params.push(...scope.values);
  }
  if (['mesero', 'mesero_fijo'].includes(String(req.authUser.role).toLowerCase())) {
    if (req.params.table === 'comandas') {
      clauses.push('mesero_id = ?');
      params.push(req.authUser.id);
    } else if (['comanda_items', 'pagos'].includes(req.params.table)) {
      clauses.push('comanda_id IN (SELECT id FROM comandas WHERE mesero_id = ?)');
      params.push(req.authUser.id);
    }
  }
  if (['barra', 'barra_fija'].includes(String(req.authUser.role).toLowerCase())
    && req.params.table === 'turnos') {
    clauses.push('barra_id = ?');
    params.push(req.authUser.id);
  }
  if (clauses.length) {
    sql += ` WHERE ${clauses.join(' AND ')}`;
  }
  if (req.query.order) {
    const [column, direction] = req.query.order.split('.');
    if (ident(column)) sql += ` ORDER BY ${column} ${direction === 'desc' ? 'DESC' : 'ASC'}`;
  }
  const limit = Number(req.query.limit);
  if (Number.isInteger(limit) && limit > 0) { sql += ' LIMIT ?'; params.push(limit); }
  try {
    const results = db.prepare(sql).all(...params).map(encode);
    if (['mesero', 'mesero_fijo'].includes(String(req.authUser.role).toLowerCase()) && req.params.table === 'turnos') {
      return res.json(results.filter(turno => Array.isArray(turno.meseros_ids) && turno.meseros_ids.includes(req.authUser.id)));
    }
    res.json(results);
  } catch (error) { res.status(400).json({ error: error.message }); }
});

router.post('/:table', tableOrFail, (req, res) => {
  if (req.params.table === 'usuarios') {
    return res.status(405).json({ error: 'Usa la ruta segura de creación de usuarios.' });
  }
  const rows = Array.isArray(req.body) ? req.body : [req.body];
  if (!rows.length) return res.status(400).json({ error: 'Datos vacíos' });
  try {
    const allowedBusinesses = isMasterUser(req.authUser) ? null : accessibleBusinessIds(req.authUser);
    if (allowedBusinesses
      && rows.some(row => !rowIsInBusinessScope(req.params.table, row, req.authUser, allowedBusinesses))) {
      return res.status(403).json({ error: 'No tienes acceso al negocio o turno asociado a estos datos.' });
    }
    if (req.params.table === 'turnos') {
      for (const row of rows) {
        const barraId = String(row.barra_id || '');
        const businessId = String(row.negocio_id || '');
        if (!barraId || !businessId) {
          return res.status(400).json({ error: 'Debes asignar un usuario de Barra al turno.' });
        }
        const barraAccount = db.prepare('SELECT id, role, negocios FROM usuarios WHERE id = ?').get(barraId);
        if (!barraAccount || String(barraAccount.role).toLowerCase() !== 'barra') {
          return res.status(400).json({ error: 'La cuenta seleccionada no tiene el rol Barra.' });
        }
        const assignedBusinesses = encode({ negocios: barraAccount.negocios }).negocios;
        const hasBusinessAccess = assignedBusinesses === 'all'
          || (Array.isArray(assignedBusinesses) && assignedBusinesses.some(id => String(id) === businessId));
        if (!hasBusinessAccess) {
          return res.status(403).json({ error: 'La cuenta de Barra seleccionada no está asignada a este negocio.' });
        }
        if (row.estado === 'abierto'
          && db.prepare("SELECT id FROM turnos WHERE negocio_id = ? AND estado = 'abierto' LIMIT 1").get(businessId)) {
          return res.status(409).json({ error: 'Ya existe un turno abierto para este negocio.' });
        }
      }
    }
    if (['mesero', 'mesero_fijo'].includes(String(req.authUser.role).toLowerCase())
      && !rowsBelongToWaiter(req.params.table, rows, req.authUser.id)) {
      return res.status(403).json({ error: 'Solo puedes registrar operaciones de tus propias comandas.' });
    }
    if (req.params.table === 'usuarios') {
      const master = db.prepare('SELECT id FROM usuarios WHERE lower(email) = ?').get(OWNER_EMAIL);
      const attemptsToCreateMaster = rows.some(row =>
        String(row.email || '').trim().toLowerCase() === OWNER_EMAIL
        || ['admin', 'administrador'].includes(String(row.role || '').toLowerCase())
      );
      if (attemptsToCreateMaster && (!master || rows.some(row =>
        String(row.email || '').trim().toLowerCase() === OWNER_EMAIL && row.id !== master.id
        || ['admin', 'administrador'].includes(String(row.role || '').toLowerCase())
          && (String(row.email || '').trim().toLowerCase() !== OWNER_EMAIL || row.id !== master.id)
      ))) {
        return res.status(403).json({ error: 'La cuenta administradora maestra no se puede crear ni reemplazar desde Gestión de Usuarios.' });
      }
    }
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
  if (req.params.table === 'usuarios') {
    return res.status(405).json({ error: 'Usa la ruta segura de actualización de usuarios.' });
  }
  const filters = parseFilter(req.query);
  const columns = Object.keys(req.body).filter(ident);
  if (!columns.length || !filters.length) return res.status(400).json({ error: 'Actualización inválida' });
  if (!isMasterUser(req.authUser)
    && columns.some(column => ['negocio_id', 'turno_id', 'comanda_id', 'cierre_semanal_id', 'planilla_id'].includes(column))) {
    return res.status(403).json({ error: 'No se puede cambiar el negocio o turno asociado a un registro.' });
  }
  if (req.params.table === 'usuarios') {
    if (String(req.body.role || '').toLowerCase() === 'administrador') {
      return res.status(403).json({ error: 'Solo puede existir el administrador maestro reservado.' });
    }
    const target = db.prepare(`SELECT id FROM usuarios WHERE ${filters.map(item => item.sql).join(' AND ')}`).get(...filters.map(item => item.value));
    const master = db.prepare('SELECT id FROM usuarios WHERE lower(email) = ?').get(OWNER_EMAIL);
    if (target && master && target.id === master.id && (req.body.email || req.body.role)) {
      return res.status(403).json({ error: 'El correo y el rol del administrador maestro están protegidos.' });
    }
  }
  try {
    const scope = businessScope(req.params.table, req.authUser);
    const scopedFilters = scope ? [...filters, scope] : filters;
    const targetRows = matchingRows(req.params.table, scopedFilters);
    if (scope && !targetRows.length) {
      return res.status(403).json({ error: 'No tienes acceso a los registros de este negocio o turno.' });
    }
    if (['barra', 'barra_fija'].includes(String(req.authUser.role).toLowerCase())
      && req.params.table === 'turnos') {
      const targetTurns = targetRows;
      if (!targetTurns.length || targetTurns.some(turno => String(turno.barra_id || '') !== String(req.authUser.id))) {
        return res.status(403).json({ error: 'Solo el usuario de Barra asignado al turno puede modificarlo.' });
      }
    }
    if (['mesero', 'mesero_fijo'].includes(String(req.authUser.role).toLowerCase())
      && !rowsBelongToWaiter(req.params.table, targetRows, req.authUser.id)) {
      return res.status(403).json({ error: 'Solo puedes modificar tus propias comandas.' });
    }
    const values = decode(req.body);
    if (!isMasterUser(req.authUser)
      && targetRows.some(row => !rowIsInBusinessScope(
        req.params.table,
        { ...row, ...values },
        req.authUser,
      ))) {
      return res.status(403).json({ error: 'La actualización no puede mover datos fuera del negocio autorizado.' });
    }
    const whereClauses = scopedFilters.map(item => item.sql);
    const sql = `UPDATE ${req.params.table} SET ${columns.map(column => `${column} = ?`).join(', ')} WHERE ${whereClauses.join(' AND ')}`;
    db.prepare(sql).run(
      ...columns.map(column => values[column] ?? null),
      ...scopedFilters.flatMap(item => item.values || [item.value]),
    );
    res.json({ ok: true });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

router.delete('/:table', tableOrFail, (req, res) => {
  const filters = parseFilter(req.query);
  if (!filters.length) return res.status(400).json({ error: 'Eliminación inválida' });
  const scope = businessScope(req.params.table, req.authUser);
  const scopedFilters = scope ? [...filters, scope] : filters;
  if (['mesero', 'mesero_fijo'].includes(String(req.authUser.role).toLowerCase())) {
    try {
      if (!rowsBelongToWaiter(req.params.table, matchingRows(req.params.table, scopedFilters), req.authUser.id)) {
        return res.status(403).json({ error: 'Solo puedes eliminar productos de tus propias comandas.' });
      }
    } catch (error) {
      console.error(`No fue posible verificar la propiedad de ${req.params.table}:`, error);
      return res.status(400).json({ error: 'No fue posible verificar la operación solicitada.' });
    }
  }
  if (req.params.table === 'usuarios') {
    const target = db.prepare(`SELECT id FROM usuarios WHERE ${filters.map(item => item.sql).join(' AND ')}`).get(...filters.map(item => item.value));
    const master = db.prepare('SELECT id FROM usuarios WHERE lower(email) = ?').get(OWNER_EMAIL);
    if (target && master && target.id === master.id) {
      return res.status(403).json({ error: 'El administrador maestro no se puede eliminar.' });
    }
  }
  try {
    const targetRows = matchingRows(req.params.table, scopedFilters);
    if (scope && !targetRows.length) {
      return res.status(403).json({ error: 'No tienes acceso a los registros de este negocio o turno.' });
    }
    db.prepare(`DELETE FROM ${req.params.table} WHERE ${scopedFilters.map(item => item.sql).join(' AND ')}`)
      .run(...scopedFilters.flatMap(item => item.values || [item.value]));
    res.json({ ok: true });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

module.exports = router;
