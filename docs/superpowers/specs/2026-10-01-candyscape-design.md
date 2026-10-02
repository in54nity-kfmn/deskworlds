# Candyscape — a new Deskworlds world

Status: **revision 2, approved 2026-10-02** (rev 1 approved 2026-10-01; revised after a full read of the source)
Date: 2026-10-01, revised 2026-10-02

## Context

[Deskworlds](https://github.com/chaseleantj/deskworlds) is a macOS live-wallpaper app: cursor-reactive 3D scenes rendered with Three.js/WebGL2, each one a self-contained "world." Four exist today — three underwater (**Riverbed**, a planted river with a schooling bloodfin tetra; **Coral reef**, clownfish + chromis + anthias + cleaner shrimp on a reef; **Betta**, a single hero betta) and one non-aquatic (**Plasma globe**). Everything runs offline, bundled with the app; the browser preview (`npm start`) is the fast iteration loop.

Each world lives in `scenes/<name>scape/` (`index.html`, `wallpaper.html`, `style.css`, `src/`, `tests/`). Shared infra in `scenes/shared/` (`controls.js`, `frame-loop.js`, `render-policy.js`, `postprocessing.js`, `start.js`, …) gives every world pause/resume, Eco/Balanced/Detail profiles and visibility/battery throttling, provided the world's `main.js` honours the host contract (`window.sceneRate/sceneFeed/scenePause/scenePower`, `window.sceneStats`).

## Goal

Add a fifth world, **Candyscape**: a dressed reef tank with a small cast of stylized, candy-colored fish, built to feel distinctly "eye candy" rather than a fourth variation on Riverbed/Coral reef's semi-realistic look.

## Decisions

| Question | Decision |
|---|---|
| Where does this live? | `scenes/candyscape/` in the fork `in54nity-kfmn/deskworlds`. |
| Visual direction | **Stylized/candy-colored realism.** Plausible anatomy, real water. The "candy" comes from palette and material, not silhouette. |
| Environment | **Dressed reef diorama** — Coral reef's tank layout, reskinned. |
| Cast | **4 species**, mixed: see *Cast* below. |
| Interaction baseline | Identical to Coral reef: cursor-reactive, Feed drops pellets (8, 36 s dissolve), Pause/Resume, shared quality profiles. |
| Signature flourish | **Sparkle burst on cursor proximity**, distinct from the existing fast-cursor alarm. |
| Code reuse mechanism | **Copy-and-diverge from `scenes/reefscape/`**, not cross-scene imports. *(new in rev 2)* |

## What the source read changed (rev 1 → rev 2)

| Rev 1 assumption | What the code actually shows | Rev 2 decision |
|---|---|---|
| Riverbed's `fish-anatomy.js`/`fish.js` is the generalizable rig; Coral reef's is bespoke. | Backwards. Riverbed's rig is one species (bloodfin tetra) hard-coded as 21 measured cross-sections, with ~1,700 lines of tetra-specific feeding behaviour. Coral reef's `fish-model.js` is already a **parameterized multi-species rig**: a `SPECIES` table (profile knots, fins, eye, scales) plus per-species `SKIN`/`FINS`/`SHEEN`/`EYE` GLSL snippets, one instanced draw call per species, per-animal variation via `aFishTrim`. | Base the rig on **`reefscape/src/fish-model.js`**. A new species = one `SPECIES` entry + four shader snippets. Riverbed is not used. |
| `reefscape/src/particles.js` has a burst system with pooling to extend. | It has no bursts. It is 4,500 ambient "marine snow" points advected by the current and lit by the water shader, plus the instanced food pellets. No spawn/retire lifecycle exists. | New module **`candyscape/src/sparkles.js`**: a fixed-size ring-buffer `THREE.Points` pool (additive blending, same shader style as the motes). Food pellets and motes come over unchanged. |
| Reuse by referencing reef modules. | Reef modules are scene-tuned: `layout.js` constants drive navigation, collision and the baked rock (`live-rock.bin`, `rock-support.bin`); water/shader uniforms are namespaced `reef*`. Importing them across scenes couples Coral reef to Candyscape. | **Copy** `reefscape/src` + rock assets into `candyscape/` and diverge. Coral reef is not touched. |
| "Only register the world in the World switcher." | Registration touches 9 files: `wallpaper/Wallpaper.swift` (`World` enum: name, `canFeed`, background colour), root `index.html` gallery portal + screenshot, the `scene-nav` in all 5 scenes' `index.html`, `README.md`, `package.json` test script. | Accepted as v1 scope. Swift change is 4 lines in an enum. |

## Design

### Tank and dressing

Keep Coral reef's tank layout exactly — `layout.js`, the baked live-rock mesh and support field, `navigation.js` visibility graph — so collision, routing and placement all work unchanged. Reskin only materials and colours:

- **Live rock** → pale pastel "rock candy" (keep triplanar shader structure, swap the coralline/turf palette for lilac/mint/peach).
- **Branching corals** (`corals.js`) → glassy, high-transmission candy spires: raise `transmission`, push colours to saturated pastels, add a soft emissive tip.
- **Anemone crowns** → gumdrop/jelly polyps: translucent tentacle material, candy palette, keep the geometry and sway.
- **Sand** → light "sugar sand": brighter, slightly sparkly base colour.
- **Water/lighting** → shift the scene background, hemisphere and actinic colours from deep reef blue toward a lighter turquoise-violet so the candy palette reads.

### Cast

All four species built on the `fish-model.js` rig. Three are palette swaps of the existing species (same geometry and behaviour, new `SKIN`/`FINS`/`SHEEN`/`EYE` snippets); one is new.

| Species (working name) | Built from | Behaviour | Count | Palette |
|---|---|---|---|---|
| Gumdrop | clownfish geometry + host behaviour | stays around the host anemone, bathes in it | 3 | tangerine with white-and-raspberry bars |
| Mint | chromis geometry + shoal behaviour | two loose shoals that roam the tank | 9 | mint → cyan with a pearly sheen |
| Rosebud | anthias geometry + harem behaviour (incl. male U-swim) | one shoal near the arch | 7 | bubblegum pink, the male magenta-violet |
| Lollipop *(new)* | new `SPECIES` entry: deep-bodied, rounded, long trailing fins | solitary roamer: open-water excursions via `navigation.destination`, no shoal | 2 | electric pink/lime split, glowing fins |

Fins get a mild emissive term ("backlit stained glass"), not bioluminescence.

Cleaner shrimp are **dropped** from Candyscape (not fish, and not part of the candy concept). `stepShrimp` and the fish→shrimp cleaning goal are removed from the copied simulation.

### Behaviour

Copied `simulation.js` keeps the shared engine: shoal centres moving along routes, `swim()` gait model, separation/cohesion/alignment, coral avoidance, alarm on fast cursor (`pointer.speed > .9`), feeding. Species branches (`kind==='clown'` etc.) are renamed to the Candyscape species. The one new branch adds the Lollipop solitary roamer (it reuses the existing `roam`/`openWater` excursion path with no shoal slot).

### Signature flourish: sparkles

- **Trigger:** cursor within ~1.2 units of a fish *at any speed*. This is separate from the alarm, which still needs a fast cursor. A slow hover sparkles; a fast swipe scatters fish (and sparkles too).
- **Rate limit:** per-fish cooldown (~1.5 s) so a cursor parked on a fish does not emit continuously.
- **Burst:** ~24 sprites from the fish's position. They get a random outward velocity, drift with the existing `currentAt` water current, rise slightly like bubbles, and fade out over ~1 s. Colour comes from that species' palette.
- **Implementation:** `sparkles.js` keeps one preallocated `Points` buffer (e.g. 512) used as a ring pool, so nothing is allocated per frame. Per-particle age is kept in an attribute, and dead particles are given size 0. The simulation emits events (`simulation.sparkles` queue) and the renderer drains them. Sparkle state is visual only and is never fed back into behaviour.
- **Capture mode:** sparkles are driven by simulation time, so deterministic captures stay deterministic.

### Performance

Coral reef is the envelope, and Candyscape is lighter than it: no shrimp, about the same fish count (21 vs 19), one extra instanced draw call for the new species, and one `Points` draw call for sparkles. Quality profiles are inherited unchanged.

## Out of scope for v1

- New app-shell features beyond World registration.
- Interaction beyond the sparkle flourish.
- Windows/Linux.
- Any change to `scenes/shared/` or `scenes/reefscape/`.
- New baked assets (rock geometry is reused as-is).

## Verification

- `npm test` and `npm run check` stay green. New `scenes/candyscape/tests/` covers simulation stability (finite positions over N steps, food consumed), the sparkle pool (bounded count, retirement, cooldown), and that fish never penetrate rock bounds.
- Browser preview at `npm start` → `/scenes/candyscape/`: visual check on wide view, `?diagnostics=1` frame cost at Balanced comparable to Coral reef.
- Wallpaper: `npm run wallpaper` builds the Swift host, and Candyscape appears in the World menu.

## Next step

Approve rev 2 → `writing-plans` produces the step-by-step implementation plan.
