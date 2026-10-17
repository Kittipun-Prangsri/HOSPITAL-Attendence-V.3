const { pool } = require('../config/db');
const { LEAVE_TYPES } = require('../constants/leave');

const { reviewScope, scopeFilter } = require('../services/reviewScope');
const RECENT_DAYS = 14;

// Each source is isolated so one missing table (e.g. migration not yet run) doesn't empty the inbox
async function safe(fn, fallback) {
  try { return await fn(); } catch (err) { console.warn('[inbox]', err.message); return fallback; }
}

/** Aggregated notification inbox for the topbar bell. */
exports.getInbox = async (req, res) => {
  const user = req.session.user;
  const items = [];
  const counts = { pendingExcuses: 0, pendingLeaves: 0, pendingOt: 0, pendingScans: 0, failedDeliveries: 0 };

  // Admins see every pending item; department heads only those of their departments (never their own)
  const rs = await safe(() => reviewScope(user), null);
  if (rs) {
    const scoped = (cols, extra = '') => {
      const f = scopeFilter(rs, cols);
      return { sql: f.sql ? ` AND ${f.sql}` : '', params: f.params, extra };
    };
    const ex = scoped({ employeeCol: 'username' });
    const excuses = await safe(async () => (await pool.query(
      `SELECT id, fullname, date, submitted_at FROM attendance_excuses WHERE status = 'pending' AND username <> ?${ex.sql}
       ORDER BY submitted_at DESC LIMIT 50`, [user.username, ...ex.params]))[0], []);
    counts.pendingExcuses = excuses.length;
    if (excuses.length) {
      items.push({
        kind: 'action', tone: 'amber', icon: 'bi-clipboard2-pulse', href: '/excuses',
        title: `คำร้องแก้ต่างรอตรวจ ${excuses.length} รายการ`,
        desc: excuses.slice(0, 3).map(e => e.fullname).join(', ') + (excuses.length > 3 ? ' …' : ''),
        time: excuses[0].submitted_at
      });
    }

    const lv = scoped({ personCol: 'hr_person_id', employeeCol: 'employee_id' });
    const leaves = await safe(async () => (await pool.query(
      `SELECT id, fullname, leave_type, days, submitted_at FROM leave_requests WHERE status = 'pending' AND employee_id <> ?${lv.sql}
       ORDER BY submitted_at DESC LIMIT 50`, [user.username, ...lv.params]))[0], []);
    counts.pendingLeaves = leaves.length;
    if (leaves.length) {
      items.push({
        kind: 'action', tone: 'brand', icon: 'bi-calendar2-x', href: '/leave#approvals',
        title: `ใบลารออนุมัติ ${leaves.length} รายการ`,
        desc: leaves.slice(0, 3).map(l => `${l.fullname} (${(LEAVE_TYPES[l.leave_type] || {}).label || 'ลา'} ${Number(l.days)} วัน)`).join(', '),
        time: leaves[0].submitted_at
      });
    }

    const ot = scoped({ personCol: 'hr_person_id', employeeCol: 'employee_id' });
    const ots = await safe(async () => (await pool.query(
      `SELECT fullname, hours, submitted_at FROM ot_requests WHERE status = 'pending' AND employee_id <> ?${ot.sql}
       ORDER BY submitted_at DESC LIMIT 50`, [user.username, ...ot.params]))[0], []);
    counts.pendingOt = ots.length;
    if (ots.length) {
      items.push({
        kind: 'action', tone: 'amber', icon: 'bi-stopwatch', href: '/ot#approvals',
        title: `คำขอ OT รออนุมัติ ${ots.length} รายการ`,
        desc: ots.slice(0, 3).map(o => `${o.fullname} (${Number(o.hours)} ชม.)`).join(', '),
        time: ots[0].submitted_at
      });
    }

    const ms = scoped({ employeeCol: 'employee_id' });
    const scans = await safe(async () => (await pool.query(
      `SELECT COUNT(*) AS n, MAX(created_at) AS last FROM mobile_scans WHERE status = 'pending'${ms.sql}`, ms.params))[0][0], { n: 0 });
    counts.pendingScans = Number(scans.n) || 0;
    if (counts.pendingScans) {
      items.push({
        kind: 'action', tone: 'amber', icon: 'bi-phone', href: '/admin/face#scans',
        title: `สแกนผ่านมือถือรอตรวจ ${counts.pendingScans} รายการ`,
        desc: 'นอกพื้นที่ / GPS ไม่แม่น / ใบหน้าก้ำกึ่ง', time: scans.last
      });
    }

    // Delivery failures are a system concern: admins only
    const failed = rs.all ? await safe(async () => (await pool.query(
      "SELECT COUNT(*) AS n, MAX(updated_at) AS last FROM notification_deliveries WHERE status = 'failed'"))[0][0], { n: 0 }) : { n: 0 };
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

  const myOts = await safe(async () => (await pool.query(
    `SELECT status, hours, reviewer, DATE_FORMAT(work_date, '%Y-%m-%d') AS work_date, reviewed_at FROM ot_requests
     WHERE employee_id = ? AND status IN ('approved', 'rejected') AND reviewed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     ORDER BY reviewed_at DESC LIMIT 5`, [user.username, RECENT_DAYS]))[0], []);
  myOts.forEach(o => items.push({
    kind: 'result', tone: o.status === 'approved' ? 'green' : 'red', icon: o.status === 'approved' ? 'bi-check2-circle' : 'bi-x-circle', href: '/ot',
    title: `OT ${Number(o.hours)} ชม. ${o.status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}`,
    desc: `วันที่ ${new Date(`${o.work_date}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}${o.reviewer ? ` · โดย ${o.reviewer}` : ''}`,
    time: o.reviewed_at
  }));

  items.sort((a, b) => (a.kind === 'result') - (b.kind === 'result') || new Date(b.time || 0) - new Date(a.time || 0));
  const badge = counts.pendingExcuses + counts.pendingLeaves + counts.pendingOt + counts.pendingScans + counts.failedDeliveries + myExcuses.length + myLeaves.length + myOts.length;
  res.json({ success: true, items, counts, badge });
};
