/**
 * Watches the Hikvision feed. In Dec 2025 no scans reached hosoffice.hikvision for three weeks and nobody
 * noticed until the absence report was wrong. During working hours on working days this alerts admins
 * once when the feed (or a normally busy device) goes quiet, and once when it comes back.
 * Mobile face scans are excluded: they say nothing about the devices or the import job.
 */
const { hosofficePool } = require('../config/db');
const { getHolidaySet } = require('./holidays');

const config = () => {
  const [from, to] = String(process.env.SCANNER_WATCH_HOURS || '07:30-16:30').split('-');
  return {
    silenceMin: Math.max(10, Number(process.env.SCANNER_SILENCE_MINUTES) || 45),
    from: /^\d{2}:\d{2}$/.test(from) ? from : '07:30',
    to: /^\d{2}:\d{2}$/.test(to) ? to : '16:30',
    // a device counts as "busy" (worth watching on its own) with at least this many scans in 7 days
    busyWeekly: Math.max(1, Number(process.env.SCANNER_BUSY_WEEKLY) || 50)
  };
};

const DEVICE_SCAN = "(AuthenticationType IS NULL OR AuthenticationType NOT IN ('MobileFace', 'API'))";

const bkk = now => ({
  date: now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }),
  hm: now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour12: false, hour: '2-digit', minute: '2-digit' }),
  dow: new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })).getDay()
});
const toMs = s => (s ? new Date(`${String(s).replace(' ', 'T')}+07:00`).getTime() : null);
const minutesSince = (now, s) => (s ? Math.floor((now.getTime() - toMs(s)) / 60000) : null);

/** Working day (Mon–Fri, not a public holiday) and inside the watch window. */
function isWatchTime(now, holidays, cfg = config()) {
  const t = bkk(now);
  return t.dow >= 1 && t.dow <= 5 && !holidays.has(t.date) && t.hm >= cfg.from && t.hm <= cfg.to;
}

/**
 * Pure evaluation (unit-tested).
 * overallLast: 'YYYY-MM-DD HH:MM:SS' of the newest device scan (any day) or null
 * devices: [{ name, last: 'YYYY-MM-DD HH:MM:SS'|null (today), weekCount }]
 * Silence is measured from the later of the last scan and the start of today's window, so a quiet
 * night does not count as an outage at 07:31.
 */
function evaluate({ now, watching, cfg, overallLast, devices }) {
  if (!watching) return { overallSilent: false, silentDevices: [] };
  const t = bkk(now);
  const windowStart = `${t.date} ${cfg.from}:00`;
  const since = s => minutesSince(now, !s || s < windowStart ? windowStart : s);
  const overallSilent = since(overallLast) >= cfg.silenceMin;
  // A single busy device going quiet (e.g. one entrance offline) — allow it twice the time
  const silentDevices = overallSilent ? [] : devices
    .filter(d => d.weekCount >= cfg.busyWeekly && since(d.last) >= cfg.silenceMin * 2)
    .map(d => d.name);
  return { overallSilent, silentDevices };
}

async function readFeed(now) {
  const { date } = bkk(now);
  const nowStamp = `${date} ${now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour12: false })}`;
  // Only scans up to "now": a clock-skewed device row in the future must not hide an outage
  const [[overall]] = await hosofficePool.query(
    `SELECT DATE_FORMAT(MAX(TIMESTAMP(AccessDate, AccessTime)), '%Y-%m-%d %H:%i:%s') AS last
     FROM hikvision WHERE AccessDate BETWEEN DATE_SUB(?, INTERVAL 7 DAY) AND ? AND TIMESTAMP(AccessDate, AccessTime) <= ? AND ${DEVICE_SCAN}`,
    [date, date, nowStamp]);
  const [devices] = await hosofficePool.query(
    `SELECT COALESCE(NULLIF(DeviceName, ''), '(ไม่ระบุชื่อเครื่อง)') AS name, COUNT(*) AS weekCount,
            DATE_FORMAT(MAX(CASE WHEN AccessDate = ? AND TIMESTAMP(AccessDate, AccessTime) <= ? THEN TIMESTAMP(AccessDate, AccessTime) END), '%Y-%m-%d %H:%i:%s') AS last
     FROM hikvision WHERE AccessDate >= DATE_SUB(?, INTERVAL 7 DAY) AND AccessDate <= ? AND ${DEVICE_SCAN}
     GROUP BY name ORDER BY weekCount DESC LIMIT 30`, [date, nowStamp, date, date]);
  return { overallLast: overall.last, devices: devices.map(d => ({ name: d.name, last: d.last, weekCount: Number(d.weekCount) })) };
}

