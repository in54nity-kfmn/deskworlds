import assert from 'node:assert/strict';
import { register } from 'node:module';
register('../../riverscape/tests/three-loader.mjs', import.meta.url);
const { ReefSimulation, FIXED_STEP, POPULATION }=await import('../src/simulation.js');
const { currentAt,responseAt,WAVES,SURFACE }=await import('../src/water.js');
const { HOST }=await import('../src/terrain.js');
const { Vector3 }=await import('three');
const V=(x=0,y=0,z=0)=>new Vector3(x,y,z);
const sim=new ReefSimulation();
assert.equal(sim.fish.length,19);assert.equal(POPULATION.clownfish,3);
// Candyscape keeps the fish and drops the cleaner shrimp: no station animals, no cleaning.
assert.equal(sim.shrimp,undefined,'Candyscape has no cleaner shrimp');assert.ok(!('shrimp' in POPULATION));
const clowns=sim.fish.filter(f=>f.kind==='clown').map(f=>f.size);
assert.ok(Math.abs(clowns[0]/clowns[1]-1.26)<.05&&Math.abs(clowns[1]/clowns[2]-1.37)<.05,`Rank ratios ${clowns}`);
const goldies=sim.fish.filter(f=>f.kind==='anthias');
const male=goldies.find(f=>!f.rank),hens=goldies.filter(f=>f.rank);
assert.ok(male.size/(hens.reduce((s,f)=>s+f.size,0)/hens.length)>1.35,'Terminal male must outsize the harem');
let maxHome=0,cleaned=0,displayed=0,henDisplayed=0;
assert.ok(male.position.y<hens.reduce((n,f)=>n+f.position.y,0)/hens.length);
for(let i=0;i<60*180;i++){
  if(i===60*10||i===60*32)sim.feed(-1.5,1.3);
  sim.step(FIXED_STEP);
  for(const f of sim.fish){if(f.state==='clean')cleaned++;if(f.state==='display')f.rank?henDisplayed++:displayed++;}
  if(i%60===0){
    assert.ok(sim.diagnostics().finite);
    for(const f of sim.fish){
      assert.ok(f.velocity.length()<1.701);
      if(f.kind==='clown')maxHome=Math.max(maxHome,Math.hypot(f.position.x-HOST.x,f.position.y-HOST.y,f.position.z-HOST.z));
    }
  }
}
assert.ok(maxHome<2.6,`Clownfish host radius ${maxHome}`);
let aligned=0,moving=0;const flow=V(),rel=V(),head=V();
for(let i=0;i<60*20;i++){sim.step(FIXED_STEP);for(const f of sim.fish){currentAt(f.position,sim.time,flow);rel.copy(f.velocity).sub(flow);if(rel.length()<.2)continue;head.set(Math.cos(f.yaw)*Math.cos(f.pitch),Math.sin(f.pitch),-Math.sin(f.yaw)*Math.cos(f.pitch));moving++;if(head.dot(rel)/rel.length()>.94)aligned++;}}
assert.ok(aligned/moving>.85,`Fish swim along their heading ${aligned}/${moving} of the time`);
for(const kind of ['chromis','anthias']){const of=sim.fish.filter(f=>f.kind===kind);let beats=0,n=0;for(let i=0;i<60*30;i++){sim.step(FIXED_STEP);for(const f of of){n++;if(f.beat)beats++;}}assert.ok(beats/n>.12&&beats/n<.55,`${kind} bout fraction ${(beats/n).toFixed(2)}`);}
assert.equal(cleaned,0,'With no shrimp there is no cleaning station to visit');
assert.ok(displayed>0&&henDisplayed===0,`U-swim is male-only: male ${displayed}, females ${henDisplayed}`);
assert.ok(sim.consumed>0,'Fish must actually consume food');
assert.equal(sim.food.filter(p=>p.active).length,0,'Food bounded lifetime');
const a=new ReefSimulation(42),b=new ReefSimulation(42);
for(let i=0;i<600;i++){a.step(FIXED_STEP);b.step(FIXED_STEP);}
for(let i=0;i<a.fish.length;i++)assert.deepEqual(a.fish[i].position.toArray(),b.fish[i].position.toArray());
const threatened=a.fish[0];const pointer={position:threatened.position.clone(),speed:8};a.step(FIXED_STEP,pointer);assert.equal(threatened.state,'shelter');
const wave=new ReefSimulation();
const seed=wave.fish.find(f=>f.kind==='chromis'),pod=wave.fish.filter(f=>f.kind==='chromis'&&f!==seed&&f.shoal===seed.shoal);
[seed,...pod].forEach((f,i)=>{f.position.set(-.8+i*.65,6.8,3.4);f.velocity.set(0,0,0);f.goal.copy(f.position);f.goalTimer=5;});
seed.alarm=2.6;wave.step(FIXED_STEP);
const first=pod.filter(f=>f.alarm>0).length;
assert.ok(first<pod.length,`A startle cannot reach a whole pod in one frame (${first}/${pod.length})`);
for(let i=0;i<12;i++)wave.step(FIXED_STEP);
assert.ok(pod.filter(f=>f.alarm>0).length>first,'A startle must keep spreading through the pod');
const pool=new ReefSimulation();for(let i=0;i<30;i++){pool.lastFeed=-100;pool.feed(0,1);}assert.equal(pool.food.filter(p=>p.active).length,32);
assert.equal(pool.feed(0,1),0,'Feed cooldown works');
for(const t of [0,1,10,100,10000]){
 const v=currentAt(V(0,2,0),t,V());assert.ok(v.toArray().every(Number.isFinite));assert.ok(v.length()<1.8);
 const response=responseAt(V(0,2,0),t,.8,V());assert.ok(response.toArray().every(Number.isFinite));
}
for(const w of WAVES)assert.ok(Math.abs(w.omega*w.omega-98.1*w.k*Math.tanh(w.k*SURFACE))<1e-9);
assert.throws(()=>sim.step(NaN),RangeError);assert.throws(()=>sim.step(1),RangeError);
console.log(JSON.stringify({pass:true,simulatedSeconds:sim.time,consumed:sim.consumed,maxClownfishHostDistance:maxHome,...sim.diagnostics()},null,2));
