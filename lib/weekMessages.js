function fmtMoney(n) {
  return '$' + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function firstName(name) {
  return (name || '').split(/\s+/)[0] || name;
}

function fmtWeekDates(start, end) {
  const fmt = s => {
    const [, m, d] = s.split('-');
    return `${Number(m)}/${Number(d)}`;
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

function lineForPerson(r) {
  const parts = [];
  if (r.crew_pay > 0) parts.push(`crew ${fmtMoney(r.crew_pay)}`);
  if (r.commission_pay > 0) parts.push(`sales ${fmtMoney(r.commission_pay)}`);
  if (r.tips_pay > 0) parts.push(`tips ${fmtMoney(r.tips_pay)}`);
  const detail = parts.length ? `\n   (${parts.join(' · ')})` : '';
  return `• ${r.name} — ${fmtMoney(r.total_pay)}${detail}`;
}

function buildHighlights(rows) {
  const active = rows.filter(r => r.total_pay > 0);
  const topBy = (key, filter = () => true) => {
    const sorted = active.filter(filter).sort((a, b) => (b[key] || 0) - (a[key] || 0));
    const top = sorted[0];
    return top && (top[key] || 0) > 0
      ? { id: top.id, name: top.name, amount: top[key], role: top.role }
      : null;
  };

  return {
    topCommission: topBy('commission_pay', r => r.commission_pay > 0),
    topCrewPay: topBy('crew_pay', r => (r.crew_pay || 0) > 0 && r.role !== 'd2d'),
    topCleaningCrew: topBy('crew_pay', r => r.role === 'cleaning_tech' && r.crew_pay > 0),
    topTips: topBy('tips_pay', r => r.tips_pay > 0),
    topTotal: topBy('total_pay'),
  };
}

function medalLine(label, emoji, entry) {
  if (!entry) return `${emoji} ${label}: —`;
  return `${emoji} ${label}: ${entry.name} — ${fmtMoney(entry.amount)}`;
}

function buildIndividualMessage(r, week) {
  const hi = firstName(r.name);
  const lines = [`Hey ${hi}! 🦈`, '', `Your Week ${week.number} pay (${fmtWeekDates(week.start, week.end)}):`, ''];

  if (r.role === 'd2d') {
    lines.push(`Sales commission: ${fmtMoney(r.commission_pay)}`);
    if (r.crew_pay > 0) lines.push(`Crew (if any): ${fmtMoney(r.crew_pay)}`);
  } else if (r.role === 'cleaning_tech') {
    lines.push(`Crew / cleaning pay: ${fmtMoney(r.crew_pay)}`);
    if (r.commission_pay > 0) lines.push(`Sales commission: ${fmtMoney(r.commission_pay)}`);
  } else {
    lines.push(`Crew pay: ${fmtMoney(r.crew_pay)}`);
    if (r.commission_pay > 0) lines.push(`Sales commission: ${fmtMoney(r.commission_pay)}`);
  }

  if (r.tips_pay > 0) lines.push(`Tips: ${fmtMoney(r.tips_pay)}`);

  lines.push('─────────────');
  lines.push(`Total: ${fmtMoney(r.total_pay)}`);
  if (r.job_count > 0) lines.push('', `Jobs this week: ${r.job_count}`);
  lines.push('', 'Let me know if anything looks off. Great work!');
  return lines.join('\n');
}

function buildWeekMessages(week, rows) {
  const sorted = [...rows]
    .filter(r => r.total_pay > 0)
    .sort((a, b) => b.total_pay - a.total_pay);
  const highlights = buildHighlights(rows);
  const dateLine = fmtWeekDates(week.start, week.end);

  const groupFull = [
    `🦈 SHARK EXTERIORS — Week ${week.number} Pay Recap`,
    `📅 ${dateLine}`,
    '',
    '💰 Pay this week:',
    '',
    ...sorted.map(lineForPerson),
    '',
    sorted.length ? 'Reply if anything looks off. Great work team! 💪' : 'No crew pay recorded this week yet.',
  ].join('\n');

  const groupHighlights = [
    `🦈 Shark Exteriors — Week ${week.number} Shout-outs 🏆`,
    `📅 ${dateLine}`,
    '',
    medalLine('Top Sales Commission', '💼', highlights.topCommission),
    medalLine('Top Cleaning Crew Pay', '🧽', highlights.topCleaningCrew),
    medalLine('Top Crew Pay (all)', '🔧', highlights.topCrewPay),
    medalLine('Top Tips', '💵', highlights.topTips),
    medalLine('Top Total Earner', '🥇', highlights.topTotal),
    '',
    'Want the full breakdown? Just ask — happy to share.',
  ].join('\n');

  const leadersLines = [
    `🦈 Week ${week.number} Leaderboard (${dateLine})`,
    '',
    '💼 SALES COMMISSION',
    ...rows
      .filter(r => r.commission_pay > 0)
      .sort((a, b) => b.commission_pay - a.commission_pay)
      .slice(0, 5)
      .map((r, i) => `${i + 1}. ${r.name} — ${fmtMoney(r.commission_pay)}`),
    '',
    '🧽 CLEANING CREW PAY',
    ...rows
      .filter(r => r.role === 'cleaning_tech' && r.crew_pay > 0)
      .sort((a, b) => b.crew_pay - a.crew_pay)
      .slice(0, 5)
      .map((r, i) => `${i + 1}. ${r.name} — ${fmtMoney(r.crew_pay)}`),
    '',
    '🔧 CREW PAY (everyone)',
    ...rows
      .filter(r => r.crew_pay > 0)
      .sort((a, b) => b.crew_pay - a.crew_pay)
      .slice(0, 5)
      .map((r, i) => `${i + 1}. ${r.name} — ${fmtMoney(r.crew_pay)}`),
    '',
    '💵 TIPS',
    ...rows
      .filter(r => r.tips_pay > 0)
      .sort((a, b) => b.tips_pay - a.tips_pay)
      .slice(0, 5)
      .map((r, i) => `${i + 1}. ${r.name} — ${fmtMoney(r.tips_pay)}`),
  ].join('\n');

  const individual = {};
  for (const r of rows) {
    if (r.total_pay <= 0 && r.job_count <= 0) continue;
    individual[r.id] = {
      id: r.id,
      name: r.name,
      role: r.role,
      text: buildIndividualMessage(r, week),
    };
  }

  return {
    week,
    highlights,
    employees: sorted,
    messages: {
      groupFull,
      groupHighlights,
      leaders: leadersLines,
      individual,
    },
  };
}

module.exports = { buildWeekMessages, fmtMoney };
