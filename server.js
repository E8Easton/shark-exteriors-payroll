const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const FileStore = require('session-file-store')(session);
app.use(session({
  store: new FileStore({ path: path.join(__dirname, 'sessions'), ttl: 604800, reapInterval: 3600 }),
  secret: process.env.SESSION_SECRET || 'shark-exteriors-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

app.use('/api/auth',      require('./routes/auth'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/jobs',      require('./routes/jobs'));
app.use('/api/reports',   require('./routes/reports'));

app.use(express.static(path.join(__dirname, 'public')));

// Redirect unauthenticated HTML requests to login
app.get(/^(?!\/api).*$/, (req, res, next) => {
  if (req.path === '/login.html') return next();
  if (!req.session.userId) return res.redirect('/login.html');
  next();
}, express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Shark Exteriors Payroll running on http://localhost:${PORT}`);
});