const hm = s => (s ? String(s).slice(11, 16) : '—');
let state = { overallSilent: false, silentSince: null, silentDevices: new Set(), lastCheck: null, feed: null };

/** Run one check; sends alerts on state changes. notify(message) defaults to the admin channels. */
async function check({ now = new Date(), notify } = {}) {
  const cfg = config();
  const send = notify || (msg => require('./notificationService').sendToAdmin(msg));
  const { date } = bkk(now);
  const holidays = await getHolidaySet(date, date);
  const watching = isWatchTime(now, holidays, cfg);
  const feed = await readFeed(now);
  const r = evaluate({ now, watching, cfg, ...feed });
  const base = (process.env.SYSTEM_URL || '').trim().replace(/\/+$/, '');
  const link = base.startsWith('http') ? `\nถ้าข้อมูลช่วงนี้หายจริง บันทึกช่วงขัดข้องได้ที่ ${base}/admin/calendar (แท็บเครื่องสแกนขัดข้อง)` : '';

  if (r.overallSilent && !state.overallSilent) {
    state.silentSince = feed.overallLast;
    await send(`⚠️ ไม่มีข้อมูลสแกนจากเครื่อง Hikvision เข้าระบบ\nสแกนล่าสุด: ${feed.overallLast || 'ไม่พบใน 7 วัน'} (${minutesSince(now, feed.overallLast) ?? '—'} นาทีที่แล้ว)\n` +
      'ตรวจสอบ: เครื่องสแกนเปิดอยู่/มีเครือข่ายหรือไม่ และโปรแกรมดึงข้อมูลเข้า hosoffice ยังทำงานอยู่หรือไม่');
  } else if (!r.overallSilent && state.overallSilent && feed.overallLast && feed.overallLast > (state.silentSince || '')) {
    await send(`✅ ข้อมูลสแกนกลับมาเข้าระบบแล้ว\nเงียบไปตั้งแต่ ${hm(state.silentSince)} ถึง ${hm(feed.overallLast)}${link}`);
    state.silentSince = null;
  }
  // Per-device alerts only while the feed as a whole is alive (when everything is down, one alert is enough)
  if (!r.overallSilent) {
    const nowSilent = new Set(r.silentDevices);
    const newly = [...nowSilent].filter(d => !state.silentDevices.has(d));
    // Outside the watch window evaluate() reports nothing; that is "not watching", not "recovered"
    const back = watching ? [...state.silentDevices].filter(d => !nowSilent.has(d)) : [];
    if (newly.length) {
      const lines = newly.map(n => { const d = feed.devices.find(x => x.name === n); return `• ${n} — สแกนล่าสุดวันนี้ ${hm(d && d.last)}`; });
      await send(`⚠️ เครื่องสแกนบางเครื่องเงียบผิดปกติ\n${lines.join('\n')}\nเครื่องอื่นยังมีการสแกนตามปกติ`);
    }
    if (back.length) await send(`✅ เครื่องสแกนกลับมาทำงาน: ${back.join(', ')}`);
    state.silentDevices = nowSilent;
  }
  state.overallSilent = r.overallSilent;
  state.lastCheck = now;
  state.feed = feed;
  return { watching, ...r, feed };
}

/** Snapshot for the admin status panel (no alerts). */
async function status(now = new Date()) {
  const cfg = config();
  const { date } = bkk(now);
  const feed = await readFeed(now);
  const watching = isWatchTime(now, await getHolidaySet(date, date), cfg);
  return {
    watching, ...evaluate({ now, watching, cfg, ...feed }),
    lastScan: feed.overallLast, minutesSince: minutesSince(now, feed.overallLast),
    devices: feed.devices.slice(0, 8), window: `${cfg.from}–${cfg.to}`, silenceMin: cfg.silenceMin
  };
}

function _reset() { state = { overallSilent: false, silentSince: null, silentDevices: new Set(), lastCheck: null, feed: null }; }

module.exports = { check, status, evaluate, isWatchTime, config, _reset };
