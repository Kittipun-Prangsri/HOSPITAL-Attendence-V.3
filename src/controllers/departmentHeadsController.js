const { pool, hosofficePool } = require('../config/db');
const { logAudit } = require('../utils/audit');
const { clearReviewScopeCache } = require('../services/reviewScope');

/** GET /api/department-heads — every department with its heads (super only). */
exports.list = async (req, res) => {
  try {
    const [departments] = await hosofficePool.query(
      `SELECT d.HR_DEPARTMENT_ID AS id, d.HR_DEPARTMENT_NAME AS name, COUNT(p.ID) AS staff
       FROM hr_department d
       LEFT JOIN hr_person p ON p.HR_DEPARTMENT_ID = d.HR_DEPARTMENT_ID AND p.HR_STATUS_ID IN ('01', '02', '03', '04', '09')
       GROUP BY d.HR_DEPARTMENT_ID, d.HR_DEPARTMENT_NAME ORDER BY d.HR_DEPARTMENT_ID`);
    const [heads] = await pool.query('SELECT hr_person_id, department_id, created_by, created_at FROM department_heads');
    let people = {};
    if (heads.length) {
      const [rows] = await hosofficePool.query(
        "SELECT ID, FINGLE_ID, CONCAT(HR_FNAME, ' ', HR_LNAME) AS name FROM hr_person WHERE ID IN (?)", [[...new Set(heads.map(h => h.hr_person_id))]]);
      people = Object.fromEntries(rows.map(r => [String(r.ID), r]));
    }
    res.json({
      success: true,
      departments: departments.map(d => ({
        id: d.id, name: d.name, staff: Number(d.staff),
        heads: heads.filter(h => Number(h.department_id) === Number(d.id)).map(h => ({
          hrPersonId: h.hr_person_id, name: (people[String(h.hr_person_id)] || {}).name || `#${h.hr_person_id}`,
          employeeId: (people[String(h.hr_person_id)] || {}).FINGLE_ID || '', createdBy: h.created_by
        }))
      }))
    });
  } catch (err) {
    console.error('[heads] list failed:', err);
    res.status(500).json({ success: false, error: 'โหลดข้อมูลหัวหน้ากลุ่มงานไม่สำเร็จ (ตรวจสอบว่ารัน npm run migrate แล้ว)' });
  }
};

/** GET /api/department-heads/people?q= — find active staff by name or scanner id. */
exports.searchPeople = async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 50) : '';
  if (q.length < 2) return res.json({ success: true, people: [] });
  try {
    const [rows] = await hosofficePool.query(
      `SELECT p.ID AS id, p.FINGLE_ID AS employeeId, CONCAT(p.HR_FNAME, ' ', p.HR_LNAME) AS name, d.HR_DEPARTMENT_NAME AS dept
       FROM hr_person p LEFT JOIN hr_department d ON d.HR_DEPARTMENT_ID = p.HR_DEPARTMENT_ID
       WHERE p.HR_STATUS_ID IN ('01', '02', '03', '04', '09')
         AND (CONCAT(p.HR_FNAME, ' ', p.HR_LNAME) LIKE ? OR p.FINGLE_ID LIKE ?)
       ORDER BY p.HR_FNAME LIMIT 15`, [`%${q}%`, `%${q}%`]);
    res.json({ success: true, people: rows });
  } catch (err) {
    console.error('[heads] search failed:', err);
    res.status(500).json({ success: false, error: 'ค้นหาไม่สำเร็จ' });
  }
};

exports.add = async (req, res) => {
  const departmentId = Number((req.body || {}).departmentId);
  const hrPersonId = Number((req.body || {}).hrPersonId);
  if (!Number.isInteger(departmentId) || !Number.isInteger(hrPersonId)) return res.status(400).json({ success: false, error: 'ข้อมูลไม่ครบ' });
  try {
    const [[dept]] = await hosofficePool.query('SELECT HR_DEPARTMENT_NAME AS name FROM hr_department WHERE HR_DEPARTMENT_ID = ?', [departmentId]);
    const [[person]] = await hosofficePool.query("SELECT CONCAT(HR_FNAME, ' ', HR_LNAME) AS name FROM hr_person WHERE ID = ?", [hrPersonId]);
    if (!dept || !person) return res.status(404).json({ success: false, error: 'ไม่พบกลุ่มงานหรือบุคลากร' });
    await pool.query('INSERT IGNORE INTO department_heads (hr_person_id, department_id, created_by) VALUES (?, ?, ?)',
      [hrPersonId, departmentId, req.session.user.fullname]);
    clearReviewScopeCache();
    logAudit(req, 'assign', 'department_head', `${departmentId}:${hrPersonId}`, { department: dept.name, person: person.name });
    res.json({ success: true, message: `ตั้ง ${person.name} เป็นหัวหน้า ${dept.name} แล้ว` });
  } catch (err) {
    console.error('[heads] add failed:', err);
    res.status(500).json({ success: false, error: 'บันทึกไม่สำเร็จ' });
  }
};

exports.remove = async (req, res) => {
  const departmentId = Number(req.params.departmentId);
  const hrPersonId = Number(req.params.hrPersonId);
  if (!Number.isInteger(departmentId) || !Number.isInteger(hrPersonId)) return res.status(400).json({ success: false, error: 'ข้อมูลไม่ถูกต้อง' });
  try {
    const [r] = await pool.query('DELETE FROM department_heads WHERE hr_person_id = ? AND department_id = ?', [hrPersonId, departmentId]);
    clearReviewScopeCache();
    if (r.affectedRows) logAudit(req, 'unassign', 'department_head', `${departmentId}:${hrPersonId}`);
    res.json({ success: true, message: 'ยกเลิกหัวหน้ากลุ่มงานแล้ว' });
  } catch (err) {
    console.error('[heads] remove failed:', err);
    res.status(500).json({ success: false, error: 'ยกเลิกไม่สำเร็จ' });
  }
};
