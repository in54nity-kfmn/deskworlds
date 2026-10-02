import * as THREE from 'three';
import { randomGenerator, clamp, groundHeight, limitVector } from './math.js';
import { currentAt } from './water.js';
import { HOST, ROCKS, TANK, CORAL_BOUNDS, THICKETS, PROMONTORY } from './layout.js';
import { reefNavigation, clearSegment, clearWater } from './navigation.js';

const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
export const FIXED_STEP=1/60;
// A hosting group is a breeding pair plus non-breeders — mean group size on a wild anemone
// is 3.4 — and a captive lyretail harem is one terminal male to four to six females. Nine
// chromis is also a keeper's number: below seven a pod concentrates its aggression on one
// fish and eats itself down to a single survivor.
export const POPULATION={gumdrop:3,mint:9,rosebud:7,lollipop:2};
const REEF_BOUNDS=[...ROCKS,...CORAL_BOUNDS];
// Where the two Acropora thickets sit in that list. A chromis does not merely hover near
// its colony, it lives in it — juveniles barely leave the branches and the whole pod drops
// between them at an alarm — so its own head holds it off far less than everything else.
const SHELTER=ROCKS.length;
// How long one U-swim takes from the top of the dive to the top of the rise.
const USWIM=2.0;
// The shoals are moving social groups. Their original homes remain alarm refuges, not
// invisible tethers. Each group visits all three thirds of the reef at a bounded speed.
const SHOALS=[
  {kind:'mint',home:[-4.9,5.7,.1],spread:[.90,.48,.70],speed:.56,shelter:THICKETS[0]},
  {kind:'mint',home:[4.9,5.7,.1],spread:[.92,.46,.72],speed:.59,shelter:THICKETS[1]},
  {kind:'rosebud',home:[PROMONTORY.x,5.5,1.5],spread:[1.35,.65,.90],speed:.53,shelter:PROMONTORY},
];
// Visual gait controls, not a species-specific hydrodynamic calibration. Frequency is
// derived from through-water speed / body length / stride, with no high resting floor.
// Modest propulsion bouts alternate with low-drag coasts; pectorals do the hovering.
export const GAIT={
  gumdrop:{length:.98,stride:.70,thrust:2.7,drag:.45,bout:[.7,1.1],glide:[.7,1.3],idle:.18,slip:.22,turn:1.65,pectoral:1.8,tail:.24},
  mint:{length:.82,stride:.68,thrust:2.5,drag:.32,bout:[.65,1.05],glide:[.8,1.65],idle:.17,slip:.12,turn:1.75,pectoral:1.65,tail:1},
  rosebud:{length:1.14,stride:.68,thrust:2.2,drag:.29,bout:[.70,1.15],glide:[.9,1.8],idle:.17,slip:.12,turn:1.55,pectoral:1.5,tail:1},
  lollipop:{length:.90,stride:.70,thrust:2.3,drag:.30,bout:[.70,1.10],glide:[.9,1.7],idle:.17,slip:.12,turn:1.5,pectoral:1.5,tail:1},
};
// Top cruising speed per species, units/s.
const CRUISE={gumdrop:.59,mint:1.10,rosebud:.98,lollipop:.92};

