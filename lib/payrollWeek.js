/** Shared SQL helpers for one payroll week. */

function getWeekOverride(db, employeeId, start, end) {
  return db.prepare(`
    SELECT * FROM week_pay_overrides
    WHERE employee_id = ? AND week_start = ? AND week_end = ?
  `).get(employeeId, start, end);
}

function getWeekOverridesForRange(db, start, end) {
  return db.prepare(`
    SELECT o.*, e.name, e.role, e.active
    FROM week_pay_overrides o
    JOIN employees e ON e.id = o.employee_id
    WHERE o.week_start = ? AND o.week_end = ? AND e.role != 'owner'
  `).all(start, end);
}

function mergeOverride(base, override, weekPaid) {
  if (!override) {
    return {
      ...base,
      hasOverride: false,
      calculated_crew_pay: base.crew_pay,
      calculated_commission_pay: base.commission_pay,
      calculated_tips_pay: base.tips_pay,
    };
  }
  const crew = override.crew_pay ?? 0;
  const comm = override.commission_pay ?? 0;
  const tips = override.tips_pay ?? 0;
  const total = crew + comm + tips;
  return {
    ...base,
    crew_pay: crew,
    commission_pay: comm,
    tips_pay: tips,
    total_pay: total,
    hasOverride: true,
    override_note: override.note || '',
    calculated_crew_pay: base.crew_pay,
    calculated_commission_pay: base.commission_pay,
    calculated_tips_pay: base.tips_pay,
    unpaid_amount: weekPaid ? 0 : total,
  };
}

function getPayrollForWeek(db, start, end) {
  const employees = db.prepare(`
    SELECT e.id, e.name, e.role,
           COALESCE(jc_agg.crew_pay, 0) as crew_pay,
           COALESCE(jc_agg.commission_pay, 0) as commission_pay,
           COALESCE(tip_agg.tips_pay, 0) as tips_pay,
           COALESCE(jc_agg.crew_pay, 0) + COALESCE(jc_agg.commission_pay, 0) + COALESCE(tip_agg.tips_pay, 0) as total_pay,
           COALESCE(jc_agg.unpaid_jobs, 0) + COALESCE(tip_agg.unpaid_tips, 0) as unpaid_amount,
           COALESCE(jc_agg.job_count, 0) as job_count
    FROM employees e
    LEFT JOIN (
      SELECT jc.employee_id,
             SUM(jc.crew_pay) as crew_pay,
             SUM(jc.commission_pay) as commission_pay,
             SUM(CASE WHEN jc.paid = 0 THEN jc.crew_pay + jc.commission_pay ELSE 0 END) as unpaid_jobs,
             COUNT(jc.id) as job_count
      FROM job_crew jc
      JOIN jobs j ON j.id = jc.job_id
      WHERE j.date BETWEEN ? AND ?
      GROUP BY jc.employee_id
    ) jc_agg ON jc_agg.employee_id = e.id
    LEFT JOIN (
      SELECT employee_id,
             SUM(amount) as tips_pay,
             SUM(CASE WHEN paid = 0 THEN amount ELSE 0 END) as unpaid_tips
      FROM tips WHERE date BETWEEN ? AND ?
      GROUP BY employee_id
    ) tip_agg ON tip_agg.employee_id = e.id
    WHERE e.active = 1 AND e.role != 'owner'
      AND (COALESCE(jc_agg.crew_pay, 0) + COALESCE(jc_agg.commission_pay, 0) + COALESCE(tip_agg.tips_pay, 0)) > 0
    ORDER BY e.name
  `).all(start, end, start, end);

  const payoutFlags = db.prepare(`
    SELECT employee_id, paid, paid_at FROM weekly_payouts
    WHERE week_start = ? AND week_end = ?
  `).all(start, end);
  const flagMap = Object.fromEntries(payoutFlags.map(p => [p.employee_id, p]));

  const rowMap = new Map();
  for (const e of employees) {
    const weekPaid = flagMap[e.id]?.paid === 1;
    const base = {
      ...e,
      weekPaid,
      paidAt: flagMap[e.id]?.paid_at || null,
    };
    rowMap.set(e.id, mergeOverride(base, getWeekOverride(db, e.id, start, end), weekPaid));
  }

  for (const o of getWeekOverridesForRange(db, start, end)) {
    if (!o.active || rowMap.has(o.employee_id)) continue;
    const weekPaid = flagMap[o.employee_id]?.paid === 1;
    const base = {
      id: o.employee_id,
      name: o.name,
      role: o.role,
      crew_pay: 0,
      commission_pay: 0,
      tips_pay: 0,
      total_pay: 0,
      unpaid_amount: 0,
      job_count: 0,
      weekPaid,
      paidAt: flagMap[o.employee_id]?.paid_at || null,
    };
    rowMap.set(o.employee_id, mergeOverride(base, o, weekPaid));
  }

  const rows = Array.from(rowMap.values())
    .filter(r => r.total_pay > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  const weekRevenue = db.prepare(`
    SELECT COALESCE(SUM(total_revenue), 0) as revenue,
           COALESCE(SUM(owner_gross), 0) as owner_gross,
           COALESCE(SUM(owner_take_home), 0) as take_home
    FROM daily_summaries WHERE date BETWEEN ? AND ?
  `).get(start, end);

  const totalTips = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total,
           COALESCE(SUM(CASE WHEN paid = 0 THEN amount ELSE 0 END), 0) as unpaid
    FROM tips WHERE date BETWEEN ? AND ?
  `).get(start, end);

  return { rows, weekRevenue, totalTips };
}

function getEmployeeWeekPay(db, employeeId, start, end) {
  const jobs = db.prepare(`
    SELECT COALESCE(SUM(jc.crew_pay), 0) as crew_pay,
           COALESCE(SUM(jc.commission_pay), 0) as commission_pay,
           COALESCE(SUM(jc.crew_pay + jc.commission_pay), 0) as job_pay,
           COUNT(jc.id) as job_count,
           COALESCE(SUM(CASE WHEN jc.paid = 0 THEN jc.crew_pay + jc.commission_pay ELSE 0 END), 0) as unpaid_jobs
    FROM job_crew jc
    JOIN jobs j ON j.id = jc.job_id
    WHERE jc.employee_id = ? AND j.date BETWEEN ? AND ?
  `).get(employeeId, start, end);

  const tips = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as tips_pay,
           COALESCE(SUM(CASE WHEN paid = 0 THEN amount ELSE 0 END), 0) as unpaid_tips
    FROM tips WHERE employee_id = ? AND date BETWEEN ? AND ?
  `).get(employeeId, start, end);

  const flag = db.prepare(`
    SELECT paid FROM weekly_payouts
    WHERE week_start = ? AND week_end = ? AND employee_id = ?
  `).get(start, end, employeeId);

  const crewPay = jobs?.crew_pay || 0;
  const commissionPay = jobs?.commission_pay || 0;
  const tipsPay = tips?.tips_pay || 0;
  const totalPay = crewPay + commissionPay + tipsPay;
  const weekPaid = flag?.paid === 1;

  const base = {
    crew_pay: crewPay,
    commission_pay: commissionPay,
    tips_pay: tipsPay,
    total_pay: totalPay,
    job_count: jobs?.job_count || 0,
    unpaid_amount: (jobs?.unpaid_jobs || 0) + (tips?.unpaid_tips || 0),
    weekPaid,
  };

  return mergeOverride(base, getWeekOverride(db, employeeId, start, end), weekPaid);
}

module.exports = {
  getPayrollForWeek,
  getEmployeeWeekPay,
  getWeekOverride,
};
