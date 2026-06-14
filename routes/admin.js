const express = require('express');
const db = require('../db');
const router = express.Router();

function ownerOnly(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  if (req.session.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });
  next();
}

// POST /api/admin/reset-payroll — wipe all jobs, summaries, payouts (keeps employees)
router.post('/reset-payroll', ownerOnly, async (req, res) => {
  const { confirm } = req.body;
  if (confirm !== 'RESET') {
    return res.status(400).json({ error: 'Type RESET to confirm' });
  }

  await db.exec('DELETE FROM job_crew');
  await db.exec('DELETE FROM jobs');
  await db.exec('DELETE FROM daily_summaries');
  await db.exec('DELETE FROM weekly_payouts');
  await db.exec('DELETE FROM tips');

  res.json({ ok: true, message: 'All payroll data cleared. Employees kept.' });
});

module.exports = router;
