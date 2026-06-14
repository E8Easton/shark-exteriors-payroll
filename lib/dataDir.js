const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function canWrite(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const testFile = path.join(dir, '.write_test');
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    return true;
  } catch {
    return false;
  }
}

/** Prefer Fly volume /data; fall back to ./data locally or if volume is not mounted yet. */
function resolveDataDir() {
  if (process.env.DATA_DIR && canWrite(process.env.DATA_DIR)) {
    return process.env.DATA_DIR;
  }

  const onFly = Boolean(process.env.FLY_APP_NAME || process.env.FLY_MACHINE_ID);
  if (onFly && canWrite('/data')) return '/data';

  const local = path.join(__dirname, '..', 'data');
  if (canWrite(local)) return local;
  return path.join(__dirname, '..');
}

function resolveSessionSecret(dataDir) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;

  const secretFile = path.join(dataDir, '.session_secret');
  if (fs.existsSync(secretFile)) {
    return fs.readFileSync(secretFile, 'utf8').trim();
  }

  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  console.log(`Created SESSION_SECRET at ${secretFile}`);
  return secret;
}

module.exports = { resolveDataDir, resolveSessionSecret };
