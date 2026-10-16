const { pool } = require('../config/db');
const { parseDate } = require('../utils/leave');

exports.listAudit = async (req, res) => {
  const user = req.session.user;
  if (!user || user.role !== 'super') return res.status(403).json({ success: false, error: 'เฉพาะ Super Admin เท่านั้น' });
  const { entity, action, q, from, to } = req.query;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const where = [];
  const params = [];
  if (typeof entity === 'string' && /^[a-z_]{1,50}$/.test(entity)) { where.push('entity = ?'); params.push(entity); }
  if (typeof action === 'string' && /^[a-z_]{1,50}$/.test(action)) { where.push('action = ?'); params.push(action); }
  if (typeof q === 'string' && q.trim()) {
    const like = `%${q.trim().slice(0, 100)}%`;
    where.push('(actor_name LIKE ? OR actor_id LIKE ? OR entity_id LIKE ? OR detail LIKE ?)');
    params.push(like, like, like, like);
  }
  if (parseDate(from)) { where.push('created_at >= ?'); params.push(`${from} 00:00:00`); }
  if (parseDate(to)) { where.push('created_at <= ?'); params.push(`${to} 23:59:59`); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  try {
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM audit_log ${clause}`, params);
    const [rows] = await pool.query(
      `SELECT id, actor_id, actor_name, actor_role, action, entity, entity_id, detail, ip, created_at
       FROM audit_log ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [entities] = await pool.query('SELECT DISTINCT entity FROM audit_log ORDER BY entity');
    res.json({ success: true, total: Number(total), rows, entities: entities.map(e => e.entity) });
  } catch (error) {
    console.error('Error listing audit log:', error);
    res.status(500).json({ success: false, error: 'ไม่สามารถโหลดบันทึกการใช้งานได้ (ตรวจสอบว่ารัน npm run migrate แล้ว)', rows: [], total: 0 });
  }
};
