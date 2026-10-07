/* ChatPro. AGPL-3.0-only; see LICENSE and THIRD_PARTY.md.
 * Original source notices: THIRD_PARTY.md. Current rules are documented in docs/QUOTA_POLICY.md.
 * Windows userscript, resumable scan and request gate added 2026-10-08.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatProCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const MODEL = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;
  const DEFAULTS = {
    mode: 'rolling', anchor: null, allowanceProfile: 'auto',
    buckets: [
      { id: 'gpt6', label: 'GPT-6 Pro', models: ['gpt-6-pro'], days: 7, limit: null },
      { id: 'gpt56', label: 'GPT-5.6 Pro', models: ['gpt-5-6-pro'], days: 7, limit: null },
      { id: 'shared', label: '两个 Pro 模型合计', models: ['gpt-6-pro', 'gpt-5-6-pro'], days: 7, limit: null }
    ]
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  function timestamp(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value * 1000 : null;
    if (typeof value === 'string') {
      const time = Date.parse(value);
      return Number.isFinite(time) && time > 0 ? time : null;
    }
    return null;
  }
  async function hash(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function isWork(origin, model) {
    return ['tpp', 'flora', 'codex'].includes(String(origin || '').toLowerCase()) ||
      /-wm$|codex/i.test(model || '');
  }
  function settings(input = DEFAULTS) {
    const result = clone(DEFAULTS);
    if (!object(input) || !['subscription', 'server', 'rolling', 'fixed'].includes(input.mode)) throw new Error('周期类型无效。');
    result.mode = input.mode;
    result.allowanceProfile = input.allowanceProfile || 'auto';
    if (!['auto', 'pro100', 'pro200-100', 'pro200-200', 'pro500'].includes(result.allowanceProfile)) throw new Error('套餐额度规则无效。');
    result.anchor = input.anchor;
    if (result.mode === 'fixed' && (!Number.isFinite(input.anchor) || input.anchor <= 0)) {
      throw new Error('请填写固定周期的起始时间。');
    }
    result.buckets = result.buckets.map(base => {
      const row = input.buckets?.find(item => item.id === base.id);
      if (!row) throw new Error('缺少模型配置。');
      const days = Number(row.days);
      if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('周期必须是 1–90 的整数天数。');
      const limit = row.limit === '' || row.limit == null ? null : Number(row.limit);
      if (limit != null && (!Number.isInteger(limit) || limit < 1 || limit > 1000000)) {
        throw new Error('上限请留空，或填写 1–1000000 的整数。');
      }
      return { ...base, days, limit, start: Number.isFinite(row.start) ? row.start : null,
        end: Number.isFinite(row.end) ? row.end : null, source: row.source || null, blocked: row.blocked === true,
        estimated: row.estimated === true, limitSource: row.limitSource || null,
        cycleAnchor: Number.isFinite(row.cycleAnchor) ? row.cycleAnchor : null,
        validUntil: Number.isFinite(row.validUntil) ? row.validUntil : null };
    });
    return result;
  }
  function windowFor(config, bucket, now) {
    const duration = bucket.days * DAY;
    if (config.mode === 'subscription' && bucket.cycleAnchor != null) {
      const start = bucket.cycleAnchor + Math.max(0, Math.floor((now - bucket.cycleAnchor) / duration)) * duration;
      return { start, end: start + duration, active: start <= now &&
        (bucket.validUntil == null || now < bucket.validUntil) };
    }
    if (['server', 'subscription'].includes(config.mode)) return { start: bucket.start, end: bucket.end,
      active: Number.isFinite(bucket.start) && bucket.start <= now &&
        (bucket.end == null || bucket.end > now) };
    if (config.mode === 'rolling') return { start: now - duration, end: now, active: true };
    if (now < config.anchor) return { start: config.anchor, end: config.anchor + duration, active: false };
    const start = config.anchor + Math.floor((now - config.anchor) / duration) * duration;
    return { start, end: start + duration, active: true };
  }
  function coverageSince(config, now) {
    return Math.min(...config.buckets.map(bucket => windowFor(config, bucket, now))
      .filter(window => window.active && Number.isFinite(window.start)).map(window => window.start));
  }
  function coverageSignature(config) {
    return JSON.stringify([config.mode, config.anchor, config.buckets.map(b => [b.id, b.days,
      ['server', 'subscription'].includes(config.mode) ? [b.start, b.end, b.cycleAnchor, b.validUntil] : null])]);
  }
  function newState() {
    return { version: 1, conversations: {}, job: null, coverage: null, lastBatch: null };
  }
  async function parseConversation(detail, id, revision, since) {
    if (!object(detail) || detail.conversation_id !== id || !object(detail.mapping)) {
      throw new Error('会话详情结构或 ID 不符，已暂停。');
    }
    if (isWork(detail.conversation_origin, detail.default_model_slug) || detail.is_temporary_chat === true) {
      return { revision, parsedSince: since, turns: [], unknown: [], excluded: true };
    }
    const mapping = detail.mapping;
    const users = new Map();
    const replies = new Map();
    const originKnown = detail.conversation_origin == null || ['chat', 'chatgpt'].includes(detail.conversation_origin);
    for (const [key, node] of Object.entries(mapping)) {
      const message = node?.message;
      if (message?.author?.role !== 'user') continue;
      const time = timestamp(message.create_time);
      if (time != null && time < since) continue;
      users.set(key, { message, time });
    }
    // Resolve the nearest user ancestor; memoization keeps long tool chains linear.
    const owners = new Map(Array.from(users.keys(), key => [key, key]));
    for (const [key, node] of Object.entries(mapping)) {
      const message = node?.message;
      if (message?.author?.role !== 'assistant' || message.recipient !== 'all' ||
          message.status !== 'finished_successfully' ||
          (message.channel != null && message.channel !== 'final') ||
          !['text', 'multimodal_text'].includes(message.content?.content_type)) continue;
      const path = [], visited = new Set();
      let cursor = key, owner = null;
      while (cursor && !visited.has(cursor)) {
        visited.add(cursor);
        if (owners.has(cursor)) { owner = owners.get(cursor); break; }
        if (mapping[cursor]?.message?.author?.role === 'user') break;
        path.push(cursor);
        cursor = mapping[cursor]?.parent;
      }
      for (const ancestor of path) owners.set(ancestor, owner);
      if (!owner) continue;
      const previous = replies.get(owner);
      if (!previous || (timestamp(message.create_time) ?? 0) > (timestamp(previous.create_time) ?? 0)) {
        replies.set(owner, message);
      }
    }
    const turns = new Map(), unknown = [];
    for (const [key, { message, time }] of users) {
      const reply = replies.get(key), model = reply?.metadata?.model_slug;
      if (!originKnown || typeof message.id !== 'string' || !message.id || time == null ||
          typeof model !== 'string' || !MODEL.test(model)) {
        unknown.push(time); continue;
      }
      if (isWork(detail.conversation_origin, model)) continue;
      const identity = await hash(id + ':' + message.id);
      turns.set(identity, { id: identity, time, model });
    }
    return { revision, parsedSince: since, turns: Array.from(turns.values()), unknown, excluded: false };
  }
  function totals(state, config, now = Date.now()) {
    const unique = new Map();
    const unknownTimes = [];
    for (const conversation of Object.values(state.conversations)) {
      if (conversation.excluded) continue;
      for (const turn of conversation.turns) unique.set(turn.id, turn);
      unknownTimes.push(...conversation.unknown);
    }
    const coverage = state.coverage;
    const covered = Number.isFinite(coverageSince(config, now)) && !state.job && coverage?.signature === coverageSignature(config) &&
      coverage.since <= coverageSince(config, now) && (config.mode !== 'subscription' ||
        coverage.checkedAt >= coverageSince(config, now));
    const rows = config.buckets.map(bucket => {
      const window = windowFor(config, bucket, now);
      const known = Number.isFinite(window.start) && window.active;
      const inWindow = time => time >= window.start && time <= now &&
        (window.end == null || (config.mode === 'rolling' ? time <= window.end : time < window.end));
      const used = known ? Array.from(unique.values()).filter(turn => bucket.models.includes(turn.model) &&
        inWindow(turn.time)).length : null;
      const unknown = known ? unknownTimes.filter(time => time == null ||
        inWindow(time)).length : null;
      const complete = Boolean(covered && known && unknown === 0);
      const blocked = ['server', 'subscription'].includes(config.mode) && bucket.blocked && bucket.end > now;
      return { ...bucket, window, used, unknown, complete, blocked,
        remaining: blocked ? 0 : complete && bucket.limit != null &&
          (!['server', 'subscription'].includes(config.mode) || Number.isFinite(window.end)) ? Math.max(0, bucket.limit - used) : null };
    });
    const currentJob = state.job?.signature === coverageSignature(config) && Number.isFinite(coverageSince(config, now));
    return { rows, covered: Boolean(covered), lastCheckedAt: coverage?.checkedAt ?? null,
      lastFullAt: coverage?.fullAt ?? null, pending: currentJob ? state.job.queue.length : 0 };
  }
  class RateLimitError extends Error {
    constructor(until) { super('请求被限流，已暂停整轮扫描。'); this.name = 'RateLimitError'; this.until = until; }
  }
  function retryUntil(header, now, streak = 1) {
    let duration;
    if (header && /^\d+(?:\.\d+)?$/.test(header.trim())) duration = Number(header) * 1000;
    else if (header) duration = Date.parse(header) - now;
    if (!Number.isFinite(duration) || duration <= 0) duration = Math.min(6 * 3600000, 15 * 60000 * 2 ** Math.min(streak - 1, 5));
    return now + Math.max(60000, duration);
  }
  function abortError() { return new DOMException('扫描已暂停。', 'AbortError'); }
  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(abortError()); return; }
      const finish = () => { signal?.removeEventListener('abort', cancel); resolve(); };
      const timer = setTimeout(finish, ms);
      const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(abortError()); };
      signal?.addEventListener('abort', cancel, { once: true });
    });
  }
  function allowedPath(path, method = 'GET') {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\#]/.test(path)) return false;
    const url = new URL(path, 'https://chatgpt.com');
    if (url.origin !== 'https://chatgpt.com') return false;
    if (method === 'POST') return path === '/backend-api/conversation/init';
    if (method !== 'GET') return false;
    if (path === '/api/auth/session') return true;
    if (path === '/backend-api/accounts/check/v4-2023-04-27') return true;
    if (url.pathname === '/backend-api/subscriptions') return Array.from(url.searchParams).every(([key, value]) =>
      key === 'account_id' && /^[A-Za-z0-9_-]{1,200}$/.test(value));
    if (url.pathname === '/backend-api/conversations') {
      return Array.from(url.searchParams).every(([key, value]) =>
        (['offset', 'limit'].includes(key) && /^\d+$/.test(value)) ||
        (key === 'order' && value === 'updated') ||
        (key === 'is_archived' && ['true', 'false'].includes(value)));
    }
    return !url.search && url.pathname.startsWith('/backend-api/conversation/') && UUID.test(url.pathname.slice(26));
  }
  async function readJSON(response, signal) {
    const maximum = 8 * 1024 * 1024;
    const parse = text => {
      try { return JSON.parse(text); }
      catch { throw new Error('接口返回的内容不是有效 JSON，已暂停。'); }
    };
    if (Number(response.headers.get('Content-Length')) > maximum) throw new Error('响应超过 8 MiB，已暂停。');
    if (response.body?.getReader) {
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let size = 0, text = '';
      try {
        while (true) {
          if (signal?.aborted) throw abortError();
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > maximum) throw new Error('响应超过 8 MiB，已暂停。');
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
        return parse(text);
      } finally { await reader.cancel().catch(() => {}); }
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximum) throw new Error('响应超过 8 MiB，已暂停。');
    return parse(text);
  }
  class ApiClient {
    constructor({ fetcher, get, set, now = Date.now, wait = sleep, interval = 2500 }) {
      Object.assign(this, { fetcher, get, set, now, wait, interval });
    }
    async request(path, auth, signal, method = 'GET') {
      if (!allowedPath(path, method)) throw new Error('拒绝了扫描范围以外的接口。');
      let gate = await this.get('gate', {});
      if (gate.until > this.now()) throw new RateLimitError(gate.until);
      const delay = Math.max(0, (gate.lastRequestAt || 0) + this.interval - this.now());
      if (delay) await this.wait(delay, signal);
      if (signal?.aborted) throw abortError();
      gate = await this.get('gate', {});
      if (gate.until > this.now()) throw new RateLimitError(gate.until);
      await this.set('gate', { ...gate, lastRequestAt: this.now() });
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(cancel, 15000);
      try {
        const headers = { Accept: 'application/json' };
        if (auth?.token) headers.Authorization = 'Bearer ' + auth.token;
        if (auth?.accountId) headers['ChatGPT-Account-Id'] = auth.accountId;
        if (method === 'POST') headers['Content-Type'] = 'application/json';
        const response = await this.fetcher('https://chatgpt.com' + path, {
          method, headers, credentials: 'include', mode: 'same-origin', redirect: 'error',
          body: method === 'POST' ? JSON.stringify({ conversation_id: null, gizmo_id: null,
            requested_default_model: null, system_hints: [], timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            timezone_offset_min: new Date().getTimezoneOffset() }) : undefined,
          cache: 'no-store', signal: controller.signal
        });
        if (response.status === 429) {
          gate = await this.get('gate', {});
          const streak = gate.last429At && this.now() - gate.last429At < DAY ? (gate.streak || 0) + 1 : 1;
          const until = retryUntil(response.headers.get('Retry-After'), this.now(), streak);
          await this.set('gate', { ...gate, streak, until, last429At: this.now() });
          await response.body?.cancel().catch(() => {});
          throw new RateLimitError(until);
        }
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          if ([401, 403].includes(response.status)) throw new Error('登录失效或接口拒绝访问，请重新登录后再试。');
          throw new Error('接口返回 HTTP ' + response.status + '，已暂停。');
        }
        const data = await readJSON(response, controller.signal);
        if (!object(data)) throw new Error('接口没有返回可识别的数据。');
        return data;
      } catch (error) {
        if (signal?.aborted) throw abortError();
        if (controller.signal.aborted) throw new Error('请求超过 15 秒，已暂停，可稍后续扫。');
        throw error;
      } finally { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); }
    }
  }
  async function sessionIdentity(session, verifiedAccountId = null) {
    const userId = session?.user?.id, token = session?.accessToken;
    if (typeof userId !== 'string' || !userId || typeof token !== 'string' || !token) throw new Error('请先在 ChatGPT 网页登录。');
    let claims = {};
    try {
      const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      claims = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')));
    } catch { /* Opaque web tokens can still authenticate the default personal account. */ }
    const accountId = verifiedAccountId || claims['https://api.openai.com/auth']?.chatgpt_account_id || session.account?.id || null;
    if (accountId != null && (typeof accountId !== 'string' || !accountId)) throw new Error('账号标识无法识别。');
    return { key: await hash(userId + ':' + (accountId || 'personal-default')), token, accountId };
  }
  function automaticSettings() { return { ...clone(DEFAULTS), mode: 'subscription' }; }
  function normalizePlan(value) {
    if (typeof value !== 'string') return null;
    const key = value.toLowerCase().replace(/[^a-z0-9]/g, '');
    return ({ chatgptproliteplan: 'prolite', prolite: 'prolite', pro100: 'prolite',
      chatgptproplan: 'pro', pro: 'pro', pro200: 'pro',
      chatgptpro500plan: 'pro500', pro500: 'pro500',
      chatgptplusplan: 'plus', plus: 'plus' })[key] || value.slice(0, 80);
  }
  function accountMetadata(payload, expectedId) {
    const source = payload?.accounts;
    const records = Array.isArray(source) ? source.map(record => [null, record]) :
      object(source) ? Object.entries(source) : [];
    const rows = records.map(([key, record]) => ({ record, account: record?.account || record,
      id: record?.account?.account_id || record?.account?.id || record?.account_id || key }));
    const selected = expectedId ? rows.find(row => row.id === expectedId) :
      rows.find(row => row.id === (payload.default_account_id || payload.default_account)) ||
      rows.find(row => row.account?.is_default === true) || (rows.length === 1 ? rows[0] : null);
    if (!selected || typeof selected.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(selected.id)) {
      throw new Error('账号列表无法唯一匹配当前账号，已停止识别。');
    }
    const entitlement = selected.record?.entitlement;
    return { accountId: selected.id, plan: normalizePlan(entitlement?.subscription_plan || selected.account?.plan_type) };
  }
  function subscriptionMetadata(payload, expectedId) {
    if (!object(payload)) throw new Error('订阅信息格式无法识别。');
    if (payload.account_id && payload.account_id !== expectedId) throw new Error('订阅账号不匹配。');
    return { plan: normalizePlan(payload.plan_type || payload.subscription_plan),
      activeStart: timestamp(payload.active_start), activeUntil: timestamp(payload.active_until || payload.expires_at),
      billingPeriod: typeof payload.billing_period === 'string' ? payload.billing_period : null };
  }
  function quotaMetadata(payload, plan, previous = {}, now = Date.now()) {
    const rows = {};
    const models = Array.isArray(payload?.model_limits) ? payload.model_limits : [];
    const sharedWeek = ['prolite', 'pro_100', 'pro100', 'pro', 'pro200'].includes(String(plan).toLowerCase());
    const durationFor = id => sharedWeek ? 7 * DAY : plan === 'pro' ? id === 'gpt6' ? 7 * DAY : id === 'gpt56' ? DAY : null : null;
    for (const bucket of DEFAULTS.buckets) {
      const old = previous.rows?.[bucket.id];
      // A past announced reset is an observed lower boundary, not evidence of the next deadline.
      if (old?.end && old.end <= now) rows[bucket.id] = { ...old, start: old.end, end: null, blocked: false, source: '最近已观察的服务器重置边界（后续周期未确认）' };
      else if (old?.start) rows[bucket.id] = { ...clone(old), blocked: false };
    }
    // Optional explicit message-usage rows: only a matching set of Pro slugs can establish a bucket.
    const usage = Array.isArray(payload?.message_usage) ? payload.message_usage :
      object(payload?.message_usage) ? [payload.message_usage] : [];
    for (const item of usage) {
      if (item.unit != null && item.unit !== 'messages') continue;
      const slugs = Array.isArray(item.models) ? item.models : [item.model_slug];
      const bucket = DEFAULTS.buckets.find(row => row.models.length === slugs.length && row.models.every(slug => slugs.includes(slug)));
      if (!bucket) continue;
      const start = timestamp(item.last_reset_at || item.window_start);
      const end = timestamp(item.resets_after || item.reset_at || item.window_end);
      if (!start || !end || start > now || end <= now || end - start > 90 * DAY || end <= start) continue;
      const limit = Number.isInteger(item.limit) && item.limit > 0 && item.limit <= 1000000 ? item.limit : null;
      rows[bucket.id] = { start, end, limit, limitObservedAt: limit != null ? now : null, blocked: false, source: '服务器明确返回的消息周期' };
      if (sharedWeek && bucket.id === 'shared') {
        for (const id of ['gpt6', 'gpt56']) if (!rows[id]) rows[id] = { start, end, limit: null, blocked: false, source: '共享周额度的模型分项' };
      }
    }
    for (const item of models) {
      const bucket = DEFAULTS.buckets.find(row => row.models.length === 1 && row.models[0] === item.model_slug);
      if (!bucket) continue;
      const end = timestamp(item.resets_after || item.reset_at);
      if (!end || end <= now) continue;
      const seconds = item.window_seconds ?? item.limit_window_seconds;
      const duration = Number.isFinite(seconds) && seconds > 0 && seconds <= 90 * 86400 ? seconds * 1000 : durationFor(bucket.id);
      const explicitStart = timestamp(item.last_reset_at || item.window_start);
      const start = explicitStart ?? (duration ? end - duration : null);
      const limit = Number.isInteger(item.limit) && item.limit > 0 ? item.limit : rows[bucket.id]?.limit ?? null;
      if (start == null || start <= now) rows[bucket.id] = { start, end, limit,
        limitObservedAt: Number.isInteger(item.limit) && item.limit > 0 ? now : rows[bucket.id]?.limitObservedAt ?? null, blocked: true,
        source: explicitStart ? '服务器返回周期' : '服务器重置时间与已知窗口长度' };
    }
    let blocked = payload?.blocked_features;
    if (object(blocked)) blocked = Object.entries(blocked).map(([name, value]) => ({ ...value, feature_name: name }));
    // The known shared weekly `reason` throttle must be linked to both Pro slugs.
    const proBlocked = DEFAULTS.buckets[2].models.every(slug => models.some(row => row.model_slug === slug &&
      timestamp(row.resets_after || row.reset_at) > now));
    const reason = Array.isArray(blocked) ? blocked.find(row => row.feature_name === 'reason') : null;
    if (sharedWeek && proBlocked && reason) {
      const end = timestamp(reason.resets_after || reason.reset_after);
      const limit = Number.isInteger(reason.limit) && reason.limit > 0 ? reason.limit : null;
      const matchingReset = DEFAULTS.buckets[2].models.every(slug => models.some(row => row.model_slug === slug &&
        Math.abs(timestamp(row.resets_after || row.reset_at) - end) <= 60000));
      if (end && end > now && matchingReset) {
        const shared = { start: end - 7 * DAY, end, limit, limitObservedAt: limit != null ? now : null, blocked: true, source: '服务器 reason 共享周额度' };
        rows.shared = shared;
        for (const id of ['gpt6', 'gpt56']) rows[id] = { ...shared, limit: null, source: '共享周额度的模型分项' };
      }
    }
    return { rows, checkedAt: now, modelLimitsReported: models.length };
  }
  const PRO200_POLICY = Object.freeze({
    eligibilityStart: Date.parse('2026-09-22T00:00:00-07:00'),
    eligibilityEnd: Date.parse('2026-09-29T10:00:00-07:00'),
    // Help Center specifies calendar dates, not an exact expiry instant.
    // Use midnight Pacific after October 29 as a local fallback convention.
    lowerAllowanceFrom: Date.parse('2026-10-30T00:00:00-07:00')
  });
  function pro200Eligibility(subscription, now = Date.now()) {
    const start = subscription?.activeStart, until = subscription?.activeUntil;
    return subscription?.pro200Qualified === true || (normalizePlan(subscription?.plan) === 'pro' &&
      Number.isFinite(start) && Number.isFinite(until) && until > start && start <= now &&
      start <= PRO200_POLICY.eligibilityEnd && until > PRO200_POLICY.eligibilityStart);
  }
  function pro200Allowance(subscription, now = Date.now(), profile = 'auto') {
    if (now >= PRO200_POLICY.lowerAllowanceFrom) return { limit: 100, reason: '旧资格期限已结束 · 共享每周 100 次' };
    if (profile === 'pro200-100') return { limit: 100, reason: '已选择普通额度 · 共享每周 100 次' };
    if (profile === 'pro200-200' || pro200Eligibility(subscription, now)) {
      return { limit: 200, reason: '旧资格额度 · 共享每周 200 次，至 2026-10-29（太平洋日期）' };
    }
    return { limit: null, reason: '旧资格待确认：需在 2026-09-22 至 09-29 10:00（太平洋时间）曾有有效 Pro $200 订阅' };
  }
  // User-selected allowance presets. Billing dates anchor the
  // estimate only; observed server windows and caps always take precedence.
  function subscriptionQuota(subscription, quota, now = Date.now(), profile = 'auto') {
    const rows = clone(quota?.rows || {});
    const plan = normalizePlan(subscription?.plan);
    const tier = profile === 'auto' ? plan === 'prolite' ? 'pro100' : plan === 'pro' ? 'pro200' : plan === 'pro500' ? 'pro500' : null : profile;
    if (!tier) return { ...quota, rows };
    const start = subscription?.activeStart, until = subscription?.activeUntil;
    const subscribed = Number.isFinite(start) && start <= now && Number.isFinite(until) && until > now;
    const sharedTier = tier === 'pro100' || tier.startsWith('pro200');
    const sharedLimit = tier.startsWith('pro200') ? pro200Allowance(subscription, now, profile).limit : tier === 'pro100' ? 50 : null;
    // An old server cap cannot extend a grandfathered allowance indefinitely.
    // Keep its reset boundary, but require a fresh server observation for 200.
    if (tier.startsWith('pro200') && now >= PRO200_POLICY.lowerAllowanceFrom) {
      for (const row of Object.values(rows)) if (row.limit === 200 &&
        !(row.limitObservedAt >= PRO200_POLICY.lowerAllowanceFrom)) row.limit = null;
    }
    if (!sharedTier) {
      for (const bucket of DEFAULTS.buckets) {
        const observed = rows[bucket.id];
        const days = 7;
        const fallback = bucket.id === 'gpt6' ? ({pro500:250})[tier] ?? null : null;
        if (observed?.end > now && Number.isFinite(observed.start)) {
          rows[bucket.id] = { ...observed, days, estimated: false, cycleAnchor: null, validUntil: null,
            limit: observed.limit ?? fallback, limitSource: observed.limit != null ? '服务器上限' : '所选套餐规则' };
        } else if (subscribed) {
          const anchor = Number.isFinite(observed?.start) ? observed.start : start;
          const cycleStart = anchor + Math.floor((now - anchor) / (days * DAY)) * days * DAY;
          rows[bucket.id] = { start: cycleStart, end: cycleStart + days * DAY, days, cycleAnchor: anchor,
            validUntil: until, limit: observed?.limit ?? fallback, blocked: false, estimated: true,
            limitSource: observed?.limit != null ? '已观察的服务器上限' : '所选套餐规则',
            source: observed ? '按已观察的服务器重置推算周期' : '按订阅起始时间推算周期' };
        }
        if (rows[bucket.id] && bucket.id === 'shared' && tier === 'pro500') rows[bucket.id].label = '两个 Pro 模型观察合计';
      }
      return { ...quota, rows };
    }
    let observed = rows.shared;
    if (!Number.isFinite(observed?.start)) {
      observed = ['gpt6', 'gpt56'].map(id => rows[id]).find(row => Number.isFinite(row?.start) && row.end > now);
      if (observed) observed = { ...observed, limit: null, blocked: false };
    }
    if (!subscribed && !observed) return { ...quota, rows };
    let shared;
    if (observed?.end > now && Number.isFinite(observed.start)) {
      shared = { ...observed, days: 7, estimated: false, cycleAnchor: null, validUntil: null,
        limit: observed.limit ?? sharedLimit, limitSource: observed.limit != null ? '服务器上限' : '套餐规则' };
    } else {
      if (!subscribed) return { ...quota, rows };
      const anchor = Number.isFinite(observed?.start) ? observed.start : start;
      const cycleStart = anchor + Math.floor((now - anchor) / (7 * DAY)) * 7 * DAY;
      shared = { start: cycleStart, end: cycleStart + 7 * DAY, days: 7, cycleAnchor: anchor,
        validUntil: until, limit: observed?.limit ?? sharedLimit, blocked: false, estimated: true,
        limitSource: observed?.limit != null ? '已观察的服务器上限' : '套餐规则',
        source: observed ? '按已观察的服务器重置推算每周周期' : '按订阅起始时间推算每周周期' };
    }
    rows.shared = shared;
    for (const id of ['gpt6', 'gpt56']) rows[id] = { ...shared, limit: null,
      blocked: shared.blocked || (rows[id]?.blocked === true && rows[id].end > now),
      source: shared.source + ' · 共享额度分项' };
    return { ...quota, rows };
  }
  function applyQuota(config, quota, subscription = null, now = Date.now()) {
    const result = settings(config);
    if (!['server', 'subscription'].includes(result.mode)) return result;
    if (result.mode === 'subscription') quota = subscriptionQuota(subscription, quota, now, result.allowanceProfile);
    result.buckets = result.buckets.map(bucket => ({ ...bucket, limit: null, start: null, end: null, source: null,
      blocked: false, estimated: false, limitSource: '服务器上限', cycleAnchor: null, validUntil: null,
      ...(quota?.rows?.[bucket.id] || {}) }));
    return result;
  }
  function reconcileState(state, config, now = Date.now()) {
    const signature = coverageSignature(config), valid = Number.isFinite(coverageSince(config, now));
    let changed = false;
    if (state.job && (!valid || state.job.signature !== signature)) { state.job = null; changed = true; }
    if (state.coverage && (!valid || state.coverage.signature !== signature)) { state.coverage = null; changed = true; }
    if (changed) state.lastBatch = null;
    // Parsed conversation metadata remains available for reuse once a real boundary is acquired.
    return changed;
  }
  function quotaDiagnostics(payload) {
    const labels = ['feature_name', 'model_slug', 'using_default_model_slug', 'unit', 'type'];
    const numbers = ['limit', 'remaining', 'used', 'total', 'window_seconds', 'limit_window_seconds', 'reset_after_seconds'];
    const dates = ['resets_after', 'reset_after', 'reset_at', 'last_reset_at', 'window_start', 'window_end'];
    const project = value => {
      if (!object(value)) return { valueType: value === null ? 'null' : typeof value };
      const result = { fieldNames: Object.keys(value).slice(0, 80) };
      for (const key of labels) if (typeof value[key] === 'string' && MODEL.test(value[key])) result[key] = value[key];
      for (const key of numbers) if (typeof value[key] === 'number' && Number.isFinite(value[key]) &&
        value[key] >= 0 && value[key] <= 1000000000) result[key] = value[key];
      for (const key of dates) {
        const time = timestamp(value[key]);
        if (time != null && time >= Date.UTC(2020, 0, 1) && time < Date.UTC(2100, 0, 1)) result[key] = new Date(time).toISOString();
      }
      for (const key of ['models', 'model_slugs']) if (Array.isArray(value[key])) {
        result[key] = value[key].filter(slug => typeof slug === 'string' && MODEL.test(slug)).slice(0, 32);
      }
      return result;
    };
    const result = { rootFields: object(payload) ? Object.keys(payload).slice(0, 80) : [] };
    for (const key of ['model_limits', 'blocked_features', 'limits_progress', 'message_usage']) {
      const value = payload?.[key];
      if (Array.isArray(value)) result[key] = { count: value.length, rows: value.slice(0, 50).map(project) };
      else if (object(value)) result[key] = { keys: Object.keys(value).slice(0, 50), rows: [project(value)],
        entries: Object.entries(value).slice(0, 50).map(([name, row]) => ({ key: MODEL.test(name) ? name : '[unrecognized]', ...project(row) })) };
      else result[key] = { valueType: value === undefined ? 'absent' : value === null ? 'null' : typeof value };
    }
    return result;
  }
  function quotaStatus(subscription, config, now = Date.now()) {
    if (config.mode === 'subscription' && config.buckets.some(row => row.estimated) && Number.isFinite(coverageSince(config, now)))
      return '已按订阅日期或已观察重置时间推算每周周期，采用套餐共享次数规则。服务器返回周期时自动校准。';
    if (Number.isFinite(coverageSince(config, now))) return '已识别至少一项统计边界。';
    if (subscription?.issues?.length) return '重置边界尚未取得：' + subscription.issues.join('；');
    if (!subscription) return '尚未查询额度接口。';
    const diagnostic = subscription.diagnostics;
    if (!diagnostic) return '旧诊断缺少额度字段值，请点击“识别账号”重新读取，再导出诊断。';
    const count = diagnostic.model_limits?.count;
    return '额度接口已响应' + (count != null ? '，model_limits=' + count : '') +
      '，尚未解析到可用的重置边界。点击“导出诊断”可查看 limits_progress 等额度字段值。';
  }
  async function scanAutomatically({ execute, getCooldown = async () => 0, wait = sleep, now = Date.now,
    signal, onWait = () => {}, batchDelay = 60000 }) {
    const waitUntil = async until => {
      while (until > now()) {
        if (signal?.aborted) throw abortError();
        onWait(until);
        await wait(Math.min(30000, until - now()), signal);
      }
    };
    while (!signal?.aborted) {
      await waitUntil(await getCooldown());
      let result;
      try { result = await execute(); }
      catch (error) {
        if (!(error instanceof RateLimitError)) throw error;
        await waitUntil(error.until + 1000); continue;
      }
      if (result.status === 'budget') await waitUntil(now() + batchDelay);
      else if (result.status === 'cooldown') await waitUntil(result.error.until + 1000);
      else return result;
    }
    throw abortError();
  }
  function startJob(state, config, now, forceFull) {
    const since = coverageSince(config, now), signature = coverageSignature(config);
    if (state.job && state.job.signature === signature && state.job.since <= since) return;
    const prior = state.coverage;
    const full = forceFull || !prior || prior.signature !== signature || prior.since > since ||
      now - prior.fullAt >= DAY;
    state.job = { signature, since, listSince: full ? since : Math.max(since, prior.checkedAt - 120000),
      full, startedAt: now, stream: 0, offsets: [0, 0], queue: [], seen: {}, skipped: 0, pages: 0 };
  }
  async function scanBatch({ state, config, request, save, signal, now = Date.now, onProgress = () => {},
    maxRequests = 10, detailBudget = 6, maxDuration = 55000, forceFull = false }) {
    config = settings(config);
    reconcileState(state, config, now());
    if (!Number.isFinite(coverageSince(config, now()))) {
      await save(state);
      return { status: 'needs-window', requests: 0, details: 0, error: null };
    }
    startJob(state, config, now(), forceFull);
    const job = state.job, started = now();
    let requests = 0, details = 0, status = 'budget', error = null;
    const progress = async () => { await save(state); onProgress({ requests, details, pending: job.queue.length, pages: job.pages }); };
    try {
      while (requests < maxRequests && now() - started < maxDuration) {
        if (signal?.aborted) throw abortError();
        if (job.queue.length) {
          const row = job.queue[0], cached = state.conversations[row.id];
          if (cached && cached.revision === row.revision && cached.parsedSince <= job.since) {
            job.queue.shift(); await progress(); continue;
          }
          if (details >= detailBudget) break;
          requests++; details++;
          const detail = await request('/backend-api/conversation/' + row.id, signal);
          state.conversations[row.id] = await parseConversation(detail, row.id, row.revision, job.since);
          job.queue.shift(); await progress(); continue;
        }
        if (job.stream >= 2) {
          if (job.full) {
            for (const id of Object.keys(state.conversations)) if (!job.seen[id]) delete state.conversations[id];
          }
          // Cache entries outside the current observation horizon cannot contribute to counts.
          for (const [id, entry] of Object.entries(state.conversations)) {
            if (entry.revision < job.since) delete state.conversations[id];
          }
          state.coverage = { signature: job.signature, since: job.since, checkedAt: job.startedAt,
            fullAt: job.full ? job.startedAt : state.coverage.fullAt, finishedAt: now(), skipped: job.skipped };
          state.job = null; status = 'complete'; await progress(); break;
        }
        requests++;
        const path = '/backend-api/conversations?offset=' + job.offsets[job.stream] +
          '&limit=50&order=updated&is_archived=' + (job.stream === 1);
        const list = await request(path, signal);
        if (!Array.isArray(list.items)) throw new Error('会话列表格式变化，已暂停。');
        const rows = list.items.map(item => {
          const revision = timestamp(item?.update_time);
          const excluded = item?.is_temporary_chat === true || isWork(item?.conversation_origin);
          if (!excluded && (!UUID.test(item?.id || '') || revision == null)) {
            throw new Error('会话列表缺少有效 ID 或更新时间，已暂停。');
          }
          return { id: UUID.test(item?.id || '') ? item.id : null, revision, excluded };
        });
        // Refuse to infer a coverage boundary from an unexpectedly unsorted page.
        const datedRows = rows.filter(row => row.revision != null);
        if (datedRows.some((row, index) => index > 0 && row.revision > datedRows[index - 1].revision)) {
          throw new Error('会话列表未按更新时间排序，已暂停；可稍后重试。');
        }
        let added = 0;
        for (const row of rows) {
          if (row.revision != null && row.revision < job.listSince) continue;
          // Work/temporary rows need no transcript or Chat-style UUID to be excluded.
          if (row.excluded) {
            if (row.id) { delete state.conversations[row.id]; job.seen[row.id] = true; }
            job.skipped++; added++; continue;
          }
          if (job.seen[row.id]) continue;
          job.seen[row.id] = true; added++;
          const cached = state.conversations[row.id];
          if (!cached || cached.revision !== row.revision || cached.parsedSince > job.since) {
            job.queue.push({ id: row.id, revision: row.revision });
          }
        }
        const next = job.offsets[job.stream] + rows.length;
        const end = rows.length === 0 || (rows.at(-1).revision != null && rows.at(-1).revision < job.listSince) ||
          (Number.isInteger(list.total) && list.total >= 0 && next >= list.total);
        if (!end && added === 0) throw new Error('列表重复返回同一页，已暂停。');
        job.offsets[job.stream] = next;
        job.pages++;
        if (end) job.stream++;
        await progress();
      }
    } catch (caught) {
      error = caught;
      status = caught instanceof RateLimitError ? 'cooldown' : caught.name === 'AbortError' ? 'paused' : 'error';
    }
    state.lastBatch = { at: now(), status, requests, details,
      message: error ? error.message : null, cooldownUntil: error instanceof RateLimitError ? error.until : null };
    await save(state);
    return { status, requests, details, error };
  }
  class RefreshSchedule {
    constructor({ now = Date.now, gap = 60000, interval = 180000, settle = 8000 } = {}) {
      Object.assign(this, { now, gap, interval, settle });
      this.lastStarted = 0; this.dirtyAt = null; this.nextPoll = now() + interval;
    }
    changed() { this.dirtyAt = this.now(); }
    due({ busy = false, visible = true, streaming = false, lastBatchAt = 0 } = {}) {
      const now = this.now();
      return !busy && visible && !streaming && now >= Math.max(this.lastStarted, lastBatchAt) + this.gap &&
        (now >= this.nextPoll || (this.dirtyAt != null && now >= this.dirtyAt + this.settle));
    }
    started() { this.lastStarted = this.now(); this.dirtyAt = null; this.nextPoll = this.now() + this.interval; }
    finished() { this.nextPoll = this.now() + this.interval; }
  }
  return { DAY, DEFAULTS, clone, hash, timestamp, settings, windowFor, coverageSince, coverageSignature,
    newState, parseConversation, totals, RateLimitError, retryUntil, allowedPath, ApiClient, sessionIdentity,
    startJob, scanBatch, sleep, automaticSettings, accountMetadata, subscriptionMetadata, quotaMetadata,
    applyQuota, subscriptionQuota, PRO200_POLICY, pro200Eligibility, pro200Allowance,
    scanAutomatically, normalizePlan, reconcileState, quotaDiagnostics, quotaStatus, RefreshSchedule };
});
