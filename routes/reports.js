const express = require('express');
const db = require('../db');
const {
  SEASON_END,
  SELF_EMPLOYMENT_TAX_RATE,
  getSeasonWeeks,
  getDisplaySeasonWeeks,
  daysUntilSeasonEnd,
  getCurrentWeekNumber,
} = require('../lib/season');
const { getPayrollForWeek, getEmployeeWeekPay } = require('../lib/payrollWeek');
const { buildWeekMessages } = require('../lib/weekMessages');
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
router.get('/daily', requireAuth, async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });

  if (req.session.role === 'owner') {
    const summary = await db.prepare('SELECT * FROM daily_summaries WHERE date = ?').get(date);
    const jobs = await db.prepare('SELECT * FROM jobs WHERE date = ? ORDER BY id').all(date);
    const enriched = [];
    for (const job of jobs) {
      enriched.push({
        ...job,
        crew: await db.prepare(`
          SELECT jc.*, e.name FROM job_crew jc
          JOIN employees e ON e.id = jc.employee_id WHERE jc.job_id = ?
        `).all(job.id),
      });
    }
    return res.json({ summary, jobs: enriched });
  }

  const rows = await db.prepare(`
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
router.get('/weekly', requireAuth, async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end dates required' });

  if (req.session.role === 'owner') {
    const summaries = await db.prepare(
      'SELECT * FROM daily_summaries WHERE date BETWEEN ? AND ? ORDER BY date'
    ).all(start, end);

    const empTotals = await db.prepare(`
      SELECT e.id, e.name, e.role,
             COALESCE(jc_agg.crew_pay, 0) as crew_pay,
             COALESCE(jc_agg.commission_pay, 0) as commission_pay,
             COALESCE(tip_agg.tips_pay, 0) as tips_pay,
             COALESCE(jc_agg.crew_pay, 0) + COALESCE(jc_agg.commission_pay, 0) + COALESCE(tip_agg.tips_pay, 0) as total_pay,
             COALESCE(jc_agg.paid_amount, 0) + COALESCE(tip_agg.paid_tips, 0) as paid_amount,
             COALESCE(jc_agg.unpaid_amount, 0) + COALESCE(tip_agg.unpaid_tips, 0) as unpaid_amount,
             COALESCE(jc_agg.job_count, 0) as job_count
      FROM employees e
      LEFT JOIN (
        SELECT jc.employee_id,
               SUM(jc.crew_pay) as crew_pay,
               SUM(jc.commission_pay) as commission_pay,
               SUM(CASE WHEN jc.paid = 1 THEN jc.crew_pay + jc.commission_pay ELSE 0 END) as paid_amount,
               SUM(CASE WHEN jc.paid = 0 THEN jc.crew_pay + jc.commission_pay ELSE 0 END) as unpaid_amount,
               COUNT(jc.id) as job_count
        FROM job_crew jc
        JOIN jobs j ON j.id = jc.job_id
        WHERE j.date BETWEEN ? AND ?
        GROUP BY jc.employee_id
      ) jc_agg ON jc_agg.employee_id = e.id
      LEFT JOIN (
        SELECT employee_id,
               SUM(amount) as tips_pay,
               SUM(CASE WHEN paid = 1 THEN amount ELSE 0 END) as paid_tips,
               SUM(CASE WHEN paid = 0 THEN amount ELSE 0 END) as unpaid_tips
        FROM tips WHERE date BETWEEN ? AND ?
        GROUP BY employee_id
      ) tip_agg ON tip_agg.employee_id = e.id
      WHERE e.active = 1 AND e.role != 'owner'
        AND (jc_agg.employee_id IS NOT NULL OR tip_agg.employee_id IS NOT NULL)
      ORDER BY total_pay DESC
    `).all(start, end, start, end);

    return res.json({ summaries, employeeTotals: empTotals });
  }

  const rows = await db.prepare(`
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

  const weekTotal = await db.prepare(`
    SELECT SUM(jc.crew_pay) as crew_pay,
           SUM(jc.commission_pay) as commission_pay,
           SUM(jc.crew_pay + jc.commission_pay) as total_pay,
           COUNT(jc.id) as job_count
    FROM job_crew jc
    JOIN jobs j ON j.id = jc.job_id
    WHERE jc.employee_id = ? AND j.date BETWEEN ? AND ?
  `).get(req.session.userId, start, end);

  const tipsTotal = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as tips_pay,
           COALESCE(SUM(CASE WHEN paid = 0 THEN amount ELSE 0 END), 0) as unpaid_tips
    FROM tips WHERE employee_id = ? AND date BETWEEN ? AND ?
  `).get(req.session.userId, start, end);

  res.json({ rows, weekTotal, tipsTotal });
});

// GET /api/reports/monthly?year=YYYY&month=MM
router.get('/monthly', requireAuth, async (req, res) => {
  const { year, month } = req.query;
  if (!year || !month) return res.status(400).json({ error: 'year and month required' });
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = `${year}-${String(month).padStart(2, '0')}-31`;

  if (req.session.role === 'owner') {
    const totals = await db.prepare(`
      SELECT SUM(total_revenue) as revenue, SUM(owner_gross) as owner_gross,
             SUM(owner_take_home) as take_home, COUNT(*) as days
      FROM daily_summaries WHERE date BETWEEN ? AND ?
    `).get(start, end);
    return res.json(totals);
  }

  const rows = await db.prepare(`
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
router.get('/leaderboard', requireAuth, async (req, res) => {
  const { type = 'total', start, end } = req.query;
  const orderCol = type === 'sales' ? 'commission_pay' : 'total_pay';
  let dateClause = '';
  const params = [];
  if (start && end) {
    dateClause = 'AND j.date BETWEEN ? AND ?';
    params.push(start, end);
  }

  const rows = await db.prepare(`
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

// GET /api/reports/roster-payroll — season totals per employee for roster cards
router.get('/roster-payroll', ownerOnly, async (req, res) => {
  const weeks = getDisplaySeasonWeeks();

  const emps = await db.prepare(`
    SELECT id, name, username, role, active, notes FROM employees ORDER BY name
  `).all();

  const rows = [];
  for (const emp of emps) {
    if (emp.role === 'owner') {
      rows.push({ ...emp, crew_pay: 0, commission_pay: 0, tips_pay: 0, total_pay: 0, job_count: 0, unpaid_amount: 0 });
      continue;
    }
    let crewPay = 0;
    let commissionPay = 0;
    let tipsPay = 0;
    let jobCount = 0;
    let unpaid = 0;
    for (const w of weeks) {
      const wp = await getEmployeeWeekPay(db, emp.id, w.start, w.end);
      crewPay += wp.crew_pay || 0;
      commissionPay += wp.commission_pay || 0;
      tipsPay += wp.tips_pay || 0;
      jobCount += wp.job_count || 0;
      unpaid += wp.unpaid_amount || 0;
    }
    rows.push({
      ...emp,
      crew_pay: crewPay,
      commission_pay: commissionPay,
      tips_pay: tipsPay,
      total_pay: crewPay + commissionPay + tipsPay,
      job_count: jobCount,
      unpaid_amount: unpaid,
    });
  }
  res.json(rows);
});

// GET /api/reports/payroll?start=&end= — owner weekly payout checklist
router.get('/payroll', ownerOnly, async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end dates required' });
  res.json(await getPayrollForWeek(db, start, end));
});

// GET /api/reports/payroll/season — all season weeks with payout data
router.get('/payroll/season', ownerOnly, async (req, res) => {
  const weeks = getDisplaySeasonWeeks();
  const currentWeek = getCurrentWeekNumber();
  const payload = [];
  for (const w of weeks) {
    const data = await getPayrollForWeek(db, w.start, w.end);
    payload.push({
      ...w,
      rows: data.rows,
      weekRevenue: data.weekRevenue,
      totalTips: data.totalTips,
    });
  }
  res.json({
    weeks: payload.reverse(),
    seasonEnd: SEASON_END,
    daysUntilLeave: daysUntilSeasonEnd(),
    currentWeek,
    totalWeeks: weeks.length,
    maxDisplayWeek: weeks[weeks.length - 1]?.number ?? 11,
  });
});

// GET /api/reports/employee/:id/payroll — per-week earnings for one employee (owner)
router.get('/employee/:id/payroll', ownerOnly, async (req, res) => {
  const emp = await db.prepare(
    'SELECT id, name, username, role, active, notes FROM employees WHERE id = ?'
  ).get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });

  const weeks = [];
  for (const w of getDisplaySeasonWeeks()) {
    weeks.push({
      ...w,
      ...(await getEmployeeWeekPay(db, emp.id, w.start, w.end)),
    });
  }

  const totals = weeks.reduce((a, w) => ({
    crew_pay: a.crew_pay + w.crew_pay,
    commission_pay: a.commission_pay + w.commission_pay,
    tips_pay: a.tips_pay + w.tips_pay,
    total_pay: a.total_pay + w.total_pay,
    unpaid_amount: a.unpaid_amount + w.unpaid_amount,
    job_count: a.job_count + w.job_count,
  }), { crew_pay: 0, commission_pay: 0, tips_pay: 0, total_pay: 0, unpaid_amount: 0, job_count: 0 });

  res.json({
    employee: emp,
    weeks,
    totals,
    seasonEnd: SEASON_END,
    daysUntilLeave: daysUntilSeasonEnd(),
    currentWeek: getCurrentWeekNumber(),
  });
});

// PUT /api/reports/employee/:id/override — admin adjust weekly pay totals
router.put('/employee/:id/override', ownerOnly, async (req, res) => {
  const emp = await db.prepare('SELECT id, role FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  if (emp.role === 'owner') return res.status(400).json({ error: 'Cannot override owner pay' });

  const { weekStart, weekEnd, crewPay, commissionPay, tipsPay, note } = req.body;
  if (!weekStart || !weekEnd) {
    return res.status(400).json({ error: 'weekStart and weekEnd required' });
  }

  const crew = Number(crewPay);
  const comm = Number(commissionPay);
  const tips = Number(tipsPay);
  if ([crew, comm, tips].some(n => Number.isNaN(n) || n < 0)) {
    return res.status(400).json({ error: 'Pay amounts must be non-negative numbers' });
  }

  await db.prepare(`
    INSERT INTO week_pay_overrides (employee_id, week_start, week_end, crew_pay, commission_pay, tips_pay, note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(employee_id, week_start, week_end) DO UPDATE SET
      crew_pay = excluded.crew_pay,
      commission_pay = excluded.commission_pay,
      tips_pay = excluded.tips_pay,
      note = excluded.note,
      updated_at = datetime('now')
  `).run(emp.id, weekStart, weekEnd, crew, comm, tips, note ?? '');

  res.json({ ok: true, week: await getEmployeeWeekPay(db, emp.id, weekStart, weekEnd) });
});

// DELETE /api/reports/employee/:id/override?weekStart=&weekEnd=
router.delete('/employee/:id/override', ownerOnly, async (req, res) => {
  const { weekStart, weekEnd } = req.query;
  if (!weekStart || !weekEnd) {
    return res.status(400).json({ error: 'weekStart and weekEnd required' });
  }
  await db.prepare(`
    DELETE FROM week_pay_overrides
    WHERE employee_id = ? AND week_start = ? AND week_end = ?
  `).run(req.params.id, weekStart, weekEnd);
  res.json({ ok: true });
});

// GET /api/reports/week-messages?start=&end= OR ?week=10 — copy-paste chat messages
router.get('/week-messages', ownerOnly, async (req, res) => {
  const { start, end, week: weekParam } = req.query;
  const displayWeeks = getDisplaySeasonWeeks();
  let week;

  if (start && end) {
    week = displayWeeks.find(w => w.start === start && w.end === end);
  } else if (weekParam) {
    week = displayWeeks.find(w => w.number === Number(weekParam));
  } else {
    week = displayWeeks.find(w => w.isCurrent) || displayWeeks[displayWeeks.length - 1];
  }

  if (!week) return res.status(400).json({ error: 'Week not found or not in active season range' });

  const { rows } = await getPayrollForWeek(db, week.start, week.end);
  res.json(buildWeekMessages(week, rows));
});

// GET /api/reports/season — meta for season weeks (crew + owner)
router.get('/season', requireAuth, (req, res) => {
  const weeks = getDisplaySeasonWeeks();
  res.json({
    weeks,
    seasonEnd: SEASON_END,
    daysUntilLeave: daysUntilSeasonEnd(),
    currentWeek: getCurrentWeekNumber(),
    totalWeeks: weeks.length,
    selfEmploymentTaxRate: SELF_EMPLOYMENT_TAX_RATE,
  });
});

// PATCH /api/reports/payroll — mark employee paid/unpaid for a week
router.patch('/payroll', ownerOnly, async (req, res) => {
  const { start, end, employeeId, paid } = req.body;
  if (!start || !end || !employeeId) {
    return res.status(400).json({ error: 'start, end, employeeId required' });
  }

  const isPaid = paid ? 1 : 0;
  const paidAt = isPaid ? new Date().toISOString() : null;

  await db.prepare(`
    INSERT INTO weekly_payouts (week_start, week_end, employee_id, paid, paid_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(week_start, week_end, employee_id) DO UPDATE SET
      paid = excluded.paid, paid_at = excluded.paid_at
  `).run(start, end, employeeId, isPaid, paidAt);

  if (isPaid) {
    await db.prepare(`
      UPDATE job_crew SET paid = 1
      WHERE employee_id = ? AND job_id IN (
        SELECT id FROM jobs WHERE date BETWEEN ? AND ?
      )
    `).run(employeeId, start, end);
    await db.prepare(`
      UPDATE tips SET paid = 1
      WHERE employee_id = ? AND date BETWEEN ? AND ?
    `).run(employeeId, start, end);
  }

  res.json({ ok: true });
});

// POST /api/reports/payroll/mark-all — mark everyone paid for the week
router.post('/payroll/mark-all', ownerOnly, async (req, res) => {
  const { start, end } = req.body;
  if (!start || !end) return res.status(400).json({ error: 'start and end required' });

  const emps = await db.prepare(`
    SELECT DISTINCT e.id
    FROM employees e
    WHERE e.active = 1 AND e.role != 'owner' AND (
      e.id IN (
        SELECT jc.employee_id FROM job_crew jc
        JOIN jobs j ON j.id = jc.job_id
        WHERE j.date BETWEEN ? AND ?
      )
      OR e.id IN (
        SELECT employee_id FROM tips WHERE date BETWEEN ? AND ?
      )
    )
  `).all(start, end, start, end);

  const upsert = db.prepare(`
    INSERT INTO weekly_payouts (week_start, week_end, employee_id, paid, paid_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(week_start, week_end, employee_id) DO UPDATE SET paid = 1, paid_at = excluded.paid_at
  `);
  const now = new Date().toISOString();
  for (const e of emps) await upsert.run(start, end, e.id, now);

  await db.prepare(`
    UPDATE job_crew SET paid = 1
    WHERE job_id IN (SELECT id FROM jobs WHERE date BETWEEN ? AND ?)
  `).run(start, end);
  await db.prepare(`UPDATE tips SET paid = 1 WHERE date BETWEEN ? AND ?`).run(start, end);

  res.json({ ok: true, count: emps.length });
});

// GET /api/reports/my-earnings — crew member's all-time breakdown
router.get('/my-earnings', requireAuth, async (req, res) => {
  if (req.session.role === 'owner') {
    return res.status(403).json({ error: 'Owner should use the admin dashboard' });
  }

  const allTime = await db.prepare(`
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

  const tipsAll = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as tips_pay,
           COALESCE(SUM(CASE WHEN paid = 0 THEN amount ELSE 0 END), 0) as tips_outstanding,
           COUNT(*) as tip_count
    FROM tips WHERE employee_id = ?
  `).get(req.session.userId);

  const recent = await db.prepare(`
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

  const thisWeek = await db.prepare(`
    SELECT SUM(jc.crew_pay) as crew_pay,
           SUM(jc.commission_pay) as commission_pay,
           SUM(jc.crew_pay + jc.commission_pay) as total_pay,
           COUNT(jc.id) as job_count
    FROM job_crew jc
    JOIN jobs j ON j.id = jc.job_id
    WHERE jc.employee_id = ? AND j.date BETWEEN ? AND ?
  `).get(req.session.userId, weekStart, weekEnd);

  const weekTips = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as tips_pay
    FROM tips WHERE employee_id = ? AND date BETWEEN ? AND ?
  `).get(req.session.userId, weekStart, weekEnd);

  const recentTips = await db.prepare(`
    SELECT date, amount, note, paid FROM tips
    WHERE employee_id = ?
    ORDER BY date DESC, id DESC LIMIT 15
  `).all(req.session.userId);

  const today = now.toISOString().slice(0, 10);
  const todayEarnings = await db.prepare(`
    SELECT SUM(jc.crew_pay + jc.commission_pay) as total_pay,
           COUNT(jc.id) as job_count
    FROM job_crew jc
    JOIN jobs j ON j.id = jc.job_id
    WHERE jc.employee_id = ? AND j.date = ?
  `).get(req.session.userId, today);

  const seasonWeeksMeta = getDisplaySeasonWeeks();
  const seasonWeeks = [];
  for (const w of seasonWeeksMeta) {
    seasonWeeks.push({
      ...w,
      ...(await getEmployeeWeekPay(db, req.session.userId, w.start, w.end)),
    });
  }

  const grossIncome = (allTime?.total_pay || 0) + (tipsAll?.tips_pay || 0);
  const selfEmploymentTax = grossIncome * SELF_EMPLOYMENT_TAX_RATE;
  const estimatedAfterTax = grossIncome - selfEmploymentTax;

  res.json({
    allTime,
    tipsAll,
    recent,
    recentTips,
    thisWeek,
    weekTips,
    todayEarnings,
    weekStart,
    weekEnd,
    seasonWeeks,
    seasonEnd: SEASON_END,
    daysUntilLeave: daysUntilSeasonEnd(),
    currentWeek: getCurrentWeekNumber(),
    selfEmploymentTaxRate: SELF_EMPLOYMENT_TAX_RATE,
    grossIncome,
    selfEmploymentTax,
    estimatedAfterTax,
  });
});

module.exports = router;
