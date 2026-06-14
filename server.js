const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const publicDir = path.join(__dirname, 'public');
const SESSIONS_PATH = process.env.SESSIONS_PATH || path.join(__dirname, 'sessions');
const sessionSecret = process.env.SESSION_SECRET || 'shark-exteriors-secret-change-me';

if (isProduction && sessionSecret === 'shark-exteriors-secret-change-me') {
  console.error('Set SESSION_SECRET before running in production (e.g. fly secrets set SESSION_SECRET=...)');
  process.exit(1);
}

fs.mkdirSync(SESSIONS_PATH, { recursive: true });

app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Shark Exteriors Payroll running on port ${PORT}`);
});
