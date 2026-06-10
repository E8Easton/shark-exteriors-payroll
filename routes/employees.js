const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const router = express.Router();

// Owner-only middleware
function ownerOnly(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  if (req.session.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });
  next();
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  next();
}

// GET /api/employees — owner sees all, crew sees just their own info
router.get('/', requireAuth, (req, res) => {
  if (req.session.role === 'owner') {
    const rows = db.prepare('SELECT id, name, username, role, active FROM employees ORDER BY name').all();
    return res.json(rows);
  }
  const emp = db.prepare('SELECT id, name, username, role FROM employees WHERE id = ?').get(req.session.userId);
  res.json([emp]);
});

// POST /api/employees — owner adds new crew member
router.post('/', ownerOnly, (req, res) => {
  const { name, username, password, role } = req.body;
  if (!name || !username) return res.status(400).json({ error: 'Name and username required' });

  const pw = password || username; // default password = username if not provided
  const hash = bcrypt.hashSync(pw, 10);
  try {
    const result = db.prepare(
      'INSERT INTO employees (name, username, password_hash, role) VALUES (?, ?, ?, ?)'
    ).run(name, username.toLowerCase(), hash, role || 'crew');
    res.json({ id: result.lastInsertRowid, name, username, role: role || 'crew' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username already taken' });
    throw e;
  }
});

// DELETE /api/employees/:id — owner deactivates an employee (soft delete)
router.delete('/:id', ownerOnly, (req, res) => {
  db.prepare('UPDATE employees SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// PUT /api/employees/:id — owner resets a crew member's password
router.put('/:id/reset-password', ownerOnly, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE employees SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
