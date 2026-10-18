/**
 * Mobile face scan (Phase 2): one-time challenge → two photos (frontal + turned head) + GPS → decision.
 *
 * Liveness is checked by the server, not trusted from the phone: the turned photo must show the same
 * person with the head turned the way the random challenge asked. A printed photo or a still picture
 * on a screen cannot turn. Yaw convention (measured on Human's mesh, raw un-mirrored camera frames):
 * negative = the person turned to THEIR left, positive = to their right.
 */
const crypto = require('crypto');
const { pool, hosofficePool, STAFF } = require('../config/db');
const { analyzeJpeg, similarity, MODEL_VERSION } = require('./faceEngine');
const { decryptTemplate } = require('../utils/faceCrypto');
const { savePhoto } = require('../utils/faceFiles');
const { getMobileScanSettings, locate } = require('./mobileScanSettings');
const { markIncidentsStale } = require('./incidentSync');

const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const MIN_GAP_SECONDS = 120;          // one scan per 2 minutes per person
const FRONT_MAX_YAW = 0.25;           // ≈ 14°: "looking straight"
const TURN_MIN_YAW = 0.25;            // ≈ 14°: clearly turned
const ACTIONS = ['left', 'right'];

const challenges = new Map();         // token → { personId, direction, action, expiresAt }

function sweep(now = Date.now()) {
  for (const [k, c] of challenges) if (c.expiresAt < now) challenges.delete(k);
}

function createChallenge(personId, direction) {
  sweep();
  const token = crypto.randomBytes(16).toString('hex');
  const action = ACTIONS[crypto.randomInt(ACTIONS.length)];
  challenges.set(token, { personId: String(personId), direction, action, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  return { token, action, expiresIn: CHALLENGE_TTL_MS / 1000 };
}

/** Single use: a challenge is consumed by the first attempt, success or not. */
function takeChallenge(token, personId) {
  const c = typeof token === 'string' ? challenges.get(token) : null;
  if (!c) return null;
  challenges.delete(token);
  if (c.expiresAt < Date.now() || c.personId !== String(personId)) return null;
  return c;
}

const turnedAsAsked = (action, yaw) =>
  typeof yaw === 'number' && (action === 'left' ? yaw <= -TURN_MIN_YAW : yaw >= TURN_MIN_YAW);

/**
 * Pure decision so it can be unit-tested.
 * @returns {{ status: 'accepted'|'pending'|'rejected', reason: string|null }}
 */
function decide({ settings, match, sameFace, frontYaw, turnYaw, action, place }) {
  if (Math.abs(frontYaw) > FRONT_MAX_YAW) return { status: 'rejected', reason: 'ภาพแรกต้องมองตรงมาที่กล้อง' };
  if (!turnedAsAsked(action, turnYaw)) return { status: 'rejected', reason: `ไม่ได้หันหน้าไปทาง${action === 'left' ? 'ซ้าย' : 'ขวา'}ตามคำสั่ง` };
  if (sameFace < settings.reviewThreshold) return { status: 'rejected', reason: 'สองภาพไม่ใช่บุคคลเดียวกัน' };
  if (match < settings.reviewThreshold) return { status: 'rejected', reason: 'ใบหน้าไม่ตรงกับที่ลงทะเบียนไว้' };
  const reasons = [];
  if (match < settings.matchThreshold) reasons.push('ความเหมือนของใบหน้าก้ำกึ่ง');
  if (!place.inside) {
    reasons.push(place.site === null ? 'ไม่ได้กำหนดจุดสแกน'
      : place.distanceM > place.radiusM ? `อยู่นอกพื้นที่ (ห่าง ${Math.round(place.distanceM)} ม.)`
        : 'สัญญาณ GPS ไม่แม่นยำพอ');
  }
  return reasons.length ? { status: 'pending', reason: reasons.join(' · ') } : { status: 'accepted', reason: null };
}

const bangkokParts = date => {
  const d = date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const t = date.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour12: false });
  return { date: d, time: t };
};

/** Write an accepted mobile scan into HOSoffice hikvision so reports, incidents and cards pick it up. */
async function writeToHikvision({ employeeId, fullname, scannedAt, direction, site }) {
  const { date, time } = bangkokParts(scannedAt);
  const today = bangkokParts(new Date()).date;
  await hosofficePool.query(
    `INSERT INTO hikvision (EmployeeID, AccessDateandTime, AccessDate, AccessTime, AuthenticationResult,
       AuthenticationType, DeviceName, PersonName, Direction, AttendanceStatus, is_notified)
     VALUES (?, ?, ?, ?, 'Success', 'MobileFace', ?, ?, ?, ?, ?)`,
    [employeeId, `${date}T${time}`, date, time, `มือถือ · ${site || 'นอกพื้นที่ (อนุมัติแล้ว)'}`.slice(0, 100),
      fullname, direction, direction === 'in' ? 'i' : 'o',
      // 1 = realtime notifier sends the usual scan card; approvals of older scans stay silent
      date === today ? 1 : 3]
  );
  markIncidentsStale(date);
}

/**
 * Verify a scan. Throws { status, message } for request errors; otherwise records the attempt and
 * resolves to { id, status, reason, match, place, scannedAt }.
 */
