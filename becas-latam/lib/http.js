const crypto = require("crypto");

function body(req) {
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  return b && typeof b === "object" ? b : {};
}

function sameSecret(given, expected) {
  if (!given || !expected) return false;
  const a = crypto.createHash("sha256").update(String(given)).digest();
  const b = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

// El panel manda la clave en el encabezado x-crm-key.
function isAdmin(req) {
  return sameSecret(req.headers["x-crm-key"], process.env.CRM_PASSWORD);
}

module.exports = { body, sameSecret, isAdmin };
