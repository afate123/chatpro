const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');
const NOW = Date.UTC(2026, 9, 8, 8);
function fixture() {
  let clock = NOW;
  const schedule = new C.RefreshSchedule({ now: () => clock });
  return { schedule, advance: ms => { clock += ms; } };
}
test('new response changes coalesce until output settles', () => {
  const { schedule, advance } = fixture();
  schedule.changed(); advance(7000); assert.equal(schedule.due(), false);
  schedule.changed(); advance(7000); assert.equal(schedule.due(), false);
  advance(1000); assert.equal(schedule.due(), true);
});
test('background updates respect gap from the most recent saved scan', () => {
  const { schedule, advance } = fixture();
  schedule.changed(); advance(8000);
  assert.equal(schedule.due({ lastBatchAt: NOW }), false);
  advance(52000); assert.equal(schedule.due({ lastBatchAt: NOW }), true);
  schedule.started(); schedule.changed(); advance(8000);
  assert.equal(schedule.due(), false);
});
test('hidden pages, active scans and streaming responses postpone without losing pending work', () => {
  const { schedule, advance } = fixture();
  schedule.changed(); advance(8000);
  assert.equal(schedule.due({ visible: false }), false);
  assert.equal(schedule.due({ busy: true }), false);
  assert.equal(schedule.due({ streaming: true }), false);
  assert.equal(schedule.due(), true);
});
test('periodic reconciliation discovers cloud changes even without local DOM events', () => {
  const { schedule, advance } = fixture();
  advance(179999); assert.equal(schedule.due(), false);
  advance(1); assert.equal(schedule.due(), true);
  schedule.started(); schedule.finished(); advance(179999); assert.equal(schedule.due(), false);
  advance(1); assert.equal(schedule.due(), true);
});
test('response appearing during a scan schedules another incremental refresh', () => {
  const { schedule, advance } = fixture();
  schedule.started(); advance(10000); schedule.changed(); advance(10000); schedule.finished();
  advance(40000); assert.equal(schedule.due(), true);
});
test('incremental history updates refetch only new or changed conversations, without duplicating turns', async () => {
  const config = C.settings({ ...C.DEFAULTS, mode: 'fixed', anchor: NOW - C.DAY });
  const state = C.newState();
  const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  let phase = 0;
  const calls = [];
  const detail = n => ({ conversation_id: id(n), mapping: Object.fromEntries(
    Array.from({length: n === 1 && phase ? 2 : 1}, (_, index) => [
      ['u' + index, { parent: null, message: { id: 'user-' + index, author: {role:'user'}, create_time:(NOW - 1000 + index * 500)/1000 } }],
      ['a' + index, { parent: 'u' + index, message: { author: {role:'assistant'}, recipient:'all', status:'finished_successfully',
        channel:'final', create_time:NOW/1000, content:{content_type:'text'}, metadata:{model_slug:'gpt-6-pro'} } }]
    ]).flat()) });
  const request = async path => {
    calls.push(path);
    if (path.startsWith('/backend-api/conversations?')) return path.includes('is_archived=true') ? {items:[], total:0} :
      {items:(phase ? [1,3,2] : [1,2]).map(n => ({id:id(n), update_time:(NOW + (phase && n !== 2 ? 60000 : 0))/1000})), total:phase ? 3 : 2};
    return detail(Number(path.slice(-12)));
  };
  assert.equal((await C.scanBatch({state,config,request,save:async()=>{},now:()=>NOW})).status,'complete');
  assert.equal(C.totals(state,config,NOW).rows[2].used,2);
  phase = 1; calls.length = 0;
  assert.equal((await C.scanBatch({state,config,request,save:async()=>{},now:()=>NOW+60000})).status,'complete');
  assert.deepEqual(calls.filter(path => !path.includes('?')), ['/backend-api/conversation/'+id(1),'/backend-api/conversation/'+id(3)]);
  assert.equal(C.totals(state,config,NOW+60000).rows[2].used,4);
});
