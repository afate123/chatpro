const {test}=require('node:test');
const assert=require('node:assert/strict');
test('Spanish regional preferences and saved selection resolve without changing accounting',()=>{
  const I=require('../src/i18n.js');
  assert.equal(I.resolve('auto',['es-MX','en-US']),'es');
  assert.equal(I.resolve('zh',['es-ES']),'zh');
  assert.equal(I.resolve('auto',['pt-BR']),'en');
  assert.equal(I.translate('开始自动扫描','es'),'Iniciar escaneo automático');
  assert.equal(I.translate('估算剩余 42 / 50（套餐规则）','es'),'Restante estimado 42 / 50(regla del plan)');
  assert.equal(I.translate('开始自动扫描','zh'),'开始自动扫描');
});
test('translation preserves unknown external errors and model identifiers',()=>{
  const I=require('../src/i18n.js');
  assert.equal(I.translate('NetworkError gpt-6-pro 429','es'),'NetworkError gpt-6-pro 429');
  assert.equal(I.translate('GPT-6 Pro 周期天数','es'),'GPT-6 Pro días del período');
});

test('all owned interface and accounting messages are translated except native language names',()=>{
  const fs=require('node:fs'),I=require('../src/i18n.js');
  for(const name of ['browser','core']){
    const source=fs.readFileSync(require.resolve('../src/'+name+'.js'),'utf8');
    const values=[...source.matchAll(/'([^'\n]*)'/g),...source.matchAll(/>([^<>\n]+)</g),
      ...source.matchAll(/(?:aria-label|placeholder)="([^"]+)"/g)].map(m=>m[1]);
    for(const value of values)if(/\p{Script=Han}/u.test(value)&&value!=='中文'&&!value.includes('停止生成'))
      for(const lang of ['en','es'])assert.doesNotMatch(I.translate(value,lang),/\p{Script=Han}/u,lang+': '+value);
  }
});

test('switching language preserves source labels and accepts new dynamic counters',()=>{
  const I=require('../src/i18n.js');
  const nodes=[{nodeValue:'开始自动扫描',parentElement:{tagName:'BUTTON'}},
    {nodeValue:'估算剩余 42 / 50（套餐规则）',parentElement:{tagName:'DIV'}}];
  const root={querySelectorAll:()=>[]};
  const oldDocument=global.document,oldFilter=global.NodeFilter;
  global.document={createTreeWalker:()=>{let i=0;return {nextNode:()=>nodes[i++]};}};
  global.NodeFilter={SHOW_TEXT:4};
  try {
    I.localize(root,'es');assert.equal(nodes[0].nodeValue,'Iniciar escaneo automático');
    I.localize(root,'en');assert.equal(nodes[0].nodeValue,'Start automatic scan');
    nodes[1].nodeValue='估算剩余 41 / 50（套餐规则）';
    I.localize(root,'es');assert.match(nodes[1].nodeValue,/41 \/ 50/);
    I.localize(root,'zh');assert.equal(nodes[0].nodeValue,'开始自动扫描');
    assert.equal(nodes[1].nodeValue,'估算剩余 41 / 50（套餐规则）');
  } finally {global.document=oldDocument;global.NodeFilter=oldFilter;}
});
