const { pool, hosofficePool, STAFF } = require('../config/db');
const { DEFAULT_LEAVE_POLICY } = require('../constants/leave');
const { quotasForStatus } = require('../utils/leave');

const POLICY_KEY = 'leave_policy';

async function getLeavePolicy() {
  try {
    const [rows] = await pool.query('SELECT setting_value FROM app_settings WHERE setting_key = ?', [POLICY_KEY]);
    if (!rows.length) return { ...DEFAULT_LEAVE_POLICY };
    const raw = rows[0].setting_value;
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { ...DEFAULT_LEAVE_POLICY, ...value, byStatus: (value && value.byStatus) || {} };
  } catch (err) {
    console.warn('[leavePolicy] using defaults:', err.message);
    return { ...DEFAULT_LEAVE_POLICY };
  }
}

/** HR_STATUS_NAME (staff type) for a session username (FINGLE_ID or HR_CID). */
async function statusOfEmployee(employeeId) {
  try {
    const [rows] = await hosofficePool.query(
      `SELECT s.HR_STATUS_NAME AS status FROM ${STAFF} p
       LEFT JOIN hr_status s ON s.HR_STATUS_ID = p.HR_STATUS_ID
       WHERE p.FINGLE_ID = ? OR p.HR_CID = ? LIMIT 1`,
      [employeeId, employeeId]
    );
    return rows[0] ? rows[0].status : null;
  } catch (err) {
    console.warn('[leavePolicy] status lookup failed:', err.message);
    return null;
  }
}

async function quotasForEmployee(employeeId, policy) {
  const status = await statusOfEmployee(employeeId);
  return { status, quotas: quotasForStatus(policy || await getLeavePolicy(), status) };
}

module.exports = { POLICY_KEY, getLeavePolicy, statusOfEmployee, quotasForEmployee };
