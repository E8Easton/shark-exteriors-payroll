const bcrypt = require('bcryptjs');
const path = require('path');
const { credentialsFromName } = require('./lib/credentials');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'payroll.db');

let db;
let driver = 'better-sqlite3';
try {
  const BetterSqlite = require('better-sqlite3');
  db = new BetterSqlite(DB_PATH);
} catch {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(DB_PATH);
  driver = 'node:sqlite';
}

if (driver === 'better-sqlite3') {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
} else {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'crew',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    job_name TEXT NOT NULL,
    total_amount REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS job_crew (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    crew_pay REAL NOT NULL DEFAULT 0,
    commission_pct REAL NOT NULL DEFAULT 0,
    commission_pay REAL NOT NULL DEFAULT 0,
    paid INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS daily_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    total_revenue REAL NOT NULL DEFAULT 0,
    owner_gross REAL NOT NULL DEFAULT 0,
    owner_tax_reserve REAL NOT NULL DEFAULT 0,
    owner_emergency_reserve REAL NOT NULL DEFAULT 0,
    owner_take_home REAL NOT NULL DEFAULT 0,
    notes TEXT
  );
`);

const count = db.prepare('SELECT COUNT(*) as n FROM employees').get().n;
if (count === 0) {
  const defaultCrew = [
    { name: 'Easton Zastrow', role: 'owner' },
    { name: 'Malcolm Gall', role: 'crew' },
    { name: 'Teddy', role: 'crew' },
    { name: 'Asher Petersen', role: 'crew' },
    { name: 'Tyler Smith', role: 'crew' },
    { name: 'Graham Leyden', role: 'crew' },
    { name: 'Noah Zach', role: 'crew' },
  ];

  const insert = db.prepare(
    'INSERT INTO employees (name, username, password_hash, role) VALUES (?, ?, ?, ?)'
  );
  for (const emp of defaultCrew) {
    const { username, password } = credentialsFromName(emp.name);
    const hash = bcrypt.hashSync(password, 10);
    insert.run(emp.name, username, hash, emp.role);
  }
  console.log(`Seeded default employees (db: ${driver})`);
}

function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

if (!columnExists('jobs', 'crew_pool_pct')) {
  db.exec('ALTER TABLE jobs ADD COLUMN crew_pool_pct REAL NOT NULL DEFAULT 30');
}

if (!columnExists('employees', 'notes')) {
  db.exec('ALTER TABLE employees ADD COLUMN notes TEXT DEFAULT \'\'');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS weekly_payouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_start TEXT NOT NULL,
    week_end TEXT NOT NULL,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    paid INTEGER NOT NULL DEFAULT 0,
    paid_at TEXT,
    UNIQUE(week_start, week_end, employee_id)
  );

  CREATE TABLE IF NOT EXISTS tips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    note TEXT,
    paid INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS week_pay_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    week_start TEXT NOT NULL,
    week_end TEXT NOT NULL,
    crew_pay REAL NOT NULL DEFAULT 0,
    commission_pay REAL NOT NULL DEFAULT 0,
    tips_pay REAL NOT NULL DEFAULT 0,
    note TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(employee_id, week_start, week_end)
  );
`);

module.exports = db;
