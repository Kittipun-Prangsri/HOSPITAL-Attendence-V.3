const test = require('node:test');
const assert = require('node:assert/strict');
const { isPermanent, relinkMessage } = require('../src/services/deadLinks');

test('only errors that can never succeed count towards unlinking', () => {
  for (const m of ['ETELEGRAM: 400 Bad Request: chat not found', 'ETELEGRAM: 403 Forbidden: bot was blocked by the user', 'ETELEGRAM: 403 Forbidden: user is deactivated']) {
    assert.equal(isPermanent(new Error(m)), true, m);
  }
  for (const m of ['ETELEGRAM: 429 Too Many Requests: retry after 5', 'ETELEGRAM: 502 Bad Gateway', 'EFATAL: socket hang up', "Bad Request: can't parse entities"]) {
    assert.equal(isPermanent(new Error(m)), false, m);
  }
  assert.equal(isPermanent(null), false);
});

test('the LINE notice tells people how to relink (LIFF link when configured)', () => {
  assert.match(relinkMessage('2000000000-abcd'), /https:\/\/liff\.line\.me\/2000000000-abcd/);
  assert.match(relinkMessage(''), /ติดต่อผู้ดูแลระบบ/);
});
