import test from 'node:test';
import assert from 'node:assert/strict';
import {bootstrapSession} from '../src/bootstrap.ts';

const forbiddenDemo=()=>{throw Error('A normal user must never read the demo account');};
test('refreshing a real session never reads stale demo names or groups',()=>{
  const boot=bootstrapSession('real-session',false,true,'ru',forbiddenDemo,forbiddenDemo);
  assert.equal(boot.token,'real-session');
  assert.equal(boot.snapshot.user.name,'');
  assert.deepEqual(boot.snapshot.groups,[]);
  assert.equal(boot.onboarding,false);
  assert.equal(boot.demoEnabled,false);
});
test('production without a session opens registration even if old demo storage was set',()=>{
  const boot=bootstrapSession(null,false,true,'en',forbiddenDemo,forbiddenDemo);
  assert.equal(boot.onboarding,true);
  assert.equal(boot.demoEnabled,false);
  assert.deepEqual(boot.snapshot.events,[]);
});
test('development also requires an explicit demo choice',()=>{
  assert.equal(bootstrapSession(null,true,false,'en',forbiddenDemo,forbiddenDemo).onboarding,true);
});
test('an explicitly selected development demo remains available for developer QA only',()=>{
  const fixture={user:{id:'demo',name:'Demo',locale:'en'},groups:[],events:[]};
  const boot=bootstrapSession(null,true,true,'en',()=>fixture,forbiddenDemo);
  assert.equal(boot.snapshot,fixture);
  assert.equal(boot.demoEnabled,true);
  assert.equal(boot.onboarding,false);
});
