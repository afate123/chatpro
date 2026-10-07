const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');
const strictSettings = () => ({ ...C.automaticSettings(), mode: 'server' });
const NOW = Date.UTC(2026, 9, 8, 8), WEEK = 7 * C.DAY;
const reset = new Date(NOW + 2 * C.DAY).toISOString();
const signals = () => ({ model_limits: ['gpt-6-pro', 'gpt-5-6-pro'].map(model_slug => ({ model_slug, resets_after: reset })),
  blocked_features: [{ feature_name: 'reason', limit: 50, resets_after: reset }] });
test('account selection binds to current identity and rejects another account', () => {
  const payload = { accounts: { a1: { account: { account_id: 'a1', plan_type: 'pro' } },
    a2: { account: { account_id: 'a2' }, entitlement: { subscription_plan: 'chatgptproliteplan' } } } };
  assert.deepEqual(C.accountMetadata(payload, 'a2'), { accountId: 'a2', plan: 'prolite' });
  assert.throws(() => C.accountMetadata(payload, 'different'));
  assert.throws(() => C.accountMetadata(payload));
});
test('subscription dates never produce dialogue reset or cap', async () => {
  const info = C.subscriptionMetadata({ account_id: 'a1', plan_type: 'pro', active_start: '2026-10-01T00:00:00Z',
    active_until: '2026-11-01T00:00:00Z' }, 'a1');
  const cfg = C.applyQuota(strictSettings(), C.quotaMetadata({}, info.plan, {}, NOW));
  assert.equal(C.coverageSince(cfg, NOW), Infinity);
  assert.deepEqual(C.totals(C.newState(), cfg, NOW).rows.map(row => row.used), [null, null, null]);
  let requests = 0;
  const result = await C.scanBatch({ state: C.newState(), config: cfg, now: () => NOW,
    request: async () => { requests++; }, save: async () => {} });
  assert.equal(result.status, 'needs-window'); assert.equal(requests, 0);
});
test('unknown period does not present unclassified messages or pending items from a legacy seven-day job', async () => {
  const state = C.newState(), cfg = strictSettings();
  state.conversations.saved = { turns: [], unknown: [NOW - 1000] };
  state.job = { signature: C.coverageSignature(C.DEFAULTS), pages: 1, queue: Array(44).fill({ id: 'old' }) };
  state.lastBatch = { status: 'budget', at: NOW };
  assert.equal(C.totals(state, cfg, NOW).pending, 0);
  assert.deepEqual(C.totals(state, cfg, NOW).rows.map(row => row.unknown), [null, null, null]);
  let saved = false;
  const result = await C.scanBatch({ state, config: cfg, now: () => NOW,
    request: async () => { throw new Error('must not request history'); }, save: async () => { saved = true; } });
  assert.equal(result.status, 'needs-window'); assert.equal(state.job, null); assert.equal(saved, true);
  assert.equal(state.lastBatch, null); assert.ok(state.conversations.saved);
});
test('period metadata can invalidate a legacy checkpoint without deleting conversation cache', () => {
  const state = C.newState(), cfg = C.applyQuota(strictSettings(), C.quotaMetadata(signals(), 'prolite', {}, NOW));
  state.job = { signature: 'legacy-seven-days', queue: [] };
  state.coverage = { signature: 'legacy-seven-days' };
  state.conversations.keep = { turns: [], unknown: [] };
  assert.equal(C.reconcileState(state, cfg, NOW), true);
  assert.equal(state.job, null); assert.equal(state.coverage, null); assert.ok(state.conversations.keep);
  state.job = { signature: C.coverageSignature(cfg), queue: [] };
  assert.equal(C.reconcileState(state, cfg, NOW), false); assert.ok(state.job);
});
test('quota diagnostic retains actual limits_progress values while omitting credentials and free text', () => {
  const diagnostic = C.quotaDiagnostics({ accessToken: 'SECRET_TOKEN', email: 'PRIVATE_EMAIL',
    model_limits: [], blocked_features: [], limits_progress: [{ feature_name: 'reason', limit: 50, remaining: 47,
      reset_after: reset, model_slugs: ['gpt-6-pro', 'gpt-5-6-pro'], description: 'PRIVATE_BODY', cookie: 'SECRET_COOKIE' }] });
  assert.equal(diagnostic.model_limits.count, 0);
  assert.equal(diagnostic.limits_progress.rows[0].remaining, 47);
  assert.equal(diagnostic.limits_progress.rows[0].reset_after, reset);
  assert.doesNotMatch(JSON.stringify(diagnostic), /SECRET_TOKEN|PRIVATE_EMAIL|PRIVATE_BODY|SECRET_COOKIE/);
});
test('diagnostic status distinguishes missing values in an old export from an empty live quota response', () => {
  const cfg = strictSettings();
  assert.match(C.quotaStatus({ fields: { init: ['limits_progress'] }, issues: [] }, cfg, NOW), /旧诊断缺少/);
  assert.match(C.quotaStatus({ diagnostics: C.quotaDiagnostics({ model_limits: [], limits_progress: [] }) }, cfg, NOW), /model_limits=0/);
  assert.match(C.quotaStatus({ issues: ['HTTP 403'] }, cfg, NOW), /403/);
});
test('foreign subscription identity fails instead of mixing billing metadata', () => {
  assert.throws(() => C.subscriptionMetadata({ account_id: 'another' }, 'current'), /不匹配/);
});
test('verified account selection controls storage even with stale token account claims', async () => {
  const token = 'header.' + Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'old' } })).toString('base64url') + '.signature';
  const identity = await C.sessionIdentity({ user: { id: 'user' }, accessToken: token }, 'verified');
  assert.equal(identity.accountId, 'verified');
  assert.equal(identity.key, await C.hash('user:verified'));
});
test('shared Pro 100 throttle anchors start to server reset minus week, never now minus week', () => {
  const quota = C.quotaMetadata(signals(), 'prolite', {}, NOW);
  assert.equal(quota.rows.shared.start, NOW + 2 * C.DAY - WEEK);
  assert.equal(quota.rows.shared.end, NOW + 2 * C.DAY);
  assert.equal(quota.rows.shared.limit, 50);
  assert.equal(quota.rows.gpt6.limit, null); // per-model values are subdivisions of the shared cap
  assert.equal(quota.rows.gpt56.start, quota.rows.shared.start);
});
test('only messages after the last reset count, with next reset excluded', () => {
  const cfg = C.applyQuota(strictSettings(), C.quotaMetadata({ message_usage: [{
    models: ['gpt-6-pro', 'gpt-5-6-pro'], window_start: new Date(NOW - 5 * C.DAY).toISOString(),
    reset_at: reset, limit: 50, unit: 'messages' }] }, 'prolite', {}, NOW));
  const start = cfg.buckets[2].start;
  const state = C.newState();
  state.conversations.a = { turns: [
    { id: 'before', time: start - 1, model: 'gpt-6-pro' },
    { id: 'after', time: start + 1, model: 'gpt-6-pro' },
    { id: 'newer', time: NOW - 1, model: 'gpt-5-6-pro' }
  ], unknown: [] };
  state.coverage = { signature: C.coverageSignature(cfg), since: start, checkedAt: NOW };
  const rows = C.totals(state, cfg, NOW).rows;
  assert.deepEqual(rows.map(row => row.used), [1, 1, 2]);
  assert.equal(rows[2].remaining, 48);
});
test('server exhaustion overrides incomplete history and never estimates a positive remainder', () => {
  const cfg = C.applyQuota(strictSettings(), C.quotaMetadata(signals(), 'prolite', {}, NOW));
  const row = C.totals(C.newState(), cfg, NOW).rows[2];
  assert.equal(row.remaining, 0); assert.equal(row.blocked, true);
});
test('unrelated token usage and a model without a known duration cannot establish a counting boundary', () => {
  const quota = C.quotaMetadata({ message_usage: [{ models: ['gpt-6-pro', 'gpt-5-6-pro'], unit: 'tokens',
    window_start: new Date(NOW - C.DAY).toISOString(), reset_at: reset, limit: 50000 }],
    model_limits: [{ model_slug: 'gpt-5-6-pro', resets_after: reset }] }, 'business', {}, NOW);
  assert.equal(quota.rows.shared, undefined); assert.equal(quota.rows.gpt56.start, null);
});
test('reason cap cannot be applied to a different tier or non-Pro throttle', () => {
  assert.equal(C.quotaMetadata(signals(), 'business', {}, NOW).rows.shared, undefined);
  const payload = signals(); payload.model_limits.pop();
  assert.equal(C.quotaMetadata(payload, 'prolite', {}, NOW).rows.shared, undefined);
});
test('server explicit windows supported, expired deadlines not extrapolated into invented next reset', () => {
  const initial = C.quotaMetadata({ model_limits: [{ model_slug: 'gpt-5-6-pro', limit: 170,
    resets_after: reset, last_reset_at: new Date(NOW - C.DAY).toISOString() }] }, 'pro', {}, NOW);
  assert.equal(initial.rows.gpt56.start, NOW - C.DAY);
  const expired = C.quotaMetadata({}, 'pro', initial, NOW + 3 * C.DAY);
  assert.equal(expired.rows.gpt56.start, NOW + 2 * C.DAY);
  assert.equal(expired.rows.gpt56.end, null);
});
test('empty model limits retains an already observed boundary within its period', () => {
  const first = C.quotaMetadata(signals(), 'prolite', {}, NOW);
  const second = C.quotaMetadata({}, 'prolite', first, NOW + 1000);
  assert.equal(second.rows.shared.start, first.rows.shared.start);
});
test('after an observed reset, a missing next deadline must not produce a remaining estimate', () => {
  const old = C.quotaMetadata(signals(), 'prolite', {}, NOW);
  const later = NOW + 3 * C.DAY;
  const quota = C.quotaMetadata({}, 'prolite', old, later);
  const cfg = C.applyQuota(strictSettings(), quota), state = C.newState();
  state.coverage = { signature: C.coverageSignature(cfg), since: cfg.buckets[2].start };
  assert.equal(C.totals(state, cfg, later).rows[2].remaining, null);
  assert.equal(C.totals(state, cfg, later).rows[2].blocked, false);
});
test('automatic runner continues all budget batches without more clicks', async () => {
  let clock = NOW, calls = 0; const waits = [];
  const result = await C.scanAutomatically({ now: () => clock, batchDelay: 60000,
    wait: async ms => { waits.push(ms); clock += ms; },
    execute: async () => ({ status: ++calls < 4 ? 'budget' : 'complete' }) });
  assert.equal(result.status, 'complete'); assert.equal(calls, 4);
  assert.equal(waits.reduce((a, b) => a + b, 0), 180000);
  assert.ok(waits.every(ms => ms <= 30000));
});
test('automatic runner waits through initial and in-batch 429, then resumes', async () => {
  let clock = NOW, calls = 0;
  const result = await C.scanAutomatically({ now: () => clock, getCooldown: async () => NOW + 60000,
    wait: async ms => { clock += ms; }, execute: async () => {
      assert.ok(clock >= NOW + 60000);
      calls++;
      if (calls === 1) throw new C.RateLimitError(clock + 120000);
      if (calls === 2) return { status: 'cooldown', error: new C.RateLimitError(clock + 60000) };
      return { status: 'complete' };
    } });
  assert.equal(result.status, 'complete'); assert.equal(calls, 3);
  assert.ok(clock >= NOW + 240000);
});
test('pause cancels a waiting automatic run before any next batch', async () => {
  let calls = 0; const controller = new AbortController();
  await assert.rejects(C.scanAutomatically({ signal: controller.signal,
    getCooldown: async () => NOW + 60000, now: () => NOW,
    wait: async () => { controller.abort(); }, execute: async () => { calls++; } }), { name: 'AbortError' });
  assert.equal(calls, 0);
});
test('non-rate-limit error and missing cycle stop automation instead of retrying forever', async () => {
  let calls = 0;
  const result = await C.scanAutomatically({ execute: async () => { calls++; return { status: 'needs-window' }; } });
  assert.equal(result.status, 'needs-window'); assert.equal(calls, 1);
  await assert.rejects(C.scanAutomatically({ execute: async () => { throw new Error('login'); } }), /login/);
});
test('metadata requests constrained; init payload cannot send a question', async () => {
  assert.equal(C.allowedPath('/backend-api/subscriptions?account_id=abc-123'), true);
  assert.equal(C.allowedPath('/backend-api/subscriptions?account_id=abc&extra=1'), false);
  assert.equal(C.allowedPath('/backend-api/conversation/init', 'POST'), true);
  assert.equal(C.allowedPath('/backend-api/conversation', 'POST'), false);
  let sent;
  const api = new C.ApiClient({ now: () => NOW, get: async () => ({}), set: async () => {},
    fetcher: async (url, options) => { sent = options; return new Response('{}'); } });
  await api.request('/backend-api/conversation/init', { token: 'SECRET' }, null, 'POST');
  assert.equal(sent.method, 'POST');
  const payload = JSON.parse(sent.body);
  assert.equal(payload.conversation_id, null); assert.equal(payload.messages, undefined);
  assert.equal(payload.timezone_offset_min, new Date().getTimezoneOffset());
});
