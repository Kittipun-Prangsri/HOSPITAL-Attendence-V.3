const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureIncidentsSynced, markIncidentsStale, TTL_MS, _reset } = require('../src/services/incidentSync');

test('syncs once per TTL and shares concurrent runs', async () => {
  _reset();
  let calls = 0;
  let t = 1000;
  const sync = async () => { calls++; await new Promise(r => setTimeout(r, 5)); };
  await Promise.all([ensureIncidentsSynced(2026, 10, sync, () => t), ensureIncidentsSynced(2026, 10, sync, () => t)]);
  assert.equal(calls, 1);
  await ensureIncidentsSynced(2026, 10, sync, () => t + 1000);
  assert.equal(calls, 1);
  await ensureIncidentsSynced(2026, 10, sync, () => t + TTL_MS + 1);
  assert.equal(calls, 2);
});

test('marking a month stale forces the next view to resync', async () => {
  _reset();
  let calls = 0;
  const sync = async () => { calls++; };
  await ensureIncidentsSynced(2026, 9, sync);
  await ensureIncidentsSynced(2026, 10, sync);
  markIncidentsStale({ from: '2026-09-28', to: '2026-10-02' });
  await ensureIncidentsSynced(2026, 9, sync);
  await ensureIncidentsSynced(2026, 10, sync);
  assert.equal(calls, 4);
  markIncidentsStale('2026-10-15');
  await ensureIncidentsSynced(2026, 10, sync);
  assert.equal(calls, 5);
});

test('a failed sync is retried on the next call', async () => {
  _reset();
  let calls = 0;
  const failing = async () => { calls++; throw new Error('db down'); };
  await assert.rejects(ensureIncidentsSynced(2026, 1, failing));
  await assert.rejects(ensureIncidentsSynced(2026, 1, failing));
  assert.equal(calls, 2);
});
