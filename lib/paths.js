const fs = require('fs');
const path = require('path');

function resolvePublicDir() {
  const candidates = [
    path.join(__dirname, 'public'),
    path.join(__dirname, '..', 'public'),
    path.join(process.cwd(), 'public'),
  ];
  return candidates.find((dir) => fs.existsSync(dir)) || candidates[0];
}

module.exports = { resolvePublicDir };
