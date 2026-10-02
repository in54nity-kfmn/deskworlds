# Candyscape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fifth Deskworlds world, Candyscape: Coral reef's tank reskinned in candy colours, four candy fish species, and a sparkle burst when the cursor nears a fish.

**Architecture:** Copy `scenes/reefscape/` to `scenes/candyscape/` and diverge from it. Coral reef itself is never edited. The simulation stays a CPU fixed-step model (`simulation.js`); rendering is Three.js instanced meshes plus custom shader hooks (`underwater()` in `water.js`). Sparkles split in two: the simulation emits sparkle *events* (pure and testable in Node), and a separate `sparkles.js` turns them into a pooled `THREE.Points` effect.

**Tech Stack:** Vanilla ES modules, Three.js (vendored in `vendor/three.module.js`), Node ≥ 20 test scripts using `node:assert` (no test framework), headless Chrome for render smoke tests, Swift for the macOS wallpaper host.

**Spec:** `docs/superpowers/specs/2026-10-01-candyscape-design.md` (rev 2, approved)

## Global Constraints

- Never modify anything under `scenes/reefscape/` or `scenes/shared/`.
- Coordinates: 1 unit = 10 cm; tank bounds come from `scenes/candyscape/src/layout.js` (`TANK`), unchanged from Coral reef.
- Simulation fixed step: `FIXED_STEP = 1/60`; `step(dt)` throws `RangeError` outside `0 < dt ≤ 0.101`.
- Species keys: `gumdrop` (ex-clownfish), `mint` (ex-chromis), `rosebud` (ex-anthias), `lollipop` (new).
- Population: gumdrop 3, mint 9, rosebud 7, lollipop 2 (21 fish). No shrimp.
- Feed: 8 pellets per feed, 36 s dissolve, 1 s feed cooldown (inherited, unchanged).
- Sparkle: radius 1.2 units measured in the screen (x–y) plane, per-fish cooldown 1.5 s, 24 sprites per burst, ~1 s life, pool of 512, event queue cap 64.
- Code style: match the copied reef files — terse, semicolon-chained lines, explanatory `//` comments that say *why*.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work on branch `candyscape` in `/Users/in54nity/claude/deskworlds/fork`.

## Review Focus

1. **Cursor parked on a fish or a crowd** → must not emit continuous sparkles. Bounded by the per-fish cooldown and the 512 pool. *Test: Task 6 step 1 (cooldown), Task 7 step 1 (pool bound under a flood).*
2. **Fast swipe across the whole tank** → alarm and sparkles fire together. The event queue must stay ≤ 64 and nothing may go non-finite. *Test: Task 6 step 1 ("swipe" block).*
3. **Lollipop alarmed** → it has no shoal (`shoal === -1`), and the reef code indexes `this.shoals[f.shoal]` during an alarm, so it must not crash. *Test: Task 5 step 1 ("lollipop alarm" block).*
4. **Pause, hidden tab, or host rate 0, then resume** → sparkles freeze in place and must not jump or burst on resume. `update(0)` must be a no-op. *Test: Task 7 step 1 ("zero dt" block).*
5. **Deterministic capture (`?capture&time=N`)** → same seed plus same pointer sequence gives identical sparkle events; no pointer gives no sparkles. *Test: Task 6 step 1 ("determinism" and "no pointer" blocks).*

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `tools/smoke-scene.sh` | Headless-Chrome render gate: screenshot plus fail on shader/script errors | 1 |
| `scenes/candyscape/**` | Copy of reefscape (html, css, src, assets, tests) | 1 |
| `scenes/candyscape/src/shrimp.js` | Deleted | 2 |
| `scenes/candyscape/src/simulation.js` | Fish behaviour; species keys; lollipop; sparkle events | 2, 3, 5, 6 |
| `scenes/candyscape/src/fish-model.js` | Fish geometry and shaders; candy palettes; lollipop | 3, 4, 5 |
| `scenes/candyscape/src/sparkles.js` | `SparklePool` (CPU state) plus `createSparkles` (Points renderer) | 7 |
| `scenes/candyscape/src/main.js` | Wiring: no shrimp, sparkles, lighting | 2, 7, 8 |
| `scenes/candyscape/src/{water,terrain}.js` | Water tint, rock and sand palette | 8 |
| `scenes/candyscape/src/{corals,anemone,particles}.js` | Coral, anemone, mote and pellet palette | 9 |
| `scenes/candyscape/tests/sparkles.mjs` | Sparkle event and pool tests | 6, 7 |
| `wallpaper/Wallpaper.swift`, `index.html`, 5× scene `index.html`, `README.md`, `package.json`, `docs/images/candyscape-wide.png` | Registration | 1, 10 |

---

### Task 1: Scaffold Candyscape as a copy of Coral reef, plus a render smoke gate

**Files:**
- Create: `tools/smoke-scene.sh`
- Create: `scenes/candyscape/` (copy of `scenes/reefscape/`)
- Modify: `scenes/candyscape/index.html`, `scenes/candyscape/wallpaper.html`, `scenes/candyscape/src/main.js` (diagnostics global), `scenes/candyscape/assets/README.md`, `package.json` (`test` script)

**Interfaces:**
- Produces: `sh tools/smoke-scene.sh <scene-dir-name> <out.png> [query]`. Exit 0 means it rendered with no errors; exit 1 means it found errors. Every later visual task uses it.
- Produces: `window.candy` (was `window.reef`) diagnostics object in candyscape's `main.js`.

- [ ] **Step 1: Write the smoke gate**

`tools/smoke-scene.sh`:
```sh
#!/bin/sh
# Render one scene headless at a fixed simulation time and fail on shader or script errors.
# Capture mode advances the real simulation and draws the real WebGL scene, so the
# screenshot is deterministic for a given time. Usage:
#   sh tools/smoke-scene.sh <scene-dir> <out.png> [query]
set -eu
scene=$1 out=$2 query=${3:-capture&time=20}
port=${SMOKE_PORT:-8093}
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
root=$(cd "$(dirname "$0")/.." && pwd)
PORT=$port node "$root/serve.mjs" >/dev/null 2>&1 & server=$!
trap 'kill $server 2>/dev/null' EXIT
sleep 1
log=$(mktemp)
"$chrome" --headless=new --enable-unsafe-swiftshader --use-angle=swiftshader --window-size=1440,750 \
  --virtual-time-budget=20000 --enable-logging=stderr --v=0 --screenshot="$out" \
  "http://localhost:$port/scenes/$scene/?$query" 2>"$log"
if grep -E "Shader Error|Uncaught|SyntaxError|Failed to load module|Unable to load" "$log"; then
  echo "smoke: errors in $scene" >&2; exit 1
fi
test -s "$out" && echo "smoke: $scene ok -> $out"
```

- [ ] **Step 2: Prove the gate passes on a good scene and fails on a broken one**

Run: `sh tools/smoke-scene.sh reefscape /tmp/smoke-reef.png`
Expected: `smoke: reefscape ok -> /tmp/smoke-reef.png`

Then temporarily break a shader. In `scenes/reefscape/src/particles.js`, change `gl_FragColor=vec4(glow*a,1.);` to `gl_FragColor=vec4(glow*a,1.)`, removing the semicolon. Run the same command and expect exit 1 with `smoke: errors in reefscape`. **Revert immediately** with `git checkout scenes/reefscape/src/particles.js` and confirm with `git status --short scenes/reefscape` (expected: empty).

If the broken run still exits 0, the console isn't reaching the log. Add `--enable-logging=stderr --v=1` and look for the `CONSOLE` line text, then widen the grep. Do not continue until the gate catches the break.

- [ ] **Step 3: Copy the scene**

