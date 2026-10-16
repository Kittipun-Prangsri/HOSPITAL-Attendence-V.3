const { parseDate } = require('./leave');

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_OT_HOURS = 16;

const toMin = t => { const m = TIME_RE.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** [start, end) in minutes from the work date's midnight; an end at/before start rolls past midnight. */
function otInterval(start, end) {
  const s = toMin(start);
  const e = toMin(end);
  if (s == null || e == null) return null;
  return [s, e > s ? e : e + 1440];
}

const overlaps = (a, b) => a[0] < b[1] && b[0] < a[1];

function validateOtRequest(body) {
  const { work_date: workDate, start_time: startTime, end_time: endTime } = body || {};
  const reason = typeof (body && body.reason) === 'string' ? body.reason.trim() : '';
  if (!parseDate(workDate)) return { error: 'วันที่ไม่ถูกต้อง' };
  const iv = otInterval(startTime, endTime);
  if (!iv) return { error: 'เวลาเริ่ม/สิ้นสุดไม่ถูกต้อง (รูปแบบ HH:MM)' };
  const hours = Math.round(((iv[1] - iv[0]) / 60) * 10) / 10;
  if (hours < 0.5) return { error: 'OT ต้องไม่น้อยกว่า 30 นาที' };
  if (hours > MAX_OT_HOURS) return { error: `OT ต่อครั้งต้องไม่เกิน ${MAX_OT_HOURS} ชั่วโมง` };
  if (!reason) return { error: 'กรุณาระบุเหตุผล / งานที่ปฏิบัติ' };
  if (reason.length > 1000) return { error: 'เหตุผลยาวเกินไป' };
  return { value: { workDate, startTime, endTime, hours, reason, interval: iv } };
}

module.exports = { validateOtRequest, otInterval, overlaps, MAX_OT_HOURS };
