const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { credentialsFromName } = require('./credentials');

function getDatabaseUrl() {
  return process.env.DATABASE_URL
    || process.env.SUPABASE_DB_URL
    || process.env.POSTGRES_URL;
}

const usePostgres = Boolean(getDatabaseUrl());
let syncDb;
let pool;
let driver = usePostgres ? 'postgres' : 'sqlite';
let initPromise;

function splitStatements(sql) {
  return sql.split(';').map((s) => s.trim()).filter(Boolean);
}

function adaptSql(sql) {
  if (!usePostgres) return sql;
  return sql.replace(/datetime\('now'\)/gi, 'NOW()');
}

function toPgParams(sql, args) {
  let index = 0;
  const text = adaptSql(sql).replace(/\?/g, () => `$${++index}`);
  return { text, values: args };
}

async function pgQuery(sql, args = []) {
  const { text, values } = toPgParams(sql, args);
  return pool.query(text, values);
}

async function runStatementRaw(mode, sql, args = []) {
  if (usePostgres) {
    const adapted = adaptSql(sql);
    if (mode === 'run') {
      let runSql = adapted;
      if (/^\s*INSERT/i.test(adapted) && !/RETURNING/i.test(adapted)) {
        runSql = `${adapted.replace(/;?\s*$/, '')} RETURNING id`;
      }
      const res = await pgQuery(runSql, args);
      return {
        changes: res.rowCount,
        lastInsertRowid: Number(res.rows[0]?.id || 0),
      };
    }
    const res = await pgQuery(adapted, args);
    if (mode === 'get') return res.rows[0] || undefined;
    return res.rows;
  }

  const stmt = syncDb.prepare(sql);
  return stmt[mode](...args);
}

async function runStatement(mode, sql, args) {
  await initDb();
  return runStatementRaw(mode, sql, args);
}

async function columnExists(table, column) {
  if (usePostgres) {
    const res = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [table, column],
    );
    return res.rowCount > 0;
  }
  const cols = await runStatementRaw('all', `PRAGMA table_info(${table})`);
  return cols.some((c) => c.name === column);
}

async function seedDefaults() {
  const count = (await runStatementRaw('get', 'SELECT COUNT(*) as n FROM employees')).n;
  if (Number(count) > 0) return;

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
  if (usePostgres) {
    for (const statement of splitStatements(adaptSql(sql))) {
      await pool.query(statement);
    }
    return;
  }
  syncDb.exec(sql);
}

async function openConnection() {
  if (usePostgres) {
    const connectionString = getDatabaseUrl();
    if (!connectionString) {
      throw new Error('Set DATABASE_URL in Netlify (Supabase → Connect → URI). See DEPLOY.md.');
    }
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 1,
    });
    driver = 'postgres';
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

  if (usePostgres) {
    await seedDefaults();
    return;
  }

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
