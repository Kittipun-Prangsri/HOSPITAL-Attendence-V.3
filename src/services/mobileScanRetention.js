const { pool } = require('../config/db');
const { deletePhoto } = require('../utils/faceFiles');
const { getMobileScanSettings } = require('./mobileScanSettings');

/** Delete scan photos older than photoRetentionDays; the scan record (time, place, score) stays. */
async function purgeOldScanPhotos() {
  const { photoRetentionDays } = await getMobileScanSettings();
  const [rows] = await pool.query(
    `SELECT id, photo_file FROM mobile_scans
     WHERE photo_file IS NOT NULL AND status <> 'pending' AND scanned_at < DATE_SUB(NOW(), INTERVAL ? DAY) LIMIT 5000`,
    [photoRetentionDays]);
  for (const r of rows) {
    await deletePhoto(r.photo_file);
    await pool.query('UPDATE mobile_scans SET photo_file = NULL WHERE id = ?', [r.id]);
  }
  return rows.length;
}

module.exports = { purgeOldScanPhotos };
