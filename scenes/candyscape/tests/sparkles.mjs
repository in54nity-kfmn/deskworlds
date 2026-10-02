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
// A cursor left resting is not a hover: on the wallpaper the mouse is parked over the desktop
// for hours, and a fish passing under it must not keep the tank glittering. Sparkles need a
// cursor that moved within the last SPARKLE.idle seconds.
{
  const s=new ReefSimulation(3),i=s.fish.findIndex(f=>f.kind==='mint'),f=s.fish[i];
  const parked=()=>({...at(f),idle:SPARKLE.idle+.5}),fresh=()=>({...at(f),idle:SPARKLE.idle-.5});
  let n=0;for(let k=0;k<300;k++){s.step(FIXED_STEP,parked());n+=s.drainSparkles().length;}
  assert.equal(n,0,'A parked cursor never sparkles');
  s.step(FIXED_STEP,fresh());assert.equal(mine(s.drainSparkles(),i),1,'A cursor that just moved sparkles');
  assert.ok(SPARKLE.idle>=1&&SPARKLE.idle<=4);
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
const { SparklePool,SPARKLE_LIFE,SPARKLE_COLORS,SPARKLE_SIZE,createSparkles }=await import('../src/sparkles.js');
// A sparkle must be visible from the wide view: the fish swim 15–18 units from the lens, so a
// new glint there is at least 8 px before the pixel ratio, not a 2 px speck lost in the motes.
for(const depth of [15,18])assert.ok(Math.min(SPARKLE_SIZE.max,Math.max(SPARKLE_SIZE.min,SPARKLE_SIZE.scale/depth))>=8,`Sparkle size at ${depth} u`);
const THREE=await import('three');
// One burst: N live sprites that rise, fade and retire on time.
{
  const pool=new SparklePool(512,1);pool.emit(0,3,1,[1,.5,.8],24);
  assert.equal(pool.alive(),24);const y0=[...Array(24)].reduce((s,_,i)=>s+pool.position[i*3+1],0)/24;
  for(let k=0;k<30;k++)pool.update(1/60);
  const y1=[...Array(24)].reduce((s,_,i)=>s+pool.position[i*3+1],0)/24;assert.ok(y1>y0,'Sparkles drift upward like bubbles');
  assert.ok(pool.life(0)>0&&pool.life(0)<1,'Fading');
  for(let k=0;k<60;k++)pool.update(1/60);assert.equal(pool.alive(),0,'Retired after SPARKLE_LIFE');assert.equal(pool.life(0),0);
}
// Flood: far more than the pool holds — the ring overwrites the oldest, never grows.
{
  const pool=new SparklePool(512,2);for(let k=0;k<100;k++)pool.emit(k*.1,2,1,[1,1,1],24);
  assert.equal(pool.alive(),512);assert.equal(pool.position.length,512*3);assert.ok([...pool.position].every(Number.isFinite));
}
// Zero dt (paused, hidden, host rate 0): nothing moves, nothing ages.
{
  const pool=new SparklePool(64,3);pool.emit(1,2,3,[1,1,1],8);const before=[...pool.position],life=pool.life(0);
  for(let k=0;k<100;k++)pool.update(0);
  assert.deepEqual([...pool.position],before);assert.equal(pool.life(0),life);
}
// Deterministic for a seed.
{const a=new SparklePool(64,4),b=new SparklePool(64,4);a.emit(0,0,0,[1,1,1]);b.emit(0,0,0,[1,1,1]);a.update(.1);b.update(.1);assert.deepEqual([...a.position],[...b.position]);}
// Every species has a sparkle colour.
for(const kind of ['gumdrop','mint','rosebud','lollipop'])assert.equal(SPARKLE_COLORS[kind].length,3);
assert.ok(SPARKLE_LIFE>.8&&SPARKLE_LIFE<1.3);
// Wired to a simulation: hover events become live sprites, drained exactly once.
{
  const s=new ReefSimulation(3),scene=new THREE.Scene(),fx=createSparkles(scene,s);
  const f=s.fish.find(g=>g.kind==='rosebud');s.step(FIXED_STEP,at(f));fx.update(FIXED_STEP);
  assert.equal(fx.pool.alive()%24,0);assert.ok(fx.pool.alive()>=24);assert.equal(s.drainSparkles().length,0);
  assert.ok(scene.children.some(c=>c.isPoints),'Adds one Points object');
}
console.log('candyscape sparkle events ok');
