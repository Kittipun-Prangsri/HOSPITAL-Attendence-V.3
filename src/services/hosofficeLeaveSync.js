/**
 * Sync leave records from HOSoffice (hosoffice.leave_register) into hospital_db.leave_requests.
 *
 * Keeps attendance incidents, calendars, and monthly reports synchronized with leaves
 * officially approved or recorded in HOSoffice.
 */
const { pool, hosofficePool, STAFF } = require('../config/db');
const { markIncidentsStale } = require('./incidentSync');

const TYPE_MAP = {
  '01': 'sick',        // ลาป่วย
  '02': 'maternity',   // ลาคลอดบุตร
  '03': 'personal',    // ลากิจ
  '04': 'vacation',    // ลาพักผ่อน
  '05': 'ordination'   // ลาอุปสมบท
};

const HALF_DAY_MAP = {
  '02': 'morning',
  '03': 'afternoon'
};

function mapStatus(statusCode, isCancelled) {
  if (String(isCancelled).toLowerCase() === 'true') return 'cancelled';
  if (statusCode === 'X' || statusCode === 'D') return 'rejected';
  if (['Z', 'S', 'E'].includes(statusCode)) return 'approved';
  if (statusCode === 'A') return 'pending';
  return 'pending';
}

/**
 * Sync leaves from HOSoffice.
 * @param {Object} options
 * @param {string} [options.fromDate] - Start date (YYYY-MM-DD), defaults to start of current calendar year
 * @param {string} [options.toDate]   - End date (YYYY-MM-DD), optional
 * @returns {Promise<{ success: boolean, total: number, synced: number, months: string[] }>}
 */
async function syncLeavesFromHosoffice(options = {}) {
  const fromDate = options.fromDate || `${new Date().getFullYear()}-01-01`;
  const params = [fromDate];
  let toFilter = '';
  if (options.toDate) {
    toFilter = 'AND r.LEAVE_DATE_BEGIN <= ?';
    params.push(options.toDate);
  }

  const sql = `
    SELECT 
      r.ID as hos_id,
      r.LEAVE_PERSON_ID as person_id,
      r.LEAVE_PERSON_CODE as person_cid,
      r.LEAVE_PERSON_FULLNAME as raw_fullname,
      COALESCE(p.FINGLE_ID, p.HR_CID, r.LEAVE_PERSON_CODE) as emp_id,
      COALESCE(CONCAT(p.HR_FNAME, ' ', p.HR_LNAME), r.LEAVE_PERSON_FULLNAME) as fullname,
      COALESCE(htt.HILING_TIME_NAME, d.HR_DEPARTMENT_NAME, 'ไม่ระบุกลุ่มงาน') as dept,
      r.LEAVE_TYPE_CODE as type_code,
      DATE_FORMAT(r.LEAVE_DATE_BEGIN, '%Y-%m-%d') as start_date,
      DATE_FORMAT(r.LEAVE_DATE_END, '%Y-%m-%d') as end_date,
      r.LEAVE_DATE_SUM as days,
      r.DAY_TYPE_ID as day_type,
      r.LEAVE_BECAUSE as reason,
      r.LEAVE_STATUS_CODE as status_code,
      r.LEAVE_CANCEL_STATUS as is_cancelled,
      r.LEAVE_ACCEPT_BY as reviewer,
      r.ACCEPT_COMMENT as review_comment,
      DATE_FORMAT(r.LEAVE_DATETIME_REGIS, '%Y-%m-%d %H:%i:%s') as submitted_at,
      DATE_FORMAT(r.LEAVE_ACCEPT_DATETIME, '%Y-%m-%d %H:%i:%s') as reviewed_at
    FROM leave_register r
    LEFT JOIN ${STAFF} p ON p.ID = r.LEAVE_PERSON_ID
    LEFT JOIN hr_person_hiling_time hht ON hht.HR_PERSON_ID = p.ID
    LEFT JOIN hiling_time_template htt ON htt.ID = hht.TEMPLATE_ID
    LEFT JOIN hr_department d ON p.HR_DEPARTMENT_ID = d.HR_DEPARTMENT_ID
    WHERE r.LEAVE_DATE_BEGIN >= ? ${toFilter}
    ORDER BY r.ID ASC
  `;

  const [rows] = await hosofficePool.query(sql, params);
  if (!rows || rows.length === 0) {
    return { success: true, total: 0, synced: 0, months: [] };
  }

  const affectedMonths = new Set();
  const values = [];

  for (const r of rows) {
    const startDate = r.start_date;
    const endDate = r.end_date || r.start_date;
    if (!startDate) continue;

    const empId = r.emp_id || r.person_cid || (r.person_id ? `P${r.person_id}` : 'UNKNOWN');
    const fullname = (r.fullname && r.fullname.trim()) || r.raw_fullname || empId;
    const leaveType = TYPE_MAP[r.type_code] || 'other';
    const halfDay = HALF_DAY_MAP[r.day_type] || 'none';
    const numDays = parseFloat(r.days) || 1.0;
    const status = mapStatus(r.status_code, r.is_cancelled);
    const reason = r.reason || 'ลาจากระบบ HOSoffice';
    const reviewer = r.reviewer || null;
    const reviewComment = r.review_comment || null;
    const submittedAt = r.submitted_at ? new Date(r.submitted_at) : new Date();
    const reviewedAt = r.reviewed_at ? new Date(r.reviewed_at) : (status === 'approved' ? submittedAt : null);

    values.push([
      r.hos_id,
      'hosoffice',
      empId,
      r.person_id || null,
      fullname,
      r.dept,
      leaveType,
      startDate,
      endDate,
      halfDay,
      numDays,
      reason,
      status,
      reviewer,
      reviewComment,
      submittedAt,
      reviewedAt
    ]);

    // Track affected months
    if (startDate) affectedMonths.add(startDate.slice(0, 7));
    if (endDate) affectedMonths.add(endDate.slice(0, 7));
  }

  const insertSql = `
    INSERT INTO leave_requests (
      hosoffice_leave_id, synced_from, employee_id, hr_person_id, fullname, dept,
      leave_type, start_date, end_date, half_day, days, reason,
      status, reviewer, review_comment, submitted_at, reviewed_at
    ) VALUES ?
    ON DUPLICATE KEY UPDATE
      employee_id = VALUES(employee_id),
      hr_person_id = VALUES(hr_person_id),
      fullname = VALUES(fullname),
      dept = VALUES(dept),
      leave_type = VALUES(leave_type),
      start_date = VALUES(start_date),
      end_date = VALUES(end_date),
      half_day = VALUES(half_day),
      days = VALUES(days),
      reason = VALUES(reason),
      status = VALUES(status),
      reviewer = VALUES(reviewer),
      review_comment = VALUES(review_comment),
      reviewed_at = VALUES(reviewed_at)
  `;

  const chunkSize = 500;
  for (let i = 0; i < values.length; i += chunkSize) {
    const chunk = values.slice(i, i + chunkSize);
    await pool.query(insertSql, [chunk]);
  }

  // Mark all affected months stale so incident_logs will recalculate without absent marks on leave days
  for (const ym of affectedMonths) {
    markIncidentsStale(ym);
  }

  return {
    success: true,
    total: rows.length,
    synced: values.length,
    months: Array.from(affectedMonths).sort()
  };
}

module.exports = {
  syncLeavesFromHosoffice,
  TYPE_MAP,
  HALF_DAY_MAP,
  mapStatus
};
