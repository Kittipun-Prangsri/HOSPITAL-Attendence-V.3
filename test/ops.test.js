const test = require('node:test');
const assert = require('node:assert/strict');
const { formatEscalation } = require('../src/services/pendingEscalation');
const { monthsBetween } = require('../src/services/incidentRebuild');

test('escalation message lists overdue items and stays silent when none', () => {
  assert.equal(formatEscalation({}), null);
  const msg = formatEscalation({
    leaves: [{ fullname: 'ก' }, { fullname: 'ข' }, { fullname: 'ก' }],
    ots: [{ fullname: 'ค' }],
    excuses: []
  }, 2, 'https://hr.example/');
  assert.match(msg, /เกิน 2 วัน \(4 รายการ\)/);
  assert.match(msg, /ใบลา 3 รายการ: ก, ข/);
  assert.match(msg, /OT 1 รายการ: ค/);
  assert.doesNotMatch(msg, /คำร้องแก้ต่าง/);
  assert.match(msg, /https:\/\/hr\.example\/leave#approvals/);
});

test('escalation truncates long name lists', () => {
  const leaves = Array.from({ length: 8 }, (_, i) => ({ fullname: `คน${i}` }));
  assert.match(formatEscalation({ leaves }), /และอีก 3 คน/);
});

test('monthsBetween walks across years and validates input', () => {
  assert.deepEqual(monthsBetween('2025-11', '2026-02'), [[2025, 11], [2025, 12], [2026, 1], [2026, 2]]);
  assert.throws(() => monthsBetween('2026-13', '2026-14'));
  assert.throws(() => monthsBetween('2026-05', '2026-01'));
  assert.throws(() => monthsBetween('2020-01', '2026-01'), /36/);
});
