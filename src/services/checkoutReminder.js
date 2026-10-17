/**
 * Evening "forgot to scan out" reminder (working days only).
 * Office staff who scanned in today but have no scan in the afternoon get a personal Telegram
 * message, and admins get one Telegram summary. LINE is not used (metered push quota); staff on
 * LINE can still check with the free "สแกนล่าสุด" reply. People on leave today and anyone on the
 * duty roster today (their shift ends at another time) are skipped.
 */
const { pool, hosofficePool } = require('../config/db');
const { getHolidaySet } = require('./holidays');
const { approvedLeaveMap, leaveFor } = require('./leaveCalendar');
const { getWorkSettings } = require('./workSettings');

const toMin = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
const toHHMM = min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * Pure selection (unit-tested). An afternoon scan is any scan at or after `cutoff`
 * (default: two hours before work end), so a 13:00 lunch-time scan does not count as leaving.
 */
function findMissingCheckouts({ people, scans, rostered, onLeave, cutoff }) {
  return people.filter(p => {
    const s = scans[p.fingle];
    if (!s || !s.first) return false;                  // never came: that is an absence, not a missed checkout
    if (rostered.has(p.fingle) || onLeave.has(p.fingle)) return false;
    return String(s.last).slice(0, 5) < cutoff;
  });
}

const bkkDate = now => now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });

async function run({ now = new Date(), sendPersonal, sendAdmin } = {}) {
  const NotificationService = require('./notificationService');
  const personal = sendPersonal || ((chatId, msg) => NotificationService.sendDirectTelegram(chatId, msg));
  const admin = sendAdmin || (msg => (process.env.TELEGRAM_ADMIN_CHAT_ID ? NotificationService.sendDirectTelegram(process.env.TELEGRAM_ADMIN_CHAT_ID, msg) : false));

  const date = bkkDate(now);
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (dow === 0 || dow === 6 || (await getHolidaySet(date, date)).has(date)) return { skipped: 'not a working day', missing: [] };

  const settings = await getWorkSettings();
  const cutoff = toHHMM(Math.max(0, toMin(settings.workEnd || '16:00') - 120));

  // Office staff only (hiling template 1); shift workers are judged by their roster
  const [people] = await hosofficePool.query(
    `SELECT p.ID AS id, p.FINGLE_ID AS fingle, p.HR_CID AS cid, CONCAT(p.HR_FNAME, ' ', p.HR_LNAME) AS name,
            COALESCE(d.HR_DEPARTMENT_NAME, '-') AS dept
     FROM hr_person p
     LEFT JOIN hr_person_hiling_time h ON h.HR_PERSON_ID = p.ID
     LEFT JOIN hr_department d ON d.HR_DEPARTMENT_ID = p.HR_DEPARTMENT_ID
     WHERE p.HR_STATUS_ID IN ('01', '02', '03', '04', '09') AND p.FINGLE_ID IS NOT NULL AND p.FINGLE_ID <> ''
       AND COALESCE(h.TEMPLATE_ID, 1) <> 2`);
  const [scanRows] = await hosofficePool.query(
    `SELECT EmployeeID, TIME_FORMAT(MIN(AccessTime), '%H:%i') AS first, TIME_FORMAT(MAX(AccessTime), '%H:%i') AS last
     FROM hikvision WHERE AccessDate = ? AND (AuthenticationResult IS NULL OR AuthenticationResult <> 'Failed')
     GROUP BY EmployeeID`, [date]);
  const scans = Object.fromEntries(scanRows.map(r => [r.EmployeeID, r]));
  const links = await require('./messagingLinks').linksFor(people.map(p => p.id));
  people.forEach(p => { p.telegram = (links.get(String(p.id)) || {}).telegram || null; });
  const [rosterRows] = await pool.query('SELECT employee_id FROM schedule_entries WHERE schedule_date = ?', [date]);
  const rostered = new Set(rosterRows.map(r => r.employee_id));

  const appLeaves = await approvedLeaveMap(date, date);
  const day = Number(date.slice(8, 10));
  const [hos] = await hosofficePool.query(`SELECT hr_person_id, di${day} AS v FROM service_work_scans_morning WHERE year_and_month = ?`, [date.slice(0, 7)]).catch(() => [[]]);
  const hosLeave = new Set(hos.filter(r => r.v && String(r.v).trim() && !/^\d{2}:\d{2}/.test(String(r.v))).map(r => String(r.hr_person_id)));
  const onLeave = new Set(people.filter(p => hosLeave.has(String(p.id)) || leaveFor(appLeaves, [p.fingle, p.cid], date)).map(p => p.fingle));

  const missing = findMissingCheckouts({ people, scans, rostered, onLeave, cutoff });
  const base = (process.env.SYSTEM_URL || '').trim().replace(/\/+$/, '');
  let notified = 0;
  for (const p of missing) {
    if (!p.telegram || !/^-?\d+$/.test(String(p.telegram).trim())) continue;
    const ok = await personal(String(p.telegram).trim(),
      `🕔 ลืมสแกนออกหรือไม่?\nวันนี้พบการสแกนเข้า ${scans[p.fingle].first} น. แต่ยังไม่พบการสแกนออก\n` +
      `ถ้ายังอยู่ที่ทำงาน กรุณาสแกนออกก่อนกลับ หรือถ้าลืม แจ้งเหตุได้ที่${base ? ` ${base}/excuses` : 'เมนู "แจ้งสาเหตุการลงเวลา"'}`).catch(() => false);
    if (ok) notified++;
    await new Promise(r => setTimeout(r, sendPersonal ? 0 : 350)); // Telegram rate limit
  }
  if (missing.length) {
    const lines = missing.slice(0, 40).map(p => `• ${p.name} (${p.dept}) — เข้า ${scans[p.fingle].first}`);
    await admin(`🕔 ยังไม่สแกนออก ${missing.length} คน (${date})\n${lines.join('\n')}${missing.length > 40 ? `\n… และอีก ${missing.length - 40} คน` : ''}\nแจ้งเตือนรายบุคคลทาง Telegram แล้ว ${notified} คน`);
  }
  return { date, cutoff, missing: missing.map(p => p.fingle), notified };
}

/** "17:30" → cron "30 17 * * 1-5" (weekdays; holidays are checked inside run()). */
function cronFor(time = process.env.FORGOT_CHECKOUT_TIME || '17:30') {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time).trim());
  return m ? `${Number(m[2])} ${Number(m[1])} * * 1-5` : '30 17 * * 1-5';
}

module.exports = { run, findMissingCheckouts, cronFor };
