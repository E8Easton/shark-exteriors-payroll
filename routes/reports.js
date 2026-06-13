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

    const empTotals = db.prepare(`
      SELECT e.id, e.name, e.role,
             SUM(jc.crew_pay) as crew_pay,
             SUM(jc.commission_pay) as commission_pay,
             SUM(jc.crew_pay + jc.commission_pay) as total_pay,
             SUM(CASE WHEN jc.paid = 1 THEN jc.crew_pay + jc.commission_pay ELSE 0 END) as paid_amount,
             SUM(CASE WHEN jc.paid = 0 THEN jc.crew_pay + jc.commission_pay ELSE 0 END) as unpaid_amount,
             COUNT(jc.id) as job_count
      FROM job_crew jc
      JOIN jobs j ON j.id = jc.job_id
      JOIN employees e ON e.id = jc.employee_id
      WHERE j.date BETWEEN ? AND ? AND e.role != 'owner'
      GROUP BY e.id
      ORDER BY total_pay DESC
    `).all(start, end);

    return res.json({ summaries, employeeTotals: empTotals });
  }

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

  const weekTotal = db.prepare(`
    SELECT SUM(jc.crew_pay) as crew_pay,
           SUM(jc.commission_pay) as commission_pay,
           SUM(jc.crew_pay + jc.commission_pay) as total_pay,
           COUNT(jc.id) as job_count
    FROM job_crew jc
    JOIN jobs j ON j.id = jc.job_id
    WHERE jc.employee_id = ? AND j.date BETWEEN ? AND ?
  `).get(req.session.userId, start, end);

  res.json({ rows, weekTotal });
});

