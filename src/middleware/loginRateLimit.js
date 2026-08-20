const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function loginRateLimit(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const record = attempts.get(key);

  if (!record || now - record.startedAt >= WINDOW_MS) {
    attempts.set(key, { startedAt: now, count: 1 });
    return next();
  }
  if (record.count >= MAX_ATTEMPTS) {
    return res.status(429).render('login', { error: 'ลองเข้าสู่ระบบมากเกินไป กรุณารอ 15 นาทีแล้วลองใหม่' });
  }
  record.count += 1;
  next();
}

module.exports = { loginRateLimit };
