import { readFile, writeFile, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const release = JSON.parse(await readFile(new URL('release.config.json', root), 'utf8'));
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(release.repository) || !/^[A-Za-z0-9_.-]+$/.test(release.branch)) throw new Error('Invalid release repository or branch');
const home = 'https://github.com/' + release.repository;
const raw = 'https://raw.githubusercontent.com/' + release.repository + '/' + release.branch + '/dist/';
const metadata = `// ==UserScript==
// @name         ChatPro 历史用量估算
// @name:en      ChatPro History Usage Estimate
// @name:es      ChatPro Estimación de Uso del Historial
// @namespace    local.chatpro.history
// @version      ${pkg.version}
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
// @homepageURL  ${home}
// @supportURL   ${home}/issues
// @updateURL    ${raw}chatpro.meta.js
// @downloadURL  ${raw}chatpro.user.js
// ==/UserScript==
`;
const core = await readFile(new URL('src/core.js', root), 'utf8');
const i18n = await readFile(new URL('src/i18n.js', root), 'utf8');
const browser = (await readFile(new URL('src/browser.js', root), 'utf8')).replaceAll('__CHATPRO_VERSION__', pkg.version);
const outputs = { 'chatpro.user.js': metadata + '\n' + core + '\n' + i18n + '\n' + browser, 'chatpro.meta.js': metadata };
if (process.argv.includes('--check')) {
  for (const [name, expected] of Object.entries(outputs)) {
    const actual = await readFile(new URL('dist/' + name, root), 'utf8');
    if (actual !== expected) throw new Error(name + ' does not match current source; run npm run build');
  }
  console.log('Distribution matches source and package version.');
} else {
  await mkdir(new URL('dist/', root), { recursive: true });
  for (const [name, content] of Object.entries(outputs)) await writeFile(new URL('dist/' + name, root), content, 'utf8');
  // preview uses the same transformed UI as installation, without any remote dependencies.
  await writeFile(new URL('dist/preview-browser.js', root), browser, 'utf8');
  console.log('Built userscript and update metadata v' + pkg.version);
}
