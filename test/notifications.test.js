// Keep the real bots out of unit tests (dotenv never overrides variables that are already set)
for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_ID', 'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_ADMIN_USER_ID']) process.env[key] = '';
process.env.ENABLE_TELEGRAM_POLLING = 'false';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { describeLineError } = require('../src/services/notificationService');
const { validSignature } = require('../src/middleware/lineSignature');

test('LINE push errors are explained in Thai, quota exhaustion first', () => {
  assert.match(describeLineError({ status: 429, body: '{"message":"You have reached your monthly limit."}' }), /โควตา/);
  assert.match(describeLineError({ status: 429, body: '{"message":"Too many requests"}' }), /ถี่/);
  assert.match(describeLineError({ status: 401, body: '{}' }), /token/i);
  assert.match(describeLineError({ originalError: { response: { status: 400, data: { message: 'The property, \'to\', in the request body is invalid' } } } }), /User ID/);
  assert.match(describeLineError(new Error('socket hang up')), /socket hang up/);
});

test('LINE webhook signature check', () => {
  const body = Buffer.from('{"events":[]}');
  const sig = crypto.createHmac('sha256', 's3cret').update(body).digest('base64');
  assert.equal(validSignature(body, sig, 's3cret'), true);
  assert.equal(validSignature(body, sig, 'other'), false);
  assert.equal(validSignature(Buffer.from('{"events":[1]}'), sig, 's3cret'), false);
  assert.equal(validSignature(body, undefined, 's3cret'), false);
  assert.equal(validSignature(undefined, sig, 's3cret'), false);
});

test('routine LINE pushes follow LINE_PUSH_POLICY', () => {
  const svc = require('../src/services/notificationService');
  delete process.env.LINE_PUSH_POLICY;
  assert.equal(svc.routineLineId('U123'), null, 'default keeps LINE quota for important messages');
  process.env.LINE_PUSH_POLICY = 'all';
  assert.equal(svc.routineLineId('U123'), 'U123');
  delete process.env.LINE_PUSH_POLICY;
});
