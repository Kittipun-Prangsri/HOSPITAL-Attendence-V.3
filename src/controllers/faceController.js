const fs = require('fs');
const { pool, hosofficePool, STAFF } = require('../config/db');
const { logAudit } = require('../utils/audit');
const { analyzeJpeg, MODEL_VERSION } = require('../services/faceEngine');
const { encryptTemplate, isConfigured } = require('../utils/faceCrypto');
const { decodeJpeg, savePhoto, photoPath, deletePhoto } = require('../utils/faceFiles');
const { getMobileScanSettings, saveMobileScanSettings, validate } = require('../services/mobileScanSettings');
const consent = require('../constants/faceConsent');
const mobileScan = require('../services/mobileScan');
const { reviewScope, canReview, scopeFilter } = require('../services/reviewScope');

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
    `SELECT p.ID AS id, p.FINGLE_ID AS fingle_id, CONCAT(p.HR_FNAME, ' ', p.HR_LNAME) AS fullname
     FROM ${STAFF} p WHERE p.ID = ? LIMIT 1`, [user.id]);
  if (!rows[0]) return null;
  rows[0].line_user_id = (await require('../services/messagingLinks').linkOf(rows[0].id)).line;
  return rows[0];
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
    const [today] = await pool.query(
      `SELECT DATE_FORMAT(scanned_at, '%H:%i') AS time, direction, status, reject_reason AS reason
       FROM mobile_scans WHERE employee_id = ? AND scanned_at >= CURDATE() ORDER BY scanned_at DESC LIMIT 10`,
      [person ? person.fingle_id : '']);
    res.json({
      success: true,
      todayScans: today,
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

/* ---------------- Mobile scan (Phase 2) ---------------- */

exports.scanChallenge = async (req, res) => {
  const direction = (req.body || {}).direction;
  if (!['in', 'out'].includes(direction)) return res.status(400).json({ success: false, error: 'เลือกเข้างานหรือออกงาน' });
  try {
    const settings = await getMobileScanSettings();
    if (!settings.enabled) return res.status(403).json({ success: false, error: 'ยังไม่เปิดให้สแกนลงเวลาผ่านมือถือ' });
    res.json({ success: true, ...mobileScan.createChallenge(req.session.user.id, direction) });
  } catch (err) {
    console.error('[scan] challenge failed:', err);
    res.status(500).json({ success: false, error: 'เริ่มการสแกนไม่สำเร็จ' });
  }
};

exports.scan = async (req, res) => {
  const user = req.session.user;
  const body = req.body || {};
  const challenge = mobileScan.takeChallenge(body.token, user.id);
  if (!challenge) return res.status(400).json({ success: false, error: 'คำสั่งหมดอายุหรือใช้ไปแล้ว กรุณาเริ่มสแกนใหม่' });
  const front = decodeJpeg(body.front);
  const turn = decodeJpeg(body.turn);
  if (front.error || turn.error) return res.status(400).json({ success: false, error: front.error || turn.error });
  try {
    const person = await personOf(user);
    if (!person || !person.fingle_id) return res.status(400).json({ success: false, error: 'ไม่พบรหัสเครื่องสแกน (FINGLE_ID) ของท่าน' });
    const r = await mobileScan.verifyScan({
      person, challenge, front: front.value, turn: turn.value,
      lat: body.lat, lng: body.lng, accuracy: body.accuracy,
      lineUserId: person.line_user_id, userAgent: req.get('user-agent')
    });
    logAudit(req, `scan_${r.status}`, 'mobile_scan', r.id, { direction: challenge.direction, match: r.match, site: r.place.site, distanceM: r.place.distanceM, reason: r.reason || undefined });
    const time = r.scannedAt.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
    const label = challenge.direction === 'in' ? 'เข้างาน' : 'ออกงาน';
    const message = r.status === 'accepted' ? `บันทึก${label}แล้ว เวลา ${time} น.`
      : r.status === 'pending' ? `ส่งให้หัวหน้าตรวจสอบ (${r.reason})`
        : `ไม่ผ่าน: ${r.reason}`;
    res.json({ success: true, status: r.status, reason: r.reason, message, time, direction: challenge.direction, site: r.place.site, distanceM: r.place.distanceM });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, error: err.message });
    console.error('[scan] failed:', err);
    res.status(500).json({ success: false, error: 'บันทึกการสแกนไม่สำเร็จ ลองใหม่อีกครั้ง' });
  }
};

