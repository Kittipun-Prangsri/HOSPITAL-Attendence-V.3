const test = require('node:test');
const assert = require('node:assert/strict');
const { expandRanges } = require('../src/services/holidays');
const { validateOutage } = require('../src/controllers/calendarController');

test('outage ranges expand to days clipped to the requested window', () => {
  const days = expandRanges([{ start: '2025-12-09', end: '2026-01-04' }], '2025-12-01', '2025-12-31');
  assert.equal(days.size, 23);
  assert.ok(days.has('2025-12-09') && days.has('2025-12-31'));
  assert.ok(!days.has('2025-12-08') && !days.has('2026-01-01'));
  assert.equal(expandRanges([{ start: '2026-02-27', end: '2026-03-02' }], '2026-02-01', '2026-02-28').size, 2);
  assert.equal(expandRanges([], '2026-01-01', '2026-01-31').size, 0);
});

test('outage validation', () => {
  const ok = validateOutage({ start_date: '2025-12-09', end_date: '2026-01-04', reason: ' เครื่องดับ ' });
  assert.deepEqual(ok.value, { start_date: '2025-12-09', end_date: '2026-01-04', reason: 'เครื่องดับ', days: 27 });
  assert.ok(validateOutage({ start_date: '2026-01-04', end_date: '2025-12-09', reason: 'x' }).error);
  assert.ok(validateOutage({ start_date: '2026-01-01', end_date: '2026-06-30', reason: 'x' }).error, 'too long');
  assert.ok(validateOutage({ start_date: '2026-01-01', end_date: '2026-01-02', reason: '' }).error);
  assert.ok(validateOutage({ start_date: '2026-13-01', end_date: '2026-01-02', reason: 'x' }).error);
});
