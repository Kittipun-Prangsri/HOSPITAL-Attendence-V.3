const { pool } = require('../config/db');

const KEY = 'mobile_scan';
const TTL_MS = 60 * 1000;

// Disabled until an admin sets the real hospital location and turns it on
const DEFAULTS = {
  enabled: false,
  sites: [],                 // [{ name, lat, lng, radiusM }]
  maxAccuracyM: 100,         // GPS fixes less precise than this are not trusted as "inside"
  matchThreshold: 0.45,      // similarity at/above → accepted
  reviewThreshold: 0.35,     // between review and match → pending for a person to check
  photoRetentionDays: 90
};

let cache = { value: null, at: 0 };

function validate(input) {
  const p = input || {};
  const num = (v, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
  const sites = Array.isArray(p.sites) ? p.sites : [];
  if (sites.length > 10) return { error: 'กำหนดจุดได้ไม่เกิน 10 จุด' };
  const cleanSites = [];
  for (const s of sites) {
    const name = typeof s.name === 'string' ? s.name.trim().slice(0, 100) : '';
    const lat = num(s.lat, -90, 90);
    const lng = num(s.lng, -180, 180);
    const radiusM = num(s.radiusM, 20, 5000);
    if (!name || lat === null || lng === null || radiusM === null) return { error: 'ข้อมูลจุดสแกนไม่ถูกต้อง (ชื่อ, ละติจูด, ลองจิจูด, รัศมี 20–5000 ม.)' };
    cleanSites.push({ name, lat, lng, radiusM });
  }
  const maxAccuracyM = num(p.maxAccuracyM, 10, 1000);
  const matchThreshold = num(p.matchThreshold, 0.2, 0.95);
  const reviewThreshold = num(p.reviewThreshold, 0.1, 0.95);
  const photoRetentionDays = num(p.photoRetentionDays, 7, 3650);
  if (maxAccuracyM === null) return { error: 'ความแม่นยำ GPS ต้องอยู่ระหว่าง 10–1000 เมตร' };
  if (matchThreshold === null || reviewThreshold === null || reviewThreshold > matchThreshold) {
    return { error: 'เกณฑ์ความเหมือนไม่ถูกต้อง (เกณฑ์ส่งตรวจต้องไม่สูงกว่าเกณฑ์ผ่าน)' };
  }
  if (photoRetentionDays === null) return { error: 'ระยะเวลาเก็บภาพต้องอยู่ระหว่าง 7–3650 วัน' };
  const enabled = Boolean(p.enabled);
  if (enabled && !cleanSites.length) return { error: 'ต้องกำหนดจุดสแกนอย่างน้อย 1 จุดก่อนเปิดใช้งาน' };
  return { value: { enabled, sites: cleanSites, maxAccuracyM, matchThreshold, reviewThreshold, photoRetentionDays: Math.round(photoRetentionDays) } };
}

async function getMobileScanSettings() {
  if (cache.value && Date.now() - cache.at < TTL_MS) return cache.value;
  let value = { ...DEFAULTS };
  try {
    const [rows] = await pool.query('SELECT setting_value FROM app_settings WHERE setting_key = ?', [KEY]);
    if (rows.length) {
      const raw = typeof rows[0].setting_value === 'string' ? JSON.parse(rows[0].setting_value) : rows[0].setting_value;
      const { value: v } = validate({ ...DEFAULTS, ...raw });
      if (v) value = v;
    }
  } catch (err) {
    console.warn('[mobileScan] settings unavailable, using defaults:', err.message);
  }
  cache = { value, at: Date.now() };
  return value;
}

async function saveMobileScanSettings(value, updatedBy) {
  await pool.query(
    `INSERT INTO app_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [KEY, JSON.stringify(value), updatedBy]
  );
  cache = { value: null, at: 0 };
}

/** Great-circle distance in metres. */
function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = d => d * Math.PI / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Nearest configured site and whether the fix is inside it (accuracy must also be good enough). */
function locate(settings, lat, lng, accuracyM) {
  let best = null;
  for (const s of settings.sites) {
    const d = distanceM(lat, lng, s.lat, s.lng);
    if (!best || d < best.distanceM) best = { site: s.name, distanceM: Math.round(d * 10) / 10, radiusM: s.radiusM };
  }
  if (!best) return { site: null, distanceM: null, inside: false };
  const accurate = Number.isFinite(accuracyM) && accuracyM <= settings.maxAccuracyM;
  return { ...best, inside: accurate && best.distanceM <= best.radiusM };
}

module.exports = { KEY, DEFAULTS, validate, getMobileScanSettings, saveMobileScanSettings, distanceM, locate };
