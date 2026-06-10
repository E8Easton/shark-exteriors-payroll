const express = require('express');
const db = require('../db');
const router = express.Router();

function ownerOnly(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  if (req.session.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });
  next();
}

// ── Payroll math ──────────────────────────────────────────────────────────────
// 30% of job total split evenly among workers only
function calcCrewPay(jobTotal, workerCount) {
  return workerCount > 0 ? (jobTotal * 0.30) / workerCount : 0;
}

function calcOwnerBreakdown(ownerGross) {
  const taxReserve = ownerGross * 0.20;
  const emergencyReserve = ownerGross * 0.10;
  return { taxReserve, emergencyReserve, takeHome: ownerGross * 0.70 };
}

// ── Jobs CRUD ─────────────────────────────────────────────────────────────────

router.get('/', ownerOnly, (req, res) => {
  const { date } = req.query;
  const jobs = date
    ? db.prepare('SELECT * FROM jobs WHERE date = ? ORDER BY id').all(date)
    : db.prepare('SELECT * FROM jobs ORDER BY date DESC, id').all();

  const enriched = jobs.map(job => ({
    ...job,
    crew: db.prepare(`
      SELECT jc.*, e.name FROM job_crew jc
      JOIN employees e ON e.id = jc.employee_id WHERE jc.job_id = ?
    `).all(job.id),
  }));
  res.json(enriched);
});

// POST /api/jobs
// crew = [{ employeeId, isWorker, commissionPct }]
// isWorker=true  → gets a share of the 30% crew pool
// commissionPct>0 → gets that % of total as sales commission
// A person can be both
router.post('/', ownerOnly, (req, res) => {
  const { date, jobName, totalAmount, crew } = req.body;
  if (!date || !jobName || totalAmount == null) {
    return res.status(400).json({ error: 'date, jobName, totalAmount required' });
  }

  const members = Array.isArray(crew) ? crew : [];
  const workerCount = members.filter(m => m.isWorker).length;
  const perWorkerPay = calcCrewPay(totalAmount, workerCount);

  let totalCrewPay   = perWorkerPay * workerCount;
  let totalCommission = members.reduce((s, m) => s + totalAmount * ((m.commissionPct || 0) / 100), 0);
  const ownerGross   = totalAmount - totalCrewPay - totalCommission;

  const jobResult = db.prepare(
    'INSERT INTO jobs (date, job_name, total_amount) VALUES (?, ?, ?)'
  ).run(date, jobName, totalAmount);
  const jobId = jobResult.lastInsertRowid;

  const insertCrew = db.prepare(
    'INSERT INTO job_crew (job_id, employee_id, crew_pay, commission_pct, commission_pay) VALUES (?, ?, ?, ?, ?)'
  );
  for (const m of members) {
    const crewPay      = m.isWorker ? perWorkerPay : 0;
    const commissionPay = totalAmount * ((m.commissionPct || 0) / 100);
    insertCrew.run(jobId, m.employeeId, crewPay, m.commissionPct || 0, commissionPay);
  }

  upsertDailySummary(date);
  res.json({ id: jobId, ownerGross, ...calcOwnerBreakdown(ownerGross) });
});

router.delete('/:id', ownerOnly, (req, res) => {
  const job = db.prepare('SELECT date FROM jobs WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);
  if (job) upsertDailySummary(job.date);
  res.json({ ok: true });
});

router.patch('/crew/:jobCrewId/paid', ownerOnly, (req, res) => {
  const { paid } = req.body;
  db.prepare('UPDATE job_crew SET paid = ? WHERE id = ?').run(paid ? 1 : 0, req.params.jobCrewId);
  res.json({ ok: true });
});

// ── Helper ────────────────────────────────────────────────────────────────────
function upsertDailySummary(date) {
  const jobs = db.prepare('SELECT * FROM jobs WHERE date = ?').all(date);
  let totalRevenue = 0, ownerGross = 0;
  for (const job of jobs) {
    totalRevenue += job.total_amount;
    const crew = db.prepare('SELECT * FROM job_crew WHERE job_id = ?').all(job.id);
    const crewPay    = crew.reduce((s, c) => s + c.crew_pay, 0);
    const commission = crew.reduce((s, c) => s + c.commission_pay, 0);
    ownerGross += job.total_amount - crewPay - commission;
  }
  const { taxReserve, emergencyReserve, takeHome } = calcOwnerBreakdown(ownerGross);
  db.prepare(`
    INSERT INTO daily_summaries (date, total_revenue, owner_gross, owner_tax_reserve, owner_emergency_reserve, owner_take_home)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      total_revenue = excluded.total_revenue,
      owner_gross = excluded.owner_gross,
      owner_tax_reserve = excluded.owner_tax_reserve,
      owner_emergency_reserve = excluded.owner_emergency_reserve,
      owner_take_home = excluded.owner_take_home
  `).run(date, totalRevenue, ownerGross, taxReserve, emergencyReserve, takeHome);
}

module.exports = router;
