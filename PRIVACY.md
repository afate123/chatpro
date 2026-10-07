# Privacy / 隐私

ChatPro has no analytics, advertising, external backend, or remote runtime dependencies.

While running on chatgpt.com it reads the signed-in session, selected account, subscription metadata, quota signals, and saved conversation history from chatgpt.com. The full history response is processed in memory; conversation text is not saved. Requests include the current session credentials and, where needed, its in-memory access token sent only to chatgpt.com. Automatic identity checks run at page load; ongoing checks start after a successful scan.

Tampermonkey storage holds account hashes, conversation UUIDs, update times, hashed turn IDs, model slugs, timestamps, subscription dates, a qualifying Pro $200 evidence flag, selected limits, minimal quota diagnostics, scanning checkpoints, monitoring and language preferences, and request cooldowns. No chat titles, text, emails, cookies, or access tokens are persisted. Data is isolated by the verified account. Cached metadata can still reveal usage patterns, so treat it as personal data. Interface translations are bundled locally, without a translation service.

**Pause automatic updates** stops scheduled scans. **Clear local records** deletes the current account's cache; quota settings and cooldown remain. Deleting the script's data using the userscript manager removes all ChatPro storage. Updating the existing script preserves that storage; installing a second copy may create separate storage.

Diagnostic export is a local file, not an upload. It includes an account hash prefix and precise subscription/reset dates; review or remove those before sharing. No credentials, chat text, or conversation UUIDs are exported.

Userscript update checks/downloads go to the configured public GitHub/raw.githubusercontent.com URLs through Tampermonkey. Those servers receive normal network request information; ChatPro does not attach ChatGPT tokens or cache content. Installing grants the script access to ChatGPT responses on the matched site, so review the source and updates.

中文：运行数据请求仅发往 chatgpt.com，无遥测和外部数据服务。只保存统计所需元数据，不保存正文、标题或令牌。诊断导出不会自动上传，但含账号哈希前缀和精确日期，分享前应脱敏。暂停可停止自动更新，清空记录删除当前账号缓存；彻底删除所有存储可在油猴管理器中操作。脚本更新由油猴向公开 GitHub 地址检查，不附带 ChatGPT 凭据。
