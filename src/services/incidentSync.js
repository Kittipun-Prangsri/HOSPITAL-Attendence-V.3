/**
 * Throttles incident_logs syncing triggered by report views.
 * A month is synced at most once per TTL, concurrent requests share one run,
 * and writes that change the outcome (excuse/leave approvals, holidays) mark the month stale.
 */
const TTL_MS = 10 * 60 * 1000;
const state = new Map(); // 'YYYY-MM' → { at, promise }

const keyOf = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

async function ensureIncidentsSynced(year, month, syncFn, now = Date.now) {
  const key = keyOf(year, month);
  const entry = state.get(key);
  if (entry && entry.promise) return entry.promise;
  if (entry && now() - entry.at < TTL_MS) return undefined;
  const promise = Promise.resolve()
    .then(() => syncFn(year, month))
    .then(() => { state.set(key, { at: now(), promise: null }); })
    .catch(err => { state.delete(key); throw err; });
  state.set(key, { at: 0, promise });
  return promise;
}

/** Accepts 'YYYY-MM-DD' / 'YYYY-MM' strings, or a { from, to } date range. */
function markIncidentsStale(target) {
  const months = new Set();
  if (target && typeof target === 'object' && target.from && target.to) {
    const [fy, fm] = target.from.split('-').map(Number);
    const [ty, tm] = target.to.split('-').map(Number);
    for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? (y++, m = 1) : m++) months.add(keyOf(y, m));
  } else if (typeof target === 'string' && /^\d{4}-\d{2}/.test(target)) {
    months.add(target.slice(0, 7));
  } else if (target instanceof Date) {
    months.add(keyOf(target.getFullYear(), target.getMonth() + 1));
  }
  months.forEach(k => { const e = state.get(k); if (e && !e.promise) state.delete(k); });
}

function _reset() { state.clear(); }

module.exports = { ensureIncidentsSynced, markIncidentsStale, TTL_MS, _reset };
