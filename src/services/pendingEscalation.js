const { pool } = require('../config/db');

const DEFAULT_DAYS = 2;

/** Pending approvals older than `days` (by submission time), grouped by kind. */
async function collectStalePending(days = DEFAULT_DAYS) {
  const q = async (sql) => {
    try { return (await pool.query(sql, [days]))[0]; } catch (err) { console.warn('[escalation]', err.message); return []; }
  };
  const [leaves, ots, excuses] = await Promise.all([
    q("SELECT fullname, submitted_at FROM leave_requests WHERE status = 'pending' AND submitted_at < DATE_SUB(NOW(), INTERVAL ? DAY) ORDER BY submitted_at"),
    q("SELECT fullname, submitted_at FROM ot_requests WHERE status = 'pending' AND submitted_at < DATE_SUB(NOW(), INTERVAL ? DAY) ORDER BY submitted_at"),
    q("SELECT fullname, submitted_at FROM attendance_excuses WHERE status = 'pending' AND submitted_at < DATE_SUB(NOW(), INTERVAL ? DAY) ORDER BY submitted_at")
  ]);
  return { leaves, ots, excuses };
}

/** Admin message text, or null when nothing is overdue. */
function formatEscalation({ leaves = [], ots = [], excuses = [] }, days = DEFAULT_DAYS, systemUrl = '') {
  const total = leaves.length + ots.length + excuses.length;
  if (!total) return null;
  const names = list => {
    const unique = [...new Set(list.map(r => r.fullname))];
    return unique.slice(0, 5).join(', ') + (unique.length > 5 ? ` และอีก ${unique.length - 5} คน` : '');
  };
  const lines = [`⏳ *รายการรออนุมัติเกิน ${days} วัน (${total} รายการ)*`, ''];
  if (leaves.length) lines.push(`📝 ใบลา ${leaves.length} รายการ: ${names(leaves)}`);
  if (ots.length) lines.push(`⏱ คำขอ OT ${ots.length} รายการ: ${names(ots)}`);
  if (excuses.length) lines.push(`📋 คำร้องแก้ต่าง ${excuses.length} รายการ: ${names(excuses)}`);
  if (systemUrl) lines.push('', `🔗 ${systemUrl.replace(/\/$/, '')}/leave#approvals`);
  return lines.join('\n');
}

module.exports = { collectStalePending, formatEscalation, DEFAULT_DAYS };
