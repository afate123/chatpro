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
