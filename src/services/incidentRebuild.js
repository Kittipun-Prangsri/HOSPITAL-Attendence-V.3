const { pool } = require('../config/db');

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthsBetween(from, to) {
  if (!YM_RE.test(from) || !YM_RE.test(to) || from > to) throw new Error('Use --from YYYY-MM --to YYYY-MM (from ≤ to)');
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push([y, m]);
    if (++m > 12) { m = 1; y++; }
    if (out.length > 36) throw new Error('At most 36 months per run');
  }
  return out;
}

/**
 * Delete and recompute incident_logs for each month. Incident rows are derived data
 * (scans + schedule + approved excuses/leave), so nothing is lost by rebuilding them.
 * @returns per-month { month, before, after }
 */
async function rebuildIncidents({ from, to, dryRun = true, syncFn }) {
  const results = [];
  for (const [y, m] of monthsBetween(from, to)) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    const range = [`${ym}-01`, `${ym}-01`];
    const [[{ n: before }]] = await pool.query(
      'SELECT COUNT(*) AS n FROM incident_logs WHERE incident_date >= ? AND incident_date < DATE_ADD(?, INTERVAL 1 MONTH)', range);
    if (dryRun) { results.push({ month: ym, before: Number(before), after: null }); continue; }
    await pool.query('DELETE FROM incident_logs WHERE incident_date >= ? AND incident_date < DATE_ADD(?, INTERVAL 1 MONTH)', range);
    await syncFn(y, m);
    const [[{ n: after }]] = await pool.query(
      'SELECT COUNT(*) AS n FROM incident_logs WHERE incident_date >= ? AND incident_date < DATE_ADD(?, INTERVAL 1 MONTH)', range);
    results.push({ month: ym, before: Number(before), after: Number(after) });
  }
  return results;
}

module.exports = { rebuildIncidents, monthsBetween };
