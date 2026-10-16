const { pool } = require('../config/db');
const { lateThresholdFor } = require('../utils/attendanceTime');

const DEFAULTS = { workStart: '08:00', lateMin: 31 };
const TTL_MS = 60 * 1000;
let cache = { value: null, at: 0 };

/**
 * Work-time settings saved from the settings modal (app_settings.work_settings).
 * Cached for a minute because the realtime notifier polls every few seconds.
 * Returns { workStart, lateMin, stored } — stored=false means no saved settings yet.
 */
async function getWorkSettings() {
  if (cache.value && Date.now() - cache.at < TTL_MS) return cache.value;
  let value = { ...DEFAULTS, stored: false };
  try {
    const [rows] = await pool.query("SELECT setting_value FROM app_settings WHERE setting_key = 'work_settings'");
    if (rows.length) {
      const raw = typeof rows[0].setting_value === 'string' ? JSON.parse(rows[0].setting_value) : rows[0].setting_value;
      value = { workStart: raw.workStart || DEFAULTS.workStart, lateMin: Number.isFinite(Number(raw.lateMin)) ? Number(raw.lateMin) : DEFAULTS.lateMin, stored: true };
    }
  } catch (err) {
    console.warn('[workSettings] using defaults:', err.message);
  }
  cache = { value, at: Date.now() };
  return value;
}

/** Saved settings win; otherwise fall back to what an older client sent, then defaults. */
async function resolveWorkSettings(fallback = {}) {
  const s = await getWorkSettings();
  if (s.stored) return s;
  return {
    workStart: fallback.workStart || DEFAULTS.workStart,
    lateMin: Number.isFinite(parseInt(fallback.lateMin, 10)) ? parseInt(fallback.lateMin, 10) : DEFAULTS.lateMin,
    stored: false
  };
}

async function getLateThreshold() {
  return lateThresholdFor(await getWorkSettings());
}

function clearWorkSettingsCache() {
  cache = { value: null, at: 0 };
}

module.exports = { getWorkSettings, resolveWorkSettings, getLateThreshold, clearWorkSettingsCache, DEFAULTS };
