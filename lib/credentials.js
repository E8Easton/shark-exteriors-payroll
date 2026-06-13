/** Derive default login from full name: username = first name, password = last name */
function credentialsFromName(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1] : first;
  return {
    username: first.toLowerCase(),
    password: last.toLowerCase(),
  };
}

module.exports = { credentialsFromName };
