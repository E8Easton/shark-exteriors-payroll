const express = require('express');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new MemoryStore({ checkPeriod: 86400000 }),
  secret: process.env.SESSION_SECRET || 'shark-exteriors-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
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

app.listen(PORT, () => {
  console.log(`Shark Exteriors Payroll running on http://localhost:${PORT}`);
});
