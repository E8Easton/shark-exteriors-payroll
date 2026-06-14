-- Run this in Supabase: SQL Editor → New query → Run
-- (Or use Supabase CLI: supabase db push)

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'crew',
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  date TEXT NOT NULL,
  job_name TEXT NOT NULL,
  total_amount DOUBLE PRECISION NOT NULL,
  crew_pool_pct DOUBLE PRECISION NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_crew (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  crew_pay DOUBLE PRECISION NOT NULL DEFAULT 0,
  commission_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  commission_pay DOUBLE PRECISION NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_summaries (
  id SERIAL PRIMARY KEY,
  date TEXT UNIQUE NOT NULL,
  total_revenue DOUBLE PRECISION NOT NULL DEFAULT 0,
  owner_gross DOUBLE PRECISION NOT NULL DEFAULT 0,
  owner_tax_reserve DOUBLE PRECISION NOT NULL DEFAULT 0,
  owner_emergency_reserve DOUBLE PRECISION NOT NULL DEFAULT 0,
  owner_take_home DOUBLE PRECISION NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS weekly_payouts (
  id SERIAL PRIMARY KEY,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  paid INTEGER NOT NULL DEFAULT 0,
  paid_at TEXT,
  UNIQUE(week_start, week_end, employee_id)
);

CREATE TABLE IF NOT EXISTS tips (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  date TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  note TEXT,
  paid INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS week_pay_overrides (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  crew_pay DOUBLE PRECISION NOT NULL DEFAULT 0,
  commission_pay DOUBLE PRECISION NOT NULL DEFAULT 0,
  tips_pay DOUBLE PRECISION NOT NULL DEFAULT 0,
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id, week_start, week_end)
);

-- Backend-only app: disable public API access (Express uses DATABASE_URL directly)
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_crew ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tips ENABLE ROW LEVEL SECURITY;
ALTER TABLE week_pay_overrides ENABLE ROW LEVEL SECURITY;

-- No policies = no access via Supabase Data API (service role / direct SQL still works)
