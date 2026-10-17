const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

// Keyed by IP + username so staff behind one NAT/proxy address don't lock each other out,
// and only failed attempts count (a successful login redirects with 302 and clears the record).
function keyOf(req) {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  const username = String((req.body && req.body.username) || '').trim().toLowerCase().slice(0, 50);
  return `${ip}|${username}`;
}

function loginRateLimit(req, res, next) {
  const key = keyOf(req);
  const now = Date.now();
  const record = attempts.get(key);
  if (record && now - record.startedAt >= WINDOW_MS) attempts.delete(key);

  const current = attempts.get(key);
  if (current && current.count >= MAX_ATTEMPTS) {
    return res.status(429).render('login', { error: 'ลองเข้าสู่ระบบผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่' });
  }

  res.on('finish', () => {
    if (res.statusCode === 302) {
      attempts.delete(key);
      return;
    }
    const r = attempts.get(key);
    if (r) r.count += 1;
    else attempts.set(key, { startedAt: Date.now(), count: 1 });
  });
  next();
}

function _reset() { attempts.clear(); }

module.exports = { loginRateLimit, MAX_ATTEMPTS, _reset };