async function verifyScan({ person, challenge, front, turn, lat, lng, accuracy, lineUserId, userAgent }) {
  const settings = await getMobileScanSettings();
  if (!settings.enabled) throw Object.assign(new Error('ยังไม่เปิดให้สแกนลงเวลาผ่านมือถือ'), { status: 403 });

  const [[enrolment]] = await pool.query(
    "SELECT id, template, model_version FROM face_enrollments WHERE employee_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 1",
    [person.fingle_id]);
  if (!enrolment || !enrolment.template) throw Object.assign(new Error('ยังไม่มีใบหน้าที่อนุมัติแล้ว กรุณาลงทะเบียนใบหน้าก่อน'), { status: 409 });
  if (enrolment.model_version !== MODEL_VERSION) {
    throw Object.assign(new Error('ระบบจดจำใบหน้าถูกปรับปรุง กรุณาลงทะเบียนใบหน้าใหม่'), { status: 409 });
  }

  const [[recent]] = await pool.query(
    `SELECT COUNT(*) AS n FROM mobile_scans WHERE employee_id = ? AND status IN ('accepted', 'pending')
       AND scanned_at > DATE_SUB(NOW(), INTERVAL ? SECOND)`, [person.fingle_id, MIN_GAP_SECONDS]);
  if (Number(recent.n) > 0) throw Object.assign(new Error('เพิ่งสแกนไปแล้ว กรุณารอ 2 นาทีก่อนสแกนอีกครั้ง'), { status: 429 });

  const latN = Number(lat), lngN = Number(lng), accN = Number(accuracy);
  const hasFix = Number.isFinite(latN) && Number.isFinite(lngN) && Math.abs(latN) <= 90 && Math.abs(lngN) <= 180;
  const place = hasFix ? locate(settings, latN, lngN, Number.isFinite(accN) ? accN : Infinity)
    : { site: null, distanceM: null, radiusM: null, inside: false };

  const a = await analyzeJpeg(front);
  if (!a.ok) throw Object.assign(new Error(`ภาพหน้าตรง: ${a.reason}`), { status: 422 });
  const b = await analyzeJpeg(turn);
  if (!b.ok) throw Object.assign(new Error(`ภาพหันหน้า: ${b.reason}`), { status: 422 });

  const match = await similarity(a.embedding, decryptTemplate(enrolment.template));
  const sameFace = await similarity(a.embedding, b.embedding);
  const verdict = decide({ settings, match, sameFace, frontYaw: a.yaw, turnYaw: b.yaw, action: challenge.action, place });

  const scannedAt = new Date();
  const photoFile = await savePhoto('scan', front);
  const [result] = await pool.query(
    `INSERT INTO mobile_scans (employee_id, enrollment_id, scanned_at, direction, latitude, longitude, accuracy_m, site_name,
       distance_m, inside_area, match_score, real_score, live_score, challenge, photo_file, status, reject_reason, line_user_id, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [person.fingle_id, enrolment.id, scannedAt, challenge.direction, hasFix ? latN : null, hasFix ? lngN : null,
      Number.isFinite(accN) ? Math.min(accN, 9999999) : null, place.site, place.distanceM, place.inside ? 1 : 0,
      match, a.real, a.live, `${challenge.action}:${a.yaw}/${b.yaw}:same=${sameFace}`.slice(0, 30), photoFile,
      verdict.status, verdict.reason, lineUserId || null, String(userAgent || '').slice(0, 255)]
  );

  if (verdict.status === 'accepted') {
    await writeToHikvision({ employeeId: person.fingle_id, fullname: person.fullname, scannedAt, direction: challenge.direction, site: place.site });
  }
  return { id: result.insertId, status: verdict.status, reason: verdict.reason, match, place, scannedAt };
}

/** Admin decision on a pending scan; approval writes it to hikvision with the original scan time. */
async function reviewScan(id, decision, reviewer, note) {
  const [[row]] = await pool.query(
    `SELECT m.id, m.employee_id, m.scanned_at, m.direction, m.site_name, m.status FROM mobile_scans m WHERE m.id = ?`, [id]);
  if (!row) return { error: 'ไม่พบรายการ', code: 404 };
  if (row.status !== 'pending') return { error: 'รายการนี้ถูกดำเนินการไปแล้ว', code: 409 };
  if (decision === 'approve') {
    const [[p]] = await hosofficePool.query(
      `SELECT CONCAT(HR_FNAME, ' ', HR_LNAME) AS fullname FROM ${STAFF} WHERE FINGLE_ID = ? LIMIT 1`, [row.employee_id]);
    await writeToHikvision({ employeeId: row.employee_id, fullname: p ? p.fullname : row.employee_id, scannedAt: new Date(row.scanned_at), direction: row.direction, site: row.site_name });
  }
  await pool.query(
    `UPDATE mobile_scans SET status = ?, reviewed_by = ?, reviewed_at = NOW(),
       reject_reason = CASE WHEN ? = 'rejected' THEN ? ELSE reject_reason END WHERE id = ?`,
    [decision === 'approve' ? 'accepted' : 'rejected', reviewer, decision === 'approve' ? 'accepted' : 'rejected', note || null, id]);
  return { ok: true, row };
}

function _resetChallenges() { challenges.clear(); }

module.exports = {
  createChallenge, takeChallenge, verifyScan, reviewScan, decide, turnedAsAsked,
  FRONT_MAX_YAW, TURN_MIN_YAW, _resetChallenges
};
