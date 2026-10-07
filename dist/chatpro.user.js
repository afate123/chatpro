// ==UserScript==
// @name         ChatPro 历史用量估算
// @name:en      ChatPro History Usage Estimate
// @name:es      ChatPro Estimación de Uso del Historial
// @namespace    local.chatpro.history
// @version      0.5.1
// @description  新回答后自动增量统计，刷新恢复缓存，服务器校准，分批扫描与429自动续扫。
// @description:en  Saved-history estimates with automatic updates, cache restoration and rate-limit recovery.
// @description:es  Estima el uso del historial con actualizaciones automáticas, caché y recuperación tras límites de solicitudes.
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @license      AGPL-3.0-only
// @homepageURL  https://github.com/afate123/chatpro
// @supportURL   https://github.com/afate123/chatpro/issues
// @updateURL    https://raw.githubusercontent.com/afate123/chatpro/main/dist/chatpro.meta.js
// @downloadURL  https://raw.githubusercontent.com/afate123/chatpro/main/dist/chatpro.user.js
// ==/UserScript==

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

// Presentation-only translations. Stable Chinese accounting messages remain
// untouched in storage and diagnostics; no translation service is contacted.
(function(root,factory){ const api=factory(); if(typeof module==='object'&&module.exports)module.exports=api; root.ChatProI18n=api; })(globalThis,function(){
  'use strict';
  const rows = `
语言|Language|Idioma
自动（浏览器语言）|Automatic (browser language)|Automático (idioma del navegador)
Pro 用量|Pro usage|Uso de Pro
历史估算|History estimate|Estimación del historial
ChatPro 历史用量估算|ChatPro history usage estimate|ChatPro: estimación de uso del historial
收起面板|Collapse panel|Contraer panel
收起|Collapse|Contraer
识别账号|Identify account|Identificar cuenta
开始自动扫描|Start automatic scan|Iniciar escaneo automático
恢复自动扫描|Resume automatic scan|Reanudar escaneo automático
正在自动扫描|Scanning automatically|Escaneo automático en curso
正在恢复记录|Restoring records|Restaurando registros
检查额度接口|Check allowance endpoint|Consultar límites
导出诊断|Export diagnostics|Exportar diagnóstico
额度与周期设置|Allowance and period settings|Configuración de límites y períodos
套餐额度规则|Plan allowance rule|Regla de límites del plan
自动识别套餐与旧资格|Detect plan and previous entitlement|Detectar plan y derecho anterior
Pro $100 · 共享 50 次/周|Pro $100 · 50 shared messages/week|Pro $100 · 50 mensajes compartidos/semana
Pro $200 · 两模型共享 100 次/周|Pro $200 · 100 shared messages/week|Pro $200 · 100 mensajes compartidos/semana
Pro $200 · 已确认旧资格（到期自动转 100）|Pro $200 · Confirmed previous entitlement (100 after expiry)|Pro $200 · Derecho anterior confirmado (100 al vencer)
Pro $500 · GPT-6 Pro 250 次/周|Pro $500 · GPT-6 Pro 250 messages/week|Pro $500 · GPT-6 Pro 250 mensajes/semana
$100：共享每周 50 次。$200：两模型共享每周 100/200 次，按旧资格与期限判断。$500：GPT-6 Pro 每周 250 次；服务器上限优先。|$100: 50 shared messages/week. $200: 100/200 shared messages/week, based on previous entitlement and expiry. $500: GPT-6 Pro 250/week. Server limits take precedence.|$100: 50 mensajes compartidos/semana. $200: 100/200 compartidos/semana, según el derecho anterior y su vencimiento. $500: GPT-6 Pro 250/semana. Los límites del servidor tienen prioridad.
旧资格：2026-09-22 至 09-29 10:00（太平洋时间）曾有有效 $200 订阅；保留至 10-29，随后转 100。近期续订日期不能证明不符合；缺少旧资格证据时显示待确认。手动选择只改变本地估算。|Previous entitlement: an active $200 subscription at any point from 2026-09-22 through 09-29 10:00 Pacific. Retained through 10-29, then 100. A recent renewal cannot prove ineligibility; missing evidence remains unconfirmed. Manual selection changes only this estimate.|Derecho anterior: suscripción de $200 activa en algún momento entre el 22/09/2026 y el 29/09 a las 10:00, hora del Pacífico. Se conserva hasta el 29/10; después, 100. Una renovación reciente no demuestra falta de elegibilidad. Sin pruebas, queda pendiente. La selección manual solo cambia esta estimación.
周期来源|Period source|Origen del período
订阅日期与套餐规则（自动校准）|Subscription dates and plan rules (server calibration)|Fechas de suscripción y reglas del plan (calibración del servidor)
手动指定已知重置周期|Manually specify a known reset period|Indicar manualmente un período de reinicio conocido
已知的上次重置时间（本地时区）|Known last reset time (local time zone)|Último reinicio conocido (zona horaria local)
只有你已知真实边界时才使用手动设置，每 N × 24 小时重复。|Use manual settings only for a known reset boundary; repeats every N × 24 hours.|Usa la configuración manual solo si conoces el reinicio real; se repite cada N × 24 horas.
统计对象|Counter|Contador
天数|Days|Días
次数上限|Message limit|Límite de mensajes
两个模型合计|Combined models|Total de ambos modelos
两个 Pro 模型合计|Combined Pro models|Total de ambos modelos Pro
两个 Pro 模型观察合计|Observed total for both Pro models|Total observado de ambos modelos Pro
周期天数|period days|días del período
合计周期天数|Combined period days|Días del período combinado
两个模型共享次数上限|Shared limit for both models|Límite compartido de ambos modelos
保存设置|Save settings|Guardar configuración
订阅日期划分的是估算周期，可能与实际重置不同。两个模型分别展示次数，合计行展示共享剩余；共享行不是额外一份额度。|Subscription dates define estimated periods and may differ from actual resets. Model counters show individual usage; the combined row shows the shared remainder, not an extra allowance.|Las fechas de suscripción definen períodos estimados y pueden diferir de los reinicios reales. Cada modelo muestra su uso; la fila combinada muestra el saldo compartido, no un cupo adicional.
扫描与本地数据|Scanning and local data|Escaneo y datos locales
普通与已归档会话都会扫描。排除 Work、Codex 和临时聊天。同一条提问的重新生成只计一次；失败、未完成或无模型标签的回答会列为未分类。|Scans regular and archived chats. Excludes Work, Codex and temporary chats. Regenerations of one prompt count once; failed, unfinished or unlabeled answers remain unclassified.|Se escanean chats normales y archivados. Se excluyen Work, Codex y chats temporales. Las regeneraciones de una misma pregunta cuentan una vez; las respuestas fallidas, incompletas o sin modelo quedan sin clasificar.
增量刷新只读变化的会话详情；每天首次扫描会重新核对历史列表。已删除或临时会话无法从云端历史恢复，观察次数也不等于服务器扣额。|Incremental updates fetch only changed conversations; the first daily scan reconciles history lists. Deleted or temporary chats cannot be recovered, and observed counts may differ from server charging.|Las actualizaciones incrementales solo consultan conversaciones modificadas; el primer escaneo diario revisa las listas. No se recuperan chats borrados o temporales, y los conteos pueden diferir del consumo del servidor.
重新核对全窗口|Reconcile full period|Revisar todo el período
清空本地记录|Clear local records|Borrar registros locales
缓存仅留会话 ID、更新时间、模型、哈希消息 ID 和时间；不保存正文、标题或登录令牌。清空记录不会解除限流冷却。|Cache stores conversation IDs, revisions, models, hashed turn IDs and times, not text, titles or login tokens. Clearing records does not remove rate-limit cooldown.|La caché guarda IDs, revisiones, modelos, hashes de mensajes y fechas; no guarda texto, títulos ni tokens. Borrar registros no elimina la espera por límites de solicitudes.
点击开始，读取订阅日期与套餐规则，自动扫描本周期。|Start to read subscription dates and plan rules and scan this period automatically.|Inicia el escaneo para leer la suscripción y las reglas del plan y revisar este período automáticamente.
离线演示 · 模拟历史数据|Offline demo · Synthetic history|Demostración sin conexión · Historial simulado
已连接会话账号 · |Connected account · |Cuenta conectada · 
尚未连接 · 不会自动发送扫描请求|Not connected · No automatic scan requests|Sin conexión · No se enviarán solicitudes de escaneo automáticamente
已观察|observed|observados
服务器上限|server limit|límite del servidor
你设置的上限|your configured limit|límite configurado
识别周期后显示观察次数|Counts appear after identifying a period|Los conteos aparecerán al identificar el período
服务器报告额度已耗尽 · 剩余 0|Server reports exhausted allowance · 0 remaining|El servidor indica que se agotó el cupo · Restante 0
与另一 Pro 模型共享额度 · 见合计行|Shared with the other Pro model · See combined row|Compartido con el otro modelo Pro · Consulta el total
上限未知 · 剩余未知|Limit unknown · Remainder unknown|Límite desconocido · Saldo desconocido
 · 剩余未知| · Remainder unknown| · Saldo desconocido
估算剩余 |Estimated remaining |Restante estimado 
等待可用周期信息|Waiting for usable period information|Esperando información del período
估算周期 |Estimated period |Período estimado 
本周期起点 |Period start |Inicio del período 
最近观察的重置 |Last observed reset |Último reinicio observado 
下一重置未确认|Next reset unconfirmed|Próximo reinicio sin confirmar
回看最近 |Look back over |Consultar los últimos 
固定 |Fixed |Fijo 
 天 · 下次周期 | days · Next period | días · Próximo período 
 天| days| días
 · 未分类 | · Unclassified | · Sin clasificar 
 条| messages| mensajes
套餐：|Plan: |Plan: 
未识别|Unidentified|Sin identificar
订阅有效期：|Subscription valid: |Suscripción válida: 
$200 预设：|$200 preset: |Regla de $200: 
扫描完整度：尚未扫描|Coverage: not scanned|Cobertura: sin escanear
本周期扫描尚未开始：等待重置边界|Period scan not started: waiting for reset boundary|Escaneo del período pendiente: esperando el reinicio
扫描未完成 · 已读 |Scan incomplete · Read |Escaneo incompleto · Leídas 
 页 · 待解析 | pages · Pending | páginas · Pendientes 
 个会话| conversations| conversaciones
历史列表已覆盖 · 模型未分类 |History lists covered · Unclassified |Listas revisadas · Sin clasificar 
最近检查：|Last check: |Última revisión: 
扫描完整度：尚未覆盖当前窗口|Coverage: current period incomplete|Cobertura: período actual incompleto
本批 |This batch: |Este lote: 
 次请求 · 已读详情 | requests · Details read | solicitudes · Detalles leídos 
 个| items| elementos
429 冷却中，恢复时间：|429 cooldown, resume at: |Espera por error 429; reanudación: 
剩余 |Remaining |Restante 
 秒。| seconds.| segundos.
到时自动续扫。|Automatically resumes then.|Se reanudará automáticamente.
启动后会自动等待并续扫。|Start to wait and resume automatically.|Al iniciar, esperará y se reanudará automáticamente.
正在等待账号识别，已有缓存保留。|Waiting for account identification; cache preserved.|Esperando la identificación de la cuenta; la caché se conserva.
已保存进度，|Progress saved; |Progreso guardado; 
 秒后自动继续下一批。无需重复点击。| seconds until the next batch. No repeated clicks needed.| segundos hasta el siguiente lote. No hace falta volver a pulsar.
暂停自动更新|Pause automatic updates|Pausar actualizaciones automáticas
暂停|Pause|Pausar
自动更新已开启：新回答后增量统计，页面可见时定期核对。可随时暂停。|Automatic updates enabled: incremental counts after new answers and periodic checks while visible. Pause anytime.|Actualizaciones automáticas activas: conteo tras nuevas respuestas y revisiones periódicas con la página visible. Puedes pausarlas.
分批限速在后台自动完成。429 冷却后自动续扫，可随时暂停。|Batches run automatically in the background. Resumes after 429 cooldown; pause anytime.|Los lotes se procesan automáticamente en segundo plano. Se reanudan tras la espera por error 429; puedes pausarlos.
当前浏览器不支持跨标签页扫描锁，请使用较新的 Chrome 或 Edge。|This browser lacks cross-tab scan locks. Use a recent Chrome or Edge.|Este navegador no admite bloqueos de escaneo entre pestañas. Usa Chrome o Edge actualizado.
另一个 ChatGPT 标签页正在使用 ChatPro，请等它完成。|Another ChatGPT tab is using ChatPro; wait for it to finish.|Otra pestaña de ChatGPT está usando ChatPro; espera a que termine.
已暂停，已完成的扫描进度保留。|Paused; completed scan progress preserved.|En pausa; se conserva el progreso del escaneo.
登录账号发生变化，自动扫描已停止，请在新账号下重新启动。|Account changed; automatic scanning stopped. Restart under the new account.|La cuenta ha cambiado; el escaneo se detuvo. Reinícialo en la nueva cuenta.
正在自动识别账号并恢复已保存的统计…|Identifying account and restoring saved counts…|Identificando la cuenta y restaurando conteos…
已恢复保存的用量与扫描进度，可点击“恢复自动扫描”继续。|Saved usage and progress restored. Click “Resume automatic scan” to continue.|Uso y progreso restaurados. Pulsa «Reanudar escaneo automático» para continuar.
已自动识别账号并恢复上次扫描记录。无需重新扫描；可启动增量刷新。|Account identified and previous records restored. No full rescan needed; incremental updates are available.|Cuenta identificada y registros restaurados. No hace falta repetir el escaneo; puedes actualizar de forma incremental.
账号已自动识别，尚无本地扫描记录。点击“开始自动扫描”即可。|Account identified; no local records yet. Click “Start automatic scan”.|Cuenta identificada; todavía no hay registros locales. Pulsa «Iniciar escaneo automático».
正在识别账号与额度周期…|Identifying account and allowance period…|Identificando la cuenta y el período de uso…
正在自动扫描，只统计已识别重置边界之后的对话…|Scanning automatically; counting only after the identified period start…|Escaneando automáticamente; solo se cuenta desde el inicio del período identificado…
历史列表扫描完成，但有未分类回答；剩余额度保持未知。|History scan complete, but some answers are unclassified; remainder stays unknown.|Escaneo terminado, pero hay respuestas sin clasificar; el saldo sigue siendo desconocido.
历史列表扫描完成。显示的是已保存历史的估算次数。|History scan complete. Counts are estimates from saved history.|Escaneo terminado. Los conteos son estimaciones del historial guardado.
没有启动本周期历史扫描。|History scan for this period did not start.|No se inició el escaneo del historial de este período.
已暂停，扫描进度已保存。|Paused; scan progress saved.|En pausa; progreso guardado.
扫描已暂停。|Scanning paused.|Escaneo en pausa.
正在暂停…|Pausing…|Pausando…
自动更新已暂停，已有统计保留。点击开始自动扫描可重新开启。|Automatic updates paused; counts preserved. Start a scan to enable again.|Actualizaciones pausadas; se conservan los conteos. Inicia un escaneo para activarlas de nuevo.
正在读取登录状态…|Reading login status…|Consultando el estado de inicio de sesión…
设置已保存。自动模式按订阅日期与套餐规则估算，服务器周期优先；手动模式采用你指定的周期。|Settings saved. Automatic mode estimates from subscription dates and plan rules, with server periods taking precedence. Manual mode uses your specified period.|Configuración guardada. El modo automático estima según la suscripción y el plan, con prioridad para los períodos del servidor. El modo manual usa el período indicado.
本地扫描记录已清空。额度设置和限流冷却保留。|Local scan records cleared. Allowance settings and cooldown preserved.|Registros locales borrados. Se conservan la configuración y la espera por límites de solicitudes.
诊断已导出，包含额度字段值；不含正文、邮箱、登录令牌或会话 ID。|Diagnostics exported with allowance fields; no text, emails, tokens or conversation IDs.|Diagnóstico exportado con los datos de límites; sin texto, correos, tokens ni IDs de conversaciones.
打开 ChatPro 历史用量|Open ChatPro history usage|Abrir el uso histórico de ChatPro
自动更新已暂停：|Automatic updates paused: |Actualizaciones automáticas en pausa: 
周期类型无效。|Invalid period type.|Tipo de período no válido.
套餐额度规则无效。|Invalid allowance profile.|Regla de límites no válida.
请填写固定周期的起始时间。|Enter the fixed period start.|Indica el inicio del período fijo.
缺少模型配置。|Missing model configuration.|Falta la configuración del modelo.
周期必须是 1–90 的整数天数。|Period must be an integer from 1 to 90 days.|El período debe ser un número entero de 1 a 90 días.
上限请留空，或填写 1–1000000 的整数。|Leave the limit blank or enter an integer from 1 to 1000000.|Deja el límite vacío o indica un entero de 1 a 1000000.
会话详情结构或 ID 不符，已暂停。|Conversation structure or ID mismatch; paused.|La estructura o el ID de la conversación no coincide; en pausa.
请求被限流，已暂停整轮扫描。|Request rate limited; scan paused.|Límite de solicitudes alcanzado; escaneo en pausa.
接口返回的内容不是有效 JSON，已暂停。|Endpoint returned invalid JSON; paused.|El servidor devolvió JSON no válido; en pausa.
响应超过 8 MiB，已暂停。|Response exceeds 8 MiB; paused.|La respuesta supera 8 MiB; en pausa.
拒绝了扫描范围以外的接口。|Rejected an endpoint outside the scan scope.|Se rechazó un punto de acceso fuera del alcance del escaneo.
登录失效或接口拒绝访问，请重新登录后再试。|Login expired or access denied. Sign in again and retry.|Sesión caducada o acceso denegado. Inicia sesión de nuevo y reinténtalo.
接口返回 HTTP |Endpoint returned HTTP |El servidor devolvió HTTP 
，已暂停。|; paused.|; en pausa.
接口没有返回可识别的数据。|Endpoint returned unrecognized data.|El servidor devolvió datos no reconocibles.
请求超过 15 秒，已暂停，可稍后续扫。|Request exceeded 15 seconds; paused. Resume later.|La solicitud superó 15 segundos; en pausa. Reanuda más tarde.
请先在 ChatGPT 网页登录。|Sign in to ChatGPT first.|Inicia sesión en ChatGPT primero.
账号标识无法识别。|Unrecognized account identifier.|Identificador de cuenta no reconocido.
账号列表无法唯一匹配当前账号，已停止识别。|Cannot uniquely match the current account; identification stopped.|No se puede identificar de forma inequívoca la cuenta actual; identificación detenida.
订阅信息格式无法识别。|Unrecognized subscription format.|Formato de suscripción no reconocido.
订阅账号不匹配。|Subscription account mismatch.|La cuenta de la suscripción no coincide.
最近已观察的服务器重置边界（后续周期未确认）|Last observed server reset (later periods unconfirmed)|Último reinicio observado del servidor (períodos posteriores sin confirmar)
服务器明确返回的消息周期|Explicit server message period|Período de mensajes indicado por el servidor
共享周额度的模型分项|Model breakdown of shared weekly allowance|Desglose por modelo del cupo semanal compartido
服务器返回周期|Server period|Período del servidor
服务器重置时间与已知窗口长度|Server reset and known period length|Reinicio del servidor y duración conocida del período
服务器 reason 共享周额度|Server reason shared weekly allowance|Cupo semanal compartido reason del servidor
旧资格期限已结束 · 共享每周 100 次|Previous entitlement expired · 100 shared messages/week|Derecho anterior vencido · 100 mensajes compartidos/semana
已选择普通额度 · 共享每周 100 次|Standard allowance selected · 100 shared messages/week|Cupo estándar seleccionado · 100 mensajes compartidos/semana
旧资格额度 · 共享每周 200 次，至 2026-10-29（太平洋日期）|Previous entitlement · 200 shared messages/week through 2026-10-29 (Pacific date)|Derecho anterior · 200 mensajes compartidos/semana hasta el 29/10/2026 (fecha del Pacífico)
旧资格待确认：需在 2026-09-22 至 09-29 10:00（太平洋时间）曾有有效 Pro $200 订阅|Previous entitlement unconfirmed: requires active Pro $200 at some point from 2026-09-22 through 09-29 10:00 Pacific|Derecho anterior pendiente: requiere Pro $200 activo en algún momento entre el 22/09/2026 y el 29/09 a las 10:00, hora del Pacífico
所选套餐规则|selected plan rule|regla del plan seleccionado
已观察的服务器上限|observed server limit|límite observado del servidor
按已观察的服务器重置推算每周周期|Weekly estimate anchored to an observed server reset|Estimación semanal basada en un reinicio observado del servidor
按订阅起始时间推算每周周期|Weekly estimate anchored to subscription start|Estimación semanal basada en el inicio de la suscripción
按已观察的服务器重置推算周期|Estimate anchored to an observed server reset|Estimación basada en un reinicio observado del servidor
按订阅起始时间推算周期|Estimate anchored to subscription start|Estimación basada en el inicio de la suscripción
套餐规则|plan rule|regla del plan
共享额度分项|shared allowance breakdown|desglose del cupo compartido
已按订阅日期或已观察重置时间推算每周周期，采用套餐共享次数规则。服务器返回周期时自动校准。|Weekly period estimated from subscription dates or observed reset, using shared plan rules. Server periods calibrate the estimate.|Período semanal estimado según la suscripción o un reinicio observado, con las reglas compartidas del plan. Los períodos del servidor calibran la estimación.
已识别至少一项统计边界。|At least one counting boundary identified.|Se identificó al menos un límite temporal para el conteo.
重置边界尚未取得：|Reset boundary unavailable: |Reinicio aún no disponible: 
尚未查询额度接口。|Allowance endpoint not queried yet.|Todavía no se consultaron los límites.
旧诊断缺少额度字段值，请点击“识别账号”重新读取，再导出诊断。|Old diagnostics lack allowance values. Click “Identify account”, then export again.|El diagnóstico antiguo no contiene límites. Pulsa «Identificar cuenta» y expórtalo de nuevo.
额度接口已响应|Allowance endpoint responded|El servidor de límites respondió
，尚未解析到可用的重置边界。点击“导出诊断”可查看 limits_progress 等额度字段值。|; no usable reset boundary parsed. Export diagnostics to inspect limits_progress and other fields.|; no se identificó un reinicio válido. Exporta el diagnóstico para revisar limits_progress y otros campos.
会话列表格式变化，已暂停。|Conversation list format changed; paused.|Cambió el formato de la lista de conversaciones; en pausa.
会话列表缺少有效 ID 或更新时间，已暂停。|Conversation list lacks valid IDs or revisions; paused.|Faltan IDs o fechas válidas en la lista de conversaciones; en pausa.
会话列表未按更新时间排序，已暂停；可稍后重试。|Conversation list not sorted by update time; paused. Retry later.|La lista no está ordenada por fecha de actualización; en pausa. Reinténtalo más tarde.
列表重复返回同一页，已暂停。|List repeatedly returned the same page; paused.|La lista devolvió la misma página repetidamente; en pausa.
未知|Unknown|Desconocido
`;
  const entries=rows.split('\n').filter(Boolean).map(row=>row.split('|'));
  const dictionary=Object.fromEntries(entries.map(([zh,en,es])=>[zh,{en,es}]));
  const pattern=new RegExp(Object.keys(dictionary).sort((a,b)=>b.length-a.length)
    .map(key=>key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g');
  function resolve(saved='auto',languages=[]){
    if(['zh','en','es'].includes(saved))return saved;
    const primary=String(languages[0]||'en').toLowerCase().split('-')[0];
    return ['zh','es'].includes(primary)?primary:'en';
  }
  function translate(value,language){ return language==='zh'?String(value):String(value)
    .replace(pattern,key=>dictionary[key][language]||dictionary[key].en)
    .replaceAll('（','(').replaceAll('）',')').replaceAll('；','; ').replaceAll('，',', '); }
  const originals=new WeakMap();
  function localize(root,language){
    const update=(node,key)=>{
      const current=key?node.getAttribute(key):node.nodeValue;
      let saved=originals.get(node); if(!saved){saved={};originals.set(node,saved);}
      const id=key||'text', prior=saved[id];
      const original=prior&&prior.translated===current?prior.original:current;
      const translated=translate(original,language); saved[id]={original,translated};
      if(current!==translated){if(key)node.setAttribute(key,translated);else node.nodeValue=translated;}
    };
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let node; while((node=walker.nextNode())) if(!['STYLE','SCRIPT'].includes(node.parentElement?.tagName))update(node);
    for(const element of root.querySelectorAll('[aria-label],[placeholder],[title]'))
      for(const key of ['aria-label','placeholder','title']) if(element.hasAttribute(key))update(element,key);
  }
  return {resolve,translate,localize,locale:language=>({zh:'zh-CN',en:'en-US',es:'es-ES'})[language]||'en-US'};
});

(async function () {
  'use strict';
  const C = globalThis.ChatProCore;
  const I = globalThis.ChatProI18n;
  if (!C || !I || document.getElementById('chatpro-estimator-host')) return;
  const preview = globalThis.CHATPRO_PREVIEW === true;
  if (!preview && location.origin !== 'https://chatgpt.com') return;
  const store = {
    get: async (key, fallback) => GM_getValue('chatpro:v1:' + key, fallback),
    set: async (key, value) => GM_setValue('chatpro:v1:' + key, value),
    remove: async key => GM_deleteValue('chatpro:v1:' + key)
  };
  const api = new C.ApiClient({ fetcher: (...args) => fetch(...args), get: store.get, set: store.set, interval: preview ? 500 : 2500 });
  let languagePreference = await store.get('language','auto');
  let language = I.resolve(languagePreference,navigator.languages || [navigator.language]);
  let identity = null, state = C.newState(), config = C.automaticSettings();
  let busy = false, abort = null, resumeAt = 0, message = '点击开始，读取订阅日期与套餐规则，自动扫描本周期。';
  let progress = null, gate = {}, expanded = false, restoring = false;
  let monitoring = false, monitorTickBusy = false;
  const refresh = new C.RefreshSchedule(preview ? { gap: 1000, interval: 20000, settle: 1000 } : {});
  const host = document.createElement('div');
  host.id = 'chatpro-estimator-host';
  document.documentElement.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{all:initial;font:14px/1.5 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#e8eaf2}
    *{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer;border:1px solid #485064;border-radius:9px;padding:8px 12px;background:#283246;color:#f2f4ff}
    button:hover{background:#354461}button:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible{outline:2px solid #87b6ff;outline-offset:2px}
    button:disabled{cursor:default;opacity:.5}button.primary{background:#c4e1cf;color:#143421;border-color:#c4e1cf}button.primary:hover{background:#dcf3e4}
    .toggle{position:fixed;right:16px;bottom:18px;z-index:2147483646;background:#1c2534;box-shadow:0 4px 18px #0006;padding:10px 16px}
    .panel{position:fixed;right:16px;bottom:68px;width:370px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 90px);overflow:auto;z-index:2147483646;background:#171d29;border:1px solid #424b61;border-radius:16px;box-shadow:0 12px 48px #0008;padding:18px;color:#e8eaf2;color-scheme:dark}
    [hidden]{display:none!important}header{display:flex;gap:8px;justify-content:space-between;align-items:center}h2{font-size:18px;letter-spacing:.2px;margin:0}h3{font-size:14px;margin:12px 0 4px}
    .badge{font-size:11px;color:#a4d1b6;border:1px solid #446653;border-radius:5px;padding:1px 5px;margin-left:5px;white-space:nowrap}
    .muted{color:#aab3c6;font-size:12px}.account{margin:10px 0 12px}.notice{padding:10px 12px;border-radius:9px;background:#232d3e;margin:12px 0;font-size:12px;white-space:pre-line;overflow-wrap:anywhere}
    .coverage{font-size:12px;color:#b7c5da;margin:10px 0}.cards{display:grid;gap:8px}.card{border:1px solid #3b4558;border-radius:11px;padding:11px 12px;background:#1e2735}
    .row{display:flex;justify-content:space-between;gap:8px;align-items:baseline}.label{font-weight:600;font-size:13px}.value{font-size:25px;font-weight:650;font-variant-numeric:tabular-nums}.suffix{font-size:11px;color:#aab3c6;margin-left:4px;font-weight:400}
    .remaining{font-size:12px;margin-top:5px;color:#bedcc8}.period{font-size:11px;color:#aab3c6;margin-top:4px;overflow-wrap:anywhere}
    .actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.actions button{flex:1 1 140px;white-space:normal;overflow-wrap:anywhere}.small{font-size:12px;padding:6px 8px}
    header h2{display:flex;align-items:center;flex-wrap:wrap;gap:4px;min-width:0}.row .label{min-width:0;overflow-wrap:anywhere}.row .value{flex-shrink:0}header button{flex-shrink:0}
    details{border-top:1px solid #3b4558;padding-top:12px;margin-top:12px}summary{cursor:pointer;font-size:13px;color:#d1daeb}
    label{display:block;margin:9px 0 3px;font-size:12px;color:#bcc9df}input,select{width:100%;min-width:0;border:1px solid #536079;border-radius:7px;background:#121a27;color:#e8eaf2;padding:7px 8px}
    .setting-row{display:grid;grid-template-columns:1fr 74px 88px;gap:8px;align-items:center;margin:8px 0;font-size:12px}.setting-heading{margin-top:12px;color:#aab3c6;font-size:11px}
    .setting-row input{text-align:right}.hint{font-size:11px;color:#aab3c6;margin:8px 0}.footer{font-size:11px;color:#9babc4;border-top:1px solid #3b4558;padding-top:10px;margin-top:14px}a{color:#b4d5ff}
    @media(max-width:420px){.panel{right:12px;padding:14px}.toggle{right:12px}.setting-row{grid-template-columns:1fr 65px 78px;gap:5px}}
    @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
  </style>
  <button class="toggle" id="toggle" aria-expanded="false" aria-controls="panel">Pro 用量</button>
  <section class="panel" id="panel" hidden aria-label="ChatPro 历史用量估算">
    <header><h2>ChatPro<span class="badge">历史估算</span></h2><button id="close" class="small" aria-label="收起面板">收起</button></header>
    <label for="language">语言</label><select id="language"><option value="auto">自动（浏览器语言）</option><option value="zh">中文</option><option value="en">English</option><option value="es">Español</option></select>
    <div id="account" class="account muted"></div>
    <div id="cards" class="cards"></div>
    <div id="subscription" class="coverage"></div><div id="coverage" class="coverage"></div>
    <div id="notice" class="notice" role="status" aria-live="polite"></div>
    <div class="actions"><button id="connect">识别账号</button><button id="scan" class="primary">开始自动扫描</button><button id="pause" hidden>暂停</button></div>
    <div class="actions"><button id="export" class="small">导出诊断</button></div>
    <div id="monitor-status" class="muted">分批限速在后台自动完成。429 冷却后自动续扫，可随时暂停。</div>
    <details id="settings"><summary>额度与周期设置</summary>
      <p class="hint">$100：共享每周 50 次。$200：两模型共享每周 100/200 次，按旧资格与期限判断。$500：GPT-6 Pro 每周 250 次；服务器上限优先。</p>
      <label for="allowance-profile">套餐额度规则</label><select id="allowance-profile"><option value="auto">自动识别套餐与旧资格</option><option value="pro100">Pro $100 · 共享 50 次/周</option><option value="pro200-100">Pro $200 · 两模型共享 100 次/周</option><option value="pro200-200">Pro $200 · 已确认旧资格（到期自动转 100）</option><option value="pro500">Pro $500 · GPT-6 Pro 250 次/周</option></select>
      <p class="hint">旧资格：2026-09-22 至 09-29 10:00（太平洋时间）曾有有效 $200 订阅；保留至 10-29，随后转 100。近期续订日期不能证明不符合；缺少旧资格证据时显示待确认。手动选择只改变本地估算。</p>
      <label for="mode">周期来源</label><select id="mode"><option value="subscription">订阅日期与套餐规则（自动校准）</option><option value="fixed">手动指定已知重置周期</option></select>
      <div id="anchor-wrap" hidden><label for="anchor">已知的上次重置时间（本地时区）</label><input id="anchor" type="datetime-local"><p class="hint">只有你已知真实边界时才使用手动设置，每 N × 24 小时重复。</p></div>
      <div class="setting-row setting-heading"><span>统计对象</span><span>天数</span><span>次数上限</span></div>
      <div class="setting-row"><span>GPT-6 Pro</span><input id="days-gpt6" type="number" min="1" max="90" aria-label="GPT-6 Pro 周期天数"><input id="limit-gpt6" type="number" min="1" placeholder="未知" aria-label="GPT-6 Pro 次数上限"></div>
      <div class="setting-row"><span>GPT-5.6 Pro</span><input id="days-gpt56" type="number" min="1" max="90" aria-label="GPT-5.6 Pro 周期天数"><input id="limit-gpt56" type="number" min="1" placeholder="未知" aria-label="GPT-5.6 Pro 次数上限"></div>
      <div class="setting-row"><span>两个模型合计</span><input id="days-shared" type="number" min="1" max="90" aria-label="合计周期天数"><input id="limit-shared" type="number" min="1" placeholder="未知" aria-label="两个模型共享次数上限"></div>
      <div class="actions"><button id="save" class="small">保存设置</button></div>
      <p class="hint">订阅日期划分的是估算周期，可能与实际重置不同。两个模型分别展示次数，合计行展示共享剩余；共享行不是额外一份额度。</p>
    </details>
    <details><summary>扫描与本地数据</summary>
      <p class="hint">普通与已归档会话都会扫描。排除 Work、Codex 和临时聊天。同一条提问的重新生成只计一次；失败、未完成或无模型标签的回答会列为未分类。</p>
      <p class="hint">增量刷新只读变化的会话详情；每天首次扫描会重新核对历史列表。已删除或临时会话无法从云端历史恢复，观察次数也不等于服务器扣额。</p>
      <div class="actions"><button id="full" class="small">重新核对全窗口</button><button id="clear" class="small">清空本地记录</button></div>
      <p class="hint">缓存仅留会话 ID、更新时间、模型、哈希消息 ID 和时间；不保存正文、标题或登录令牌。清空记录不会解除限流冷却。</p>
    </details>
    <div class="footer"><a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer">AGPL-3.0</a> · Beta · 0.5.1</div>
  </section>`;
  const $ = id => shadow.getElementById(id);
  const date = time => time == null ? '—' : new Date(time).toLocaleString(I.locale(language), { hour12: false });
  const seconds = time => Math.max(0, Math.ceil((time - Date.now()) / 1000));
  const cooldown = () => gate.until > Date.now();
  function setExpanded(value) {
    expanded = value; $('panel').hidden = !value;
    $('toggle').setAttribute('aria-expanded', String(value));
    if (value) render();
  }
  function fillSettings() {
    $('mode').value = config.mode;
    $('allowance-profile').value = config.allowanceProfile;
    $('anchor-wrap').hidden = config.mode !== 'fixed';
    if (config.anchor) {
      const local = new Date(config.anchor - new Date(config.anchor).getTimezoneOffset() * 60000);
      $('anchor').value = local.toISOString().slice(0, 16);
    } else $('anchor').value = '';
    for (const bucket of config.buckets) {
      $('days-' + bucket.id).value = bucket.days;
      $('limit-' + bucket.id).value = bucket.limit ?? '';
    }
  }
  function render() {
    const result = C.totals(state, config);
    const hasWindow = Number.isFinite(C.coverageSince(config, Date.now()));
    const currentJob = hasWindow && state.job?.signature === C.coverageSignature(config) ? state.job : null;
    $('account').textContent = preview ? '离线演示 · 模拟历史数据' : identity ?
      '已连接会话账号 · ' + identity.key.slice(0, 10) : '尚未连接 · 不会自动发送扫描请求';
    $('cards').replaceChildren();
    for (const row of result.rows) {
      const card = document.createElement('div'); card.className = 'card';
      const line = document.createElement('div'); line.className = 'row';
      const label = document.createElement('span'); label.className = 'label'; label.textContent = row.label;
      const value = document.createElement('span'); value.className = 'value'; value.textContent = identity && row.used != null ? row.used : '—';
      const suffix = document.createElement('span'); suffix.className = 'suffix'; suffix.textContent = '已观察';
      value.append(suffix); line.append(label, value); card.append(line);
      const remaining = document.createElement('div'); remaining.className = 'remaining';
      const limitSource = ['server', 'subscription'].includes(config.mode) ? row.limitSource || '服务器上限' : '你设置的上限';
      const sharedPart = config.mode === 'subscription' && row.id !== 'shared' &&
        (config.allowanceProfile === 'pro100' || config.allowanceProfile.startsWith('pro200') ||
          (config.allowanceProfile === 'auto' && ['prolite','pro'].includes(state.subscription?.plan)));
      remaining.textContent = !identity ? '识别周期后显示观察次数' : row.blocked ? '服务器报告额度已耗尽 · 剩余 0' : sharedPart ? '与另一 Pro 模型共享额度 · 见合计行' : row.limit == null ? '上限未知 · 剩余未知' :
        row.remaining == null ? limitSource + ' ' + row.limit + ' · 剩余未知' :
        '估算剩余 ' + row.remaining + ' / ' + row.limit + '（' + limitSource + '）';
      card.append(remaining);
      const period = document.createElement('div'); period.className = 'period';
      period.textContent = (['server', 'subscription'].includes(config.mode) ? row.window.start == null ? '等待可用周期信息' :
        (row.estimated ? '估算周期 ' : row.window.end ? '本周期起点 ' : '最近观察的重置 ') + date(row.window.start) +
        ' → ' + (row.window.end ? date(row.window.end) : '下一重置未确认') + (row.estimated ? '\n' + row.source : '') :
        config.mode === 'rolling' ? '回看最近 ' + row.days + ' 天' :
        '固定 ' + row.days + ' 天 · 下次周期 ' + date(row.window.end)) +
        (identity && row.unknown ? ' · 未分类 ' + row.unknown + ' 条' : '');
      card.append(period); $('cards').append(card);
    }
    $('subscription').textContent = state.subscription ? '套餐：' + (state.subscription.plan || '未识别') +
      '\n订阅有效期：' + date(state.subscription.activeStart) + ' → ' + date(state.subscription.activeUntil) : '';
    if (state.subscription && (config.allowanceProfile.startsWith('pro200') ||
      (config.allowanceProfile === 'auto' && state.subscription.plan === 'pro'))) {
      $('subscription').textContent += '\n$200 预设：' + C.pro200Allowance(state.subscription, Date.now(), config.allowanceProfile).reason;
    }
    $('coverage').textContent = !identity ? '扫描完整度：尚未扫描' : !hasWindow ? '本周期扫描尚未开始：等待重置边界' : currentJob ?
      '扫描未完成 · 已读 ' + currentJob.pages + ' 页 · 待解析 ' + currentJob.queue.length + ' 个会话' :
      result.covered ? '历史列表已覆盖 · 模型未分类 ' + Math.max(...result.rows.map(row => row.unknown)) +
        ' 条\n最近检查：' + date(result.lastCheckedAt) : '扫描完整度：尚未覆盖当前窗口';
    let text = message;
    if (progress && busy) text += '\n本批 ' + progress.requests + ' 次请求 · 已读详情 ' + progress.details + ' 个';
    if (cooldown()) text = '429 冷却中，恢复时间：' + date(gate.until) + '\n剩余 ' + seconds(gate.until) + ' 秒。' + (busy ? '到时自动续扫。' : '启动后会自动等待并续扫。');
    else if (busy && resumeAt > Date.now()) text = restoring ? '正在等待账号识别，已有缓存保留。' :
      '已保存进度，' + seconds(resumeAt) + ' 秒后自动继续下一批。无需重复点击。';
    $('notice').textContent = text;
    $('connect').disabled = busy || cooldown();
    $('scan').textContent = busy ? restoring ? '正在恢复记录' : '正在自动扫描' :
      identity && state.subscription && !hasWindow ? '检查额度接口' : currentJob ? '恢复自动扫描' : '开始自动扫描';
    $('scan').disabled = busy;
    $('pause').hidden = !busy && !monitoring;
    $('pause').textContent = busy ? '暂停' : '暂停自动更新';
    $('monitor-status').textContent = monitoring ?
      '自动更新已开启：新回答后增量统计，页面可见时定期核对。可随时暂停。' :
      '分批限速在后台自动完成。429 冷却后自动续扫，可随时暂停。';
    $('full').disabled = busy || !identity;
    $('save').disabled = busy || !identity;
    $('clear').disabled = busy || !identity;
    $('export').disabled = busy || !identity;
    for (const input of shadow.querySelectorAll('input,select')) input.disabled = input.id !== 'language' && (busy ||
      ($('mode').value !== 'fixed' && input.tagName === 'INPUT'));
    $('language').value = languagePreference;
    $('panel').lang = I.locale(language);
    I.localize(shadow,language);
  }
  async function withLock(work) {
    if (busy) return;
    if (!navigator.locks) { message = '当前浏览器不支持跨标签页扫描锁，请使用较新的 Chrome 或 Edge。'; render(); return; }
    busy = true; abort = new AbortController(); progress = null; render();
    try {
      await navigator.locks.request('chatpro:history:v1', { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('另一个 ChatGPT 标签页正在使用 ChatPro，请等它完成。');
        await work(abort.signal);
      });
    } catch (error) {
      message = error.name === 'AbortError' ? '已暂停，已完成的扫描进度保留。' : error.message;
    } finally {
      busy = false; abort = null; progress = null; resumeAt = 0;
      if (identity) { identity.token = null; }
      gate = await store.get('gate', {}); render();
    }
  }
  async function loadAccount(signal, expectedKey = null, forceMetadata = false, restoreOnly = false) {
    // Revalidate on every scan: a login/account change cannot reuse the preceding user's cache.
    identity = null; state = C.newState(); config = C.automaticSettings(); render();
    const session = await api.request('/api/auth/session', null, signal);
    identity = await C.sessionIdentity(session);
    let account = null, accountError = null, accountPayload = null;
    try { accountPayload = await api.request('/backend-api/accounts/check/v4-2023-04-27', identity, signal); }
    catch (error) { if (error instanceof C.RateLimitError || signal?.aborted) throw error; accountError = error.message; }
    if (accountPayload) account = C.accountMetadata(accountPayload, identity.accountId);
    if (account) identity = await C.sessionIdentity(session, account.accountId);
    if (expectedKey && identity.key !== expectedKey) throw new Error('登录账号发生变化，自动扫描已停止，请在新账号下重新启动。');
    const saved = await store.get('account:' + identity.key, null);
    state = saved?.version === 1 ? saved : C.newState();
    try {
      const savedSettings = await store.get('settings:' + identity.key, null);
      config = savedSettings ? C.settings(['rolling', 'server'].includes(savedSettings.mode) ? { ...savedSettings, mode: 'subscription' } : savedSettings) : C.automaticSettings();
    } catch { config = C.automaticSettings(); }
    const old = state.subscription;
    if (!restoreOnly && (forceMetadata || !old || (account?.plan && old.plan !== account.plan) || Date.now() - old.checkedAt >= 10 * 60000 ||
      (old.quota && Object.values(old.quota.rows).some(row => row.end && row.end <= Date.now())))) {
      const info = { plan: account?.plan || old?.plan || null, checkedAt: Date.now(), issues: [] };
      if (old?.plan === info.plan) {
        for (const key of ['activeStart', 'activeUntil', 'billingPeriod']) if (old[key] != null) info[key] = old[key];
        info.quota = C.quotaMetadata({}, info.plan, old.quota, Date.now());
      }
      if (accountError) info.issues.push(accountError);
      if (identity.accountId) {
        try {
          const subscription = C.subscriptionMetadata(await api.request('/backend-api/subscriptions?account_id=' + encodeURIComponent(identity.accountId), identity, signal), identity.accountId);
          Object.assign(info, subscription, { plan: subscription.plan || info.plan });
        }
        catch (error) { if (error instanceof C.RateLimitError || signal?.aborted) throw error; info.issues.push(error.message); }
      }
      try {
        const init = await api.request('/backend-api/conversation/init', identity, signal, 'POST');
        info.quota = C.quotaMetadata(init, info.plan, old?.plan === info.plan ? old?.quota : {}, Date.now());
        info.diagnostics = C.quotaDiagnostics(init);
        info.fields = { init: info.diagnostics.rootFields,
          modelLimits: [...new Set((info.diagnostics.model_limits.rows || []).flatMap(row => row.fieldNames || []))] };
      } catch (error) { if (error instanceof C.RateLimitError || signal?.aborted) throw error; info.issues.push(error.message); }
      // Cached under the verified account key, so rejoining the same account
      // preserves qualifying history even when its new billing month starts later.
      if (C.pro200Eligibility(old) || C.pro200Eligibility(info)) info.pro200Qualified = true;
      state.subscription = info;
      await store.set('account:' + identity.key, state);
    }
    config = C.applyQuota(config, state.subscription?.quota, state.subscription);
    if (C.reconcileState(state, config)) await store.set('account:' + identity.key, state);
    fillSettings(); render();
  }
  async function restoreSavedAccount() {
    restoring = true;
    try {
      await withLock(async signal => {
        message = '正在自动识别账号并恢复已保存的统计…'; render();
        await C.scanAutomatically({ signal,
          getCooldown: async () => (await store.get('gate', {})).until || 0,
          onWait: until => { resumeAt = until; render(); },
          execute: async () => {
            await loadAccount(signal, null, false, true);
            message = state.job ? '已恢复保存的用量与扫描进度，可点击“恢复自动扫描”继续。' :
              state.coverage || Object.keys(state.conversations).length ?
                '已自动识别账号并恢复上次扫描记录。无需重新扫描；可启动增量刷新。' :
                '账号已自动识别，尚无本地扫描记录。点击“开始自动扫描”即可。';
            return { status: 'complete' };
          }
        });
      });
    } finally { restoring = false; render(); }
  }
  async function setMonitoring(enabled, accountKey = identity?.key) {
    monitoring = enabled;
    await store.set('monitoring', { enabled, accountKey });
    render();
  }
  async function run(full = false, expectedKey = null, incremental = false) {
    await withLock(async signal => {
      let accountKey = expectedKey, initial = true;
      await store.set('automatic', { enabled: true, accountKey });
      try {
      const result = await C.scanAutomatically({ signal,
        batchDelay: preview ? 1000 : 60000,
        getCooldown: async () => (await store.get('gate', {})).until || 0,
        onWait: until => { resumeAt = until; render(); },
        execute: async () => {
          resumeAt = 0; message = '正在识别账号与额度周期…'; render();
          await loadAccount(signal, accountKey, initial && !incremental);
          accountKey = identity.key;
          await store.set('automatic', { enabled: true, accountKey });
          if (initial && full) state.job = null;
          const batchGap = preview ? 1000 : 60000;
          if (state.lastBatch?.at + batchGap > Date.now()) {
            resumeAt = state.lastBatch.at + batchGap;
            await C.sleep(resumeAt - Date.now(), signal); resumeAt = 0;
          }
          message = '正在自动扫描，只统计已识别重置边界之后的对话…'; render();
          const result = await C.scanBatch({ state, config, signal, forceFull: initial && full, detailBudget: preview ? 2 : 6,
            request: (path, requestSignal) => api.request(path, identity, requestSignal),
            save: value => store.set('account:' + identity.key, value),
            onProgress: value => { progress = value; render(); }
          });
          initial = false; identity.token = null;
          return result;
        }
      });
      if (result.status === 'complete') {
        await setMonitoring(true, accountKey);
        refresh.finished();
        const summary = C.totals(state, config);
        message = summary.rows.some(row => row.unknown) ?
          '历史列表扫描完成，但有未分类回答；剩余额度保持未知。' : '历史列表扫描完成。显示的是已保存历史的估算次数。';
      } else {
        await setMonitoring(false, accountKey);
        if (result.status === 'needs-window') message = C.quotaStatus(state.subscription, config) + '\n没有启动本周期历史扫描。';
        else if (result.status === 'paused') message = '已暂停，扫描进度已保存。';
        else message = result.error?.message || '扫描已暂停。';
      }
      } catch (error) { await setMonitoring(false, accountKey); throw error;
      } finally { await store.set('automatic', { enabled: false, accountKey }); }
    });
  }
  $('toggle').addEventListener('click', () => setExpanded(!expanded));
  $('language').addEventListener('change', async () => {
    languagePreference = $('language').value;
    language = I.resolve(languagePreference,navigator.languages || [navigator.language]);
    await store.set('language',languagePreference); render();
  });
  $('close').addEventListener('click', () => setExpanded(false));
  shadow.addEventListener('keydown', event => { if (event.key === 'Escape') setExpanded(false); });
  $('mode').addEventListener('change', () => {
    $('anchor-wrap').hidden = $('mode').value !== 'fixed';
    for (const input of shadow.querySelectorAll('input')) input.disabled = busy || $('mode').value !== 'fixed';
  });
  $('pause').addEventListener('click', async () => {
    await setMonitoring(false);
    message = busy ? '正在暂停…' : '自动更新已暂停，已有统计保留。点击开始自动扫描可重新开启。';
    abort?.abort(); render();
  });
  $('connect').addEventListener('click', () => withLock(async signal => {
    message = '正在读取登录状态…'; render(); await loadAccount(signal, null, true);
    message = C.quotaStatus(state.subscription, config);
  }));
  $('scan').addEventListener('click', () => run());
  $('full').addEventListener('click', () => run(true));
  $('save').addEventListener('click', () => withLock(async () => {
    const next = C.settings({ mode: $('mode').value,
      allowanceProfile: $('allowance-profile').value,
      anchor: $('anchor').value ? new Date($('anchor').value).getTime() : null,
      buckets: config.buckets.map(bucket => ({ ...bucket,
        days: $('days-' + bucket.id).value, limit: $('limit-' + bucket.id).value }))
    });
    // Reload under the same cross-tab lock instead of overwriting another tab's progress.
    const latest = await store.get('account:' + identity.key, null);
    state = latest?.version === 1 ? latest : C.newState();
    if (C.coverageSignature(config) !== C.coverageSignature(next)) { state.job = null; state.coverage = null; }
    config = C.applyQuota(next, state.subscription?.quota, state.subscription);
    await store.set('settings:' + identity.key, config);
    await store.set('account:' + identity.key, state);
    message = '设置已保存。自动模式按订阅日期与套餐规则估算，服务器周期优先；手动模式采用你指定的周期。';
  }));
  $('clear').addEventListener('click', () => withLock(async () => {
    await setMonitoring(false);
    await store.remove('account:' + identity.key); state = C.newState();
    message = '本地扫描记录已清空。额度设置和限流冷却保留。';
  }));
  $('export').addEventListener('click', async () => {
    if (busy || !identity) return;
    const latest = await store.get('account:' + identity.key, null);
    if (latest?.version === 1) state = latest;
    const blob = new Blob([JSON.stringify({ version: 1, scriptVersion: '0.5.1', generatedAt: new Date().toISOString(),
      accountTag: identity.key.slice(0, 10), settings: config, statistics: C.totals(state, config),
      lastBatch: state.lastBatch, subscription: state.subscription,
      note: 'Saved-history estimates; not official remaining allowance.' }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'chatpro-diagnostic-' + new Date().toLocaleDateString('sv-SE') + '.json';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    message = '诊断已导出，包含额度字段值；不含正文、邮箱、登录令牌或会话 ID。'; render();
  });
  if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand(I.translate('打开 ChatPro 历史用量',language), () => setExpanded(true));
  fillSettings(); gate = await store.get('gate', {}); render();
  setInterval(async () => { if (expanded) { gate = await store.get('gate', {}); render(); } }, 1000);
  if (preview) setExpanded(true);
  const automatic = await store.get('automatic', {});
  if (automatic.enabled) run(false, automatic.accountKey);
  else await restoreSavedAccount();
  const savedMonitor = await store.get('monitoring', null);
  if (identity && !busy) {
    // Existing completed scans migrate to automatic updates; an explicit pause persists.
    if (!savedMonitor && state.coverage) await setMonitoring(true);
    else monitoring = savedMonitor?.enabled === true && savedMonitor.accountKey === identity.key;
  }
  const responseSelector = '[data-message-author-role], [data-testid^="conversation-turn"]';
  const streaming = () => !!document.querySelector('[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="停止生成"], [data-is-streaming="true"]');
  const markChanged = () => { if (monitoring) refresh.changed(); };
  document.addEventListener('submit', markChanged, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing &&
      event.target?.matches?.('textarea, [contenteditable="true"]')) markChanged();
  }, true);
  document.addEventListener('click', event => {
    if (event.target?.closest?.('[data-testid="send-button"], [data-testid="composer-submit-button"]')) markChanged();
  }, true);
  new MutationObserver(records => {
    if (!monitoring) return;
    if (records.some(record => {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      return target?.closest?.(responseSelector) || [...record.addedNodes, ...record.removedNodes].some(node =>
        node.nodeType === 1 && (node.matches(responseSelector) || node.querySelector(responseSelector)));
    })) markChanged();
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setInterval(async () => {
    if (monitorTickBusy || busy || !identity) return;
    monitorTickBusy = true;
    try {
      const preference = await store.get('monitoring', null);
      monitoring = preference?.enabled === true && preference.accountKey === identity.key;
      if (!monitoring || !refresh.due({ busy, visible: document.visibilityState !== 'hidden', streaming: streaming(), lastBatchAt: state.lastBatch?.at || 0 })) return;
      // Cross-tab completion postpones duplicate work. The existing lock prevents concurrent requests.
      const latest = await store.get('account:' + identity.key, null);
      if (latest?.version === 1) state = latest;
      if (!refresh.due({ lastBatchAt: state.lastBatch?.at || 0 })) return;
      refresh.started();
      await run(false, identity.key, true);
    } catch (error) {
      await setMonitoring(false); message = '自动更新已暂停：' + error.message; render();
    } finally { monitorTickBusy = false; }
  }, preview ? 500 : 5000);
  render();
})();
