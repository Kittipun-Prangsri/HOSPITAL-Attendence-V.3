const fs = require('fs');
const { pool, hosofficePool } = require('../config/db');
const { logAudit } = require('../utils/audit');
const { analyzeJpeg, MODEL_VERSION } = require('../services/faceEngine');
const { encryptTemplate, isConfigured } = require('../utils/faceCrypto');
const { decodeJpeg, savePhoto, photoPath, deletePhoto } = require('../utils/faceFiles');
const { getMobileScanSettings, saveMobileScanSettings, validate } = require('../services/mobileScanSettings');
const consent = require('../constants/faceConsent');

const isAdmin = u => u && (u.role === 'admin' || u.role === 'super');

// At most 6 enrolment uploads per person per hour (each one runs the face model on the server)
const attempts = new Map();
function tooManyAttempts(key) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter(t => now - t < 60 * 60 * 1000);
  if (list.length >= 6) { attempts.set(key, list); return true; }
  list.push(now);
  attempts.set(key, list);
  return false;
}

async function personOf(user) {
  const [rows] = await hosofficePool.query(
    `SELECT p.ID AS id, p.FINGLE_ID AS fingle_id, CONCAT(p.HR_FNAME, ' ', p.HR_LNAME) AS fullname, p.LINE_YOUR_USER_ID AS line_user_id
     FROM hr_person p WHERE p.ID = ? LIMIT 1`, [user.id]);
  return rows[0] || null;
}

/** Remove the biometric data of the given enrolment rows (template + photo), keeping an audit row. */
async function wipe(rows, status, by, note) {
  for (const r of rows) {
    await deletePhoto(r.photo_file);
    await pool.query(
      `UPDATE face_enrollments SET status = ?, template = NULL, photo_file = NULL, reviewed_by = COALESCE(?, reviewed_by),
         reviewed_at = COALESCE(reviewed_at, NOW()), review_note = COALESCE(?, review_note) WHERE id = ?`,
      [status, by, note, r.id]
    );
  }
}

const publicRow = r => (r ? {
  id: r.id, status: r.status, createdAt: r.created_at, reviewedAt: r.reviewed_at, reviewNote: r.review_note,
  consentVersion: r.consent_version
} : null);

/* ---------------- Staff (own enrolment) ---------------- */

exports.me = async (req, res) => {
  try {
    const person = await personOf(req.session.user);
    const [rows] = await pool.query(
      `SELECT id, status, created_at, reviewed_at, review_note, consent_version FROM face_enrollments
       WHERE employee_id = ? AND status <> 'revoked' ORDER BY id DESC LIMIT 5`,
      [person ? person.fingle_id : '']
    );
    const settings = await getMobileScanSettings();
    res.json({
      success: true,
      person: person && { fullname: person.fullname, employeeId: person.fingle_id, hasLine: Boolean(person.line_user_id) },
      approved: publicRow(rows.find(r => r.status === 'approved')),
      latest: publicRow(rows[0]),
      consent: { version: consent.VERSION, text: consent.TEXT },
      ready: isConfigured(),
      scanEnabled: settings.enabled
    });
  } catch (err) {
    console.error('[face] me failed:', err);
    res.status(500).json({ success: false, error: 'โหลดข้อมูลไม่สำเร็จ (ตรวจสอบว่ารัน npm run migrate แล้ว)' });
  }
};

