const test = require('node:test');
const assert = require('node:assert/strict');
const { determineStatusType, buildAttendanceFlex } = require('../src/services/flexBuilder');

test('determineStatusType correctly handles uppercase and lowercase directions', () => {
  assert.equal(determineStatusType('IN', 'i', 'Success', false), 'check-in');
  assert.equal(determineStatusType('out', 'o', 'Success', false), 'check-out');
  assert.equal(determineStatusType('IN', 'i', 'Success', true), 'late');
  assert.equal(determineStatusType('in', 'i', 'Failed', false), 'failed');
});

test('buildAttendanceFlex returns valid LINE Flex Message object', () => {
  const flex = buildAttendanceFlex({
    fullname: 'ทดสอบ ระบบ',
    employeeId: 'EMP001',
    direction: 'IN',
    attendanceStatus: 'i',
    authResult: 'Success',
    dateThai: '6 ตุลาคม 2569',
    timeStr: '08:15:00',
    deviceName: 'ประตูหน้า',
    temperature: '36.5',
    isLate: false
  });

  assert.equal(flex.type, 'bubble');
  assert.equal(flex.size, 'mega');
  assert.equal(flex.header.type, 'box');
  assert.equal(flex.body.type, 'box');
  assert.equal(flex.footer.type, 'box');
});
