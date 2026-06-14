const express = require('express');
const db = require('../db');
const router = express.Router();

function ownerOnly(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  if (req.session.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });
  next();
}

function calcOwnerBreakdown(ownerGross) {
  return {
    taxReserve: ownerGross * 0.20,
    emergencyReserve: ownerGross * 0.10,
    takeHome: ownerGross * 0.70,
  };
}

// GET /api/jobs?date=YYYY-MM-DD
router.get('/', ownerOnly, async (req, res) => {
  const { date } = req.query;
  const jobs = date
    ? await db.prepare('SELECT * FROM jobs WHERE date = ? ORDER BY id').all(date)
    : await db.prepare('SELECT * FROM jobs ORDER BY date DESC, id').all();
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
  res.json(enriched);
});

// POST /api/jobs
// crew = [{ employeeId, crewPayPct, commissionPct }]
// crewPayPct  = % of job total paid to this person as crew pay  (0 if sales-only)
// commissionPct = % of job total paid as sales commission        (0 if crew-only)
router.post('/', ownerOnly, async (req, res) => {
  const { date, jobName, totalAmount, crew, crewPoolPct } = req.body;
  if (!date || !jobName || totalAmount == null) {
    return res.status(400).json({ error: 'date, jobName, totalAmount required' });
  }

  const poolPct = crewPoolPct != null ? Number(crewPoolPct) : 30;
  const members = Array.isArray(crew) ? crew : [];
  const jobResult = await db.prepare(
    'INSERT INTO jobs (date, job_name, total_amount, crew_pool_pct) VALUES (?, ?, ?, ?)'
  ).run(date, jobName, totalAmount, poolPct);
  const jobId = jobResult.lastInsertRowid;

  let totalCrewPay = 0, totalCommission = 0;
  const insertCrew = db.prepare(
    'INSERT INTO job_crew (job_id, employee_id, crew_pay, commission_pct, commission_pay) VALUES (?, ?, ?, ?, ?)'
  );
  for (const m of members) {
    const crewPay      = totalAmount * ((m.crewPayPct    || 0) / 100);
    const commissionPay = totalAmount * ((m.commissionPct || 0) / 100);
    totalCrewPay    += crewPay;
    totalCommission += commissionPay;
    await insertCrew.run(jobId, m.employeeId, crewPay, m.commissionPct || 0, commissionPay);
  }

  await upsertDailySummary(date);
  const ownerGross = totalAmount - totalCrewPay - totalCommission;
  res.json({ id: jobId, ownerGross, ...calcOwnerBreakdown(ownerGross) });
});

router.delete('/:id', ownerOnly, async (req, res) => {
  const jobId = req.params.id;
  const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const crew = await db.prepare(`
    SELECT jc.*, e.name FROM job_crew jc
    JOIN employees e ON e.id = jc.employee_id WHERE jc.job_id = ?
  `).all(jobId);

  const snapshot = {
    date: job.date,
    jobName: job.job_name,
    totalAmount: job.total_amount,
    crewPoolPct: job.crew_pool_pct ?? 30,
    crew: crew.map(c => ({
      employeeId: c.employee_id,
      crewPayPct: job.total_amount ? (c.crew_pay / job.total_amount) * 100 : 0,
      commissionPct: c.commission_pct,
      paid: c.paid,
    })),
  };

  await db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
  await upsertDailySummary(job.date);
  res.json({ ok: true, snapshot, jobName: job.job_name });
});

// POST /api/jobs/restore — undo a deleted job
router.post('/restore', ownerOnly, async (req, res) => {
  const { snapshot } = req.body;
  if (!snapshot?.date || !snapshot?.jobName || snapshot.totalAmount == null) {
    return res.status(400).json({ error: 'Invalid snapshot' });
  }

  const poolPct = snapshot.crewPoolPct != null ? Number(snapshot.crewPoolPct) : 30;
  const members = Array.isArray(snapshot.crew) ? snapshot.crew : [];
  const jobResult = await db.prepare(
    'INSERT INTO jobs (date, job_name, total_amount, crew_pool_pct) VALUES (?, ?, ?, ?)'
  ).run(snapshot.date, snapshot.jobName, snapshot.totalAmount, poolPct);
  const jobId = jobResult.lastInsertRowid;

  const insertCrew = db.prepare(
    'INSERT INTO job_crew (job_id, employee_id, crew_pay, commission_pct, commission_pay, paid) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const m of members) {
    const crewPay = snapshot.totalAmount * ((m.crewPayPct || 0) / 100);
    const commissionPay = snapshot.totalAmount * ((m.commissionPct || 0) / 100);
    await insertCrew.run(jobId, m.employeeId, crewPay, m.commissionPct || 0, commissionPay, m.paid ? 1 : 0);
  }

  await upsertDailySummary(snapshot.date);
  res.json({ ok: true, id: jobId });
});

router.patch('/crew/:jobCrewId/paid', ownerOnly, async (req, res) => {
  await db.prepare('UPDATE job_crew SET paid = ? WHERE id = ?').run(req.body.paid ? 1 : 0, req.params.jobCrewId);
  res.json({ ok: true });
});

async function upsertDailySummary(date) {
  const jobs = await db.prepare('SELECT * FROM jobs WHERE date = ?').all(date);
  let totalRevenue = 0, ownerGross = 0;
  for (const job of jobs) {
    totalRevenue += job.total_amount;
    const crew = await db.prepare('SELECT * FROM job_crew WHERE job_id = ?').all(job.id);
    ownerGross += job.total_amount
      - crew.reduce((s, c) => s + c.crew_pay, 0)
      - crew.reduce((s, c) => s + c.commission_pay, 0);
  }
  const { taxReserve, emergencyReserve, takeHome } = calcOwnerBreakdown(ownerGross);
  await db.prepare(`
    INSERT INTO daily_summaries (date, total_revenue, owner_gross, owner_tax_reserve, owner_emergency_reserve, owner_take_home)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      total_revenue=excluded.total_revenue, owner_gross=excluded.owner_gross,
      owner_tax_reserve=excluded.owner_tax_reserve,
      owner_emergency_reserve=excluded.owner_emergency_reserve,
      owner_take_home=excluded.owner_take_home
  `).run(date, totalRevenue, ownerGross, taxReserve, emergencyReserve, takeHome);
}

module.exports = router;
