const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Machine-to-machine endpoints without a browser session (scanner push); LINE webhook lives outside /api
const EXEMPT_PATHS = [/^\/api\/attendance\/?$/];

function tokenFor(req) {
  if (!req.session || !req.session.user) return null;
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

function sameToken(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Synchronizer-token CSRF protection for state-changing /api calls made by signed-in users.
 * The token is exposed to views as res.locals.csrfToken (rendered into <meta name="csrf-token">)
 * and sent back by the fetch wrapper in public/js/erp-ui.js as the X-CSRF-Token header.
 */
function csrfProtection(req, res, next) {
  const token = tokenFor(req);
  res.locals.csrfToken = token || '';
  if (SAFE_METHODS.has(req.method)) return next();
  if (!req.path.startsWith('/api/') || EXEMPT_PATHS.some(re => re.test(req.path))) return next();
  if (!token) return next(); // not signed in: checkAuth on the route rejects it
  const sent = req.get('x-csrf-token') || (req.body && req.body._csrf);
  if (!sameToken(sent, token)) {
    return res.status(403).json({ success: false, error: 'เซสชันหมดอายุหรือคำขอไม่ถูกต้อง กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง' });
  }
  next();
}

module.exports = { csrfProtection, sameToken };
