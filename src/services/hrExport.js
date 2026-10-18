/**
 * Monthly HR pack (one .xlsx, four sheets) for HR / finance:
 *   สรุปรายเดือน — per person: days present, late, absent, leave by type, OT hours, mobile scans
 *   ปฏิทินรายวัน — day grid with the usual codes (✓ มา · ส สาย · ข ขาด · ล ลา)
 *   OT          — approved OT requests
 *   ใบลา         — approved leave requests overlapping the month
 * Numbers come from the same sources as the monthly report (incident_logs, hikvision, leaves).
 */
const ExcelJS = require('exceljs');
const { pool, hosofficePool, STAFF } = require('../config/db');
const { approvedLeaveMap, leaveFor } = require('./leaveCalendar');
const { getHolidaySet } = require('./holidays');
const { LEAVE_TYPES } = require('../constants/leave');
const { toDateKey } = require('../utils/attendanceTime');
const { getOtRates, priceOt } = require('./otPay');

const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const ACTIVE = "('01', '02', '03', '04', '09')";
const COLORS = {
  head: 'FF581C87', headText: 'FFFFFFFF', title: 'FF3B0764', sub: 'FF64748B', zebra: 'FFFAF5FF', total: 'FFF3E8FF',
  ok: 'FFD1FAE5', late: 'FFFEF3C7', absent: 'FFFEE2E2', leave: 'FFDBEAFE', off: 'FFF1F5F9'
};

/** Map a HOSoffice leave code / app leave label to a leave bucket. */
function leaveBucket(text) {
  const t = String(text || '');
  if (/ป่วย/.test(t)) return 'sick';
  if (/กิจ/.test(t)) return 'personal';
  if (/พักผ่อน|พักร้อน/.test(t)) return 'vacation';
  return 'other';
}

