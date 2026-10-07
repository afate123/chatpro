import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
execFileSync(process.execPath, [fileURLToPath(new URL('build.mjs', import.meta.url)), '--check'], {stdio:'inherit'});
const destination = new URL('release/v' + pkg.version + '/', root);
await mkdir(destination, {recursive:true});
const files = ['dist/chatpro.user.js','dist/chatpro.meta.js','LICENSE','THIRD_PARTY.md','PRIVACY.md'];
const hashes = [];
for (const source of files) {
  const name = source.split('/').at(-1);
  await copyFile(new URL(source,root),new URL(name,destination));
  hashes.push(createHash('sha256').update(await readFile(new URL(source,root))).digest('hex') + '  ' + name);
}
// Explicit public inputs keep local diagnostics/backups out of source assets.
const sourceInputs = ['src','tests','scripts','.github','package.json','release.config.json','.gitignore',
  'README.md','README.zh-CN.md','README.es.md','CHANGELOG.md','CONTRIBUTING.md','SECURITY.md','VALIDATION.md','preview.html',
  ...files,'docs/QUOTA_POLICY.md','docs/LIVE_VALIDATION.md','docs/PUBLISHING.md','docs/release-notes.md','docs/images/demo.png','docs/images/demo-es.png'];
const sourceName = 'chatpro-v' + pkg.version + '-source.tar.gz';
execFileSync('tar', ['-czf',fileURLToPath(new URL(sourceName,destination)),'--',...sourceInputs],
  {cwd:fileURLToPath(root),stdio:'inherit'});
hashes.push(createHash('sha256').update(await readFile(new URL(sourceName,destination))).digest('hex') + '  ' + sourceName);
await writeFile(new URL('SHA256SUMS',destination),hashes.join('\n')+'\n');
console.log('Prepared local release/v' + pkg.version + ' assets. Nothing uploaded.');
