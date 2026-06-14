const express = require('express');
const db = require('../db');
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

// GET /api/tips?start=&end=  (owner: all; crew: own)
router.get('/', requireAuth, async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end required' });

  if (req.session.role === 'owner') {
    const rows = await db.prepare(`
      SELECT t.*, e.name FROM tips t
      JOIN employees e ON e.id = t.employee_id
      WHERE t.date BETWEEN ? AND ?
      ORDER BY t.date DESC, t.id DESC
    `).all(start, end);
    return res.json(rows);
  }

  const rows = await db.prepare(`
    SELECT * FROM tips
    WHERE employee_id = ? AND date BETWEEN ? AND ?
    ORDER BY date DESC, id DESC
  `).all(req.session.userId, start, end);
  res.json(rows);
});

// POST /api/tips — owner adds a tip
router.post('/', ownerOnly, async (req, res) => {
  const { employeeId, date, amount, note } = req.body;
  if (!employeeId || !date || amount == null) {
    return res.status(400).json({ error: 'employeeId, date, amount required' });
  }
  const amt = Number(amount);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const emp = await db.prepare('SELECT id, name FROM employees WHERE id = ? AND active = 1').get(employeeId);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });

  const result = await db.prepare(
    'INSERT INTO tips (employee_id, date, amount, note) VALUES (?, ?, ?, ?)'
  ).run(employeeId, date, amt, note?.trim() || null);

  res.json({
    id: result.lastInsertRowid,
    employee_id: employeeId,
    name: emp.name,
    date,
    amount: amt,
    note: note?.trim() || null,
    paid: 0,
  });
});

router.delete('/:id', ownerOnly, async (req, res) => {
  await db.prepare('DELETE FROM tips WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.patch('/:id/paid', ownerOnly, async (req, res) => {
  await db.prepare('UPDATE tips SET paid = ? WHERE id = ?').run(req.body.paid ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
