const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
test('generated install and metadata share package version and stable script identity',()=>{
  const p=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const user=fs.readFileSync(path.join(root,'dist/chatpro.user.js'),'utf8');
  const meta=fs.readFileSync(path.join(root,'dist/chatpro.meta.js'),'utf8');
  assert.ok(user.startsWith(meta));
  assert.match(meta,new RegExp('@version\\s+'+p.version.replaceAll('.','\\.')));
  assert.match(meta,/@namespace\s+local.chatpro.history/);
  assert.match(meta,/@updateURL\s+https:\/\/raw.githubusercontent.com\/afate123\/chatpro\/main\/dist\/chatpro.meta.js/);
  assert.ok(user.includes("scriptVersion: '"+p.version+"'"));
  assert.doesNotMatch(user,/__CHATPRO_VERSION__/);
});
test('distribution reproducibility check passes for the current source',()=>{
  execFileSync(process.execPath,[path.join(root,'scripts/build.mjs'),'--check'],{cwd:root});
});
