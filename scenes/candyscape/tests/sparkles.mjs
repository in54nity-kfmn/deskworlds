import assert from 'node:assert/strict';
import { register } from 'node:module';
register('../../riverscape/tests/three-loader.mjs',import.meta.url);
const { ReefSimulation,FIXED_STEP,SPARKLE }=await import('../src/simulation.js');
const { Vector3 }=await import('three');
const at=(f,speed=.2)=>({position:new Vector3(f.position.x,f.position.y,2.4),speed});
const mine=(events,i)=>events.filter(e=>e.index===i).length;

// Hover: a slow cursor over a fish sparkles once, then waits out its cooldown, and does
// not frighten it.
{
  const s=new ReefSimulation(3),i=s.fish.findIndex(f=>f.kind==='mint'),f=s.fish[i];
  s.step(FIXED_STEP,at(f));let e=s.drainSparkles();
  assert.equal(mine(e,i),1,'First hover sparkles');assert.notEqual(f.state,'shelter','A slow hover does not alarm');
  assert.ok(['x','y','z'].every(k=>Number.isFinite(e.find(v=>v.index===i)[k]))&&e.find(v=>v.index===i).kind==='mint');
  let again=0;for(let k=0;k<Math.round((SPARKLE.cooldown-.1)/FIXED_STEP);k++){s.step(FIXED_STEP,at(f));again+=mine(s.drainSparkles(),i);}
  assert.equal(again,0,'Cooldown holds');
  let later=0;for(let k=0;k<Math.round(.3/FIXED_STEP);k++){s.step(FIXED_STEP,at(f));later+=mine(s.drainSparkles(),i);}
  assert.equal(later,1,'Sparkles again after cooldown');
}
// No pointer, or a pointer far from everything: nothing.
{
  const s=new ReefSimulation(3);
  for(let k=0;k<600;k++)s.step(FIXED_STEP);assert.equal(s.drainSparkles().length,0,'No pointer, no sparkles');
  for(let k=0;k<60;k++)s.step(FIXED_STEP,{position:new Vector3(0,-50,2.4),speed:.2});assert.equal(s.drainSparkles().length,0);
}
// Swipe: a fast cursor across every fish, never drained — the queue stays bounded and the
// alarm still fires alongside.
{
  const s=new ReefSimulation(5);
  for(let k=0;k<240;k++){const f=s.fish[k%s.fish.length];s.step(FIXED_STEP,at(f,8));}
  const e=s.drainSparkles();assert.ok(e.length>0&&e.length<=SPARKLE.queue,`Queue bounded (${e.length})`);
  assert.ok(s.fish.some(f=>f.state==='shelter'));assert.ok(s.diagnostics().finite);
  assert.equal(s.drainSparkles().length,0,'Drain empties');
}
// Determinism: same seed, same pointer sequence, same events.
{
  const run=()=>{const s=new ReefSimulation(9),out=[];for(let k=0;k<600;k++){s.step(FIXED_STEP,at(s.fish[(k>>4)%s.fish.length],.3));out.push(...s.drainSparkles());}return out;};
  assert.deepEqual(run(),run());
}
console.log('candyscape sparkle events ok');