```bash
cp -R scenes/reefscape scenes/candyscape
```

- [ ] **Step 4: Rename the browser-facing identity**

In `scenes/candyscape/index.html` replace the `<head>` meta/title and the canvas/nav block:
```html
    <meta name="theme-color" content="#0d1a3a" />
    <meta
      name="description"
      content="A candy-coloured reef tank with gumdrop, mint, rosebud and lollipop fish that sparkle when the cursor comes near. A local, interactive 3D preview."
    />
    <title>Candyscape • Deskworlds</title>
```
```html
    <main id="stage" aria-label="Interactive candy reef">
      <canvas
        id="scene"
        tabindex="0"
        aria-label="A candy-coloured reef tank with four kinds of fish that sparkle when the cursor comes near. Click to feed. Space pauses. F enters fullscreen. H hides controls."
      ></canvas>
      <nav class="chrome" aria-label="Worlds">
        <a class="home-link" href="../../" aria-label="Deskworlds home">Deskworlds</a>
        <div class="scene-nav">
          <a href="../riverscape/">Riverbed</a>
          <a href="../reefscape/">Coral reef</a>
          <a href="../bettascape/">Betta</a>
          <a href="../plasmascape/">Plasma globe</a>
          <span aria-current="page">Candyscape</span>
        </div>
      </nav>
```
In `scenes/candyscape/wallpaper.html`: `theme-color` → `#0d1a3a`, description → `Candyscape, framed to fill a screen as a desktop wallpaper.`, title → `Candyscape • Deskworlds wallpaper`, `<main aria-label>` → `Interactive candy reef`.

In `scenes/candyscape/src/main.js`, rename the diagnostics global. Replace `window.reef={` with `window.candy={`, and `window.sceneStats=window.reef.diagnostics;` with `window.sceneStats=window.candy.diagnostics;`. Also change `'Restoring aquarium…'` to `'Restoring candy reef…'`.

Replace `scenes/candyscape/assets/README.md` with:
```markdown
# Candyscape assets

Copied verbatim from `scenes/reefscape/assets/`; Candyscape reuses Coral reef's baked tank (rock mesh, attachment field, crust and sand atlases) and only recolours it in its shaders. Rebuild with the `tools/bake-*.py` scripts, then copy here.
```

- [ ] **Step 5: Register the copied tests**

In `package.json` `"test"`, append to the end of the chain (before the closing quote):
```
 && node scenes/candyscape/tests/behavior.mjs && node scenes/candyscape/tests/assets.mjs && node scenes/candyscape/tests/locomotion.mjs && node scenes/candyscape/tests/anemone.mjs
```

- [ ] **Step 6: Verify**

Run: `npm test 2>&1 | grep -E "pass|ok|Error|assert" | tail -20 && npm run check`
Expected: every line passes, including the four candyscape tests, and the check exits 0.
Run: `sh tools/smoke-scene.sh candyscape /tmp/candy-1.png`
Expected: `ok`. Open `/tmp/candy-1.png`; it should look identical to `/tmp/smoke-reef.png`.

- [ ] **Step 7: Commit**

```bash
git add tools/smoke-scene.sh scenes/candyscape package.json
git commit -m "feat(candyscape): scaffold as a copy of Coral reef, add headless render smoke gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Remove the cleaner shrimp

**Files:**
- Delete: `scenes/candyscape/src/shrimp.js`
- Modify: `scenes/candyscape/src/simulation.js`, `src/main.js`, `src/layout.js`, `src/terrain.js`, `src/views.js`
- Test: `scenes/candyscape/tests/behavior.mjs` (full replacement below)

**Interfaces:**
- Produces: `ReefSimulation` with no `shrimp` property and no `stepShrimp`; `POPULATION` without a `shrimp` key; no fish ever enters state `'clean'`.

- [ ] **Step 1: Write the failing test.** Replace `scenes/candyscape/tests/behavior.mjs` entirely:

```js
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `node scenes/candyscape/tests/behavior.mjs`
Expected: FAIL with `Candyscape has no cleaner shrimp`.

- [ ] **Step 3: Strip the shrimp from the simulation**

In `scenes/candyscape/src/simulation.js`:
1. Imports: delete the line `import { supportHeight } from './terrain.js';`. In the `layout.js` import, remove `STATIONS, `.
2. `POPULATION`: change it to `export const POPULATION={clownfish:3,chromis:9,anthias:7};`.
3. Delete the whole block from the comment `// The cleaner shrimp's own tunables.` through the end of `export function seatShrimp(...){...}`. That covers `SHRIMP`, `CHORD`, `bodyFit` and `seatShrimp`, and runs up to the blank line before `export class ReefSimulation`.
4. In the constructor, delete the two statements that start with `this.shrimpRandom=` and `this.shrimp=STATIONS.map(` (and their comment lines).
5. In `chooseGoal`, delete the cleaner-station block: the comment starting `// A cleaner shrimp rocking its white antennae` and the code from `const open=this.shrimp.filter(` through the closing `}` of `if(open.length&&r()<.12){...}`.
6. In `step`, replace `f.state=f.hold?(f.kind==='clown'?'bathe':'clean'):f.kind!=='clown'?'roam':'forage';` with `f.state=f.hold?'bathe':f.kind!=='clown'?'roam':'forage';`.
7. At the end of `step`, delete `this.stepShrimp(dt,pointer);`.
8. Delete the whole `stepShrimp(dt,pointer) {...}` method and the comment block above it, from `// A cleaner shrimp lives on one rock shoulder.` up to `diagnostics(){`.

In `scenes/candyscape/src/main.js`:
- Delete `import { createShrimp } from './shrimp.js';`.
- Replace `const shrimp=createShrimp(scene,simulation),particles=createParticles(scene,simulation,shadow);` with `const particles=createParticles(scene,simulation,shadow);`.
- Replace `shrimp.update();particles.update(dt);` with `particles.update(dt);`.

In `scenes/candyscape/src/layout.js`: delete the `STATIONS` export and its three-line comment.
In `scenes/candyscape/src/terrain.js`: change the import to `import { ROCKS, HOST, TANK } from './layout.js';`, the re-export to `export {ROCKS,HOST};`, and the return to `return {obstacles:ROCKS,host:HOST,rockSurface:rocks};`.
In `scenes/candyscape/src/views.js`: delete the `shrimp:` line.
Run: `git rm scenes/candyscape/src/shrimp.js`.

- [ ] **Step 4: Verify**

Run: `grep -rn "shrimp\|STATIONS\|SHRIMP" scenes/candyscape/src` → expected: only comment text, if anything (no code references).
Run: `for t in behavior assets locomotion anemone; do node scenes/candyscape/tests/$t.mjs >/dev/null || echo FAIL $t; done; npm run check`
Expected: no `FAIL` lines; check exits 0.
Run: `sh tools/smoke-scene.sh candyscape /tmp/candy-2.png` → `ok`; the image shows the reef with no shrimp.

- [ ] **Step 5: Commit**

