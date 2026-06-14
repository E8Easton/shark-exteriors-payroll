const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  next();
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const emp = await db.prepare(
    'SELECT * FROM employees WHERE username = ? AND active = 1'
  ).get(username.toLowerCase().trim());

  if (!emp || !bcrypt.compareSync(password, emp.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.session.userId = emp.id;
  req.session.role = emp.role;
  req.session.name = emp.name;

  res.json({ role: emp.role, name: emp.name });
});

router.post('/logout', (req, res) => {
  if (typeof req.session.destroy === 'function') {
    req.session.destroy(() => res.json({ ok: true }));
  } else {
    req.session = null;
    res.json({ ok: true });
  }
});

router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  res.json({ id: req.session.userId, role: req.session.role, name: req.session.name });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(currentPassword, emp.password_hash)) {
    return res.status(400).json({ error: 'Current password incorrect' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  await db.prepare('UPDATE employees SET password_hash = ? WHERE id = ?').run(hash, emp.id);
  res.json({ ok: true });
});

module.exports = router;
