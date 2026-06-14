const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { credentialsFromName } = require('../lib/credentials');
const router = express.Router();

function ownerOnly(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  if (req.session.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });
  next();
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  next();
}

router.get('/', requireAuth, async (req, res) => {
  if (req.session.role === 'owner') {
    const rows = await db.prepare(
      'SELECT id, name, username, role, active, notes FROM employees ORDER BY name'
    ).all();
    return res.json(rows);
  }
  const emp = await db.prepare(
    'SELECT id, name, username, role FROM employees WHERE id = ?'
  ).get(req.session.userId);
  res.json([emp]);
});

const VALID_ROLES = ['owner', 'crew', 'cleaning_tech', 'd2d'];

router.post('/', ownerOnly, async (req, res) => {
  const { name, username, password, role } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });

  const empRole = role || 'crew';
  if (!VALID_ROLES.includes(empRole)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const defaults = credentialsFromName(name);
  const user = (username || defaults.username).toLowerCase().trim();
  const pw = (password || defaults.password).trim();

  const hash = bcrypt.hashSync(pw, 10);
  try {
    const result = await db.prepare(
      'INSERT INTO employees (name, username, password_hash, role) VALUES (?, ?, ?, ?)'
    ).run(name.trim(), user, hash, empRole);
    res.json({ id: result.lastInsertRowid, name: name.trim(), username: user, role: empRole });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username already taken' });
    throw e;
  }
});

router.delete('/:id', ownerOnly, async (req, res) => {
  await db.prepare('UPDATE employees SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.put('/:id/reset-password', ownerOnly, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  const hash = bcrypt.hashSync(password, 10);
  await db.prepare('UPDATE employees SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  res.json({ ok: true });
});

router.patch('/:id', ownerOnly, async (req, res) => {
  const { notes } = req.body;
  const emp = await db.prepare('SELECT id FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  await db.prepare('UPDATE employees SET notes = ? WHERE id = ?').run(notes ?? '', req.params.id);
  res.json({ ok: true });
});

module.exports = router;
