const test = require('node:test');
const assert = require('node:assert/strict');
const { toShiftCode, toShiftLabel } = require('../src/utils/shifts');

test('standard shifts normalize to one code whatever screen wrote them', () => {
  for (const v of ['เช้า', 'MORNING', 'morning', ' Morning ', 'เวรเช้า']) assert.equal(toShiftCode(v), 'MORNING');
  assert.equal(toShiftCode('บ่าย'), 'AFTERNOON');
  assert.equal(toShiftCode('NIGHT'), 'NIGHT');
});

test('labels are Thai for standard shifts and unchanged for custom ones', () => {
  assert.equal(toShiftLabel('MORNING'), 'เช้า');
  assert.equal(toShiftLabel('night'), 'ดึก');
  assert.equal(toShiftCode('เวรพิเศษ OR'), 'เวรพิเศษ OR');
  assert.equal(toShiftLabel('เวรพิเศษ OR'), 'เวรพิเศษ OR');
  assert.equal(toShiftCode(null), '');
});
