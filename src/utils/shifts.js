// Canonical shift codes stored in schedule_entries. Screens show the Thai labels;
// the dashboard matches the lower-cased code ('morning'). Custom shift names from
// Settings are stored as typed.
const SHIFT_LABELS = { MORNING: 'เช้า', AFTERNOON: 'บ่าย', NIGHT: 'ดึก' };

const ALIASES = new Map([
  ['morning', 'MORNING'], ['เช้า', 'MORNING'], ['เวรเช้า', 'MORNING'], ['กะเช้า', 'MORNING'],
  ['afternoon', 'AFTERNOON'], ['บ่าย', 'AFTERNOON'], ['เวรบ่าย', 'AFTERNOON'], ['กะบ่าย', 'AFTERNOON'],
  ['night', 'NIGHT'], ['ดึก', 'NIGHT'], ['เวรดึก', 'NIGHT'], ['กะดึก', 'NIGHT']
]);

/** Value to store: canonical code for the three standard shifts, otherwise the trimmed name. */
function toShiftCode(value) {
  const raw = String(value == null ? '' : value).trim();
  return ALIASES.get(raw.toLowerCase()) || raw;
}

/** Value to display: Thai label for standard shifts, otherwise the stored name. */
function toShiftLabel(value) {
  const code = toShiftCode(value);
  return SHIFT_LABELS[code] || code;
}

module.exports = { SHIFT_LABELS, toShiftCode, toShiftLabel, ALIASES };
