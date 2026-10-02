import * as THREE from 'three';
import { randomGenerator } from './math.js';
import { currentAt, waterTime } from './water.js';

/** Candy sparkles: a short burst of glints a fish sheds when the cursor rests near it. A
 *  fixed ring of sprites, so a cursor parked over a crowd recycles the oldest glints instead
 *  of allocating; a dead sprite is drawn at size zero. They are light, not matter: additive,
 *  no depth write, and they ride the tank's current and rise a little like fine bubbles. */
export const SPARKLE_LIFE=1.0;
const SPEED=[.35,.85],DRAG=2.6,BUOYANCY=.55;
// Point size in pixels is scale/depth, clamped. The fish swim 15–18 units from the lens, so
// the scale is set for a glint of about a dozen pixels there.
export const SPARKLE_SIZE={scale:200,min:4,max:28};
// Each species sheds its own colour.
export const SPARKLE_COLORS={gumdrop:[1,.62,.25],mint:[.55,1,.85],rosebud:[1,.6,.85],lollipop:[.85,1,.4]};

export class SparklePool{
  constructor(size=512,seed=5381){
    this.size=size;this.rng=randomGenerator(seed);this.next=0;
    this.position=new Float32Array(size*3);this.velocity=new Float32Array(size*3);this.color=new Float32Array(size*3);
    this.age=new Float32Array(size).fill(Infinity);this._flow={x:0,y:0,z:0};
  }
  emit(x,y,z,rgb,count=24){
    for(let k=0;k<count;k++){
      const i=this.next;this.next=(this.next+1)%this.size;
      // A uniform direction on the sphere, at a speed that scatters the burst about a body length.
      const u=this.rng()*2-1,a=this.rng()*Math.PI*2,r=Math.sqrt(1-u*u),s=SPEED[0]+this.rng()*(SPEED[1]-SPEED[0]);
      this.position.set([x,y,z],i*3);this.velocity.set([Math.cos(a)*r*s,u*s,Math.sin(a)*r*s],i*3);
      this.color.set(rgb,i*3);this.age[i]=0;
    }
  }
  // dt of zero (paused, hidden, host rate 0) is a no-op, so glints freeze rather than jump.
  update(dt,flow){
    if(!(dt>0))return;
    const damp=Math.exp(-dt*DRAG),f=this._flow;
    for(let i=0;i<this.size;i++){
      if(!(this.age[i]<SPARKLE_LIFE))continue;
      this.age[i]+=dt;if(this.age[i]>=SPARKLE_LIFE){this.age[i]=Infinity;continue;}
      const j=i*3,v=this.velocity,p=this.position;
      v[j]*=damp;v[j+1]=v[j+1]*damp+BUOYANCY*dt;v[j+2]*=damp;
      f.x=f.y=f.z=0;if(flow)flow(p[j],p[j+1],p[j+2],f);
      p[j]+=(v[j]+f.x)*dt;p[j+1]+=(v[j+1]+f.y)*dt;p[j+2]+=(v[j+2]+f.z)*dt;
    }
  }
  alive(){let n=0;for(let i=0;i<this.size;i++)if(this.age[i]<SPARKLE_LIFE)n++;return n;}
  life(i){return this.age[i]<SPARKLE_LIFE?1-this.age[i]/SPARKLE_LIFE:0;}
}

export function createSparkles(scene,simulation){
  const pool=new SparklePool(),life=new Float32Array(pool.size),point=new THREE.Vector3(),flowOut=new THREE.Vector3();
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(pool.position,3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color',new THREE.BufferAttribute(pool.color,3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('life',new THREE.BufferAttribute(life,1).setUsage(THREE.DynamicDrawUsage));
  const mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,vertexColors:true,uniforms:{pixelRatio:{value:1}},
    vertexShader:`uniform float pixelRatio;attribute float life;varying vec3 vColor;varying float vLife;
      void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;
        vColor=color;vLife=life;
        // A glint flares as it leaves the fish and shrinks as it fades.
        gl_PointSize=life>0.?clamp(${SPARKLE_SIZE.scale.toFixed(1)}/(-mv.z),${SPARKLE_SIZE.min.toFixed(1)},${SPARKLE_SIZE.max.toFixed(1)})*(.55+.45*life)*pixelRatio:0.;}`,
    fragmentShader:`varying vec3 vColor;varying float vLife;
      void main(){vec2 c=gl_PointCoord-.5;float r=dot(c,c);
        // A soft core with a four-point star across it: reads as a sparkle, not a dust mote.
        float core=exp(-r*28.),star=exp(-abs(c.x)*40.)*exp(-abs(c.y)*6.)+exp(-abs(c.y)*40.)*exp(-abs(c.x)*6.);
        // Kept under the tone mapper's shoulder, or every species' glint bleaches to the same white.
        gl_FragColor=vec4(vColor*(core*.85+star*.55)*pow(vLife,1.5),1.);}`});
  const points=new THREE.Points(g,mat);points.frustumCulled=false;scene.add(points);
  const flow=(x,y,z,out)=>{point.set(x,y,z);currentAt(point,waterTime.value,flowOut);out.x=flowOut.x;out.y=flowOut.y;out.z=flowOut.z;};
  return {pool,
    update(dt){
      for(const e of simulation.drainSparkles())pool.emit(e.x,e.y,e.z,SPARKLE_COLORS[e.kind]||[1,1,1]);
      pool.update(dt,flow);
      for(let i=0;i<pool.size;i++)life[i]=pool.life(i);
      g.attributes.position.needsUpdate=true;g.attributes.color.needsUpdate=true;g.attributes.life.needsUpdate=true;
    },
    setPixelRatio(r){mat.uniforms.pixelRatio.value=r;}};
}
