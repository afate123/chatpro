# Publishing

Public repository: [afate123/chatpro](https://github.com/afate123/chatpro), branch `main`.

1. Create the repository in the chosen GitHub account. If using another name, edit `release.config.json`, package.json repository URL and README installation links together, then build.
2. Use Node.js 22+ and run `npm test`, `npm run build`, `npm run build:verify`, `npm run check`, `npm run release:prepare`.
3. Review `git status` and staged contents. Exclude artifacts/, release/, diagnostics, local paths, real subscription metadata and secrets. The source archive should contain source, tests, license and generated userscript.
4. Upload/commit on main only after review. Do not change the userscript @name, @namespace or chatpro:v1 storage keys during routine updates.
5. Enable private vulnerability reporting. Complete docs/LIVE_VALIDATION.md using a real browser; leave unknown checks pending.
6. After approval, create a tag matching package.json (e.g. v0.5.1). The tag workflow publishes a **prerelease** with install script, update metadata, license, privacy, attribution, a complete public source archive and SHA256SUMS. GitHub also provides source archives for the tag.

One-click install and update metadata point to raw main/dist. They work only after those files have been uploaded. Updates follow main, so keep distribution files reviewed and passing CI before merging. A prerelease is not necessarily returned by GitHub's latest-release URL; README intentionally uses the explicit raw install URL.

Local `npm run release:prepare` uses `tar` (included in current Windows and Ubuntu runners) and creates assets only; it never uploads. The source asset uses an explicit public file list, including docs/images/demo.png; ignored local diagnostics and validation notes are excluded. No action here creates a repository or publishes without an explicit publishing request.
