const express = require('express');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Railway's reverse proxy so secure cookies work over HTTPS
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new MemoryStore({ checkPeriod: 86400000 }), // prune expired every 24h
  secret: process.env.SESSION_SECRET || 'shark-exteriors-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // HTTPS-only on Railway
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

app.use('/api/auth',      require('./routes/auth'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/jobs',      require('./routes/jobs'));
app.use('/api/reports',   require('./routes/reports'));

app.use(express.static(path.join(__dirname, 'public')));

// Redirect unauthenticated HTML page requests to login
app.get(/^(?!\/api).*$/, (req, res, next) => {
  if (req.path === '/login.html') return next();
  if (!req.session.userId) return res.redirect('/login.html');
  next();
}, express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Shark Exteriors Payroll running on http://localhost:${PORT}`);
});
