/** Shark Exteriors 2026 season — Week 1 starts Apr 6; last day Aug 16. */
const SEASON_START = '2026-04-06';
const SEASON_END = '2026-08-16';
/** Only show payout weeks 1–11 (future weeks 12+ hidden until you're in them). */
const SEASON_DISPLAY_MAX_WEEK = 11;
const SELF_EMPLOYMENT_TAX_RATE = 0.153;

function parseDate(str) {
  return new Date(str + 'T12:00:00');
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function mondayOfWeekContaining(dateStr) {
  const d = parseDate(dateStr);
  const day = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return mon;
}

function getSeasonWeeks(referenceDate) {
  const ref = referenceDate || formatDate(new Date());
  const todayMon = formatDate(mondayOfWeekContaining(ref));
  const lastMon = mondayOfWeekContaining(SEASON_END);
  const weeks = [];
  let cur = parseDate(SEASON_START);
  let num = 1;
  while (cur <= lastMon) {
    const sun = addDays(cur, 6);
    const endDate = sun > parseDate(SEASON_END) ? parseDate(SEASON_END) : sun;
    const startStr = formatDate(cur);
    weeks.push({
      number: num,
      start: startStr,
      end: formatDate(endDate),
      isCurrent: startStr === todayMon,
      label: `Week ${num}`,
    });
    num += 1;
    cur = addDays(cur, 7);
  }
  return weeks;
}

/** Weeks shown in Pay Out / crew season views (1 through SEASON_DISPLAY_MAX_WEEK). */
function getDisplaySeasonWeeks(referenceDate) {
  return getSeasonWeeks(referenceDate).filter(w => w.number <= SEASON_DISPLAY_MAX_WEEK);
}

function daysUntilSeasonEnd(fromDate) {
  const from = parseDate(fromDate || formatDate(new Date()));
  const end = parseDate(SEASON_END);
  return Math.max(0, Math.ceil((end - from) / 86400000));
}

function getCurrentWeekNumber(referenceDate) {
  const weeks = getSeasonWeeks(referenceDate);
  return weeks.find(w => w.isCurrent)?.number ?? weeks[weeks.length - 1]?.number ?? 1;
}

module.exports = {
  SEASON_START,
  SEASON_END,
  SEASON_DISPLAY_MAX_WEEK,
  SELF_EMPLOYMENT_TAX_RATE,
  getSeasonWeeks,
  getDisplaySeasonWeeks,
  daysUntilSeasonEnd,
  getCurrentWeekNumber,
  mondayOfWeekContaining,
  formatDate,
};