exports.enroll = async (req, res) => {
  const user = req.session.user;
  if (!isConfigured()) return res.status(503).json({ success: false, error: 'ระบบยังไม่พร้อม: ผู้ดูแลยังไม่ได้ตั้งค่า FACE_TEMPLATE_KEY' });
  const body = req.body || {};
  if (body.consent !== true || body.consentVersion !== consent.VERSION) {
    return res.status(400).json({ success: false, error: 'กรุณาอ่านและกดยินยอมก่อนลงทะเบียนใบหน้า' });
  }
  const { error, value: buffer } = decodeJpeg(body.photo);
  if (error) return res.status(400).json({ success: false, error });

  try {
    const person = await personOf(user);
    if (!person || !person.fingle_id) {
      return res.status(400).json({ success: false, error: 'ไม่พบรหัสเครื่องสแกน (FINGLE_ID) ของท่าน กรุณาแจ้ง HR ก่อนลงทะเบียน' });
    }
    if (tooManyAttempts(person.fingle_id)) {
      return res.status(429).json({ success: false, error: 'ลองหลายครั้งเกินไป กรุณารอ 1 ชั่วโมงแล้วลองใหม่' });
    }
    const face = await analyzeJpeg(buffer);
    if (!face.ok) return res.status(422).json({ success: false, error: face.reason });

    const photoFile = await savePhoto('enroll', buffer);
    // Earlier unfinished attempts are replaced; an approved template stays active until the new one is approved
    const [old] = await pool.query(
      "SELECT id, photo_file FROM face_enrollments WHERE employee_id = ? AND status IN ('pending', 'rejected')", [person.fingle_id]);
    await wipe(old, 'revoked', null, 'แทนที่ด้วยการลงทะเบียนใหม่');

    const [result] = await pool.query(
      `INSERT INTO face_enrollments
         (employee_id, hr_person_id, fullname, status, template, model_version, photo_file, quality, consent_version, consent_at, line_user_id)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, NOW(), ?)`,
      [person.fingle_id, person.id, person.fullname, encryptTemplate(face.embedding), MODEL_VERSION, photoFile,
        JSON.stringify({ score: face.score, real: face.real, live: face.live }), consent.VERSION, person.line_user_id || null]
    );
    logAudit(req, 'enroll', 'face', result.insertId, { quality: { score: face.score, real: face.real, live: face.live } });
    res.json({ success: true, id: result.insertId, message: 'ส่งลงทะเบียนใบหน้าแล้ว รอผู้ดูแลระบบอนุมัติ' });
  } catch (err) {
    console.error('[face] enroll failed:', err);
    res.status(500).json({ success: false, error: 'ลงทะเบียนไม่สำเร็จ ลองใหม่อีกครั้ง' });
  }
};

/** Withdraw consent: every template and photo of this person is deleted immediately. */
exports.revokeOwn = async (req, res) => {
  try {
    const person = await personOf(req.session.user);
    if (!person || !person.fingle_id) return res.json({ success: true });
    const [rows] = await pool.query(
      "SELECT id, photo_file FROM face_enrollments WHERE employee_id = ? AND status <> 'revoked'", [person.fingle_id]);
    await wipe(rows, 'revoked', req.session.user.fullname, 'เจ้าของข้อมูลถอนความยินยอม');
    logAudit(req, 'consent_withdrawn', 'face', person.fingle_id, { rows: rows.length });
    res.json({ success: true, message: 'ถอนความยินยอมและลบข้อมูลใบหน้าแล้ว' });
  } catch (err) {
    console.error('[face] revoke failed:', err);
    res.status(500).json({ success: false, error: 'ถอนความยินยอมไม่สำเร็จ' });
  }
};

/* ---------------- Admin ---------------- */

exports.list = async (req, res) => {
  if (!isAdmin(req.session.user)) return res.status(403).json({ success: false, error: 'สิทธิ์ไม่เพียงพอ' });
  const status = ['pending', 'approved', 'rejected', 'revoked'].includes(req.query.status) ? req.query.status : 'pending';
  try {
    const [rows] = await pool.query(
      `SELECT id, employee_id, fullname, status, quality, photo_file IS NOT NULL AS has_photo, consent_version,
              created_at, reviewed_by, reviewed_at, review_note
       FROM face_enrollments WHERE status = ? ORDER BY id DESC LIMIT 300`, [status]);
    const [[counts]] = await pool.query(
      `SELECT SUM(status = 'pending') AS pending, SUM(status = 'approved') AS approved FROM face_enrollments`);
    res.json({
      success: true,
      enrollments: rows.map(r => ({ ...r, has_photo: Boolean(r.has_photo), quality: typeof r.quality === 'string' ? JSON.parse(r.quality) : r.quality })),
      counts: { pending: Number(counts.pending) || 0, approved: Number(counts.approved) || 0 }
    });
  } catch (err) {
    console.error('[face] list failed:', err);
    res.status(500).json({ success: false, error: 'โหลดรายการไม่สำเร็จ (ตรวจสอบว่ารัน npm run migrate แล้ว)' });
  }
};

/** Enrolment photo: admins, or the person it belongs to. */
exports.photo = async (req, res) => {
  const user = req.session.user;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).end();
  try {
    const [[row]] = await pool.query('SELECT hr_person_id, photo_file FROM face_enrollments WHERE id = ?', [id]);
    if (!row || !row.photo_file) return res.status(404).end();
    if (!isAdmin(user) && String(row.hr_person_id) !== String(user.id)) return res.status(403).end();
    const file = photoPath(row.photo_file);
    if (!file || !fs.existsSync(file)) return res.status(404).end();
    res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff' });
    res.sendFile(file);
  } catch (err) {
    console.error('[face] photo failed:', err);
    res.status(500).end();
  }
};

