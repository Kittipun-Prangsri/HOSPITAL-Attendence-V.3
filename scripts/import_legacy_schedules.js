require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');

const DATA_DIR = path.join(__dirname, '..', 'data');

function addIfWorking(entries, employeeId, date, shift) {
  if (!employeeId || !date || !shift || ['OFF', 'EMPTY'].includes(String(shift).trim().toUpperCase())) return;
  entries.set(`${employeeId}\u0000${date}`, [String(employeeId), date, String(shift).trim(), 'legacy-import']);
}

function collectLegacyEntries() {
  const entries = new Map();
  const weeklyPath = path.join(DATA_DIR, 'schedule.json');
  if (fs.existsSync(weeklyPath)) {
    const weekly = JSON.parse(fs.readFileSync(weeklyPath, 'utf8'));
    if (!Array.isArray(weekly)) throw new Error('data/schedule.json must contain an array');
    weekly.forEach(item => addIfWorking(entries, item.emp_id, item.date, item.shift));
  }

  const monthlyDir = path.join(DATA_DIR, 'monthly_schedules');
  if (fs.existsSync(monthlyDir)) {
    for (const file of fs.readdirSync(monthlyDir)) {
      const match = /^schedule_(\d{4})_(\d{2})\.json$/.exec(file);
      if (!match) continue;
      const payload = JSON.parse(fs.readFileSync(path.join(monthlyDir, file), 'utf8'));
      for (const [employeeId, days] of Object.entries(payload.schedule || {})) {
        for (const [day, shift] of Object.entries(days || {})) {
          const dayNumber = Number(day);
          if (Number.isInteger(dayNumber) && dayNumber >= 1 && dayNumber <= 31) {
            addIfWorking(entries, employeeId, `${match[1]}-${match[2]}-${String(dayNumber).padStart(2, '0')}`, shift);
          }
        }
      }
    }
  }
  return [...entries.values()];
}

async function importSchedules() {
  const entries = collectLegacyEntries();
  if (entries.length === 0) {
    console.log('[schedule-import] No legacy schedule entries found.');
    return;
  }
  await pool.query(
    `INSERT INTO schedule_entries (employee_id, schedule_date, shift, created_by) VALUES ?
     ON DUPLICATE KEY UPDATE shift = VALUES(shift), created_by = VALUES(created_by)`,
    [entries]
  );
  console.log(`[schedule-import] Imported ${entries.length} schedule entries. Legacy JSON files were not changed.`);
}

importSchedules()
  .then(() => process.exit(0))
  .catch(error => { console.error('[schedule-import] Failed:', error.message); process.exit(1); });
