const test = require('node:test');
const assert = require('node:assert/strict');
const { csrfProtection } = require('../src/middleware/csrf');

function run(req) {
  const res = { locals: {}, statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  let nextCalled = false;
  req.get = h => (req.headers || {})[h.toLowerCase()];
  csrfProtection(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

test('issues a token for signed-in users and allows safe methods', () => {
  const req = { method: 'GET', path: '/api/leaves', session: { user: { username: 'u' } } };
  const { res, nextCalled } = run(req);
  assert.equal(nextCalled, true);
  assert.equal(res.locals.csrfToken.length, 64);
});

test('blocks state-changing API calls without the right token', () => {
  const session = { user: { username: 'u' }, csrfToken: 'a'.repeat(64) };
  assert.equal(run({ method: 'POST', path: '/api/leaves', session }).res.statusCode, 403);
  assert.equal(run({ method: 'POST', path: '/api/leaves', session, headers: { 'x-csrf-token': 'b'.repeat(64) } }).res.statusCode, 403);
  assert.equal(run({ method: 'DELETE', path: '/api/holidays/2026-10-23', session, headers: { 'x-csrf-token': 'a'.repeat(63) } }).res.statusCode, 403);
  assert.equal(run({ method: 'POST', path: '/api/leaves', session, headers: { 'x-csrf-token': 'a'.repeat(64) } }).nextCalled, true);
});

test('leaves webhooks, device pushes and anonymous requests to their own checks', () => {
  assert.equal(run({ method: 'POST', path: '/webhook', session: { user: { username: 'u' } } }).nextCalled, true);
  assert.equal(run({ method: 'POST', path: '/api/attendance', session: { user: { username: 'u' }, csrfToken: 'x' } }).nextCalled, true);
  assert.equal(run({ method: 'POST', path: '/api/leaves', session: {} }).nextCalled, true);
});