```bash
git add -A scenes/candyscape
git commit -m "feat(candyscape): remove cleaner shrimp and the cleaning-station behaviour

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Rename species keys to the Candyscape cast

**Files:**
- Modify: `scenes/candyscape/src/simulation.js`, `src/fish-model.js`, `tests/*.mjs`

**Interfaces:**
- Produces: `f.kind ∈ {'gumdrop','mint','rosebud'}`; `GAIT.gumdrop|mint|rosebud`; `POPULATION={gumdrop:3,mint:9,rosebud:7}`; `makeFishGeometry('gumdrop'|'mint'|'rosebud')`; shader tables `SKIN/FINS/SHEEN/EYE` keyed the same way.

- [ ] **Step 1: Write the failing test.** In `scenes/candyscape/tests/behavior.mjs`, directly after `const sim=new ReefSimulation();`, insert:
```js
assert.deepEqual([...new Set(sim.fish.map(f=>f.kind))].sort(),['gumdrop','mint','rosebud'],'Candyscape cast keys');
```

- [ ] **Step 2: Run it to see it fail**

Run: `node scenes/candyscape/tests/behavior.mjs` → FAIL `Candyscape cast keys`.

- [ ] **Step 3: Rename mechanically**

```bash
cd scenes/candyscape
perl -pi -e "s/'clown'/'gumdrop'/g; s/'chromis'/'mint'/g; s/'anthias'/'rosebud'/g; s/\bclownfish:/gumdrop:/g; s/\bclown:/gumdrop:/g; s/\bchromis:/mint:/g; s/\banthias:/rosebud:/g; s/POPULATION\.clownfish/POPULATION.gumdrop/g" src/simulation.js src/fish-model.js tests/*.mjs
cd ../..
```

- [ ] **Step 4: Verify nothing was missed**

Run: `grep -nE "'(clown|chromis|anthias)'|\b(clown|clownfish|chromis|anthias):|\.(clown|chromis|anthias)\b" scenes/candyscape/src/*.js scenes/candyscape/tests/*.mjs`
Expected: no output. If a hit is inside a `//` comment, leave it; if it's code, rename it by hand.
Run: `for t in behavior assets locomotion anemone; do node scenes/candyscape/tests/$t.mjs >/dev/null || echo FAIL $t; done; npm run check`
Expected: no `FAIL`.
Run: `sh tools/smoke-scene.sh candyscape /tmp/candy-3.png` → `ok` (still looks like Coral reef).

- [ ] **Step 5: Commit**

```bash
git add scenes/candyscape
git commit -m "refactor(candyscape): rename species keys to gumdrop, mint, rosebud

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Candy palettes and glowing fins for the three existing species

**Files:**
- Modify: `scenes/candyscape/src/fish-model.js` (`SKIN`, `FINS`, `SHEEN`, `EYE`, new `GLOW`, fin branch of `fishMaterial`)
- Test: `scenes/candyscape/tests/assets.mjs`

**Interfaces:**
- Produces: `export const GLOW={gumdrop:number,mint:number,rosebud:number}` in `fish-model.js`; Task 5 adds `lollipop`.
- Produces: the invariant that every key of `SPECIES` has an entry in `SKIN`, `FINS`, `SHEEN`, `EYE` and `GLOW`. Task 5 relies on the test for it.

- [ ] **Step 1: Write the failing test.** Edit `scenes/candyscape/tests/assets.mjs`: change the import line to
```js
const { makeFishGeometry,SPECIES_KEYS,SHADER_TABLES }=await import('../src/fish-model.js');
```
and directly after it add:
```js
// A species without a full set of shader snippets compiles to "undefined" in GLSL and only
// fails on the GPU; catch that here instead.
for(const kind of SPECIES_KEYS)for(const [name,table] of Object.entries(SHADER_TABLES))assert.ok(table[kind]!==undefined,`${name} has no entry for ${kind}`);
assert.ok(SHADER_TABLES.GLOW.gumdrop>0&&SHADER_TABLES.GLOW.mint>0&&SHADER_TABLES.GLOW.rosebud>0,'Candy fins glow');
```
and change the loop header `for(const kind of ['gumdrop','mint','rosebud']){` to `for(const kind of SPECIES_KEYS){`.

- [ ] **Step 2: Run it to see it fail**

Run: `node scenes/candyscape/tests/assets.mjs` → FAIL (`SPECIES_KEYS` is undefined, so it isn't iterable).

- [ ] **Step 3: Implement**

In `fish-model.js`, replace the bodies of `SKIN`, `FINS`, `SHEEN`, `EYE` with:

```js
const SKIN={
  gumdrop:`
    // Candy tangerine, a shade deeper along the back, paling to apricot at the belly.
    vec3 skin=mix(vec3(1.00,.420,.060),vec3(1.00,.560,.150),smoothstep(.06,.46,band));
    skin=mix(skin,vec3(1.00,.760,.420),smoothstep(.66,.98,band));
    // The same three bars, in icing white with a raspberry edge instead of black.
    float b1=abs(u-(.246-.048*band))-.042;
    float b2=abs(u-(.520-.104*exp(-pow((band-.46)/.215,2.))))-.058;
    float d=min(min(b1,b2),abs(u-.872)-.030);
    float edge=.013+.013*vTrim.x,aa=max(fwidth(d),.0012);
    skin=mix(skin,vec3(.780,.040,.300),1.-smoothstep(edge-aa,edge+aa,d));
    skin=mix(skin,vec3(1.00,.970,.980),1.-smoothstep(-aa,aa,d));`,
  mint:`
    // Mint over the back washing to a pearly belly, the peduncle tipped cyan.
    vec3 skin=mix(vec3(.200,.850,.620),vec3(.550,1.00,.820),smoothstep(.04,.34,band));
    skin=mix(skin,vec3(.920,1.00,.960),smoothstep(.52,.94,band));
    skin=mix(skin,vec3(.250,.900,1.00),smoothstep(.70,1.,u)*.72);
    // A bubblegum line from lip to eye.
    skin=mix(skin,vec3(.98,.55,.85),exp(-pow((band-(.30+1.5*u))/.030,2.))*(1.-smoothstep(.04,.11,u))*.8);
    skin=mix(skin,skin*vec3(.80,.98,1.20),vTrim.x*.5);
    // The nest holder goes lemon.
    skin=mix(skin,skin*vec3(1.25,1.15,.55),vTrim.y*.6);`,
  rosebud:`
    // Bubblegum pink, deepest on the back, cream-pink belly.
    vec3 skin=mix(vec3(1.00,.450,.700),vec3(1.00,.620,.820),smoothstep(.05,.40,band));
    skin=mix(skin,vec3(1.00,.850,.920),smoothstep(.56,.96,band));
    // The cheek stripe, lemon edged in violet.
    float line=(band-(.415+.58*u))/.052;
    float stripe=exp(-line*line)*(1.-smoothstep(.22,.33,u));
    skin=mix(skin,vec3(1.00,.920,.450),stripe*.90);
    skin=mix(skin,vec3(.550,.250,.950),stripe*min(1.,abs(line))*.85);
    // The terminal male: magenta to violet.
    vec3 male=mix(vec3(.780,.100,.620),vec3(.600,.200,.950),smoothstep(.13,.46,u));
    male=mix(male,vec3(.850,.150,.550),smoothstep(.60,.94,u));
    skin=mix(skin,mix(male,male*vec3(1.15,.90,1.15),smoothstep(.54,1.,band)),vTrim.y);`,
};
const FINS={
  gumdrop:`
    vec3 web=mix(vec3(1.00,.500,.120),vec3(1.00,.700,.300),span);
    web=mix(web,vec3(.800,.060,.350),smoothstep(.74,.90,span)*(1.-.70*tail)*(1.-paired+pelvic));
    web=mix(web,vec3(1.00,.940,.960),smoothstep(.95,1.,span)*(1.-paired));
    web=mix(web,vec3(.800,.060,.350),tail*(1.-smoothstep(.20,.36,span)));
    web=mix(web,vec3(.850,.080,.380),pelvic*.78);
    web=mix(web,vec3(1.00,.970,.980),(1.-tail)*(1.-smoothstep(.030,.070,abs(axial-.520)))*(1.-smoothstep(.40,.92,span)));`,
  mint:`
    vec3 web=mix(vec3(.350,.950,.800),vec3(.750,1.00,.950),span);
    web=mix(web,vec3(.980,.550,.850),tail*smoothstep(.34,1.,span)*smoothstep(.34,.04,min(vSkinUv.x,1.-vSkinUv.x)));`,
  rosebud:`
    vec3 web=mix(vec3(1.00,.550,.780),vec3(1.00,.800,.900),smoothstep(.16,.82,span));
    web=mix(web,mix(vec3(.900,.250,.750),vec3(.550,.250,.980),smoothstep(.45,1.,span)),vTrim.y*(.50+.44*tail));
    web=mix(web,vec3(.400,.300,.950),vTrim.y*below*(1.-tail)*.62);
    web=mix(web,vec3(1.00,.900,.300),vTrim.y*(paired-pelvic)*smoothstep(.22,.74,span));`,
};
const SHEEN={gumdrop:'vec3(.200,.120,.180)',mint:'vec3(.250,.450,.550)',rosebud:'vec3(.400,.200,.450)'};
const EYE={
  gumdrop:'vec3 iris=vec3(1.00,.750,.200),rim=vec3(.450,.050,.200);',
  mint:'vec3 iris=vec3(.850,.950,1.00),rim=vec3(.100,.350,.400);',
  rosebud:'vec3 iris=vec3(1.00,.850,.300),rim=mix(vec3(.550,.250,.950),vec3(.850,.150,.550),vTrim.y);',
};
// Candy fins are lit from behind like stained glass: a little of their own colour is added
// back as emission, most toward the thin free margin. Not bioluminescence — no glow in shadow
// beyond what the membrane would pass.
export const GLOW={gumdrop:.10,mint:.16,rosebud:.14};
export const SPECIES_KEYS=Object.keys(SPECIES);
export const SHADER_TABLES={SKIN,FINS,SHEEN,EYE,GLOW};
```

`SPECIES_KEYS` and `SHADER_TABLES` must come after both `SPECIES` and the four tables. Place the `GLOW`/`SPECIES_KEYS`/`SHADER_TABLES` block right after `EYE`.

In `fishMaterial`'s fin branch, directly after the line that sets `diffuseColor.a=clamp(...)`, add:
```js
        totalEmissiveRadiance+=diffuseColor.rgb*${n(GLOW[kind])}*(.35+.65*span);
```
(`totalEmissiveRadiance` is declared in three's standard fragment `main()` before `#include <color_fragment>`, where the `color` hook is injected, so it is in scope.)

- [ ] **Step 4: Verify**

Run: `for t in behavior assets locomotion anemone; do node scenes/candyscape/tests/$t.mjs >/dev/null || echo FAIL $t; done; npm run check` → no `FAIL`.
Run: `sh tools/smoke-scene.sh candyscape /tmp/candy-4.png "capture&time=20&view=fish"` → `ok`. Open the image and confirm tangerine/white/raspberry gumdrops and mint and pink fish, with no black fish and no magenta "missing shader" fish.

- [ ] **Step 5: Commit**

```bash
git add scenes/candyscape
git commit -m "feat(candyscape): candy palettes and backlit fin glow for gumdrop, mint, rosebud

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Add the Lollipop — a new solitary species

**Files:**
- Modify: `scenes/candyscape/src/fish-model.js` (`SPECIES.lollipop`, `SKIN/FINS/SHEEN/EYE/GLOW.lollipop`, `createFishSchool` kinds)
- Modify: `scenes/candyscape/src/simulation.js` (`POPULATION`, `GAIT`, constructor, `chooseGoal`, alarm shelter, cohesion, top speed)
- Test: `scenes/candyscape/tests/behavior.mjs`

**Interfaces:**
- Consumes: `SPECIES_KEYS`, `SHADER_TABLES` (Task 4).
- Produces: two fish with `kind==='lollipop'` and `shoal===-1`; `POPULATION.lollipop===2`; `GAIT.lollipop`. Total fish: 21.

- [ ] **Step 1: Write the failing test.** In `tests/behavior.mjs`:
- Change `assert.equal(sim.fish.length,19);` to `assert.equal(sim.fish.length,21);`.
- Change the cast-keys assertion to expect `['gumdrop','lollipop','mint','rosebud']`.
- Append, before the final `console.log`:
```js
// The lollipop is a loner: no shoal slot, never a follower, and it still roams the reef.
const lollies=new ReefSimulation(7).fish.filter(f=>f.kind==='lollipop');
assert.equal(lollies.length,2);assert.ok(lollies.every(f=>f.shoal===-1));
{
  const s=new ReefSimulation(7),mine=s.fish.filter(f=>f.kind==='lollipop'),span=mine.map(f=>[f.position.x,f.position.x]);
  for(let i=0;i<60*120;i++){s.step(FIXED_STEP);mine.forEach((f,k)=>{assert.equal(f.follow,null,'A lollipop never follows');span[k][0]=Math.min(span[k][0],f.position.x);span[k][1]=Math.max(span[k][1],f.position.x);});}
  span.forEach(([lo,hi],k)=>assert.ok(hi-lo>8,`Lollipop ${k} roamed only ${(hi-lo).toFixed(1)} u`));
}
// Lollipop alarm: it has no shoal to shelter with, which must not crash the shelter lookup.
{
  const s=new ReefSimulation(11),lolly=s.fish.find(f=>f.kind==='lollipop');
  for(let i=0;i<120;i++)s.step(FIXED_STEP,{position:lolly.position.clone(),speed:8});
  assert.equal(lolly.state,'shelter');assert.ok(s.diagnostics().finite);
}
```
In `tests/assets.mjs`, add after the `Candy fins glow` assertion:
```js
assert.ok(SPECIES_KEYS.includes('lollipop')&&SHADER_TABLES.GLOW.lollipop>SHADER_TABLES.GLOW.mint,'Lollipop is the brightest');
```

- [ ] **Step 2: Run them to see them fail**

Run: `node scenes/candyscape/tests/behavior.mjs` → FAIL on the length 21 assertion. Run: `node scenes/candyscape/tests/assets.mjs` → FAIL `Lollipop is the brightest`.

- [ ] **Step 3: Implement the geometry and shaders.** In `fish-model.js`, add to `SPECIES` (after `rosebud`):
```js
  // A candy invention, not a measured fish: a deep, near-round disc like a discus, with
  // tall soft dorsal and anal fins and a broad trailing caudal, so it reads as a lollipop
  // swimming edge-on and as a disc broadside.
  lollipop:{
    len:.90,
    back:[.030,.120,.200,.250,.272,.276,.262,.226,.168,.104,.052],
    belly:[.030,.118,.196,.246,.268,.268,.250,.206,.146,.088,.046],
    half:[.010,.040,.058,.066,.068,.066,.058,.045,.030,.018,.011],
    eye:{u:.120,v:.36,r:.050},scales:[30,12],cheek:.14,veil:[.80,.40],
    dorsal:{from:.200,to:.880,sink:.014,reach:[.060,.120,.160,.180,.190,.200,.210,.190,.120]},
    anal:{from:.560,to:.880,sink:.012,reach:[.060,.150,.190,.170,.100]},
    caudal:[[-.600,.220,0],[-.700,.260,0],[-.780,.220,0],[-.830,.120,0],[-.850,0,0],[-.830,-.120,0],[-.780,-.220,0],[-.700,-.260,0],[-.600,-.220,0]],
    pectoral:{base:[[.252,.30],[.285,.00],[.318,-.30]],tip:[[.350,.020,.080],[.418,-.024,.100],[.460,-.100,.096],[.428,-.160,.070],[.360,-.140,.050]]},
    pelvic:{base:[[.340,-.88],[.375,-.98]],tip:[[.408,-.290,.034],[.476,-.360,.040],[.526,-.300,.026]]},
  },
```
Add `lollipop` entries:
```js
// in SKIN
  lollipop:`
    // Split down the flank, pink over lime, with a white candy swirl laid across both.
    float split=smoothstep(-.03,.03,band-(.30+.45*u));
    vec3 skin=mix(vec3(1.00,.300,.700),vec3(.700,1.00,.250),split);
    float swirl=.5+.5*sin(u*14.+band*9.+vTrim.x*6.);
    skin=mix(skin,vec3(1.00,.970,.980),smoothstep(.82,.95,swirl)*.75);`,
// in FINS
  lollipop:`
    vec3 web=mix(vec3(1.00,.400,.800),vec3(.750,1.00,.350),span);
    web=mix(web,vec3(1.00,.970,.980),smoothstep(.92,1.,span)*.6);`,
// in SHEEN
  lollipop:'vec3(.350,.300,.400)',
// in EYE
  lollipop:'vec3 iris=vec3(.750,1.00,.350),rim=vec3(.550,.050,.350);',
```
Set `export const GLOW={gumdrop:.10,mint:.16,rosebud:.14,lollipop:.22};`.
In `createFishSchool`, change `for(const kind of ['gumdrop','mint','rosebud']){` to `for(const kind of SPECIES_KEYS){`. `SPECIES_KEYS` is a module-level `const` defined above `createFishSchool`, so it's in scope.

- [ ] **Step 4: Implement the behaviour.** In `simulation.js`:
1. `export const POPULATION={gumdrop:3,mint:9,rosebud:7,lollipop:2};`
2. Add to `GAIT`:
```js
  lollipop:{length:.90,stride:.70,thrust:2.3,drag:.30,bout:[.70,1.10],glide:[.9,1.7],idle:.17,slip:.12,turn:1.5,pectoral:1.5,tail:1},
```
3. In the constructor, after the rosebud loop (`for(let i=0;i<7;i++)this.add('rosebud',...)`), add:
```js
    // Two loners, one over each island, out in open water clear of the coral.
    for(let i=0;i<2;i++)this.add('lollipop',[[-6.4,6.4,2.6],[6.2,6.6,2.8]][i],.80+this.random()*.08,i);
```
4. In `chooseGoal`, immediately after the gumdrop block's closing `}` (the `if(f.kind==='gumdrop'){...return;}`), add:
```js
    // A lollipop keeps no shoal: every goal is the next leg of a tour of the open column,
    // a different third of the reef each time.
    if(f.kind==='lollipop'){this.openWater(f.goal,f.position);f.goalTimer=14+r()*10;f.hold=0;return;}
```
5. In `step`'s alarm branch, replace
```js
        else{const s=this.shoals[f.shoal].shelter;this._desired.set(s.x+(p.x-s.x)*.30,s.y+(f.kind==='mint'?.55:1.05),s.z+(p.z-s.z)*.30);}
```
with
```js
        else{const s=f.shoal>=0?this.shoals[f.shoal].shelter:PROMONTORY;this._desired.set(s.x+(p.x-s.x)*.30,s.y+(f.kind==='mint'?.55:1.05),s.z+(p.z-s.z)*.30);}
```
6. In the neighbour loop, change the cohesion condition `if(f.kind!=='gumdrop'&&other.kind===f.kind&&d2<7.84&&d2>.18)` to `if(f.shoal>=0&&other.kind===f.kind&&d2<7.84&&d2>.18)`. Gumdrops have `shoal===-1` too, so their behaviour is unchanged.
7. Replace the `topSpeed` head `(f.kind==='gumdrop'?.59:f.kind==='rosebud'?.98:1.10)` with `CRUISE[f.kind]`, and add near `GAIT`:
```js
// Top cruising speed per species, units/s.
const CRUISE={gumdrop:.59,mint:1.10,rosebud:.98,lollipop:.92};
```

- [ ] **Step 5: Verify**

Run: `for t in behavior assets locomotion anemone; do node scenes/candyscape/tests/$t.mjs >/dev/null || echo FAIL $t; done; npm run check` → no `FAIL`. (`locomotion.mjs` now holds lollipops to the free-roamer bar automatically: >10 u width, >65 u path, aligned swimming, no spawn snap.)
If `locomotion.mjs` fails on the spawn snap (`snapped`), a spawn point is inside an obstacle. Move that lollipop's spawn up by 0.4 in y and re-run.
Run: `sh tools/smoke-scene.sh candyscape /tmp/candy-5.png "capture&time=30"` → `ok`. Find the two pink/lime disc fish in the image.

- [ ] **Step 6: Commit**

```bash
git add scenes/candyscape
git commit -m "feat(candyscape): add the lollipop, a solitary deep-bodied roamer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Sparkle events in the simulation

**Files:**
- Modify: `scenes/candyscape/src/simulation.js`
- Create: `scenes/candyscape/tests/sparkles.mjs`
- Modify: `package.json` (`test` script)

**Interfaces:**
- Produces: `export const SPARKLE={radius:1.2,cooldown:1.5,queue:64}`
- Produces: `simulation.drainSparkles(): Array<{index:number,kind:string,x:number,y:number,z:number}>`. It returns the queued events and empties the queue.
- Produces: fish field `f.sparkle` (cooldown seconds remaining).

- [ ] **Step 1: Write the failing test.** Create `scenes/candyscape/tests/sparkles.mjs`:
```js
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
```
Append ` && node scenes/candyscape/tests/sparkles.mjs` to the `package.json` `test` chain.

- [ ] **Step 2: Run it to see it fail**

Run: `node scenes/candyscape/tests/sparkles.mjs` → FAIL (`s.drainSparkles is not a function`).

- [ ] **Step 3: Implement.** In `simulation.js`:
1. After `CRUISE`, add:
```js
// A cursor resting near a fish makes it shed a burst of sparkles. Measured across the screen
// plane (x, y) because the cursor is a ray into the tank, not a point at the fish's depth.
// Separate from the alarm, which still needs a fast cursor: a hover sparkles, a swipe
// scatters the fish and sparkles too.
export const SPARKLE={radius:1.2,cooldown:1.5,queue:64};
```
2. In the constructor, after `this.lastFeed=-10;...`, add `this.sparkles=[];`.
3. In `add`, add `sparkle:0,` to the fish object literal (next to `spook:0,`).
4. In `step`'s per-fish loop, directly after the pointer alarm line (`if(pointer&&pointer.speed>.9&&...)f.alarm=2.6;`), add:
```js
      f.sparkle=Math.max(0,f.sparkle-dt);
      if(pointer&&f.sparkle<=0&&(p.x-pointer.position.x)**2+(p.y-pointer.position.y)**2<SPARKLE.radius**2){
        f.sparkle=SPARKLE.cooldown;this.sparkles.push({index,kind:f.kind,x:p.x,y:p.y,z:p.z});
        if(this.sparkles.length>SPARKLE.queue)this.sparkles.shift();
      }
```
5. Add a method before `diagnostics(){`:
```js
  // The renderer takes the bursts once per frame; sparkle state never feeds back into behaviour.
  drainSparkles(){const out=this.sparkles;this.sparkles=[];return out;}
```

- [ ] **Step 4: Verify**

Run: `node scenes/candyscape/tests/sparkles.mjs` → `candyscape sparkle events ok`.
Run: `for t in behavior assets locomotion anemone; do node scenes/candyscape/tests/$t.mjs >/dev/null || echo FAIL $t; done` → no `FAIL`.

- [ ] **Step 5: Commit**

```bash
git add scenes/candyscape package.json
git commit -m "feat(candyscape): emit sparkle events when the cursor rests near a fish

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Sparkle renderer — pooled additive Points

**Files:**
- Create: `scenes/candyscape/src/sparkles.js`
- Modify: `scenes/candyscape/src/main.js`
- Test: `scenes/candyscape/tests/sparkles.mjs` (append)

**Interfaces:**
- Consumes: `simulation.drainSparkles()` (Task 6); `currentAt(p,t,out)` from `water.js`.
- Produces:
  - `export class SparklePool{constructor(size=512,seed=5381); emit(x,y,z,rgb:[r,g,b],count=24):void; update(dt:number,flow?:(x,y,z,out:{x,y,z})=>void):void; alive():number; life(i):number /*1 new → 0 dead*/; size:number; position:Float32Array; color:Float32Array}`
  - `export const SPARKLE_LIFE=1.0`, `export const SPARKLE_COLORS={gumdrop,mint,rosebud,lollipop}` (rgb arrays)
  - `export function createSparkles(scene,simulation):{update(dt):void,setPixelRatio(r):void,pool:SparklePool}`

- [ ] **Step 1: Write the failing test.** Append to `tests/sparkles.mjs`, before the final `console.log`:
```js
const { SparklePool,SPARKLE_LIFE,SPARKLE_COLORS,createSparkles }=await import('../src/sparkles.js');
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `node scenes/candyscape/tests/sparkles.mjs` → FAIL (`Cannot find module '../src/sparkles.js'`).

