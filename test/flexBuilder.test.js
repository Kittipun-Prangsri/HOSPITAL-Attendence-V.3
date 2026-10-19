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

test('excuse card separates "explain a late/absent day" from "apply for leave"', () => {
  const { buildExcuseFlex } = require('../src/services/flexBuilder');
  const saved = { LIFF_ID: process.env.LIFF_ID, SYSTEM_URL: process.env.SYSTEM_URL };
  try {
    Object.assign(process.env, { LIFF_ID: '2000000000-abcd', SYSTEM_URL: 'https://attendance.example.org/' });
    const uris = buildExcuseFlex({ fullname: 'ก ข' }).footer.contents.map(b => [b.action.label, b.action.uri]);
    assert.equal(uris.length, 2);
    assert.match(uris[0][0], /แจ้งสาเหตุ/);
    assert.equal(uris[0][1], 'https://liff.line.me/2000000000-abcd?tab=month', 'excuse opens the LIFF month calendar');
    assert.match(uris[1][0], /ยื่นใบลา/);
    assert.equal(uris[1][1], 'https://attendance.example.org/leave', 'leave opens the leave page');
    uris.forEach(([label]) => assert.ok([...label].length <= 40, 'LINE button label limit'));

    process.env.LIFF_ID = '';
    assert.equal(buildExcuseFlex().footer.contents[0].action.uri, 'https://attendance.example.org/excuses', 'web form without LIFF');
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
