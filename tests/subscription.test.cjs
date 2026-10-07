const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');
const START = Date.parse('2026-10-01T09:00:00Z');
const UNTIL = Date.parse('2026-11-01T09:00:00Z');
const NOW = Date.parse('2026-10-08T10:00:00+08:00');
const info = { plan: 'prolite', activeStart: START, activeUntil: UNTIL };
const configure = (now = NOW, quota = {}) => C.applyQuota(C.automaticSettings(), quota, info, now);

test('default automatic mode accepts the supplied billing anchor and estimates the current week', () => {
  const cfg = configure();
  assert.equal(cfg.mode, 'subscription');
  assert.equal(C.coverageSince(cfg, NOW), START);
  assert.equal(cfg.buckets[2].limit, 50);
  assert.deepEqual(cfg.buckets.slice(0, 2).map(row => row.limit), [null, null]);
  for (const row of cfg.buckets) {
    assert.equal(row.estimated, true);
    assert.equal(C.windowFor(cfg, row, NOW).end, Date.parse('2026-10-08T09:00:00Z'));
    assert.match(row.source, /订阅起始/);
  }
});

test('subscription week stays anchored across days and advances at the exact second', () => {
  const cfg = configure(), next = START + 7 * C.DAY;
  assert.equal(C.coverageSince(cfg, next - 1), START);
  assert.equal(C.coverageSince(cfg, next), next);
  const advanced = configure(next);
  assert.equal(advanced.buckets[2].end, START + 14 * C.DAY);
  assert.notEqual(C.coverageSignature(cfg), C.coverageSignature(advanced));
});

test('subscription estimate excludes old turns and counts both models against one cap', () => {
  const cfg = configure(), state = C.newState();
  state.conversations.a = { turns: [
    { id: 'old', time: START - 1, model: 'gpt-6-pro' },
    { id: 'at-start', time: START, model: 'gpt-6-pro' },
    { id: 'g56', time: NOW - 1, model: 'gpt-5-6-pro' }
  ], unknown: [] };
  state.coverage = { signature: C.coverageSignature(cfg), since: START, checkedAt: NOW };
  assert.deepEqual(C.totals(state, cfg, NOW).rows.map(row => row.used), [1, 1, 2]);
  assert.deepEqual(C.totals(state, cfg, NOW).rows.map(row => row.remaining), [null, null, 48]);
  assert.equal(C.totals(state, cfg, START + 7 * C.DAY).rows[2].remaining, null);
});

test('pending or unclassified history does not claim a complete remaining estimate', () => {
  const cfg = configure(), state = C.newState();
  state.coverage = { signature: C.coverageSignature(cfg), since: START, checkedAt: NOW };
  state.conversations.a = { turns: [], unknown: [NOW - 1] };
  assert.equal(C.totals(state, cfg, NOW).rows[2].remaining, null);
  state.conversations.a.unknown = [];
  state.job = { signature: C.coverageSignature(cfg), queue: [] };
  assert.equal(C.totals(state, cfg, NOW).rows[2].remaining, null);
});

test('server cap and reset supersede subscription anchor and invalidate old progress', () => {
  const end = NOW + C.DAY;
  const quota = C.quotaMetadata({ model_limits: ['gpt-6-pro', 'gpt-5-6-pro'].map(model_slug =>
    ({ model_slug, resets_after: new Date(end).toISOString() })),
    blocked_features: [{ feature_name: 'reason', limit: 60, resets_after: new Date(end).toISOString() }] }, 'prolite', {}, NOW);
  const before = configure(), cfg = configure(NOW, quota), state = C.newState();
  state.job = { signature: C.coverageSignature(before), queue: [] };
  state.conversations.keep = { turns: [], unknown: [] };
  assert.equal(C.reconcileState(state, cfg, NOW), true);
  assert.ok(state.conversations.keep);
  assert.equal(cfg.buckets[2].start, end - 7 * C.DAY);
  assert.equal(cfg.buckets[2].limit, 60);
  assert.equal(cfg.buckets[2].estimated, false);
  assert.equal(C.totals(state, cfg, NOW).rows[2].remaining, 0);
});

test('calibrated weeks repeat from observed reset after an empty later response', () => {
  const announced = NOW + C.DAY;
  const prior = { rows: { shared: { start: announced - 7 * C.DAY, end: announced, limit: 60, blocked: true } } };
  const later = announced + 8 * C.DAY;
  const quota = C.quotaMetadata({}, 'prolite', prior, later), cfg = configure(later, quota);
  assert.equal(cfg.buckets[2].start, announced + 7 * C.DAY);
  assert.equal(cfg.buckets[2].end, announced + 14 * C.DAY);
  assert.equal(cfg.buckets[2].limit, 60);
  assert.equal(cfg.buckets[2].estimated, true);
  assert.equal(cfg.buckets[2].blocked, false);
  assert.match(cfg.buckets[2].source, /服务器重置推算/);
});

test('single model reset can calibrate shared dates without marking both models exhausted', () => {
  const quota = C.quotaMetadata({ model_limits: [{ model_slug: 'gpt-6-pro',
    resets_after: new Date(NOW + C.DAY).toISOString() }] }, 'prolite', {}, NOW);
  const cfg = configure(NOW, quota);
  assert.equal(cfg.buckets[2].end, NOW + C.DAY);
  assert.equal(cfg.buckets[2].blocked, false);
  assert.equal(cfg.buckets[0].blocked, true);
});

test('other plans, missing, expired and future subscriptions never acquire the Pro 100 fallback', () => {
  for (const subscription of [null, { ...info, plan: 'plus' },
    { ...info, activeStart: null }, { ...info, activeStart: NOW + 1 }, { ...info, activeUntil: NOW }]) {
    const cfg = C.applyQuota(C.automaticSettings(), {}, subscription, NOW);
    assert.equal(C.coverageSince(cfg, NOW), Infinity);
    assert.equal(cfg.buckets[2].limit, null);
  }
  assert.equal(C.coverageSince(configure(), UNTIL), Infinity);
});

test('manual settings keep their specified period and cap', () => {
  const manual = C.settings({ ...C.DEFAULTS, mode: 'fixed', anchor: START,
    buckets: C.DEFAULTS.buckets.map(row => ({ ...row, limit: 40 })) });
  const cfg = C.applyQuota(manual, {}, info, NOW);
  assert.equal(cfg.mode, 'fixed');
  assert.equal(cfg.buckets[2].limit, 40);
});

test('old empty diagnostic can start an automatic history scan without further quota fields', async () => {
  const quota = C.quotaMetadata({ model_limits: [], blocked_features: [], limits_progress: [
    { feature_name: 'deep_research', remaining: 125 }, { feature_name: 'image_gen', remaining: 1000 }
  ] }, 'prolite', {}, NOW);
  const cfg = configure(NOW, quota), state = C.newState();
  let requests = 0;
  const result = await C.scanAutomatically({ now: () => NOW,
    execute: () => C.scanBatch({ state, config: cfg, now: () => NOW, save: async () => {},
      request: async () => { requests++; return { items: [], total: 0 }; } }) });
  assert.equal(result.status, 'complete');
  assert.equal(requests, 2);
  assert.equal(C.totals(state, cfg, NOW).rows[2].remaining, 50);
});