- [ ] **Step 3: Implement `scenes/candyscape/src/sparkles.js`**
```js
import * as THREE from 'three';
import { randomGenerator } from './math.js';
import { currentAt, waterTime } from './water.js';

/** Candy sparkles: a short burst of glints a fish sheds when the cursor rests near it. A
 *  fixed ring of sprites, so a cursor parked over a crowd recycles the oldest glints instead
 *  of allocating; a dead sprite is drawn at size zero. They are light, not matter: additive,
 *  no depth write, and they ride the tank's current and rise a little like fine bubbles. */
export const SPARKLE_LIFE=1.0;
const SPEED=[.35,.85],DRAG=2.6,BUOYANCY=.55;
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
        gl_PointSize=life>0.?clamp(30./(-mv.z),2.,14.)*(.55+.45*life)*pixelRatio:0.;}`,
    fragmentShader:`varying vec3 vColor;varying float vLife;
      void main(){vec2 c=gl_PointCoord-.5;float r=dot(c,c);
        // A soft core with a four-point star across it: reads as a sparkle, not a dust mote.
        float core=exp(-r*28.),star=exp(-abs(c.x)*40.)*exp(-abs(c.y)*6.)+exp(-abs(c.y)*40.)*exp(-abs(c.x)*6.);
        gl_FragColor=vec4(vColor*(core*1.6+star*.9)*pow(vLife,1.5),1.);}`});
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
```

- [ ] **Step 4: Wire into `main.js`**
- Add the import after the particles import: `import { createSparkles } from './sparkles.js';`
- Change `const particles=createParticles(scene,simulation,shadow);` to `const particles=createParticles(scene,simulation,shadow),sparkles=createSparkles(scene,simulation);`
- In `sync(dt)`, change `particles.update(dt);` to `particles.update(dt);sparkles.update(dt);`
- In `resize`, change `particles.setPixelRatio(ratio);` to `particles.setPixelRatio(ratio);sparkles.setPixelRatio(ratio);`

(`sync` gets `steps*FIXED_STEP`, which is 0 while paused and at most 0.1 after a stall, so the zero-dt guard covers pause and resume.)

- [ ] **Step 5: Verify**

Run: `node scenes/candyscape/tests/sparkles.mjs && npm run check` → `candyscape sparkle events ok`, check exits 0.
Run: `sh tools/smoke-scene.sh candyscape /tmp/candy-7.png` → `ok` (no sparkles visible in capture: there's no pointer).
Manual: `npm start`, open `http://localhost:8080/scenes/candyscape/`, rest the cursor on a fish and confirm a coloured burst that rises and fades in about 1 s; parking the cursor gives at most one burst per fish every 1.5 s; Pause freezes the glints and Play resumes them without a jump. If you can't run a manual browser check, use the `claude-in-chrome` skill, or ask the user to do it, and say so in the hand-off.