exports.listScans = async (req, res) => {
  const rs = await reviewScope(req.session.user);
  if (!rs) return res.status(403).json({ success: false, error: 'สิทธิ์ไม่เพียงพอ' });
  const status = ['pending', 'accepted', 'rejected', 'all'].includes(req.query.status) ? req.query.status : 'pending';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : null;
  const where = [];
  const params = [];
  if (status !== 'all') { where.push('status = ?'); params.push(status); }
  if (date) { where.push('scanned_at >= ? AND scanned_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(date, date); }
  const f = scopeFilter(rs, { employeeCol: 'employee_id' });
  if (f.sql) { where.push(f.sql); params.push(...f.params); }
  try {
    const [rows] = await pool.query(
      `SELECT id, employee_id, DATE_FORMAT(scanned_at, '%Y-%m-%d %H:%i:%s') AS scanned_at, direction, latitude, longitude,
              accuracy_m, site_name, distance_m, inside_area, match_score, status, reject_reason, reviewed_by,
              photo_file IS NOT NULL AS has_photo
       FROM mobile_scans ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY scanned_at DESC LIMIT 300`, params);
    const ids = [...new Set(rows.map(r => r.employee_id))];
    let names = {};
    if (ids.length) {
      const [people] = await hosofficePool.query(
        `SELECT FINGLE_ID, CONCAT(HR_FNAME, ' ', HR_LNAME) AS name FROM ${STAFF} WHERE FINGLE_ID IN (?)`, [ids]);
      names = Object.fromEntries(people.map(p => [p.FINGLE_ID, p.name]));
    }
    const [[counts]] = await pool.query(`SELECT SUM(status = 'pending') AS pending FROM mobile_scans${f.sql ? ' WHERE ' + f.sql : ''}`, f.params);
    res.json({
      success: true,
      scans: rows.map(r => ({ ...r, fullname: names[r.employee_id] || r.employee_id, has_photo: Boolean(r.has_photo), inside_area: Boolean(r.inside_area) })),
      counts: { pending: Number(counts.pending) || 0 }
    });
  } catch (err) {
    console.error('[scan] list failed:', err);
    res.status(500).json({ success: false, error: 'โหลดรายการสแกนไม่สำเร็จ' });
  }
};

exports.scanPhoto = async (req, res) => {
  const user = req.session.user;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).end();
  try {
    const [[row]] = await pool.query('SELECT employee_id, photo_file FROM mobile_scans WHERE id = ?', [id]);
    if (!row || !row.photo_file) return res.status(404).end();
    if (!canReview(await reviewScope(user), { employeeId: row.employee_id })) {
      const person = await personOf(user);
      if (!person || person.fingle_id !== row.employee_id) return res.status(403).end();
    }
    const file = photoPath(row.photo_file);
    if (!file || !fs.existsSync(file)) return res.status(404).end();
    res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff' });
    res.sendFile(file);
  } catch (err) {
    console.error('[scan] photo failed:', err);
    res.status(500).end();
  }
};

exports.reviewScan = async (req, res) => {
  const user = req.session.user;
  const rs = await reviewScope(user);
  if (!rs) return res.status(403).json({ success: false, error: 'สิทธิ์ไม่เพียงพอ' });
  const id = Number(req.params.id);
  const { decision } = req.body || {};
  const note = typeof (req.body || {}).note === 'string' ? req.body.note.trim().slice(0, 255) : '';
  if (!Number.isInteger(id) || !['approve', 'reject'].includes(decision)) return res.status(400).json({ success: false, error: 'คำขอไม่ถูกต้อง' });
  if (decision === 'reject' && !note) return res.status(400).json({ success: false, error: 'กรุณาระบุเหตุผลที่ไม่อนุมัติ' });
  try {
    const me = await personOf(user);
    const [[row]] = await pool.query('SELECT employee_id FROM mobile_scans WHERE id = ?', [id]);
    if (row && me && me.fingle_id === row.employee_id) return res.status(403).json({ success: false, error: 'ไม่สามารถอนุมัติการสแกนของตนเองได้' });
    if (row && !canReview(rs, { employeeId: row.employee_id })) return res.status(403).json({ success: false, error: 'พิจารณาได้เฉพาะบุคลากรในกลุ่มงานที่ท่านดูแล' });
    const r = await mobileScan.reviewScan(id, decision, user.fullname, note);
    if (r.error) return res.status(r.code).json({ success: false, error: r.error });
    logAudit(req, decision, 'mobile_scan', id, { employeeId: r.row.employee_id, note: note || undefined });
    res.json({ success: true, message: decision === 'approve' ? 'อนุมัติและบันทึกเวลาแล้ว' : 'ไม่อนุมัติแล้ว' });
  } catch (err) {
    console.error('[scan] review failed:', err);
    res.status(500).json({ success: false, error: 'บันทึกผลไม่สำเร็จ' });
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
