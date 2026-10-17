#!/usr/bin/env node
/**
 * Rebuild incident_logs (late / absent / overdue) for a range of months.
 * Needed once after the AccessDate fix: earlier syncs counted every workday as ABSENT.
 *
 *   npm run rebuild-incidents -- --from 2026-01 --to 2026-10            # dry run: show current counts
 *   npm run rebuild-incidents -- --from 2026-01 --to 2026-10 --confirm  # delete + resync
 *   node scripts/rebuild_incidents.js 2026-01 2026-10                     # same, positional (PowerShell)
 */
require('dotenv').config();
process.env.TZ = process.env.APP_TIMEZONE || 'Asia/Bangkok';
const { rebuildIncidents } = require('../src/services/incidentRebuild');
const { syncIncidentsForMonth } = require('../src/controllers/apiController');
const { pool, hosofficePool } = require('../src/config/db');

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };
// Windows PowerShell's npm shim strips `--from`/`--to`, leaving bare months: accept those too.
const positional = process.argv.slice(2).filter(a => /^\d{4}-\d{2}$/.test(a));

(async () => {
  const from = arg('from') || positional[0];
  const to = arg('to') || positional[1] || from;
  const confirm = process.argv.includes('--confirm');
  try {
    const results = await rebuildIncidents({ from, to, dryRun: !confirm, syncFn: syncIncidentsForMonth });
    console.table(results);
    console.log(confirm ? '✅ Rebuilt.' : 'ℹ️  Dry run only — add --confirm to delete and resync these months.');
    process.exitCode = 0;
  } catch (err) {
    console.error('❌', err.message);
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([pool.end(), hosofficePool.end()]);
  }
})();