- [ ] **Step 6: Commit**

```bash
git add scenes/candyscape
git commit -m "feat(candyscape): pooled additive sparkle bursts driven by simulation events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Reskin the tank — light, water, rock and sugar sand

**Files:**
- Modify: `scenes/candyscape/src/main.js` (background, lights, environment map, exposure)
- Modify: `scenes/candyscape/src/water.js` (`ABSORB`, `inscatterGLSL`, `surfaceGLSL` colours)
- Modify: `scenes/candyscape/src/terrain.js` (rock and sand GLSL colours)

**Interfaces:** none new. These are value changes only; every function signature stays the same.

- [ ] **Step 1: Capture the "before" image**

Run: `sh tools/smoke-scene.sh candyscape /tmp/candy-8-before.png` → `ok`.

- [ ] **Step 2: Lights.** In `main.js`:
- `renderer.toneMappingExposure=1.08` → `renderer.toneMappingExposure=1.15`
- `scene.background=new THREE.Color('#04101d')` → `scene.background=new THREE.Color('#0d1a3a')`
- `new THREE.HemisphereLight('#3c56c0','#4a4636',.42)` → `new THREE.HemisphereLight('#6a7ce0','#b08aa8',.55)`
- `new THREE.DirectionalLight('#ffdfba',4.3)` → `new THREE.DirectionalLight('#fff0f6',4.3)`
- `new THREE.DirectionalLight('#4f6dff',.78)` → `new THREE.DirectionalLight('#9a6dff',.9)`
- `new THREE.DirectionalLight('#7fc4ff',1.1)` → `new THREE.DirectionalLight('#9ff0ff',1.1)`
- In the `envData` loop: `envData[i]=5+glow*186;envData[i+1]=7+glow*208;envData[i+2]=24+glow*231;` → `envData[i]=14+glow*220;envData[i+1]=10+glow*200;envData[i+2]=34+glow*221;` (every channel must stay ≤ 255, or the `Uint8Array` wraps to black)

- [ ] **Step 3: Water.** In `water.js`:
- `export const ABSORB=[.108,.052,.030];` → `export const ABSORB=[.085,.045,.034];` (water that eats less red, so distant candy keeps its pink instead of going navy)
- In `reefInscatter`: `mix(vec3(.00012,.0007,.0030),vec3(.0009,.0034,.0082),sky)+vec3(.0030,.0070,.0110)*reefShafts(p,t)*lit*sky` → `mix(vec3(.0006,.0006,.0032),vec3(.0022,.0036,.0084),sky)+vec3(.0060,.0070,.0100)*reefShafts(p,t)*lit*sky`
- In `reefSurfaceUnderside`: `vec3(.035,.13,.26)` → `vec3(.10,.12,.30)` and `vec3(.30,.62,.80)` → `vec3(.70,.75,.95)`

- [ ] **Step 4: Rock candy and sugar sand.** In `terrain.js`, inside the rock material's `map` GLSL:
- `vec3 coralline=mix(mix(vec3(.17,.025,.19),vec3(.36,.035,.16),smoothstep(.05,.55,hue)),vec3(.42,.08,.10),smoothstep(.6,1.,hue));` → `vec3 coralline=mix(mix(vec3(.62,.42,.78),vec3(.95,.55,.72),smoothstep(.05,.55,hue)),vec3(.55,.85,.72),smoothstep(.6,1.,hue));`
- `coralline=mix(coralline,vec3(.42,.17,.27),fine.g*fine.r*.4);` → `coralline=mix(coralline,vec3(.98,.80,.62),fine.g*fine.r*.4);`
- `vec3 turf=mix(mix(vec3(.090,.052,.026),vec3(.085,.074,.018),crust.b),vec3(.050,.030,.022),fine.b*(1.-crust.b));` → `vec3 turf=mix(mix(vec3(.46,.40,.58),vec3(.52,.62,.60),crust.b),vec3(.40,.34,.50),fine.b*(1.-crust.b));`
- `rock=mix(rock,mix(vec3(.30,.34,.07),vec3(.40,.22,.30),step(.55,fine.b)),speck*.85);` → `rock=mix(rock,mix(vec3(.98,.94,.55),vec3(.98,.60,.85),step(.55,fine.b)),speck*.85);`
- `diffuseColor.rgb=rock*mix(.05,1.,smoothstep(.36,.68,relief))*(.18+.82*vSurface.r*vSurface.r*vSurface.r);` → `diffuseColor.rgb=rock*mix(.35,1.,smoothstep(.36,.68,relief))*(.40+.60*vSurface.r*vSurface.r*vSurface.r);` (pits stay shaded but no longer go black: candy, not limestone)

In the sand material's `color`:
- `diffuseColor.rgb=mix(vec3(.42,.33,.23),vec3(.92,.875,.78),smoothstep(.42,.92,reefGrain.r))*(.90+.08*drift)*(.90+.055*ripple)*vShade;` → replace with:
```glsl
diffuseColor.rgb=mix(vec3(.80,.70,.78),vec3(1.,.97,.96),smoothstep(.42,.92,reefGrain.r))*(.90+.08*drift)*(.90+.055*ripple)*vShade;
      // Sugar crystals: one grain in a few hundred catches the lamp.
      diffuseColor.rgb+=vec3(.9,.8,1.)*.5*step(.985,fract(sin(dot(floor(bed*90.),vec2(12.9898,78.233)))*43758.5453));
