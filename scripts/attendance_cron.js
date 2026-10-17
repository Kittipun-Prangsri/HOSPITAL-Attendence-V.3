const cron = require('node-cron');
const { pool, hosofficePool } = require('../src/config/db');
const NotificationService = require('../src/services/notificationService');
const { syncIncidentsForMonth } = require('../src/controllers/apiController');
const { buildWeeklySummaryFlex } = require('../src/services/flexBuilder');

const ACTIVE_STATUS_IDS = ['01', '02', '03', '04', '09'];

function toDateOnlyUTC(ymdStr) {
  const [y, m, d] = ymdStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmtDateOnlyUTC(date) {
  return date.toISOString().slice(0, 10);
}

/** Monday–Sunday range (Asia/Bangkok) of the week containing `now` */
function getWeekRange(now = new Date()) {
  const todayStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const today = toDateOnlyUTC(todayStr);
  const dow = today.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today);
  monday.setUTCDate(monday.getUTCDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { start: fmtDateOnlyUTC(monday), end: fmtDateOnlyUTC(sunday) };
}

function monthKeysInRange(startStr, endStr) {
  const keys = [];
  let [y, m] = startStr.split('-').map(Number);
  const [ey, em] = endStr.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    keys.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return keys;
}

/** Count leave-marked days (per hr_person.ID) that fall within [startStr, endStr] */
async function getLeaveCounts(startStr, endStr) {
  const leaveCounts = {};
  for (const ym of monthKeysInRange(startStr, endStr)) {
    const [rows] = await hosofficePool.query(
      `SELECT hr_person_id,
              di1, di2, di3, di4, di5, di6, di7, di8, di9, di10,
              di11, di12, di13, di14, di15, di16, di17, di18, di19, di20,
              di21, di22, di23, di24, di25, di26, di27, di28, di29, di30, di31
       FROM service_work_scans_morning WHERE year_and_month = ?`,
      [ym]
    );
    const [y, m] = ym.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    for (const row of rows) {
      for (let d = 1; d <= daysInMonth; d += 1) {
        const dateStr = `${ym}-${String(d).padStart(2, '0')}`;
        if (dateStr < startStr || dateStr > endStr) continue;
        const val = row[`di${d}`];
        if (val && typeof val === 'string' && val.trim() !== '' && !/^\d{2}:\d{2}/.test(val)) {
          leaveCounts[row.hr_person_id] = (leaveCounts[row.hr_person_id] || 0) + 1;
        }
      }
    }
  }
  return leaveCounts;
}

function formatWeekRangeThai(startStr, endStr) {
  const fmt = (s) => new Date(`${s}T00:00:00Z`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `สัปดาห์ ${fmt(startStr)} - ${fmt(endStr)}`;
}

async function runWeeklySummary() {
  console.log('--- Executing Weekly Attendance Summary ---');
  try {
    const { start, end } = getWeekRange();

    // Keep incident_logs (late/absent) up to date for every month this week touches
    for (const ym of monthKeysInRange(start, end)) {
      const [y, m] = ym.split('-').map(Number);
      await syncIncidentsForMonth(y, m);
    }

    // Active employees with at least one notification channel linked
    const [employees] = await hosofficePool.query(`
      SELECT p.ID, p.FINGLE_ID, CONCAT(p.HR_FNAME, ' ', p.HR_LNAME) AS fullname,
             p.LINE_YOUR_USER_ID AS line_user_id, p.TELEGRAM_CHAT_ID AS telegram_chat_id
      FROM hr_person p
      WHERE p.HR_STATUS_ID IN (?)
        AND p.FINGLE_ID IS NOT NULL AND p.FINGLE_ID != ''
        AND (NULLIF(TRIM(p.LINE_YOUR_USER_ID), '') IS NOT NULL OR NULLIF(TRIM(p.TELEGRAM_CHAT_ID), '') IS NOT NULL)
    `, [ACTIVE_STATUS_IDS]);

    if (employees.length === 0) {
      console.log('[WeeklySummary] No employees with a linked LINE/Telegram contact. Nothing to send.');
      return;
    }

    // Days present + hours worked, from real scan data
    const [scans] = await hosofficePool.query(`
      SELECT EmployeeID, AccessDate, MIN(AccessTime) AS time_in, MAX(AccessTime) AS time_out
      FROM hikvision
      WHERE AccessDate BETWEEN ? AND ?
      GROUP BY EmployeeID, AccessDate
    `, [start, end]);

    const presenceByEmployee = {};
    for (const row of scans) {
      if (!presenceByEmployee[row.EmployeeID]) presenceByEmployee[row.EmployeeID] = { daysPresent: 0, totalMinutes: 0 };
      const bucket = presenceByEmployee[row.EmployeeID];
      bucket.daysPresent += 1;
      if (row.time_in && row.time_out && row.time_in !== row.time_out) {
        const [inH, inM] = row.time_in.split(':').map(Number);
        const [outH, outM] = row.time_out.split(':').map(Number);
        if (!Number.isNaN(inH) && !Number.isNaN(outH)) {
          let minutes = (outH * 60 + outM) - (inH * 60 + inM);
          if (minutes < 0) minutes += 24 * 60;
          bucket.totalMinutes += minutes;
        }
      }
    }

    // Late/absent counts, from the same incident engine the monthly report uses
    const [incidents] = await pool.query(`
      SELECT employee_id, incident_type, COUNT(*) AS cnt
      FROM incident_logs
      WHERE incident_date BETWEEN ? AND ? AND incident_type IN ('LATE', 'ABSENT')
      GROUP BY employee_id, incident_type
    `, [start, end]);

    const incidentByEmployee = {};
    for (const row of incidents) {
      if (!incidentByEmployee[row.employee_id]) incidentByEmployee[row.employee_id] = { LATE: 0, ABSENT: 0 };
      incidentByEmployee[row.employee_id][row.incident_type] = Number(row.cnt);
    }

    const leaveCounts = await getLeaveCounts(start, end);
    const weekRangeStr = formatWeekRangeThai(start, end);
    const historyUrl = process.env.SYSTEM_URL ? `${process.env.SYSTEM_URL}/attendance` : null;

    let sentCount = 0;
    for (const emp of employees) {
      const presence = presenceByEmployee[emp.FINGLE_ID] || { daysPresent: 0, totalMinutes: 0 };
      const incident = incidentByEmployee[emp.FINGLE_ID] || { LATE: 0, ABSENT: 0 };
      const leaveCount = leaveCounts[emp.ID] || 0;
      const totalHours = (presence.totalMinutes / 60).toFixed(1);

      const message = `📊 *สรุปการทำงานประจำสัปดาห์*\n\n` +
                      `👤 ${emp.fullname}\n` +
                      `📅 ${weekRangeStr}\n\n` +
                      `✅ มาทำงาน: ${presence.daysPresent} วัน\n` +
                      `⏰ มาสาย: ${incident.LATE} ครั้ง\n` +
                      `❌ ขาดงาน: ${incident.ABSENT} วัน\n` +
                      `🏖️ ลา: ${leaveCount} วัน\n` +
                      `🕒 ชั่วโมงทำงานรวม: ${totalHours} ชม.`;

      const flexContents = buildWeeklySummaryFlex({
        fullname: emp.fullname,
        employeeId: emp.FINGLE_ID,
        weekRangeStr,
        daysPresent: presence.daysPresent,
        lateCount: incident.LATE,
        absentCount: incident.ABSENT,
        leaveCount,
        totalHours,
        historyUrl
      });

      const result = await NotificationService.sendDirectNotification(
        NotificationService.routineLineId(emp.line_user_id), // weekly summary is routine traffic
        emp.telegram_chat_id,
        message,
        {},
        flexContents
      );
      if (result.success) sentCount += 1;
    }

    console.log(`[WeeklySummary] Sent to ${sentCount}/${employees.length} employees for ${start} – ${end}.`);
  } catch (error) {
    console.error('Error in Weekly Attendance Summary:', error);
  }
}

// Schedule: Every Friday at 17:00
// Weekday mornings: remind admins about approvals waiting more than 2 days
cron.schedule('30 8 * * 1-5', async () => {
  try {
    const { collectStalePending, formatEscalation, DEFAULT_DAYS } = require('../src/services/pendingEscalation');
    const message = formatEscalation(await collectStalePending(DEFAULT_DAYS), DEFAULT_DAYS, process.env.SYSTEM_URL || '');
    if (message) {
      const NotificationService = require('../src/services/notificationService');
      await NotificationService.sendToAdmin(message);
      console.log('[cron] pending-approval escalation sent');
    }
  } catch (err) {
    console.error('[cron] escalation failed:', err.message);
  }
}, { timezone: process.env.APP_TIMEZONE || 'Asia/Bangkok' });

// Nightly: keep incident_logs current for this and last month so report views stay fast
cron.schedule('0 1 * * *', async () => {
  const now = new Date();
  const months = [[now.getFullYear(), now.getMonth() + 1]];
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  months.push([prev.getFullYear(), prev.getMonth() + 1]);
  for (const [y, m] of months) {
    try {
      await syncIncidentsForMonth(y, m);
      console.log(`[cron] incidents synced for ${y}-${String(m).padStart(2, '0')}`);
    } catch (err) {
      console.error(`[cron] incident sync failed for ${y}-${m}:`, err.message);
    }
  }
}, { timezone: process.env.APP_TIMEZONE || 'Asia/Bangkok' });

// Nightly 02:00: delete mobile-scan photos older than the configured retention (PDPA data minimisation)
cron.schedule('0 2 * * *', async () => {
  try {
    const { purgeOldScanPhotos } = require('../src/services/mobileScanRetention');
    const n = await purgeOldScanPhotos();
    if (n) console.log(`[cron] removed ${n} mobile-scan photos past retention`);
  } catch (err) {
    console.error('[cron] scan photo purge failed:', err.message);
  }
}, { timezone: process.env.APP_TIMEZONE || 'Asia/Bangkok' });

// Every 10 min: is the Hikvision feed still arriving? (alerts on silence / recovery)
cron.schedule('*/10 * * * *', async () => {
  try { await require('../src/services/scannerWatch').check(); }
  catch (err) { console.error('[cron] scanner watch failed:', err.message); }
}, { timezone: process.env.APP_TIMEZONE || 'Asia/Bangkok' });

// Every 5 min: database reachability (alerts after two failures, and on recovery)
cron.schedule('*/5 * * * *', async () => {
  try { await require('../src/services/healthWatch').check(); }
  catch (err) { console.error('[cron] health watch failed:', err.message); }
}, { timezone: process.env.APP_TIMEZONE || 'Asia/Bangkok' });

// Nightly 03:00: database backup to BACKUP_DIR (gzip SQL, kept BACKUP_KEEP_DAYS days)
cron.schedule('0 3 * * *', async () => {
  try {
    const { files, removed } = await require('../src/services/dbBackup').runBackup();
    console.log(`[cron] backup ok: ${files.map(f => `${f.file} (${Math.round(f.bytes / 1024)} KB)`).join(', ')}${removed ? `, pruned ${removed}` : ''}`);
  } catch (err) {
    console.error('[cron] backup failed:', err.message);
    await NotificationService.sendToAdmin(`🚨 สำรองฐานข้อมูลประจำคืนไม่สำเร็จ\n${err.message}`).catch(() => {});
  }
}, { timezone: process.env.APP_TIMEZONE || 'Asia/Bangkok' });

// Working-day evenings (FORGOT_CHECKOUT_TIME, default 17:30): remind office staff who did not scan out
{
  const checkout = require('../src/services/checkoutReminder');
  cron.schedule(checkout.cronFor(), async () => {
    try {
      const r = await checkout.run();
      if (!r.skipped) console.log(`[cron] checkout reminder ${r.date}: ${r.missing.length} missing, ${r.notified} notified`);
    } catch (err) {
      console.error('[cron] checkout reminder failed:', err.message);
    }
  }, { timezone: process.env.APP_TIMEZONE || 'Asia/Bangkok' });
}

cron.schedule('0 17 * * 5', () => {
  runWeeklySummary();
}, {
  scheduled: true,
  timezone: "Asia/Bangkok"
});

console.log('Attendance cron initialized: incident sync 01:00, scan-photo purge 02:00, backup 03:00, escalation 08:30 Mon–Fri, checkout reminder 17:30 Mon–Fri, weekly summary Fri 17:00, scanner watch /10min, DB watch /5min');

module.exports = { runWeeklySummary };

if (require.main === module) {
  if (process.argv.includes('--test')) {
    runWeeklySummary().then(() => process.exit(0));
  }
}
