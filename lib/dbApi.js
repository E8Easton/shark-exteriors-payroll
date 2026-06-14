const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { credentialsFromName } = require('./credentials');

const useTurso = Boolean(process.env.TURSO_DATABASE_URL);
let syncDb;
let tursoClient;
let driver = useTurso ? 'libsql' : 'better-sqlite3';
let initPromise;

function splitStatements(sql) {
  return sql.split(';').map((s) => s.trim()).filter(Boolean);
}

async function tursoExecute(sql, args = []) {
  return tursoClient.execute({ sql, args });
}

async function tursoExec(sql) {
  const statements = splitStatements(sql);
  if (statements.length <= 1) {
    await tursoExecute(sql);
    return;
  }
  await tursoClient.batch(
    statements.map((statement) => ({ sql: statement, args: [] })),
    'write',
  );
}

async function runStatementRaw(mode, sql, args = []) {
  if (useTurso) {
    const res = await tursoExecute(sql, args);
    if (mode === 'get') return res.rows[0] || undefined;
    if (mode === 'all') return res.rows;
    return {
      changes: res.rowsAffected,
      lastInsertRowid: Number(res.lastInsertRowid || 0),
    };
  }
  const stmt = syncDb.prepare(sql);
  return stmt[mode](...args);
}

async function runStatement(mode, sql, args) {
  await initDb();
  return runStatementRaw(mode, sql, args);
}

async function columnExists(table, column) {
  const cols = await runStatementRaw('all', `PRAGMA table_info(${table})`);
  return cols.some((c) => c.name === column);
}

async function seedDefaults() {
  const count = (await runStatementRaw('get', 'SELECT COUNT(*) as n FROM employees')).n;
  if (count > 0) return;

  const defaultCrew = [
    { name: 'Easton Zastrow', role: 'owner' },
    { name: 'Malcolm Gall', role: 'crew' },
    { name: 'Teddy', role: 'crew' },
    { name: 'Asher Petersen', role: 'crew' },
    { name: 'Tyler Smith', role: 'crew' },
    { name: 'Graham Leyden', role: 'crew' },
    { name: 'Noah Zach', role: 'crew' },
  ];

  for (const emp of defaultCrew) {
    const { username, password } = credentialsFromName(emp.name);
    const hash = bcrypt.hashSync(password, 10);
    await runStatementRaw(
      'run',
      'INSERT INTO employees (name, username, password_hash, role) VALUES (?, ?, ?, ?)',
      [emp.name, username, hash, emp.role],
    );
  }
  console.log(`Seeded default employees (db: ${driver})`);
}

async function execRaw(sql) {
  if (useTurso) {
    await tursoExec(sql);
    return;
  }
  syncDb.exec(sql);
}

async function openConnection() {
  if (useTurso) {
    const { createClient } = require('@libsql/client');
    if (!process.env.TURSO_DATABASE_URL) {
      throw new Error('TURSO_DATABASE_URL is required on Netlify. See DEPLOY.md.');
    }
    tursoClient = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    return;
  }

  const { resolveDataDir } = require('./dataDir');
  const DB_PATH = process.env.DB_PATH || path.join(resolveDataDir(), 'payroll.db');
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  try {
    const BetterSqlite = require('better-sqlite3');
    syncDb = new BetterSqlite(DB_PATH);
    driver = 'better-sqlite3';
    syncDb.pragma('journal_mode = WAL');
    syncDb.pragma('foreign_keys = ON');
  } catch {
    const { DatabaseSync } = require('node:sqlite');
    syncDb = new DatabaseSync(DB_PATH);
    driver = 'node:sqlite';
    syncDb.exec('PRAGMA journal_mode = WAL');
    syncDb.exec('PRAGMA foreign_keys = ON');
  }
}

async function runMigrations() {
  await openConnection();

  await execRaw(`
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

  await seedDefaults();

  if (!(await columnExists('jobs', 'crew_pool_pct'))) {
    await execRaw('ALTER TABLE jobs ADD COLUMN crew_pool_pct REAL NOT NULL DEFAULT 30');
  }
  if (!(await columnExists('employees', 'notes'))) {
    await execRaw('ALTER TABLE employees ADD COLUMN notes TEXT DEFAULT \'\'');
  }

  await execRaw(`
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
}

function initDb() {
  if (!initPromise) initPromise = runMigrations();
  return initPromise;
}

function prepare(sql) {
  return {
    get: (...args) => runStatement('get', sql, args),
    all: (...args) => runStatement('all', sql, args),
    run: (...args) => runStatement('run', sql, args),
  };
}

async function exec(sql) {
  await initDb();
  await execRaw(sql);
}

module.exports = {
  initDb,
  prepare,
  exec,
  get driver() { return driver; },
};