```

- [ ] **Step 5: Verify**

Run: `for t in behavior assets locomotion anemone; do node scenes/candyscape/tests/$t.mjs >/dev/null || echo FAIL $t; done; npm run check` → no `FAIL`. (`behavior.mjs` re-checks the wave dispersion law, which doesn't depend on `ABSORB`.)
Run: `sh tools/smoke-scene.sh candyscape /tmp/candy-8.png` → `ok`. Compare with `/tmp/candy-8-before.png`. Expected: lighter violet-turquoise water, pastel lilac/mint/peach rock, pale pink-white sand. Fail the task if the frame is blown out (large flat white areas) or the rock reads as one flat colour. If so, lower `toneMappingExposure` toward 1.08 first, then reduce the `.40` rock floor toward `.25`, and re-run.

- [ ] **Step 6: Commit**

```bash
git add scenes/candyscape
git commit -m "feat(candyscape): candy light, lighter water, rock-candy hardscape and sugar sand

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Reskin the life — glassy candy corals, jelly anemones, motes and sprinkles

**Files:**
- Modify: `scenes/candyscape/src/corals.js`, `src/anemone.js`, `src/particles.js`
- Test: `scenes/candyscape/tests/anemone.mjs` (unchanged; it must keep passing)

**Interfaces:** none new.

