const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const cookieSession = require('cookie-session');
const fs = require('fs');
const path = require('path');
const { resolveDataDir, resolveSessionSecret } = require('./lib/dataDir');
const { resolvePublicDir } = require('./lib/paths');

const isServerless = Boolean(
  process.env.NETLIFY
  || process.env.AWS_LAMBDA_FUNCTION_NAME
  || process.env.DATABASE_URL
  || process.env.SUPABASE_DB_URL,
);

function createApp() {
  const app = express();
  const isProduction = process.env.NODE_ENV === 'production';
  const publicDir = resolvePublicDir();
  const dataDir = resolveDataDir();
  const SESSIONS_PATH = process.env.SESSIONS_PATH || path.join(dataDir, 'sessions');
  const sessionSecret = resolveSessionSecret(dataDir);

  if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL && !process.env.DB_PATH) {
    process.env.DB_PATH = path.join(dataDir, 'payroll.db');
  }

  if (!isServerless) {
    fs.mkdirSync(SESSIONS_PATH, { recursive: true });
  }

  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use(async (req, res, next) => {
    try {
      await require('./db').initDb();
      next();
    } catch (err) {
      next(err);
    }
  });

  if (isServerless) {
    app.use(cookieSession({
      name: 'shark_session',
      keys: [sessionSecret],
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
    }));
  } else {
    app.use(session({
      store: new FileStore({
        path: SESSIONS_PATH,
        ttl: 7 * 24 * 60 * 60,
        retries: 0,
      }),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }));
  }

  app.get('/health', async (req, res) => {
    try {
      const db = require('./db');
      await db.initDb();
      res.json({
        ok: true,
        platform: isServerless ? 'netlify' : 'local',
        driver: db.driver,
        database: isServerless ? 'supabase-postgres' : dataDir,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/employees', require('./routes/employees'));
  app.use('/api/jobs', require('./routes/jobs'));
  app.use('/api/reports', require('./routes/reports'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/tips', require('./routes/tips'));

  function sendPage(res, filename) {
    res.sendFile(path.join(publicDir, filename));
  }

  app.get('/login.html', (req, res) => {
    if (req.session.userId) {
      return res.redirect(req.session.role === 'owner' ? '/index.html' : '/crew.html');
    }
    sendPage(res, 'login.html');
  });

  app.get('/', (req, res) => {
    if (!req.session.userId) return res.redirect('/login.html');
    res.redirect(req.session.role === 'owner' ? '/index.html' : '/crew.html');
  });

  app.get('/index.html', (req, res) => {
    if (!req.session.userId) return res.redirect('/login.html');
    if (req.session.role !== 'owner') return res.redirect('/crew.html');
    sendPage(res, 'index.html');
  });

  app.get('/crew.html', (req, res) => {
    if (!req.session.userId) return res.redirect('/login.html');
    if (req.session.role === 'owner') return res.redirect('/index.html');
    sendPage(res, 'crew.html');
  });

  app.use(express.static(publicDir, { index: false }));

  app.use((req, res) => {
    res.status(404).send('Page not found. Go to <a href="/login.html">/login.html</a>');
  });

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  });

  return app;
}

module.exports = createApp;
