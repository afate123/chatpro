const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');
const NOW = Date.UTC(2026, 9, 8, 8);
const id = number => '00000000-0000-4000-8000-' + String(number).padStart(12, '0');
const config = () => C.clone(C.DEFAULTS);
const user = (key, time = NOW - 1000) => ({ id: key, author: { role: 'user' }, create_time: time / 1000,
  content: { content_type: 'text', parts: ['PRIVATE USER BODY'] } });
const assistant = (model = 'gpt-6-pro', time = NOW) => ({ id: 'reply', author: { role: 'assistant' },
  create_time: time / 1000, recipient: 'all', status: 'finished_successfully', channel: 'final',
  content: { content_type: 'text', parts: ['PRIVATE ASSISTANT BODY'] }, metadata: { model_slug: model } });
function detail(number, model = 'gpt-6-pro', time = NOW - 1000) {
  return { conversation_id: id(number), mapping: { u: { parent: null, message: user('u-' + number, time) },
    a: { parent: 'u', message: assistant(model, time + 500) } } };
}
function row(number, updated = NOW) { return { id: id(number), update_time: updated / 1000 }; }
async function batch(state, request, extra = {}) {
  const snapshots = [];
  const result = await C.scanBatch({ state, config: config(), request, now: () => NOW,
    save: async value => snapshots.push(C.clone(value)), ...extra });
  return { result, snapshots };
}
test('parses completed answer, keeps no body/title/raw message ID', async () => {
  const parsed = await C.parseConversation(detail(1), id(1), NOW, NOW - C.DAY);
  assert.equal(parsed.turns.length, 1);
  assert.equal(parsed.turns[0].model, 'gpt-6-pro');
  assert.match(parsed.turns[0].id, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(parsed), /PRIVATE|u-1|parts/);
});
test('regeneration counts once and uses the last successful model', async () => {
  const payload = detail(1);
  payload.mapping.retry = { parent: 'u', message: assistant('gpt-5-6-pro', NOW + 1000) };
  const parsed = await C.parseConversation(payload, id(1), NOW, NOW - C.DAY);
  assert.equal(parsed.turns.length, 1);
  assert.equal(parsed.turns[0].model, 'gpt-5-6-pro');
});
test('tool/analysis nodes do not count, nearest user ancestor handles tool chains', async () => {
  const payload = detail(1);
  payload.mapping.thinking = { parent: 'u', message: { ...assistant('wrong-pro'), channel: 'analysis' } };
  payload.mapping.tool = { parent: 'thinking', message: { author: { role: 'tool' } } };
  payload.mapping.a.parent = 'tool';
  const parsed = await C.parseConversation(payload, id(1), NOW, NOW - C.DAY);
  assert.equal(parsed.turns.length, 1);
  assert.equal(parsed.turns[0].model, 'gpt-6-pro');
});
test('failed, unfinished, missing model and new origins are unclassified', async () => {
  for (const change of [p => { p.mapping.a.message.status = 'in_progress'; },
    p => { delete p.mapping.a.message.metadata; }, p => { delete p.mapping.u.message.create_time; },
    p => { p.conversation_origin = 'new-unknown-origin'; }]) {
    const payload = detail(1); change(payload);
    const parsed = await C.parseConversation(payload, id(1), NOW, NOW - C.DAY);
    assert.equal(parsed.turns.length, 0); assert.equal(parsed.unknown.length, 1);
  }
});
test('Work, Codex and temporary details are excluded', async () => {
  for (const extra of [{ conversation_origin: 'tpp' }, { conversation_origin: 'flora' },
    { default_model_slug: 'gpt-6-wm' }, { default_model_slug: 'codex-test' }, { is_temporary_chat: true }]) {
    const parsed = await C.parseConversation({ ...detail(1), ...extra }, id(1), NOW, NOW - C.DAY);
    assert.equal(parsed.excluded, true); assert.equal(parsed.turns.length, 0);
  }
});
test('messages before cutoff are dropped, mismatched detail identity fails', async () => {
  assert.equal((await C.parseConversation(detail(1, 'gpt-6-pro', NOW - 2 * C.DAY), id(1), NOW, NOW - C.DAY)).turns.length, 0);
  await assert.rejects(C.parseConversation(detail(2), id(1), NOW, 0), /ID/);
});
test('cyclic malformed ancestry terminates and reports unclassified', async () => {
  const payload = detail(1); payload.mapping.a.parent = 'a';
  const parsed = await C.parseConversation(payload, id(1), NOW, 0);
  assert.equal(parsed.unknown.length, 1);
});
test('unknown/partial coverage hides remaining even when a limit is configured', async () => {
  const state = C.newState(), cfg = config(); cfg.buckets.forEach(bucket => { bucket.limit = 50; });
  state.conversations[id(1)] = await C.parseConversation(detail(1), id(1), NOW, NOW - 7 * C.DAY);
  assert.equal(C.totals(state, cfg, NOW).rows[0].remaining, null);
  state.coverage = { signature: C.coverageSignature(cfg), since: NOW - 7 * C.DAY, checkedAt: NOW, fullAt: NOW };
  assert.equal(C.totals(state, cfg, NOW).rows[0].remaining, 49);
  state.conversations[id(1)].unknown.push(NOW - 1000);
  assert.equal(C.totals(state, cfg, NOW).rows[0].remaining, null);
});
test('no cap assumed and shared count includes both models only once', async () => {
  const state = C.newState(), cfg = config();
  state.conversations[id(1)] = await C.parseConversation(detail(1), id(1), NOW, 0);
  state.conversations[id(2)] = await C.parseConversation(detail(2, 'gpt-5-6-pro'), id(2), NOW, 0);
  state.conversations[id(3)] = await C.parseConversation(detail(3, 'ordinary-model'), id(3), NOW, 0);
  state.conversations[id(4)] = C.clone(state.conversations[id(1)]);
  const rows = C.totals(state, cfg, NOW).rows;
  assert.deepEqual(rows.map(row => row.used), [1, 1, 2]);
  assert.deepEqual(rows.map(row => row.remaining), [null, null, null]);
});
test('rolling windows age out messages without another fetch; per-model days are independent', async () => {
  const state = C.newState(), cfg = config(); cfg.buckets[0].days = 1;
  state.conversations[id(1)] = await C.parseConversation(detail(1, 'gpt-6-pro', NOW - 2 * C.DAY), id(1), NOW, 0);
  assert.deepEqual(C.totals(state, cfg, NOW).rows.map(row => row.used), [0, 0, 1]);
  assert.equal(C.totals(state, cfg, NOW + 8 * C.DAY).rows[2].used, 0);
});
test('fixed periods roll forward at boundary and do not project remaining before anchor', () => {
  const cfg = config(); cfg.mode = 'fixed'; cfg.anchor = NOW; cfg.buckets[0].days = 1;
  assert.equal(C.windowFor(cfg, cfg.buckets[0], NOW - 1).active, false);
  assert.deepEqual(C.windowFor(cfg, cfg.buckets[0], NOW + C.DAY), { start: NOW + C.DAY, end: NOW + 2 * C.DAY, active: true });
});
test('a message stamped exactly now is counted inside the rolling window', async () => {
  const state = C.newState();
  state.conversations[id(1)] = await C.parseConversation(detail(1, 'gpt-6-pro', NOW), id(1), NOW, 0);
  assert.equal(C.totals(state, config(), NOW).rows[0].used, 1);
});
test('settings validate blank caps, reject bad values and ignore edited model slugs', () => {
  const cfg = config(); cfg.buckets[0].limit = ''; cfg.buckets[0].models = ['arbitrary-model'];
  assert.equal(C.settings(cfg).buckets[0].limit, null);
  assert.deepEqual(C.settings(cfg).buckets[0].models, ['gpt-6-pro']);
  cfg.buckets[0].days = 0; assert.throws(() => C.settings(cfg), /1–90/);
});
test('first scan reads both saved and archived history; later refresh only gets changed details', async () => {
  const state = C.newState(), calls = [];
  const request = async path => {
    calls.push(path);
    if (path.startsWith('/backend-api/conversation/')) return detail(Number(path.slice(-12)));
    return path.includes('is_archived=true') ? { items: [row(2)], total: 1 } : { items: [row(1)], total: 1 };
  };
  assert.equal((await batch(state, request)).result.status, 'complete');
  assert.equal(calls.filter(path => path.includes('/conversation/')).length, 2);
  calls.length = 0;
  assert.equal((await batch(state, request)).result.status, 'complete');
  assert.equal(calls.length, 2); // list only; archived coverage retained
  assert.deepEqual(C.totals(state, config(), NOW).rows.map(row => row.used), [2, 0, 2]);
});
test('detail budget checkpoints queue across process restart, no repeat detail downloads', async () => {
  let state = C.newState(); const calls = [];
  const request = async path => {
    calls.push(path);
    return path.includes('/conversation/') ? detail(Number(path.slice(-12))) :
      path.includes('is_archived=true') ? { items: [], total: 0 } : { items: [row(1), row(2), row(3)], total: 3 };
  };
  assert.equal((await batch(state, request, { detailBudget: 1 })).result.status, 'budget');
  assert.equal(state.job.queue.length, 2);
  state = C.clone(state);
  assert.equal((await batch(state, request, { detailBudget: 1 })).result.status, 'budget');
  assert.equal((await batch(state, request, { detailBudget: 1 })).result.status, 'complete');
  assert.equal(calls.filter(path => path.endsWith('/' + id(1))).length, 1);
  assert.equal(C.totals(state, config(), NOW).covered, true);
});
test('429 stops whole batch immediately and preserves failing queue item', async () => {
  const state = C.newState(), calls = [];
  const { result } = await batch(state, async path => {
    calls.push(path);
    if (path.includes('/conversation/')) throw new C.RateLimitError(NOW + 900000);
    return { items: [row(1), row(2)], total: 2 };
  });
  assert.equal(result.status, 'cooldown'); assert.equal(calls.length, 2);
  assert.equal(state.job.queue[0].id, id(1));
  assert.equal(state.lastBatch.cooldownUntil, NOW + 900000);
});
test('pause retains successful detail and pending queue', async () => {
  const state = C.newState(), controller = new AbortController();
  const { result } = await batch(state, async path => {
    if (path.includes('/conversation/')) { controller.abort(); return detail(1); }
    return { items: [row(1), row(2)], total: 2 };
  }, { signal: controller.signal });
  assert.equal(result.status, 'paused');
  assert.equal(state.conversations[id(1)].turns.length, 1);
  assert.equal(state.job.queue[0].id, id(2));
});
test('changed revision fetched, expanding cutoff refetches even unchanged conversation', async () => {
  const state = C.newState(); const paths = [];
  const request = async path => {
    paths.push(path);
    if (path.includes('/conversation/')) return detail(1);
    return path.includes('is_archived=true') ? { items: [], total: 0 } : { items: [row(1)], total: 1 };
  };
  await batch(state, request);
  state.conversations[id(1)].revision -= 1000;
  paths.length = 0; await batch(state, request);
  assert.equal(paths.filter(path => path.includes('/conversation/')).length, 1);
  const expanded = config(); expanded.buckets[0].days = 30;
  paths.length = 0; await batch(state, request, { config: expanded });
  assert.equal(paths.filter(path => path.includes('/conversation/')).length, 1);
  assert.equal(state.coverage.since, NOW - 30 * C.DAY);
});
test('work and temporary list rows never request transcript', async () => {
  const state = C.newState(), calls = [];
  await batch(state, async path => {
    calls.push(path);
    return path.includes('is_archived=true') ? { items: [], total: 0 } :
      { items: [{ ...row(1), conversation_origin: 'tpp' }, { ...row(2), is_temporary_chat: true },
        { id: 'non-chat-task', conversation_origin: 'codex' }, { is_temporary_chat: true }], total: 4 };
  });
  assert.equal(calls.length, 2); assert.equal(state.coverage.skipped, 4);
});
test('more than four pages can resume without permanent truncation or exceeding request budget', async () => {
  const state = C.newState(), calls = [];
  const all = Array.from({ length: 220 }, (_, index) => ({ ...row(index + 1, NOW - index), conversation_origin: 'tpp' }));
  const request = async path => {
    calls.push(path);
    const query = new URL(path, 'https://chatgpt.com').searchParams;
    if (query.get('is_archived') === 'true') return { items: [], total: 0 };
    const offset = Number(query.get('offset'));
    return { items: all.slice(offset, offset + 50), total: all.length };
  };
  for (let iteration = 0; iteration < 8; iteration++) {
    const { result } = await batch(state, request, { maxRequests: 2 });
    assert.ok(result.requests <= 2);
    if (result.status === 'complete') break;
  }
  assert.equal(state.job, null);
  assert.equal(state.coverage.skipped, 220);
  assert.ok(calls.some(path => path.includes('offset=200')));
});
test('full reconciliation drops vanished conversations and nightly scan is full', async () => {
  const state = C.newState();
  state.conversations[id(1)] = await C.parseConversation(detail(1), id(1), NOW, 0);
  state.coverage = { signature: C.coverageSignature(config()), since: NOW - 7 * C.DAY, checkedAt: NOW - C.DAY, fullAt: NOW - C.DAY };
  await batch(state, async () => ({ items: [], total: 0 }));
  assert.deepEqual(state.conversations, {}); assert.equal(state.coverage.fullAt, NOW);
});
test('bad schemas and unsorted lists cannot claim complete; retry keeps cursor', async () => {
  for (const response of [{ items: [{ id: 'bad-id', update_time: 1 }] },
    { items: [row(1, NOW - 1000), row(2, NOW)] }, { broken: true }]) {
    const state = C.newState();
    assert.equal((await batch(state, async () => response)).result.status, 'error');
    assert.equal(state.job.offsets[0], 0); assert.equal(C.totals(state, config(), NOW).covered, false);
  }
});
test('unchanged details do not hide previous unknown answers', async () => {
  const state = C.newState(), payload = detail(1); delete payload.mapping.a;
  await batch(state, async path => path.includes('/conversation/') ? payload :
    path.includes('is_archived=true') ? { items: [], total: 0 } : { items: [row(1)], total: 1 });
  const cfg = config(); cfg.buckets[0].limit = 50;
  assert.equal(C.totals(state, cfg, NOW).covered, true);
  assert.equal(C.totals(state, cfg, NOW).rows[0].remaining, null);
});
test('allowlist refuses other endpoints, redirects, origins and non-UUID transcripts', () => {
  assert.equal(C.allowedPath('/backend-api/conversation/' + id(1)), true);
  assert.equal(C.allowedPath('/backend-api/conversations?offset=0&limit=50&order=updated&is_archived=false'), true);
  for (const path of ['https://evil.test', '//evil.test', '/backend-api/conversation/not-an-id',
    '/backend-api/conversation/init', '/backend-api/conversations?unknown=1', '/api/auth/session#x', '/backend-api/wham/usage']) {
    assert.equal(C.allowedPath(path), false, path);
  }
});
test('Retry-After seconds/date honored, fallback backs off and has one-minute minimum', () => {
  assert.equal(C.retryUntil('120', NOW), NOW + 120000);
  assert.equal(C.retryUntil(new Date(NOW + 180000).toUTCString(), NOW), NOW + 180000);
  assert.equal(C.retryUntil(null, NOW), NOW + 900000);
  assert.equal(C.retryUntil('broken', NOW, 2), NOW + 1800000);
  assert.equal(C.retryUntil('1', NOW), NOW + 60000);
});
function mockClient(fetcher, data = {}) {
  let clock = NOW; const waits = [];
  const api = new C.ApiClient({ fetcher, get: async (key, fallback) => data[key] ?? fallback,
    set: async (key, value) => { data[key] = value; }, now: () => clock,
    wait: async ms => { waits.push(ms); clock += ms; } });
  return { api, data, waits };
}
test('request gate persists 429 cooldown and rejects subsequent requests before fetch', async () => {
  let calls = 0;
  const { api, data } = mockClient(async () => { calls++; return new Response('{}', { status: 429, headers: { 'Retry-After': '120' } }); });
  await assert.rejects(api.request('/api/auth/session'), C.RateLimitError);
  assert.equal(data.gate.until, NOW + 120000);
  await assert.rejects(api.request('/api/auth/session'), C.RateLimitError);
  assert.equal(calls, 1);
});
test('serial gate enforces spacing and token is only in the outgoing headers', async () => {
  const requests = [];
  const { api, data, waits } = mockClient(async (url, options) => {
    requests.push({ url, options }); return new Response('{}', { status: 200 });
  });
  await api.request('/api/auth/session');
  await api.request('/backend-api/conversation/' + id(1), { token: 'SECRET-TOKEN', accountId: 'account-one' });
  assert.deepEqual(waits, [2500]);
  assert.equal(requests[1].options.headers.Authorization, 'Bearer SECRET-TOKEN');
  assert.equal(requests[1].options.redirect, 'error');
  assert.doesNotMatch(JSON.stringify(data), /SECRET/);
});
test('HTTP login/server errors and HTML responses fail without automatic retries', async () => {
  for (const status of [401, 403, 500]) {
    let calls = 0;
    const { api } = mockClient(async () => { calls++; return new Response('{}', { status }); });
    await assert.rejects(api.request('/api/auth/session')); assert.equal(calls, 1);
  }
  const { api } = mockClient(async () => new Response('<html>challenge</html>'));
  await assert.rejects(api.request('/api/auth/session'), error => {
    assert.doesNotMatch(error.message, /html|challenge/); return true;
  });
});
test('response size is bounded and a pre-aborted request never fetches', async () => {
  const { api } = mockClient(async () => new Response('{}', { headers: { 'Content-Length': String(9 * 1024 * 1024) } }));
  await assert.rejects(api.request('/api/auth/session'), /8 MiB/);
  let calls = 0; const other = mockClient(async () => { calls++; return new Response('{}'); });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(other.api.request('/api/auth/session', null, controller.signal), { name: 'AbortError' });
  assert.equal(calls, 0);
});
test('account and user changes produce separate storage identities; no email required', async () => {
  const token = account => 'header.' + Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: account } })).toString('base64url') + '.signature';
  const first = await C.sessionIdentity({ user: { id: 'u1' }, accessToken: token('a1') });
  const accountChange = await C.sessionIdentity({ user: { id: 'u1' }, accessToken: token('a2') });
  const userChange = await C.sessionIdentity({ user: { id: 'u2' }, accessToken: token('a1') });
  assert.notEqual(first.key, accountChange.key); assert.notEqual(first.key, userChange.key);
  assert.equal(first.accountId, 'a1');
  await assert.rejects(C.sessionIdentity({ user: { id: 'u1' } }), /登录/);
});
