const express = require('express');
const db = require('../db');
const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  next();
}

function ownerOnly(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  if (req.session.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });
  next();
}

// GET /api/reports/daily?date=YYYY-MM-DD  (owner sees all; crew sees self)
router.get('/daily', requireAuth, (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });

  if (req.session.role === 'owner') {
    const summary = db.prepare('SELECT * FROM daily_summaries WHERE date = ?').get(date);
    const jobs = db.prepare('SELECT * FROM jobs WHERE date = ? ORDER BY id').all(date);
    const enriched = jobs.map(job => ({
      ...job,
      crew: db.prepare(`
        SELECT jc.*, e.name FROM job_crew jc
        JOIN employees e ON e.id = jc.employee_id WHERE jc.job_id = ?
      `).all(job.id)
    }));
    return res.json({ summary, jobs: enriched });
  }

  // Crew member: only their own entries for this date
  const rows = db.prepare(`
    SELECT jc.id, jc.crew_pay, jc.commission_pct, jc.commission_pay, jc.paid,
           j.job_name, j.date, j.total_amount
    FROM job_crew jc
    JOIN jobs j ON j.id = jc.job_id
    WHERE jc.employee_id = ? AND j.date = ?
    ORDER BY j.id
  `).all(req.session.userId, date);
  res.json({ rows });
});

// GET /api/reports/weekly?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/weekly', requireAuth, (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end dates required' });

  if (req.session.role === 'owner') {
    const summaries = db.prepare(
      'SELECT * FROM daily_summaries WHERE date BETWEEN ? AND ? ORDER BY date'
    ).all(start, end);

    // Per-employee totals for the week
    const empTotals = db.prepare(`
      SELECT e.id, e.name,
             SUM(jc.crew_pay) as crew_pay,
             SUM(jc.commission_pay) as commission_pay,
             SUM(jc.crew_pay + jc.commission_pay) as total_pay
      FROM job_crew jc
      JOIN jobs j ON j.id = jc.job_id
      JOIN employees e ON e.id = jc.employee_id
      WHERE j.date BETWEEN ? AND ?
      GROUP BY e.id
      ORDER BY total_pay DESC
    `).all(start, end);

    return res.json({ summaries, employeeTotals: empTotals });
  }

  // Crew member: their week
  const rows = db.prepare(`
    SELECT j.date,
           SUM(jc.crew_pay) as crew_pay,
           SUM(jc.commission_pay) as commission_pay,
           SUM(jc.crew_pay + jc.commission_pay) as total_pay,
           COUNT(jc.id) as job_count
    FROM job_crew jc
    JOIN jobs j ON j.id = jc.job_id
    WHERE jc.employee_id = ? AND j.date BETWEEN ? AND ?
    GROUP BY j.date
    ORDER BY j.date
  `).all(req.session.userId, start, end);
  res.json({ rows });
});

// GET /api/reports/monthly?year=YYYY&month=MM
router.get('/monthly', requireAuth, (req, res) => {
  const { year, month } = req.query;
  if (!year || !month) return res.status(400).json({ error: 'year and month required' });
  const start = `${year}-${month.padStart(2, '0')}-01`;
  const end = `${year}-${month.padStart(2, '0')}-31`;

  if (req.session.role === 'owner') {
    const totals = db.prepare(`
      SELECT SUM(total_revenue) as revenue, SUM(owner_gross) as owner_gross,
             SUM(owner_take_home) as take_home, COUNT(*) as days
      FROM daily_summaries WHERE date BETWEEN ? AND ?
    `).get(start, end);
    return res.json(totals);
  }

  const rows = db.prepare(`
    SELECT SUM(jc.crew_pay) as crew_pay,
           SUM(jc.commission_pay) as commission_pay,
           SUM(jc.crew_pay + jc.commission_pay) as total_pay,
           COUNT(jc.id) as job_count
    FROM job_crew jc
    JOIN jobs j ON j.id = jc.job_id
    WHERE jc.employee_id = ? AND j.date BETWEEN ? AND ?
  `).get(req.session.userId, start, end);
  res.json(rows);
});

// GET /api/reports/leaderboard — all-time earnings per employee
router.get('/leaderboard', ownerOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT e.id, e.name,
           SUM(jc.crew_pay) as crew_pay,
           SUM(jc.commission_pay) as commission_pay,
           SUM(jc.crew_pay + jc.commission_pay) as total_pay,
           COUNT(jc.id) as job_count
    FROM job_crew jc
    JOIN employees e ON e.id = jc.employee_id
    GROUP BY e.id
    ORDER BY total_pay DESC
  `).all();
  res.json(rows);
});

// GET /api/reports/my-earnings — crew member's all-time breakdown
router.get('/my-earnings', requireAuth, (req, res) => {
  if (req.session.role === 'owner') return res.redirect('/api/reports/leaderboard');

  const allTime = db.prepare(`
    SELECT SUM(jc.crew_pay) as crew_pay,
           SUM(jc.commission_pay) as commission_pay,
           SUM(jc.crew_pay + jc.commission_pay) as total_pay,
           COUNT(jc.id) as job_count,
           SUM(CASE WHEN jc.paid = 1 THEN 1 ELSE 0 END) as paid_count,
           SUM(CASE WHEN jc.paid = 0 THEN jc.crew_pay + jc.commission_pay ELSE 0 END) as outstanding
    FROM job_crew jc
    JOIN jobs j ON j.id = jc.job_id
    WHERE jc.employee_id = ?
  `).get(req.session.userId);

  const recent = db.prepare(`
    SELECT j.date, j.job_name, jc.crew_pay, jc.commission_pay,
           jc.crew_pay + jc.commission_pay as total_pay, jc.paid
    FROM job_crew jc
    JOIN jobs j ON j.id = jc.job_id
    WHERE jc.employee_id = ?
    ORDER BY j.date DESC, j.id DESC
    LIMIT 30
  `).all(req.session.userId);

  res.json({ allTime, recent });
});

module.exports = router;
