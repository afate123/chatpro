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
