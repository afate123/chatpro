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
    <div class="footer"><a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer">AGPL-3.0</a> · Beta · __CHATPRO_VERSION__</div>
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
    const blob = new Blob([JSON.stringify({ version: 1, scriptVersion: '__CHATPRO_VERSION__', generatedAt: new Date().toISOString(),
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
