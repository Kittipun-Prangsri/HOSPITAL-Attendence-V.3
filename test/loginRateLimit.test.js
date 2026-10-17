const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { loginRateLimit, MAX_ATTEMPTS, _reset } = require('../src/middleware/loginRateLimit');

function attempt(username, finalStatus, ip = '10.0.0.1') {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.status = c => { res.statusCode = c; return res; };
  res.render = () => res;
  let passed = false;
  loginRateLimit({ ip, body: { username } }, res, () => { passed = true; });
  if (passed) { res.statusCode = finalStatus; res.emit('finish'); }
  return passed;
}

test('successful logins never count toward the limit (shared NAT/proxy IP)', () => {
  _reset();
  for (let i = 0; i < 50; i++) assert.equal(attempt(`user${i}`, 302), true);
  for (let i = 0; i < 50; i++) assert.equal(attempt('same-user', 302), true);
});

test('repeated failures lock only that username on that IP', () => {
  _reset();
  for (let i = 0; i < MAX_ATTEMPTS; i++) assert.equal(attempt('victim', 200), true);
  assert.equal(attempt('victim', 200), false);
  assert.equal(attempt('someone-else', 302), true);
  assert.equal(attempt('victim', 302, '10.0.0.2'), true);
});

test('a successful login clears earlier failures', () => {
  _reset();
  for (let i = 0; i < MAX_ATTEMPTS - 1; i++) attempt('u', 200);
  attempt('u', 302);
  for (let i = 0; i < MAX_ATTEMPTS; i++) assert.equal(attempt('u', 200), true);
});
