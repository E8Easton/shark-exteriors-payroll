const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');

// On Railway, mount a volume at /data and set DB_PATH=/data/payroll.db
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'payroll.db');
const db = new DatabaseSync(DB_PATH);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

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

// Seed default employees if none exist
const count = db.prepare('SELECT COUNT(*) as n FROM employees').get().n;
if (count === 0) {
  const defaultCrew = [
    { name: 'Easton Zastrow',  username: 'easton',  password: 'zastrow', role: 'owner' },
    { name: 'Malcolm Gall',   username: 'malcolm', password: 'gall',    role: 'crew'  },
    { name: 'Teddy',          username: 'teddy',   password: 'teddy',   role: 'crew'  },
    { name: 'Asher Petersen', username: 'asher',   password: 'petersen',role: 'crew'  },
    { name: 'Tyler Smith',    username: 'tyler',   password: 'smith',   role: 'crew'  },
    { name: 'Graham Leyden',  username: 'graham',  password: 'leyden',  role: 'crew'  },
    { name: 'Noah Zach',      username: 'noah',    password: 'zach',    role: 'crew'  },
  ];

  const insert = db.prepare(
    'INSERT INTO employees (name, username, password_hash, role) VALUES (?, ?, ?, ?)'
  );
  for (const emp of defaultCrew) {
    const hash = bcrypt.hashSync(emp.password, 10);
    insert.run(emp.name, emp.username, hash, emp.role);
  }
  console.log('Seeded default employees');
}

module.exports = db;