// GET /api/reports/monthly?year=YYYY&month=MM
router.get('/monthly', requireAuth, (req, res) => {
  const { year, month } = req.query;
  if (!year || !month) return res.status(400).json({ error: 'year and month required' });
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = `${year}-${String(month).padStart(2, '0')}-31`;

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

// GET /api/reports/leaderboard?type=total|sales&start=&end=
router.get('/leaderboard', requireAuth, (req, res) => {
  const { type = 'total', start, end } = req.query;
  const orderCol = type === 'sales' ? 'commission_pay' : 'total_pay';
  let dateClause = '';
  const params = [];
  if (start && end) {
    dateClause = 'AND j.date BETWEEN ? AND ?';
    params.push(start, end);
  }

  const rows = db.prepare(`
    SELECT e.id, e.name,
           SUM(jc.crew_pay) as crew_pay,
           SUM(jc.commission_pay) as commission_pay,
           SUM(jc.crew_pay + jc.commission_pay) as total_pay,
           COUNT(jc.id) as job_count,
           SUM(CASE WHEN jc.commission_pay > 0 THEN 1 ELSE 0 END) as sales_count
    FROM job_crew jc
    JOIN jobs j ON j.id = jc.job_id
    JOIN employees e ON e.id = jc.employee_id
    WHERE e.role != 'owner' ${dateClause}
    GROUP BY e.id
    HAVING ${orderCol} > 0
    ORDER BY ${orderCol} DESC
  `).all(...params);
  res.json(rows);
});

// GET /api/reports/payroll?start=&end= — owner weekly payout checklist
router.get('/payroll', ownerOnly, (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end dates required' });

  const employees = db.prepare(`
    SELECT e.id, e.name, e.role,
           COALESCE(SUM(jc.crew_pay), 0) as crew_pay,
           COALESCE(SUM(jc.commission_pay), 0) as commission_pay,
           COALESCE(SUM(jc.crew_pay + jc.commission_pay), 0) as total_pay,
           COALESCE(SUM(CASE WHEN jc.paid = 0 THEN jc.crew_pay + jc.commission_pay ELSE 0 END), 0) as unpaid_amount,
           COUNT(jc.id) as job_count
    FROM employees e
    LEFT JOIN job_crew jc ON jc.employee_id = e.id
    LEFT JOIN jobs j ON j.id = jc.job_id AND j.date BETWEEN ? AND ?
    WHERE e.active = 1 AND e.role != 'owner'
    GROUP BY e.id
    HAVING total_pay > 0
    ORDER BY e.name
  `).all(start, end);

  const payoutFlags = db.prepare(`
    SELECT employee_id, paid, paid_at FROM weekly_payouts
    WHERE week_start = ? AND week_end = ?
  `).all(start, end);
  const flagMap = Object.fromEntries(payoutFlags.map(p => [p.employee_id, p]));

  const rows = employees.map(e => ({
    ...e,
    weekPaid: flagMap[e.id]?.paid === 1,
    paidAt: flagMap[e.id]?.paid_at || null,
  }));

  const weekRevenue = db.prepare(`
    SELECT COALESCE(SUM(total_revenue), 0) as revenue,
           COALESCE(SUM(owner_gross), 0) as owner_gross,
           COALESCE(SUM(owner_take_home), 0) as take_home
    FROM daily_summaries WHERE date BETWEEN ? AND ?
  `).get(start, end);

  res.json({ rows, weekRevenue });
});

// PATCH /api/reports/payroll — mark employee paid/unpaid for a week
router.patch('/payroll', ownerOnly, (req, res) => {
  const { start, end, employeeId, paid } = req.body;
  if (!start || !end || !employeeId) {
    return res.status(400).json({ error: 'start, end, employeeId required' });
  }

  const isPaid = paid ? 1 : 0;
  const paidAt = isPaid ? new Date().toISOString() : null;

  db.prepare(`
    INSERT INTO weekly_payouts (week_start, week_end, employee_id, paid, paid_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(week_start, week_end, employee_id) DO UPDATE SET
      paid = excluded.paid, paid_at = excluded.paid_at
  `).run(start, end, employeeId, isPaid, paidAt);

  if (isPaid) {
    db.prepare(`
      UPDATE job_crew SET paid = 1
      WHERE employee_id = ? AND job_id IN (
        SELECT id FROM jobs WHERE date BETWEEN ? AND ?
      )
    `).run(employeeId, start, end);
  }

  res.json({ ok: true });
});

// POST /api/reports/payroll/mark-all — mark everyone paid for the week
router.post('/payroll/mark-all', ownerOnly, (req, res) => {
  const { start, end } = req.body;
  if (!start || !end) return res.status(400).json({ error: 'start and end required' });

  const emps = db.prepare(`
    SELECT DISTINCT jc.employee_id as id
    FROM job_crew jc
    JOIN jobs j ON j.id = jc.job_id
    JOIN employees e ON e.id = jc.employee_id
    WHERE j.date BETWEEN ? AND ? AND e.role != 'owner'
  `).all(start, end);

  const upsert = db.prepare(`
    INSERT INTO weekly_payouts (week_start, week_end, employee_id, paid, paid_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(week_start, week_end, employee_id) DO UPDATE SET paid = 1, paid_at = excluded.paid_at
  `);
  const now = new Date().toISOString();
  for (const e of emps) upsert.run(start, end, e.id, now);

  db.prepare(`
    UPDATE job_crew SET paid = 1
    WHERE job_id IN (SELECT id FROM jobs WHERE date BETWEEN ? AND ?)
  `).run(start, end);

  res.json({ ok: true, count: emps.length });
});

// GET /api/reports/my-earnings — crew member's all-time breakdown
router.get('/my-earnings', requireAuth, (req, res) => {
  if (req.session.role === 'owner') {
    return res.status(403).json({ error: 'Owner should use the admin dashboard' });
  }

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

  const now = new Date();
  const day = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((day + 6) % 7));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const weekStart = mon.toISOString().slice(0, 10);
  const weekEnd = sun.toISOString().slice(0, 10);

  const thisWeek = db.prepare(`
    SELECT SUM(jc.crew_pay) as crew_pay,
           SUM(jc.commission_pay) as commission_pay,
           SUM(jc.crew_pay + jc.commission_pay) as total_pay,
           COUNT(jc.id) as job_count
    FROM job_crew jc
    JOIN jobs j ON j.id = jc.job_id
    WHERE jc.employee_id = ? AND j.date BETWEEN ? AND ?
  `).get(req.session.userId, weekStart, weekEnd);

  const today = now.toISOString().slice(0, 10);
  const todayEarnings = db.prepare(`
    SELECT SUM(jc.crew_pay + jc.commission_pay) as total_pay,
           COUNT(jc.id) as job_count
    FROM job_crew jc
    JOIN jobs j ON j.id = jc.job_id
    WHERE jc.employee_id = ? AND j.date = ?
  `).get(req.session.userId, today);

  res.json({ allTime, recent, thisWeek, todayEarnings, weekStart, weekEnd });
});

module.exports = router;