- [ ] **Step 1: Corals.** In `corals.js`, replace the `branches` array and the coral material lines that follow it with these. Positions, seeds and shapes are identical; only colours change.
```js
  const branches=[
    grow(-5.82,-1.00,.42,2.10,1.05,39,'#ff7ab8','#ffe0f0',ACRO),
    grow(-7.10,-1.05,.42,1.75,1.16,74,'#6ee8b0','#e8fff4',{...ACRO,roots:14,thickness:.050,reach:.58,spread:.34}),
    grow(-4.35,-2.15,.60,2.30,.99,122,'#a98bff','#efe6ff',NEEDLE),
    grow(5.45,-1.52,.05,1.80,1.22,82,'#ffd25a','#fff6d8',ACRO),
    grow(7.34,-1.62,.38,1.30,1.00,417,'#ff7ab8','#ffe0f0',{...ACRO,roots:12,thickness:.052,reach:.62,spread:.34}),
    grow(3.28,-1.52,.38,1.60,.86,23,'#7fd8ff','#e6f8ff',NEEDLE),
    grow(4.30,1.55,.17,.84,.98,611,'#ff9f6a','#ffe6d6',{...FINGER,vary:.40}),
    grow(-.45,-1.14,.12,.95,.90,707,'#ffb0d8','#fff0f8',{...ACRO,roots:12,forks:4,reach:.56}),
    grow(1.34,-1.24,.30,.95,.55,811,'#b47bff','#f0e2ff',BRUSH),
    grow(-3.66,1.34,.10,.92,.95,1201,'#8af07a','#f0ffe8',{...FINGER,roots:13,vary:.30}),
    grow(-4.38,1.30,.10,.84,.80,1207,'#e08aff','#f8e8ff',{...FINGER,roots:10,thickness:.075,vary:.30}),
    grow(-7.30,1.10,.06,.55,.90,1213,'#ffc27a','#fff0dc',{...FINGER,roots:12,vary:.30}),
    grow(6.15,.50,.02,.85,1.05,905,'#c8ff5a','#f6ffd8',{...FINGER,roots:30,forks:3,order:1,thickness:.11,reach:.46,spread:.50,taper:.72,radials:40,glow:.5,vary:.25}),
  ];
  // Rock-candy spires: glassier and more translucent than living tissue.
  scene.add(mesh(merge(branches),coralMaterial('branching-coral',{cells:70,sheen:.8,sheenColor:'#ffe6ff',roughness:.35,transmission:.45})));
```
Plates: replace the five `'#6a7e3e','#cbd49a'` and `'#64763a','#cbd49a'` colour pairs with `'#7fe0c8','#e8fff8'`, and change the plate material `transmission:.16` to `transmission:.35`.
Brain: `'#8a7446','#2a3018'` → `'#ff9fc8','#a0306a'`. Favia: `'#98805a','#6e5a3c'` → `'#ffd88a','#c08a40'`.
Zoanthid `MORPHS` → `[['#ffe07a','#ff6fb0','#7a1f4a'],['#c8ff7a','#7a5aff','#2a1a5a'],['#ffb07a','#3ad0c0','#0a4a48']]`; zoanthid material `sheenColor:'#c8f0a0'` → `sheenColor:'#fff0c8'`.
Sea fan: `'#8a5a58','#e2b8b0'` → `'#ff8fd0','#fff0fa'`.

- [ ] **Step 2: Anemones.** In `anemone.js`:
- Body colours line → `const FOOT=new THREE.Color('#7a3a6a'),SHAFT=new THREE.Color('#e07ab0'),LIP=new THREE.Color('#ffb0d0'),WART=new THREE.Color('#fff0f6'),DISC=new THREE.Color('#ff8fc0'),LIPS=new THREE.Color('#ffd0e4'),MOUTH=new THREE.Color('#7a1f4a');`
- Tentacle `transmission:'(.20+.40*smoothstep(.20,1.,vAxis))'` → `transmission:'(.45+.45*smoothstep(.20,1.,vAxis))'` (jelly)
- In `surfaceNormal`: `vec3(.80,.64,.50)` → `vec3(1.,.85,.95)`
- In `color`, the `vec3 root=...` line → `vec3 root=vec3(.55,.20,.45),shaft=mix(vec3(.95,.45,.70),vec3(1.,.62,.80),vTone),bands=vec3(.70,.95,.80),tip=vec3(1.,.95,.70);`
- `diffuseColor.rgb=mix(tissue,vec3(.14,.06,.015),buried*.78);` → `diffuseColor.rgb=mix(tissue,vec3(.30,.08,.20),buried*.60);`

