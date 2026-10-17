const { pool, hosofficePool } = require('../config/db');

const TIMEOUT_MS = 3000;
const startedAt = Date.now();

function withTimeout(promise) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS); })
  ]);
}

async function probe(p) {
  const t = Date.now();
  try {
    await withTimeout(p.query('SELECT 1'));
    return { ok: true, ms: Date.now() - t };
  } catch (err) {
    return { ok: false, ms: Date.now() - t, error: err.message === 'timeout' ? 'timeout' : 'unreachable' };
  }
}

/** Liveness/readiness for PM2, uptime monitors or a load balancer. No auth, no internal details. */
exports.health = async (req, res) => {
  const [hospital, hosoffice] = await Promise.all([probe(pool), probe(hosofficePool)]);
  const ok = hospital.ok && hosoffice.ok;
  res.setHeader('Cache-Control', 'no-store');
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    checks: { hospitalDb: hospital, hosofficeDb: hosoffice }
  });
};
