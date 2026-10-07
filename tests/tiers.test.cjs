const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');
const NOW = Date.UTC(2026, 9, 8, 8);
const subscription = plan => ({plan, activeStart: NOW - 2*C.DAY, activeUntil: NOW+28*C.DAY});
const cfg = (plan, profile='auto', quota={}) => C.applyQuota({...C.automaticSettings(),allowanceProfile:profile},quota,subscription(plan),NOW);
test('Pro 200 automatic shared dates produce counts but never guess 100 or 200',()=>{
  const result=cfg('pro');
  assert.equal(result.buckets[0].limit,null);
  assert.equal(result.buckets[0].days,7);
  assert.deepEqual(result.buckets.slice(1).map(b=>b.days),[7,7]);
  assert.ok(Number.isFinite(C.coverageSince(result,NOW)));
});
test('Pro 200 selected qualification sets one shared weekly limit',()=>{
  for(const limit of [100,200]) {
    const result=cfg('pro','pro200-'+limit);
    assert.deepEqual(result.buckets.map(b=>b.limit),[null,null,limit]);
  }
});
test('Pro 500 defaults to 250 for GPT-6, never a shared two-model 250 cap',()=>{
  assert.equal(C.normalizePlan('chatgptpro500plan'),'pro500');
  assert.deepEqual(cfg('pro500').buckets.map(b=>b.limit),[250,null,null]);
  assert.equal(cfg('unknown','pro500').buckets[0].limit,250);
});
test('server cap and period supersede selected presets',()=>{
  const row={start:NOW-C.DAY,end:NOW+C.DAY,limit:123,blocked:true,source:'server'};
  const result=cfg('pro','pro200-200',{rows:{shared:row}});
  assert.equal(result.buckets[2].limit,123);
  assert.equal(result.buckets[0].start,row.start);
  assert.equal(result.buckets[0].estimated,false);
});
test('profile persists and cannot change fixed manually specified caps',()=>{
  assert.equal(C.settings({...C.automaticSettings(),allowanceProfile:'pro500'}).allowanceProfile,'pro500');
  assert.throws(()=>cfg('pro','random'));
  const manual=C.settings({...C.DEFAULTS,mode:'fixed',anchor:NOW-C.DAY,allowanceProfile:'pro500',buckets:C.DEFAULTS.buckets.map(b=>({...b,limit:40}))});
  assert.equal(C.applyQuota(manual,{},subscription('pro500'),NOW).buckets[0].limit,40);
});

test('official qualification interval detects an overlapping Pro 200 billing period',()=>{
  const qualifies={plan:'pro',activeStart:Date.parse('2026-09-01T00:00:00-07:00'),activeUntil:Date.parse('2026-10-01T00:00:00-07:00')};
  assert.equal(C.pro200Allowance(qualifies,NOW).limit,200);
  assert.equal(C.pro200Eligibility({...qualifies,plan:'prolite'},NOW),false);
  assert.equal(C.pro200Eligibility({...qualifies,activeUntil:C.PRO200_POLICY.eligibilityStart},NOW),false);
  assert.equal(C.pro200Eligibility({...qualifies,activeStart:C.PRO200_POLICY.eligibilityEnd},NOW),true);
  assert.equal(C.pro200Eligibility({...qualifies,activeStart:C.PRO200_POLICY.eligibilityEnd+1},NOW),false);
});

test('recent renewal alone does not prove ineligibility, same-account cached qualification survives rejoin',()=>{
  assert.equal(C.pro200Allowance(subscription('pro'),NOW).limit,null);
  assert.equal(C.pro200Allowance({...subscription('pro'),pro200Qualified:true},NOW).limit,200);
  assert.equal(C.pro200Allowance({...subscription('pro'),pro200Qualified:true},NOW,'pro200-100').limit,100);
});

test('confirmed old qualification expires automatically at the documented calendar fallback',()=>{
  const expiry=C.PRO200_POLICY.lowerAllowanceFrom;
  assert.equal(C.pro200Allowance(subscription('pro'),expiry-1,'pro200-200').limit,200);
  assert.equal(C.pro200Allowance(subscription('pro'),expiry,'pro200-200').limit,100);
  assert.equal(C.pro200Allowance(subscription('pro'),expiry,'auto').limit,100);
  const sub={plan:'pro',activeStart:expiry-C.DAY,activeUntil:expiry+30*C.DAY};
  const result=C.applyQuota({...C.automaticSettings(),allowanceProfile:'pro200-200'},{},sub,expiry);
  assert.deepEqual(result.buckets.map(b=>b.limit),[null,null,100]);
});

test('empty quota refresh cannot perpetuate a stale 200 cap past the transition',()=>{
  const expiry=C.PRO200_POLICY.lowerAllowanceFrom;
  const old={rows:{shared:{start:expiry-C.DAY,end:expiry+6*C.DAY,limit:200,limitObservedAt:expiry-1000}}};
  const refreshed=C.quotaMetadata({},'pro',old,expiry+1000);
  const sub={plan:'pro',activeStart:expiry-C.DAY,activeUntil:expiry+30*C.DAY};
  assert.equal(C.subscriptionQuota(sub,refreshed,expiry+1000).rows.shared.limit,100);
  const fresh=C.quotaMetadata({message_usage:{unit:'messages',models:['gpt-6-pro','gpt-5-6-pro'],
    window_start:(expiry-C.DAY)/1000,window_end:(expiry+6*C.DAY)/1000,limit:200}},'pro',old,expiry+1000);
  assert.equal(C.subscriptionQuota(sub,fresh,expiry+1000).rows.shared.limit,200);
});