- [ ] **Step 3: Motes and pellets.** In `particles.js`:
- `vec3(.62,.84,1.)` → `vec3(1.,.85,1.)` (motes catch the light pink-white)
- `new THREE.MeshStandardMaterial({color:'#b49366',roughness:.9})` → `new THREE.MeshStandardMaterial({color:'#ff9ec9',roughness:.6})` (sprinkle pellets)

- [ ] **Step 4: Verify**

Run: `for t in behavior assets locomotion anemone; do node scenes/candyscape/tests/$t.mjs >/dev/null || echo FAIL $t; done; npm run check` → no `FAIL`.
Run: `sh tools/smoke-scene.sh candyscape /tmp/candy-9.png` and `sh tools/smoke-scene.sh candyscape /tmp/candy-9-anemone.png "capture&time=20&view=anemone"` → both `ok`. Expected: saturated pastel corals with glassy tips, a pink jelly host anemone, no brown/olive tissue left anywhere. Compare against `/tmp/smoke-reef.png`: it should read as a different world at a glance.

- [ ] **Step 5: Commit**

```bash
git add scenes/candyscape
git commit -m "feat(candyscape): glassy candy corals, jelly anemones, pink motes and sprinkle pellets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Register Candyscape everywhere a world is listed

**Files:**
- Modify: `wallpaper/Wallpaper.swift` (`World` enum)
- Modify: `index.html` (gallery portal and help text)
- Modify: `scenes/{riverscape,reefscape,bettascape,plasmascape}/index.html` (`.scene-nav` only — the single allowed reefscape edit, a navigation link, not scene code)
- Modify: `README.md`, `package.json` (`description`)
- Create: `docs/images/candyscape-wide.png`

**Interfaces:**
- Produces: `World.candyscape` (Swift); gallery portal `#candy`.

- [ ] **Step 1: Swift.** In `wallpaper/Wallpaper.swift`:
```swift
  case riverscape, reefscape, bettascape, plasmascape, candyscape
```
In `title` add `    case .candyscape: "Candyscape"`. In `background` add `    case .candyscape: NSColor(calibratedRed: 0.051, green: 0.102, blue: 0.227, alpha: 1)` (that's `#0d1a3a`, the scene background). `canFeed` already returns true for everything but `.plasmascape`, and `page` is derived from `rawValue`, so neither needs a change.

Run: `swiftc -typecheck -target "$(uname -m)-apple-macos13.0" wallpaper/Wallpaper.swift`
Expected: no output, exit 0. (If `swiftc` is missing, note it and move on; `npm run wallpaper` in Task 11 is the real build.)

- [ ] **Step 2: Gallery.** Make the screenshot first:
Run: `sh tools/smoke-scene.sh candyscape docs/images/candyscape-wide.png "capture&time=24"` → `ok`. Open it and check it's a good frame: several species in view, the anemone visible. If it isn't, try `time=` 18, 30 or 40.

In `index.html`, change `choose one of four worlds` to `choose one of five worlds`, update the `<meta name="description">` to list `a candy reef` after `a plasma globe` (`…, a single betta, a plasma globe or a candy reef, …`), and add after the Plasma globe portal's closing `</a>`:
```html
      <a draggable="false" class="portal candy" id="candy" role="button" href="scenes/candyscape/" aria-label="Preview Candyscape">
        <div class="portal-image">
          <span class="preview-status" hidden>Preview unavailable</span>
          <img draggable="false" src="docs/images/candyscape-wide.png" alt="A candy-coloured reef tank with pink, mint and tangerine fish over pastel rock and coral" width="1440" height="750" />
        </div>
        <div class="portal-caption">
          <h2>Candyscape<span class="enter" aria-hidden="true">↗</span></h2>
        </div>
      </a>
```

- [ ] **Step 3: Scene nav.** In each of `scenes/riverscape/index.html`, `scenes/reefscape/index.html`, `scenes/bettascape/index.html`, `scenes/plasmascape/index.html`, add the last line inside `<div class="scene-nav">`:
```html
          <a href="../candyscape/">Candyscape</a>
```
Run: `grep -c "candyscape/" scenes/*/index.html` → expected: `1` for each of the four, and `0` for candyscape itself (it uses the `aria-current` span).

- [ ] **Step 4: Docs.**
- `package.json` `description` → `"Living worlds for your macOS desktop: Riverbed, a planted river, Coral reef, a coral reef, Betta, a single betta, Plasma globe, a plasma globe in a dark room, and Candyscape, a candy-coloured reef."`
- `README.md` line 9: `There are four so far.` → `There are five so far.`, and after the Plasma globe sentence append: ` The fifth, **Candyscape**, is Coral reef's tank in candy colours with four candy fish, and a fish sheds a burst of sparkles when the cursor rests near it.`
- `README.md` line 37: `between Riverbed, Coral reef, Betta and Plasma globe` → `between Riverbed, Coral reef, Betta, Plasma globe and Candyscape`.
- `README.md` line 38: after `eight in Coral reef` insert ` and Candyscape`; after `36 seconds in Coral reef` insert ` and Candyscape`.

- [ ] **Step 5: Verify**

Run: `npm test 2>&1 | grep -ciE "assert|error"` → `0`. Run: `npm run check` → exit 0.
Run: `for s in riverscape reefscape bettascape plasmascape candyscape; do sh tools/smoke-scene.sh $s /tmp/nav-$s.png || echo FAIL $s; done` → five `ok`, no `FAIL`.
Run: `git diff --stat main -- scenes/reefscape` → only `scenes/reefscape/index.html | 1 +`.

- [ ] **Step 6: Commit**

```bash
git add wallpaper/Wallpaper.swift index.html scenes/*/index.html README.md package.json docs/images/candyscape-wide.png
git commit -m "feat: register Candyscape in the wallpaper World menu, gallery, scene nav and README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: End-to-end verification

**Files:** none (verification only; fix and re-commit within the owning task's scope if anything fails).

- [ ] **Step 1: Full suite**

Run: `npm test && npm run check && echo ALL-GREEN` → ends with `ALL-GREEN`.

- [ ] **Step 2: Coral reef untouched**

Run: `git diff --stat main -- scenes/reefscape scenes/shared` → only the one-line `scenes/reefscape/index.html` nav change.

- [ ] **Step 3: Performance envelope**

`npm start`, then open `http://localhost:8080/scenes/reefscape/?diagnostics=1` and `http://localhost:8080/scenes/candyscape/?diagnostics=1` at Balanced, on the same window size. Read `drawCalls` and `cpuFrameEMA` from the diagnostics overlay (or `window.sceneStats()` in the console).
Expected: Candyscape `drawCalls` ≤ Coral reef's + 2 (it adds lollipop and sparkle draws and drops the shrimp draws), and `cpuFrameEMA` within 15% of Coral reef's. If you can't run the browser check, use the `claude-in-chrome` skill or ask the user, and state that in the hand-off.

- [ ] **Step 4: Wallpaper host**

Run: `npm run wallpaper` (builds and installs the macOS app). Pick **World → Candyscape** from the menu bar. Expected: the scene fills the desktop, Feed drops pink pellets, and resting the cursor on a fish sparkles. This step needs the user's desktop, so ask them to confirm it.

- [ ] **Step 5: Hand-off.** Use superpowers:verification-before-completion, then superpowers:finishing-a-development-branch (push `candyscape` to `origin` = `in54nity-kfmn/deskworlds`; a PR within the fork, or keep as a branch, is the user's call).