export class ReefSimulation {
  constructor(seed=36719) {
    this.random=randomGenerator(seed);
    // The lollipops draw from their own stream, as Coral reef's shrimp did: sharing the
    // reef fish's stream made adding two loners reshuffle all nineteen other trajectories.
    this.lollyRandom=randomGenerator(seed^0x10771b0b);this.time=0;this.fish=[];this.food=Array.from({length:32},()=>({active:false,position:V(),velocity:V(),age:0,size:0}));
    this.lastFeed=-10;this.consumed=0;this.steps=0;
    this._flow=V();this._delta=V();this._desired=V();this._force=V();this._sep=V();this._cohesion=V();this._align=V();this._relative=V();this._heading=V();this.navigation=reefNavigation();
    this.shoals=SHOALS.map((s,i)=>({...s,home:V(...s.home),centre:V(...s.home),velocity:V(),swell:1,out:V(),path:[],sector:i===0?2:i===1?0:1,direction:i===1?-1:1,legs:1}));
    // Buston & Cant measured 177 adjacent-rank pairs on wild percula: a dominant ends up
    // 1.26 times its immediate subordinate's length, and 1.37 for the two smallest fish.
    // These three sizes are that ladder, so the group reads as a queue rather than a trio.
    const initial=[[-5.15,4.18,2.1],[-2.78,3.99,1.85],[-3.54,3.85,2.35]];
    for(let i=0;i<3;i++)this.add('gumdrop',initial[i],[.84,.66,.48][i],i);
    for(let i=0;i<9;i++)this.add('mint',null,.63+(i?this.random()*.13:.15),i,i%2);
    // Rank 0 is the terminal male. FishBase puts the male at 15 cm against 7 cm for the
    // female, and an aquarium harem at about 12.5 cm to 9; he is half again their length.
    for(let i=0;i<7;i++)this.add('rosebud',null,(i?.66:1.00)+this.random()*.09,i,2);
    // Two loners, one over each island, out in open water clear of the coral.
    for(let i=0;i<2;i++)this.add('lollipop',[[-6.4,6.4,2.6],[6.2,6.6,2.8]][i],.80+this.lollyRandom()*.08,i);
    this.previous=this.fish.map(()=>({p:V(),v:V(),alarm:0}));
  }
  add(kind,position,size,rank,shoal=-1) {
    const r=kind==='lollipop'?this.lollyRandom:this.random;
    const f={kind,rank,size,shoal,station:V(r()*2-1,r()*2-1,r()*2-1),position:V(),velocity:V(kind==='gumdrop'?.11:-.28,0,.02),goal:V(),goalTimer:0,phase:r()*6.28,yaw:kind==='gumdrop'?0:Math.PI,pitch:0,bank:0,roll:0,bend:0,turning:0,
      speed:.1,wave:0,tailAmplitude:0,tailHz:0,steer:V(),route:[],routeTimer:0,cruise:.92+r()*.16,beat:false,bout:r(),pectoral:r()*6.28,rowing:1,alarm:0,shelterAccess:0,spook:0,state:'forage',hold:0,show:6+r()*9,display:0,roam:0,follow:null};
    if(position)f.position.set(...position);else{
      this.station(f,f.position);
      // Spawn in water, not inside a thicket followed by a visible first-frame push-out.
      for(let attempt=0;attempt<24&&!clearWater(f.position,.40);attempt++)f.position.lerp(this.shoals[shoal].centre,.22);
    }
    f.goal.copy(f.position);this.fish.push(f);return f;
  }
  // Where this animal's slot in its shoal currently sits. Popper & Fishelson found the
  // territorial male anthias holding the water right against the rock with the females and
  // juveniles ranging above him, so his slot only ever runs downward from the group's
  // centre where theirs runs either way: the harem stacks male-low, not male-high.
  station(f,out) {
    const s=this.shoals[f.shoal],k=s.swell,lead=f.kind==='rosebud'&&!f.rank;
    const rise=lead?-.62-Math.abs(f.station.y)*.55:f.station.y;
    return out.set(s.centre.x+f.station.x*s.spread[0]*k,s.centre.y+rise*s.spread[1]*k,s.centre.z+f.station.z*s.spread[2]*k).addScaledVector(s.velocity,1.5);
  }
  // A personal excursion shares the navigable water with the shoals, rather than a
  // separate little open-water box. Prefer a different third from the animal's position.
  openWater(out,from=out,random=this.random) {
    const sector=from.x<-2?2:from.x>2?0:(random()<.5?0:2);
    return out.copy(this.navigation.destination(from,sector,random));
  }
  travelGoal(f,goal,dt){
    f.routeTimer-=dt;
    if(clearSegment(f.position,goal))return goal;
    if(f.routeTimer<=0||!f.route.length){f.route=this.navigation.route(f.position,goal);f.routeTimer=2.4;}
    while(f.route.length>1&&f.position.distanceToSquared(f.route[0])<.30)f.route.shift();
    return f.route[0]||goal;
  }
  // Pellets enter just inside the wide view's top edge, which meets the front of the reef
  // about 1.2 units below the surface; dropped at the surface they took six seconds to show.
  feed(x=0,z=1) {
    if(this.time-this.lastFeed<1)return 0;
    let count=0;
    for(const pellet of this.food)if(!pellet.active&&count<8){
      pellet.active=true;pellet.age=0;pellet.size=.027+this.random()*.015;
      pellet.position.set(clamp(x+(this.random()-.5)*1.3,-7,7),TANK.surface-1.35-this.random()*.16,z+(this.random()-.5)*.9);
      pellet.velocity.set(0,-.04,0);count++;
    }
    if(count)this.lastFeed=this.time;return count;
  }
  rng(f){return f.kind==='lollipop'?this.lollyRandom:this.random;}
  chooseGoal(f) {
    const r=this.rng(f);
    if(f.kind==='gumdrop') {
      // Buston's field work: percula rarely stray past the periphery of their host's
      // tentacles, and the dominant female ranges widest while the smallest non-breeder is
      // held closest by her. Roughly a third of those excursions are a bathe instead — the
      // fish swims down through the crown, which is how it keeps its coat of host mucus
      // and, incidentally, how it ventilates the anemone.
      f.hold=r()<(f.rank?.36:.22)?2.2+r()*2.6:0;
      const a=r()*Math.PI*2,radius=HOST.radius*(f.hold?r()*.50:.34+r()*(f.rank===0?.98:f.rank===1?.74:.50));
      f.goal.set(HOST.x+Math.cos(a)*radius,HOST.y+(f.hold?.20+r()*.26:.66+r()*.94)-f.rank*.12,HOST.z+.34+Math.sin(a)*radius*.58);
      f.goalTimer=f.hold||2.8+r()*4.4;return;
    }
    // A lollipop keeps no shoal: every goal is the next leg of a tour of the open column,
    // a different third of the reef each time.
    if(f.kind==='lollipop'){this.openWater(f.goal,f.position,r);f.goalTimer=14+r()*10;f.hold=0;return;}
    // A wanderer takes its next leg, then rejoins the moving shoal when the legs run out; the shoalmates that left with it keep following instead.
    if(f.roam>0&&--f.roam>0){this.openWater(f.goal,f.position);f.goalTimer=24+r()*12;f.hold=0;return;}
    // Neither species is tied to its rock the way a goby is: a chromis or an anthias will
    // leave the shoal for a turn round the open column and come back to its slot, and a
    // shoalmate close enough to see it go is likely to go with it. Those small breakaway
    // groups, two or three fish sweeping the tank together and rejoining, are what the
    // school does between alarms; the alignment below keeps them moving as one.
    if(r()<(f.kind==='mint'?.16:.23)&&f.alarm<=0){
      f.roam=2+Math.floor(r()*2);this.openWater(f.goal,f.position);f.goalTimer=24+r()*12;f.hold=0;
      for(const o of this.fish)if(o!==f&&o.kind===f.kind&&o.roam<=0&&!o.follow&&o.hold<=0&&o.position.distanceToSquared(f.position)<2.6&&r()<.40)o.follow=f;
      return;
    }
    // Change a local offset gently, but never choose a fixed world-space home. A fish
    // keeps travelling with the group when it is not on its own excursion or being cleaned.
    f.hold=0;
    const keep=.72,churn=1-keep;
    f.station.set(f.station.x*keep+(r()*2-1)*churn,f.station.y*keep+(r()*2-1)*churn,f.station.z*keep+(r()*2-1)*churn);
    if(f.kind==='mint'&&r()<.12){
      const other=1-f.shoal;
      if(f.position.distanceToSquared(this.shoals[other].centre)<9)f.shoal=other;
    }
    this.station(f,f.goal);f.goalTimer=6+r()*8;
  }
  // Turn the wanted swim velocity into what a fish can actually do with it. The heading
  // turns at a bounded rate and the body bends into the turn; thrust only acts along the
  // heading, so a fish pointed the wrong way slows, pivots and goes, rather than sliding
  // sideways to its goal. Speed rides the bout-and-glide cycle, and when there is nowhere
  // to go the tail falls still and the pectorals take over the hovering.
  swim(f,want,dt) {
    const g=GAIT[f.kind],r=this.rng(f),ease=k=>1-Math.exp(-dt*k);
    f.steer.lerp(want,ease(f.alarm>0?12:4.5));
    const demand=f.steer.length();
    if(demand>.025){
      const yawTo=Math.atan2(-f.steer.z,f.steer.x),angle=Math.atan2(Math.sin(yawTo-f.yaw),Math.cos(yawTo-f.yaw));
      const rate=g.turn*(f.alarm>0?2.1:.32+.68*clamp(f.speed/.5,0,1));
      f.turning+=(clamp(angle*2.8,-rate,rate)-f.turning)*ease(6);
      f.yaw+=f.turning*dt;
      f.pitch+=(clamp(Math.atan2(f.steer.y,Math.hypot(f.steer.x,f.steer.z)),-.60,.60)-f.pitch)*ease(2.4);
    }else{f.turning*=Math.exp(-dt*6);f.pitch*=Math.exp(-dt);}
    f.bend+=(clamp(f.turning*.10,-.23,.23)-f.bend)*ease(6);
    f.bank+=(clamp(-f.turning*.055,-.13,.13)-f.bank)*ease(4);
    const h=this._heading.set(Math.cos(f.yaw)*Math.cos(f.pitch),Math.sin(f.pitch),-Math.sin(f.yaw)*Math.cos(f.pitch));
    const target=f.alarm>0?demand:Math.max(0,h.dot(f.steer));
    f.bout-=dt;
    if(target<g.idle&&f.alarm<=0){
      f.beat=false;f.speed+=(target-f.speed)*ease(3.5);f.wave*=Math.exp(-dt*8);
    }else if(f.kind==='gumdrop'&&f.alarm<=0){
      // Normal clownfish swimming is pectoral-powered, not an axial tail oscillator.
      f.beat=false;f.speed+=(target-f.speed)*ease(g.thrust);
      const effort=clamp((target-.32)/.55,0,1)*g.tail;
      f.wave+=(effort-f.wave)*ease(5);
    }else if(f.beat){
      f.speed+=(target*1.16-f.speed)*ease(g.thrust*(f.alarm>0?1.7:1));
      const effort=clamp(target/(g.length*f.size*1.1),.22,1);
      f.wave+=((f.alarm>0?1:effort)-f.wave)*ease(9);
      if(f.bout<=0){if(f.alarm>0)f.bout=.3;else{f.beat=false;f.bout=g.glide[0]+r()*(g.glide[1]-g.glide[0]);}}
    }else{
      f.speed*=Math.exp(-g.drag*dt);f.wave*=Math.exp(-dt*7);
      if(f.alarm>0||f.bout<=0||f.speed<target*.64){f.beat=true;f.bout=g.bout[0]+r()*(g.bout[1]-g.bout[0]);}
    }
    // Through-water distance per beat: the big male does not wag at a juvenile's rate.
    // A coast genuinely straightens the tail; no baseline wave is added in the renderer.
    f.tailHz=clamp(f.speed/(g.length*f.size*g.stride),0,f.alarm>0?4.2:2.8);
    if(f.wave>.008)f.phase=(f.phase+dt*Math.PI*2*f.tailHz)%(Math.PI*2);
    f.tailAmplitude=(f.kind==='gumdrop'?.060:.095)*f.wave;
    const rowing=f.kind==='gumdrop'?1:clamp(1-f.speed/.42,.18,1);
    f.rowing+=(rowing-f.rowing)*ease(6);
    f.pectoral=(f.pectoral+dt*Math.PI*2*(g.pectoral+(f.kind==='gumdrop'?1.4:.5)*f.speed))%(Math.PI*2);
    this._relative.copy(f.steer).addScaledVector(h,-h.dot(f.steer));
    limitVector(this._relative,g.slip*(1-clamp((f.speed-.08)/.3,0,1)));
    f.velocity.copy(this._flow).addScaledVector(h,f.speed).add(this._relative);
  }
  step(dt=FIXED_STEP,pointer=null) {
    if(!Number.isFinite(dt)||dt<=0||dt>.101)throw new RangeError('Simulation step must be 0 < dt <= 0.101 seconds.');
    this.time+=dt;this.steps++;
    const t=this.time;
    for(const p of this.food)if(p.active){
      p.age+=dt;if(p.age>36){p.active=false;continue;}
      currentAt(p.position,t,this._flow);
      this._flow.y-=.17; // reduced gravity balanced by drag: bounded settling velocity
      p.velocity.lerp(this._flow,1-Math.exp(-dt*4));p.position.addScaledVector(p.velocity,dt);
      const bed=groundHeight(p.position.x,p.position.z)+p.size;
      if(p.position.y<bed){p.position.y=bed;p.velocity.multiplyScalar(.1);}
    }
    // Move the social centres along collision-checked routes at swimming speed, not
    // exponentially towards distant targets (which made a centre race ahead then stall).
    for(const s of this.shoals){
      if(!s.path.length){
        s.out.copy(this.navigation.destination(s.centre,s.sector,this.random));
        s.path=this.navigation.route(s.centre,s.out);s.sector=(s.sector+s.direction+3)%3;
      }
      while(s.path.length>1&&s.centre.distanceToSquared(s.path[0])<.16)s.path.shift();
      this._desired.subVectors(s.path[0],s.centre);
      const d=this._desired.length(),speed=s.speed*(.92+.08*Math.sin(t*.19+s.home.x));
      if(d<.14){s.path.shift();s.velocity.multiplyScalar(.9);}
      else{s.velocity.copy(this._desired).multiplyScalar(Math.min(speed,d/dt)/d);s.centre.addScaledVector(s.velocity,dt);}
    }
    // Read neighbours from a snapshot: no order-dependent following of already-updated fish.
    const old=this.previous;
    for(let i=0;i<this.fish.length;i++){old[i].p.copy(this.fish[i].position);old[i].v.copy(this.fish[i].velocity);old[i].alarm=this.fish[i].alarm;}
    for(let index=0;index<this.fish.length;index++) {
      const f=this.fish[index],p=f.position;
      currentAt(p,t,this._flow);
      f.alarm=Math.max(0,f.alarm-dt);f.goalTimer-=dt;
      // A neighbour's bolt takes about seventy milliseconds to reach this fish, against
      // about eight for the one that saw the threat itself, so the response is held here
      // and released a few frames late. That delay is the whole difference between a
      // school that flinches as one object and one that flinches as a wave.
      if(f.spook>0&&(f.spook-=dt)<=0)f.alarm=2.3;
      if(pointer&&pointer.speed>.9&&p.distanceToSquared(pointer.position)<8.5)f.alarm=2.6;
      // Ease out of the shelter envelope after an alarm. Restoring its full radius in a
      // single step would visibly eject a chromis from the thicket when the timer expires.
      f.shelterAccess+=((f.alarm>0?1:0)-f.shelterAccess)*(1-Math.exp(-dt*(f.alarm>0?4:.9)));
      if(f.hold>0)f.hold=Math.max(0,f.hold-dt);
      // The terminal male's U-swim: a fast dive under the harem and back up the far side.
      // Shapiro's counts make this and the nose rush male-only — a female performs them at
      // effectively zero rate — so it is the single movement that sexes the fish on sight.
      if(f.kind==='rosebud'&&!f.rank){
        f.show-=dt;
        if(f.show<=0){f.display=USWIM;f.show=11+this.random()*13;}
        if(f.display>0)f.display=Math.max(0,f.display-dt);
      }
      // A follower's goal is its leader's flank for as long as the leader is out roaming.
      if(f.follow&&(f.follow.roam<=0||f.alarm>0))f.follow=null;
      if(f.follow){f.goal.copy(f.follow.position).addScaledVector(f.station,1.2);f.goalTimer=1;}
      else if(f.goalTimer<=0||(!f.hold&&p.distanceToSquared(f.goal)<(f.roam>0?.8:.10)))this.chooseGoal(f);
      else if(f.shoal>=0&&!f.hold&&f.roam<=0)this.station(f,f.goal); // the slot travels with its shoal
      let goal=f.goal,food=null,nearest=2.5**2;
      if(f.alarm>0){
        f.state='shelter';f.roam=0;
        // A percula backs into the tentacles; every open-water fish goes down to the
        // structure its shoal is attached to — the chromis into the branches of their own
        // coral head in unison, the anthias to the arch and the holes in it. The chromis
        // goal sits inside the colony's own envelope, so the pod presses down onto the
        // branches and the obstacle field is what stops it, rather than hovering politely
        // above the coral it is supposed to be hiding in.
        if(f.kind==='gumdrop')this._desired.set(HOST.x+(f.rank-1)*.44,HOST.y+.50,HOST.z+.30);
        else{const s=f.shoal>=0?this.shoals[f.shoal].shelter:PROMONTORY;this._desired.set(s.x+(p.x-s.x)*.30,s.y+(f.kind==='mint'?.55:1.05),s.z+(p.z-s.z)*.30);}
        goal=this._desired;
      }else if(f.display>0){
        f.state='display';
        const s=this.shoals[f.shoal],k=1-f.display/USWIM;
        this._desired.set(s.centre.x+(k*2-1)*2.1,s.centre.y+.40-Math.sin(k*Math.PI)*1.75,s.centre.z+.30);
        goal=this._desired;
      }else{
        f.state=f.hold?'bathe':f.kind!=='gumdrop'?'roam':'forage';
        for(const item of this.food)if(item.active){
          if(f.kind==='gumdrop'&&((item.position.x-HOST.x)**2+(item.position.y-HOST.y-.7)**2+(item.position.z-HOST.z)**2)>10)continue;
          const d=p.distanceToSquared(item.position);if(d<nearest){nearest=d;food=item;goal=item.position;}
        }
        if(food)f.state='feed';
      }
      // A fish being cleaned, or one wallowing in the tentacles, is barely swimming.
      if(f.kind!=='gumdrop'&&f.alarm<=0)goal=this.travelGoal(f,goal,dt);
      const topSpeed=CRUISE[f.kind]*f.cruise*(f.alarm>0?1.65:f.display>0?1.5:food?1.3:f.hold&&p.distanceToSquared(f.goal)<.5?.16:1);
      this._delta.subVectors(goal,p);const dist=this._delta.length();
      this._force.copy(this._delta).multiplyScalar(dist>1e-5?Math.min(topSpeed,dist*.68)/dist:0);
      this._force.sub(this._flow); // swim velocity relative to the moving water
      this._sep.set(0,0,0);this._cohesion.set(0,0,0);this._align.set(0,0,0);let neighbors=0;
      for(let j=0;j<this.fish.length;j++)if(j!==index){
        const other=this.fish[j],q=old[j].p;this._delta.subVectors(p,q);const d2=this._delta.lengthSq();
        // Open-water fish keep well over a body length between them; the clownfish crowd.
        const personal=(f.size+other.size)*(f.kind==='gumdrop'?.46:.68);
        if(d2<personal*personal&&d2>1e-8)this._sep.addScaledVector(this._delta,(personal-Math.sqrt(d2))/d2*(f.kind==='gumdrop'&&other.kind==='gumdrop'&&f.rank>other.rank?1.9:1.1));
        if(f.shoal>=0&&other.kind===f.kind&&d2<7.84&&d2>.18){this._cohesion.add(q);this._align.add(old[j].v);neighbors++;}
        // Only a fresh bolt recruits, so the alarm cannot circulate back round the school
        // and hold it up indefinitely.
        if(f.alarm<=0&&f.spook<=0&&other.kind===f.kind&&old[j].alarm>1.9&&d2<4.0)f.spook=.055;
      }
      this._force.addScaledVector(this._sep,1.3);
      // Moving destinations keep the shoal together, so cohesion only softens the edges;
      // alignment is what makes a turn run through the group.
      if(neighbors&&f.alarm<=0&&!food){
        this._cohesion.multiplyScalar(1/neighbors).sub(p);this._align.multiplyScalar(1/neighbors).sub(f.velocity);
        this._force.addScaledVector(this._cohesion,.035).addScaledVector(this._align,.20);
      }
      // Non-host fish avoid cnidarian tentacles; residents can enter the living crown.
      if(f.kind!=='gumdrop'){
        this._delta.set(p.x-HOST.x,(p.y-HOST.y-.55)*1.2,p.z-HOST.z);
        const d=this._delta.length();if(d<2.4&&d>.001)this._force.addScaledVector(this._delta,(2.4-d)/d*1.9);
      }
      // Anticipatory ellipsoid avoidance before position integration.
      const own=f.kind==='mint'?SHELTER+f.shoal:-1;
      for(let k=0;k<REEF_BOUNDS.length;k++){
        const o=REEF_BOUNDS[k],keep=k===own?1.22-.38*f.shelterAccess:1.22;
        const mx=o[3]+f.size*.26,my=o[4]+f.size*.25,mz=o[5]+f.size*.25;
        const dx=(p.x+f.velocity.x*.6-o[0])/mx,dy=(p.y+f.velocity.y*.6-o[1])/my,dz=(p.z+f.velocity.z*.6-o[2])/mz;
        const d=Math.hypot(dx,dy,dz);
        if(d<keep&&d>1e-6){this._delta.set(dx/mx,dy/my,dz/mz).normalize();this._force.addScaledVector(this._delta,(keep-d)*2.6);}
      }
      if(p.y<.55)this._force.y+=(.55-p.y)*2;
      if(p.y>TANK.surface-.6)this._force.y-=(p.y-(TANK.surface-.6))*2;
      if(Math.abs(p.x)>8)this._force.x-=Math.sign(p.x)*(Math.abs(p.x)-8)*2;
      if(p.z>4.5)this._force.z-=(p.z-4.5)*2;
      if(p.z<TANK.back+.45)this._force.z+=(TANK.back+.45-p.z)*3;
      limitVector(this._force,topSpeed);
      this.swim(f,this._force,dt);
      limitVector(f.velocity,1.7);p.addScaledVector(f.velocity,dt);
      // Robust final nonpenetration for rocks. Smooth steering normally keeps this idle.
      for(let k=0;k<REEF_BOUNDS.length;k++){
        const o=REEF_BOUNDS[k],shrink=k===own?1-.30*f.shelterAccess:1;
        const rx=(o[3]+f.size*.19)*shrink,ry=(o[4]+f.size*.18)*shrink,rz=(o[5]+f.size*.19)*shrink;
        const dx=(p.x-o[0])/rx,dy=(p.y-o[1])/ry,dz=(p.z-o[2])/rz,d=Math.hypot(dx,dy,dz);
        if(d<1&&d>1e-7){
          p.set(o[0]+dx/d*rx,o[1]+dy/d*ry,o[2]+dz/d*rz);
          this._delta.set(dx/rx,dy/ry,dz/rz).normalize();const into=f.velocity.dot(this._delta);if(into<0){f.velocity.addScaledVector(this._delta,-into);f.speed*=.5;}
        }
      }
      p.y=clamp(p.y,groundHeight(p.x,p.z)+.2,TANK.surface-.18);p.x=clamp(p.x,TANK.left+.25,TANK.right-.25);p.z=clamp(p.z,TANK.back+.22,TANK.front-.3);
      // percula rows with its pectorals and the body rocks against the stroke. The waddle
      // is the species' walk, not a symptom of hurrying, so it rides on the bank angle at
      // the pectoral beat rather than replacing it.
      f.roll=f.bank+(f.kind==='gumdrop'?Math.sin(f.pectoral)*.075:0);
      if(food&&p.distanceToSquared(food.position)<(f.size*.42)**2){food.active=false;this.consumed++;f.goalTimer=0;}
    }
  }
  diagnostics(){
    return {time:this.time,steps:this.steps,population:POPULATION,food:this.food.filter(p=>p.active).length,consumed:this.consumed,
      maxSpeed:Math.max(...this.fish.map(f=>f.velocity.length())),finite:this.fish.every(f=>[...f.position,...f.velocity,f.yaw,f.phase].every(Number.isFinite))};
  }
}