/** Collect everything for the month. Exported for tests. */
async function collect({ year, month, department }) {
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const from = `${ym}-01`;
  const to = `${ym}-${String(daysInMonth).padStart(2, '0')}`;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });

  const params = [];
  let filter = '';
  if (department) { filter = ' AND d.HR_DEPARTMENT_NAME = ?'; params.push(department); }
  const [people] = await hosofficePool.query(
    `SELECT p.ID, p.FINGLE_ID AS fingle, p.HR_CID AS cid, CONCAT(p.HR_FNAME, ' ', p.HR_LNAME) AS name,
            COALESCE(d.HR_DEPARTMENT_NAME, '-') AS dept, COALESCE(s.HR_STATUS_NAME, '-') AS status
     FROM ${STAFF} p
     LEFT JOIN hr_department d ON d.HR_DEPARTMENT_ID = p.HR_DEPARTMENT_ID
     LEFT JOIN hr_status s ON s.HR_STATUS_ID = p.HR_STATUS_ID
     WHERE p.HR_STATUS_ID IN ${ACTIVE} AND p.FINGLE_ID IS NOT NULL AND p.FINGLE_ID <> ''${filter}
     ORDER BY d.HR_DEPARTMENT_ID, p.FINGLE_ID`, params);

  const [scanRows] = await hosofficePool.query(
    `SELECT EmployeeID, DATE_FORMAT(AccessDate, '%Y-%m-%d') AS d, SUM(AuthenticationType = 'MobileFace') AS mobile
     FROM hikvision WHERE AccessDate BETWEEN ? AND ? GROUP BY EmployeeID, AccessDate`, [from, to]);
  const present = new Set(scanRows.map(r => `${r.EmployeeID}|${r.d}`));
  const mobile = {};
  scanRows.forEach(r => { mobile[r.EmployeeID] = (mobile[r.EmployeeID] || 0) + Number(r.mobile || 0); });

  const [incRows] = await pool.query(
    'SELECT employee_id, incident_date, incident_type FROM incident_logs WHERE incident_date BETWEEN ? AND ?', [from, to]);
  const incidents = new Map(incRows.map(r => [`${r.employee_id}|${toDateKey(r.incident_date)}|${r.incident_type}`, true]));

  const dayCols = Array.from({ length: 31 }, (_, i) => `di${i + 1}`).join(', ');
  const [hosLeaves] = await hosofficePool.query(
    `SELECT hr_person_id, ${dayCols} FROM service_work_scans_morning WHERE year_and_month = ?`, [ym]).catch(() => [[]]);
  const hosLeave = {};
  hosLeaves.forEach(r => { hosLeave[r.hr_person_id] = r; });

  const appLeaves = await approvedLeaveMap(from, to);
  const holidays = await getHolidaySet(from, to);

  const [otAll] = await pool.query(
    `SELECT id, employee_id, fullname, dept, DATE_FORMAT(work_date, '%Y-%m-%d') AS work_date, start_time, end_time, hours, reason, reviewer
     FROM ot_requests WHERE status = 'approved' AND work_date BETWEEN ? AND ? ORDER BY work_date, employee_id`, [from, to]);
  // Only OT of the people in this report (the department filter applies here too)
  const statusByEmp = {};
  people.forEach(p => { [p.fingle, p.cid].filter(Boolean).forEach(k => { statusByEmp[k] = p.status; }); });
  const ot = otAll.filter(r => statusByEmp[r.employee_id] !== undefined);
  const priced = priceOt(ot, { rates: await getOtRates(), holidays, statusOf: emp => statusByEmp[emp] || null });
  ot.forEach(r => Object.assign(r, priced.lines.get(r.id)));
  const [leaves] = await pool.query(
    `SELECT employee_id, fullname, dept, leave_type, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
            DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date, half_day, days, reviewer
     FROM leave_requests WHERE status = 'approved' AND start_date <= ? AND end_date >= ? ORDER BY start_date, employee_id`, [to, from]);

  const otHours = {};
  const otPay = {};
  ot.forEach(r => {
    otHours[r.employee_id] = (otHours[r.employee_id] || 0) + Number(r.hours || 0);
    otPay[r.employee_id] = Math.round(((otPay[r.employee_id] || 0) + r.amount) * 100) / 100;
  });

  const rows = people.map(p => {
    const days = [];
    const counts = { present: 0, late: 0, absent: 0, sick: 0, personal: 0, vacation: 0, other: 0 };
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${ym}-${String(d).padStart(2, '0')}`;
      const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
      const off = dow === 0 || dow === 6 || holidays.has(date);
      if (date > today) { days.push({ code: '', kind: off ? 'off' : '' }); continue; }
      const hosCode = hosLeave[p.ID] && hosLeave[p.ID][`di${d}`];
      const hosIsLeave = hosCode && String(hosCode).trim() && !/^\d{2}:\d{2}/.test(String(hosCode));
      const app = leaveFor(appLeaves, [p.fingle, p.cid], date);
      const isPresent = present.has(`${p.fingle}|${date}`);
      if (isPresent) counts.present++;
      if (hosIsLeave || app) {
        counts[leaveBucket(hosIsLeave ? hosCode : app.label)] += app && app.halfDay && !hosIsLeave ? 0.5 : 1;
        days.push({ code: 'ล', kind: 'leave' });
      } else if (incidents.has(`${p.fingle}|${date}|ABSENT`)) {
        counts.absent++; days.push({ code: 'ข', kind: 'absent' });
      } else if (incidents.has(`${p.fingle}|${date}|LATE`)) {
        counts.late++; days.push({ code: 'ส', kind: 'late' });
      } else if (isPresent) {
        days.push({ code: '✓', kind: 'ok' });
      } else {
        days.push({ code: '', kind: off ? 'off' : '' });
      }
    }
    const leaveTotal = counts.sick + counts.personal + counts.vacation + counts.other;
    const otOf = m => (m[p.fingle] || 0) + (p.cid && p.cid !== p.fingle ? m[p.cid] || 0 : 0);
    return { ...p, days, counts, leaveTotal, ot: Math.round(otOf(otHours) * 10) / 10, otPay: Math.round(otOf(otPay) * 100) / 100, mobile: mobile[p.fingle] || 0 };
  });

  return { ym, year, month, daysInMonth, holidays, rows, ot, leaves };
}

function styleHeader(row) {
  row.eachCell(c => {
    c.font = { bold: true, color: { argb: COLORS.headText }, size: 11 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.head } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = { bottom: { style: 'thin', color: { argb: 'FF3B0764' } } };
  });
  row.height = 34;
}

function titleBlock(ws, title, sub, span) {
  ws.mergeCells(1, 1, 1, span);
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { bold: true, size: 15, color: { argb: COLORS.title } };
  ws.mergeCells(2, 1, 2, span);
  ws.getCell(2, 1).value = sub;
  ws.getCell(2, 1).font = { size: 10, color: { argb: COLORS.sub } };
  ws.addRow([]);
}

/** Build the workbook. Resolves to { buffer, filename }. */
async function buildHrWorkbook({ year, month, department, generatedBy }) {
  const data = await collect({ year, month, department });
  const monthTh = `${THAI_MONTHS[month - 1]} ${year + 543}`;
  const sub = `โรงพยาบาลคลองหาด · ${department || 'ทุกกลุ่มงาน'} · พิมพ์ ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}${generatedBy ? ` โดย ${generatedBy}` : ''}`;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KHH HRM';
  wb.created = new Date();
  const font = { name: 'Tahoma', size: 10 };

  /* ---- 1. Summary ---- */
  const s = wb.addWorksheet('สรุปรายเดือน', { views: [{ state: 'frozen', ySplit: 4, xSplit: 3 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const cols = [['ลำดับ', 6], ['รหัส', 11], ['ชื่อ-สกุล', 26], ['กลุ่มงาน', 24], ['ประเภทบุคลากร', 18], ['มาปฏิบัติงาน (วัน)', 11],
    ['มาสาย (ครั้ง)', 9], ['ขาด (วัน)', 9], ['ลาป่วย', 8], ['ลากิจ', 8], ['ลาพักผ่อน', 9], ['ลาอื่น ๆ', 8], ['รวมลา (วัน)', 9], ['OT (ชม.)', 9], ['ค่า OT (บาท)', 12], ['สแกนมือถือ (ครั้ง)', 10]];
  titleBlock(s, `สรุปการปฏิบัติงานประจำเดือน ${monthTh}`, sub, cols.length);
  styleHeader(s.addRow(cols.map(c => c[0])));
  cols.forEach(([, w], i) => { s.getColumn(i + 1).width = w; });
  data.rows.forEach((r, i) => {
    const row = s.addRow([i + 1, r.fingle, r.name, r.dept, r.status, r.counts.present, r.counts.late, r.counts.absent,
      r.counts.sick, r.counts.personal, r.counts.vacation, r.counts.other, r.leaveTotal, r.ot, r.otPay, r.mobile]);
    row.font = font;
    if (i % 2) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebra } }; });
    if (r.counts.absent) row.getCell(8).font = { ...font, bold: true, color: { argb: 'FFB91C1C' } };
    if (r.counts.late) row.getCell(7).font = { ...font, bold: true, color: { argb: 'FFB45309' } };
  });
  if (data.rows.length) {
    const first = 5, last = 4 + data.rows.length;
    const total = s.addRow(['', '', `รวม ${data.rows.length} คน`, '', '', ...'FGHIJKLMNOP'.split('').map(c => ({ formula: `SUM(${c}${first}:${c}${last})` }))]);
    total.font = { ...font, bold: true };
    total.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.total } }; });
    s.autoFilter = { from: { row: 4, column: 1 }, to: { row: last, column: cols.length } };
  }
  for (let c = 6; c <= cols.length; c++) s.getColumn(c).alignment = { horizontal: 'center' };
  s.getColumn(15).numFmt = '#,##0.00';

  /* ---- 2. Day grid ---- */
  const g = wb.addWorksheet('ปฏิทินรายวัน', { views: [{ state: 'frozen', ySplit: 5, xSplit: 3 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const span = 3 + data.daysInMonth + 4;
  titleBlock(g, `ปฏิทินการปฏิบัติงาน ${monthTh}`, sub, span);
  const legend = g.getRow(3);
  [['✓ มา', 'ok'], ['ส สาย', 'late'], ['ข ขาด', 'absent'], ['ล ลา', 'leave'], ['วันหยุด', 'off']].forEach(([label, kind], i) => {
    const c = legend.getCell(4 + i * 3);
    c.value = label;
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS[kind] } };
    c.font = { size: 9 };
  });
  const head = ['รหัส', 'ชื่อ-สกุล', 'กลุ่มงาน'];
  for (let d = 1; d <= data.daysInMonth; d++) head.push(d);
  head.push('มา', 'สาย', 'ขาด', 'ลา');
  g.addRow([]);
  const hr = g.addRow(head);
  styleHeader(hr);
  g.getColumn(1).width = 11; g.getColumn(2).width = 24; g.getColumn(3).width = 18;
  for (let d = 1; d <= data.daysInMonth; d++) {
    const date = `${data.ym}-${String(d).padStart(2, '0')}`;
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    g.getColumn(3 + d).width = 4;
    if (dow === 0 || dow === 6 || data.holidays.has(date)) hr.getCell(3 + d).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF94A3B8' } };
  }
  for (let i = 0; i < 4; i++) g.getColumn(4 + data.daysInMonth + i).width = 6;
  data.rows.forEach(r => {
    const row = g.addRow([r.fingle, r.name, r.dept, ...r.days.map(x => x.code), r.counts.present, r.counts.late, r.counts.absent, r.leaveTotal]);
    row.font = { ...font, size: 9 };
    r.days.forEach((x, i) => {
      const c = row.getCell(4 + i);
      c.alignment = { horizontal: 'center' };
      if (x.kind) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS[x.kind] } };
    });
    for (let i = 0; i < 4; i++) row.getCell(4 + data.daysInMonth + i).alignment = { horizontal: 'center' };
  });

  /* ---- 3. OT ---- */
  const o = wb.addWorksheet('OT', { views: [{ state: 'frozen', ySplit: 4 }] });
  const otCols = [['ลำดับ', 6], ['วันที่', 12], ['รหัส', 11], ['ชื่อ-สกุล', 26], ['กลุ่มงาน', 22], ['เวลา', 14], ['ชั่วโมง', 9],
    ['ประเภทวัน', 11], ['อัตรา (บาท/ชม.)', 11], ['ชม. ที่เบิกได้', 10], ['จำนวนเงิน (บาท)', 13], ['เหตุผล', 36], ['ผู้อนุมัติ', 20]];
  titleBlock(o, `การทำงานล่วงเวลา (อนุมัติแล้ว) ${monthTh}`, sub, otCols.length);
  styleHeader(o.addRow(otCols.map(c => c[0])));
  otCols.forEach(([, w], i) => { o.getColumn(i + 1).width = w; });
  data.ot.forEach((r, i) => {
    const row = o.addRow([i + 1, r.work_date, r.employee_id, r.fullname, r.dept || '-', `${r.start_time}–${r.end_time}`, Number(r.hours),
      r.dayType === 'holiday' ? 'วันหยุด' : 'วันทำการ', r.rate, r.paidHours, r.amount, r.reason, r.reviewer || '-']);
    row.font = font;
    // Hours above the daily cap are not paid: make that visible
    if (r.paidHours < Number(r.hours)) row.getCell(10).font = { ...font, bold: true, color: { argb: 'FFB45309' } };
  });
  o.getColumn(11).numFmt = '#,##0.00';
  if (data.ot.length) {
    const last = 4 + data.ot.length;
    const t = o.addRow(['', '', '', `รวม ${data.ot.length} รายการ`, '', '', { formula: `SUM(G5:G${last})` }, '', '', { formula: `SUM(J5:J${last})` }, { formula: `SUM(K5:K${last})` }]);
    t.font = { ...font, bold: true };
    o.addRow([]);
    o.addRow(['', 'หมายเหตุ: คำนวณตามอัตราในหน้าตั้งค่า → อัตราค่า OT · ชั่วโมงเกินเพดานต่อวันไม่นำมาคิดเงิน · กรุณาตรวจสอบกับงานการเงินก่อนเบิกจ่าย']).font = { size: 9, italic: true, color: { argb: COLORS.sub } };
  }

  /* ---- 4. Leave ---- */
  const l = wb.addWorksheet('ใบลา', { views: [{ state: 'frozen', ySplit: 4 }] });
  const lvCols = [['ลำดับ', 6], ['รหัส', 11], ['ชื่อ-สกุล', 26], ['กลุ่มงาน', 22], ['ประเภทการลา', 22], ['ตั้งแต่', 12], ['ถึง', 12], ['จำนวน (วัน)', 11], ['ผู้อนุมัติ', 22]];
  titleBlock(l, `ใบลาที่อนุมัติแล้ว ${monthTh}`, sub, lvCols.length);
  styleHeader(l.addRow(lvCols.map(c => c[0])));
  lvCols.forEach(([, w], i) => { l.getColumn(i + 1).width = w; });
  data.leaves.forEach((r, i) => {
    l.addRow([i + 1, r.employee_id, r.fullname, r.dept || '-', (LEAVE_TYPES[r.leave_type] || {}).label || r.leave_type,
      r.start_date, r.end_date, Number(r.days), r.reviewer || '-']).font = font;
  });

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `KHH-HRM_รายงานประจำเดือน_${year + 543}-${String(month).padStart(2, '0')}${department ? `_${department}` : ''}.xlsx`;
  return { buffer, filename, rows: data.rows.length };
}

module.exports = { buildHrWorkbook, collect, leaveBucket };
