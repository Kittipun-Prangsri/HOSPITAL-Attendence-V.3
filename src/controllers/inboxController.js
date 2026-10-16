const { pool } = require('../config/db');
const { LEAVE_TYPES } = require('../constants/leave');

const isReviewer = user => user && (user.role === 'admin' || user.role === 'super');
const RECENT_DAYS = 14;

// Each source is isolated so one missing table (e.g. migration not yet run) doesn't empty the inbox
async function safe(fn, fallback) {
  try { return await fn(); } catch (err) { console.warn('[inbox]', err.message); return fallback; }
}

/** Aggregated notification inbox for the topbar bell. */
exports.getInbox = async (req, res) => {
  const user = req.session.user;
  const items = [];
  const counts = { pendingExcuses: 0, pendingLeaves: 0, failedDeliveries: 0 };

  if (isReviewer(user)) {
    const excuses = await safe(async () => (await pool.query(
      "SELECT id, fullname, date, submitted_at FROM attendance_excuses WHERE status = 'pending' ORDER BY submitted_at DESC LIMIT 50"))[0], []);
    counts.pendingExcuses = excuses.length;
    if (excuses.length) {
      items.push({
        kind: 'action', tone: 'amber', icon: 'bi-clipboard2-pulse', href: '/excuses',
        title: `คำร้องแก้ต่างรอตรวจ ${excuses.length} รายการ`,
        desc: excuses.slice(0, 3).map(e => e.fullname).join(', ') + (excuses.length > 3 ? ' …' : ''),
        time: excuses[0].submitted_at
      });
    }

    const leaves = await safe(async () => (await pool.query(
      "SELECT id, fullname, leave_type, days, submitted_at FROM leave_requests WHERE status = 'pending' ORDER BY submitted_at DESC LIMIT 50"))[0], []);
    counts.pendingLeaves = leaves.length;
    if (leaves.length) {
      items.push({
        kind: 'action', tone: 'brand', icon: 'bi-calendar2-x', href: '/leave#approvals',
        title: `ใบลารออนุมัติ ${leaves.length} รายการ`,
        desc: leaves.slice(0, 3).map(l => `${l.fullname} (${(LEAVE_TYPES[l.leave_type] || {}).label || 'ลา'} ${Number(l.days)} วัน)`).join(', '),
        time: leaves[0].submitted_at
      });
    }

    const failed = await safe(async () => (await pool.query(
      "SELECT COUNT(*) AS n, MAX(updated_at) AS last FROM notification_deliveries WHERE status = 'failed'"))[0][0], { n: 0 });
    counts.failedDeliveries = Number(failed.n) || 0;
    if (counts.failedDeliveries) {
      items.push({
        kind: 'alert', tone: 'red', icon: 'bi-exclamation-triangle', href: user.role === 'super' ? '/admin/users' : '/excuses',
        title: `ส่งแจ้งเตือนสแกนไม่สำเร็จ ${counts.failedDeliveries} รายการ`,
        desc: 'ตรวจสอบ LINE / Telegram ID ของบุคลากร', time: failed.last
      });
    }
  }

  // Personal results from the last two weeks
  const myExcuses = await safe(async () => (await pool.query(
    `SELECT id, date, status, reviewed_at FROM attendance_excuses
     WHERE username = ? AND status <> 'pending' AND reviewed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     ORDER BY reviewed_at DESC LIMIT 5`, [user.username, RECENT_DAYS]))[0], []);
  myExcuses.forEach(e => items.push({
    kind: 'result', tone: e.status === 'approved' ? 'green' : 'red', icon: e.status === 'approved' ? 'bi-check2-circle' : 'bi-x-circle', href: '/excuses',
    title: `คำร้องแก้ต่าง${e.status === 'approved' ? 'ได้รับอนุมัติ' : 'ไม่ได้รับอนุมัติ'}`,
    desc: `วันที่ ${new Date(e.date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}`, time: e.reviewed_at
  }));

  const myLeaves = await safe(async () => (await pool.query(
    `SELECT id, leave_type, days, status, reviewer, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, reviewed_at FROM leave_requests
     WHERE employee_id = ? AND status IN ('approved', 'rejected') AND reviewed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     ORDER BY reviewed_at DESC LIMIT 5`, [user.username, RECENT_DAYS]))[0], []);
  myLeaves.forEach(l => items.push({
    kind: 'result', tone: l.status === 'approved' ? 'green' : 'red', icon: l.status === 'approved' ? 'bi-check2-circle' : 'bi-x-circle', href: '/leave',
    title: `${(LEAVE_TYPES[l.leave_type] || {}).label || 'ใบลา'} ${Number(l.days)} วัน ${l.status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}`,
    desc: `เริ่ม ${new Date(`${l.start_date}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}${l.reviewer ? ` · โดย ${l.reviewer}` : ''}`,
    time: l.reviewed_at
  }));

  items.sort((a, b) => (a.kind === 'result') - (b.kind === 'result') || new Date(b.time || 0) - new Date(a.time || 0));
  const badge = counts.pendingExcuses + counts.pendingLeaves + counts.failedDeliveries + myExcuses.length + myLeaves.length;
  res.json({ success: true, items, counts, badge });
};
