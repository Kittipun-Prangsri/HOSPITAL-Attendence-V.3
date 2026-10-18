const test = require('node:test');
const assert = require('node:assert/strict');
const { buildViewSql, profileOverrides } = require('../src/services/staffStore');

test('v_staff exposes HOSoffice columns, hides link/token columns, lets app values win', () => {
  const sql = buildViewSql({ hospitalDb: 'hdb', hosofficeDb: 'hos', columns: ['ID', 'HR_FNAME', 'HR_PHONE', 'USER_TYPE', 'LINE_YOUR_USER_ID', 'LINE_TOKEN'] });
  assert.match(sql, /VIEW `hdb`\.v_staff/);
  assert.match(sql, /FROM `hos`\.hr_person p/);
  assert.match(sql, /p\.`HR_FNAME`/);
  assert.doesNotMatch(sql, /LINE_YOUR_USER_ID|LINE_TOKEN/);
  assert.match(sql, /IF\(a\.disabled, NULL, COALESCE\(a\.role, CONVERT\(p\.`USER_TYPE` USING utf8mb4\)/);
  assert.match(sql, /COALESCE\(sp\.phone, CONVERT\(p\.`HR_PHONE`/);
  // Columns missing on this server fall back to the app value only
  assert.match(sql, /COALESCE\(a\.password_hash, NULL\)\) AS `HR_PASSWORD_HASH`/);
  assert.match(sql, /COALESCE\(sp\.work_shift, NULL\), ''\) AS `WORK_SHIFT`/);
});

test('profile overrides: equal to HOSoffice → follow it (NULL); cleared → blank; changed → stored', () => {
  assert.deepEqual(
    profileOverrides({ HR_PHONE: '02-1', HR_EMAIL: null, NICKNAME: 'หญิง', WORK_SHIFT: undefined, BOGUS: 'x' },
      { HR_PHONE: ' 02-1 ', HR_EMAIL: 'a@b', NICKNAME: null }),
    { phone: null, email: '', nickname: 'หญิง' });
  assert.deepEqual(profileOverrides({ HR_EMAIL: null }, { HR_EMAIL: null }), { email: null });
});