exports.review = async (req, res) => {
  const user = req.session.user;
  if (!isAdmin(user)) return res.status(403).json({ success: false, error: 'สิทธิ์ไม่เพียงพอ' });
  const id = Number(req.params.id);
  const { decision } = req.body || {};
  const note = typeof (req.body || {}).note === 'string' ? req.body.note.trim().slice(0, 255) : '';
  if (!Number.isInteger(id) || !['approve', 'reject'].includes(decision)) return res.status(400).json({ success: false, error: 'คำขอไม่ถูกต้อง' });
  if (decision === 'reject' && !note) return res.status(400).json({ success: false, error: 'กรุณาระบุเหตุผลที่ไม่อนุมัติ' });
  try {
    const [[row]] = await pool.query("SELECT id, employee_id, hr_person_id, photo_file FROM face_enrollments WHERE id = ? AND status = 'pending'", [id]);
    if (!row) return res.status(409).json({ success: false, error: 'รายการนี้ถูกดำเนินการไปแล้ว' });
    if (String(row.hr_person_id) === String(user.id)) return res.status(403).json({ success: false, error: 'ไม่สามารถอนุมัติใบหน้าของตนเองได้' });

    if (decision === 'approve') {
      const [prev] = await pool.query(
        "SELECT id, photo_file FROM face_enrollments WHERE employee_id = ? AND status = 'approved'", [row.employee_id]);
      await wipe(prev, 'revoked', user.fullname, 'แทนที่ด้วยใบหน้าที่อนุมัติใหม่');
      await pool.query(
        "UPDATE face_enrollments SET status = 'approved', reviewed_by = ?, reviewed_at = NOW(), review_note = ? WHERE id = ?",
        [user.fullname, note || null, id]);
    } else {
      // Rejected: the biometric template and photo are not kept
      await wipe([row], 'rejected', user.fullname, note);
    }
    logAudit(req, decision, 'face', id, { employeeId: row.employee_id, note: note || undefined });
    res.json({ success: true, message: decision === 'approve' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ และลบข้อมูลใบหน้าแล้ว' });
  } catch (err) {
    console.error('[face] review failed:', err);
    res.status(500).json({ success: false, error: 'บันทึกผลไม่สำเร็จ' });
  }
};

exports.revoke = async (req, res) => {
  const user = req.session.user;
  if (!isAdmin(user)) return res.status(403).json({ success: false, error: 'สิทธิ์ไม่เพียงพอ' });
  const id = Number(req.params.id);
  const note = typeof (req.body || {}).note === 'string' ? req.body.note.trim().slice(0, 255) : '';
  if (!Number.isInteger(id) || !note) return res.status(400).json({ success: false, error: 'กรุณาระบุเหตุผล' });
  try {
    const [[row]] = await pool.query("SELECT id, employee_id, photo_file FROM face_enrollments WHERE id = ? AND status = 'approved'", [id]);
    if (!row) return res.status(404).json({ success: false, error: 'ไม่พบรายการที่อนุมัติแล้ว' });
    await wipe([row], 'revoked', user.fullname, note);
    logAudit(req, 'revoke', 'face', id, { employeeId: row.employee_id, note });
    res.json({ success: true, message: 'ยกเลิกและลบข้อมูลใบหน้าแล้ว' });
  } catch (err) {
    console.error('[face] admin revoke failed:', err);
    res.status(500).json({ success: false, error: 'ยกเลิกไม่สำเร็จ' });
  }
};

exports.getSettings = async (req, res) => {
  if (!isAdmin(req.session.user)) return res.status(403).json({ success: false, error: 'สิทธิ์ไม่เพียงพอ' });
  const settings = await getMobileScanSettings();
  res.json({
    success: true,
    settings,
    env: {
      templateKey: isConfigured(),
      lineLogin: Boolean(process.env.LINE_LOGIN_CHANNEL_ID),
      liffId: process.env.LIFF_ID || '',
      liffUrl: process.env.LIFF_ID ? `https://liff.line.me/${process.env.LIFF_ID}` : ''
    }
  });
};

exports.saveSettings = async (req, res) => {
  const user = req.session.user;
  if (!user || user.role !== 'super') return res.status(403).json({ success: false, error: 'เฉพาะ Super Admin เท่านั้นที่แก้ไขการตั้งค่านี้ได้' });
  const { error, value } = validate(req.body);
  if (error) return res.status(400).json({ success: false, error });
  try {
    await saveMobileScanSettings(value, user.fullname);
    logAudit(req, 'update', 'mobile_scan_settings', null, value);
    res.json({ success: true, settings: value });
  } catch (err) {
    console.error('[face] save settings failed:', err);
    res.status(500).json({ success: false, error: 'บันทึกการตั้งค่าไม่สำเร็จ' });
  }
};
