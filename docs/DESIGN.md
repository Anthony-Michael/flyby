# SKYHAUL — Design Document

**A bush-pilot airmail cargo game for the browser.**
Canvas 2D + vanilla ES modules. Zero build step. Zero dependencies. Pure-function physics testable with `node --test`.

Status: v1.0 design — drives implementation directly.

---

## 1. Concept & Theme

**Name: SkyHaul.**

You're a freelance bush pilot in the fictional **Kettle Range** — a rugged frontier of grass strips, mining camps, and fjord villages that trucks can't reach. Everything moves by air or not at all. You start with a wheezing single-prop taildragger, a 40-litre tank, and a mail contract nobody else wanted. Every flight is the same honest bargain: get the cargo up, get it over the terrain, and get it back down **gently** — because the plane is your livelihood and the landing grade is your paycheck. Earn enough and you buy heavier iron, take heavier loads, and fly routes deeper into the range where the strips get shorter and the wind gets meaner.

**Confirmed: bush-pilot airmail/cargo, side-view 2D.** This is the right call and I'm not pitching an alternative. Reasons: (a) cargo delivery gives missions, economy, and progression for free — the NeoFly/Deadstick loop is proven; (b) side-view makes the core physics fantasy (lift vs. gravity, flare on touchdown) *visible on screen*, which top-down destroys; (c) takeoff/landing — our two mandated features — are inherently side-view moments.

Tone: warm, slightly weathered. Flat-color vector art (silhouette mountains, simple two-tone plane), no sprites needed.

---

## 2. View & Core Loop

**Decision: 2D side-view, horizontally side-scrolling, camera follows the plane.**

- World is a horizontal strip: x = distance along the route (meters), y = altitude (meters). Terrain is an elevation profile under you.
- Camera: plane sits at 35% from the left edge (you need to see ahead), vertical follow with soft deadzone. Zoom is fixed at **6 px per meter** in flight; no dynamic zoom in MVP.
- The route is one-way: takeoff strip on the left, destination strip on the right, terrain between. No backtracking pressure — you *can* turn around (plane flips heading), but missions never require it.

**Moment-to-moment loop (60–180 seconds per mission):**

1. **Briefing** — mission card: cargo weight, distance, wind, payout, par grade.
2. **Takeoff** — throttle up, roll down the strip, rotate at speed, clear the trees.
3. **Cruise** — manage pitch/throttle against wind and terrain; watch fuel; thread the mountain gap or ride over it.
4. **Approach** — destination strip appears; bleed speed, set up descent rate.
5. **Touchdown** — the skill moment. Flare, kiss the ground inside tolerance, brake to a stop on the strip.
6. **Debrief** — landing grade, payout, XP toward unlocks; one-tap "Next mission" / "Retry for better grade."

**Session loop:** string 2–4 missions, earn cash, buy an upgrade or plane, unlock the next region of harder routes.

The fun is the landing. Everything in the flight model is tuned so that a greased three-pointer feels earned.

---

## 3. Flight Model

**Units: meters, seconds, radians.** Mass-normalized (all forces expressed as accelerations, m/s²) — no mass bookkeeping except a cargo penalty factor. **Fixed timestep dt = 1/60 s**, accumulator loop, so physics is deterministic and unit tests assert exact values.

### State (plain object — the whole sim state is serializable)

```js
{
  x: 0,          // world position, m
  y: 0,          // altitude above sea level, m
  vx: 0, vy: 0,  // velocity, m/s
  pitch: 0,      // nose angle from horizontal, rad (+ = nose up)
  throttle: 0,   // 0..1
  fuel: 40,      // liters
  onGround: true,
  braking: false,
  crashed: false,
}
```

### Constants (starter plane "Kestrel" — per-plane overrides in §7)

```js
GRAVITY        = 9.8      // m/s², down
MAX_THRUST     = 6.0      // m/s² at full throttle, along nose
LIFT_K         = 0.0215   // lift accel = LIFT_K * airspeed² * CL
CL_SLOPE       = 5.0      // CL per radian of angle-of-attack
CL_MAX         = 1.4      // clamp; beyond this AoA you're stalling
STALL_AOA      = 0.28     // rad (~16°); past this, CL decays (see below)
DRAG_P         = 0.0022   // parasitic drag coefficient
DRAG_I         = 0.0025   // induced drag coefficient (× CL²)
PITCH_RATE     = 1.6      // rad/s at full control authority
FUEL_BURN_IDLE = 0.02     // L/s
FUEL_BURN_MAX  = 0.15     // L/s at full throttle (linear between)
ROLL_FRICTION  = 0.6      // m/s² decel when rolling on ground
BRAKE_DECEL    = 3.5      // m/s² additional when braking
MASS_FACTOR_PER_KG = 1/1000  // cargo penalty: mf = 1 + cargoKg/1000
```

Derived feel targets — these follow *exactly* from the constants and become the tuning acceptance tests:
- **Stall speed 18.0 m/s**: minimum level-flight speed is where max lift equals gravity → √(GRAVITY / (LIFT_K × CL_MAX)) = √(9.8 / (0.0215 × 1.4)) = 18.0 m/s.
- **Rotation speed 22 m/s** (stall × 1.22 — comfortable margin; HUD "ROTATE" cue).
- **Cruise 40 m/s at ~64% throttle**: level flight at 40 needs CL = 9.8/(0.0215×1600) = 0.285 (AoA ≈ 3.3°); drag there = (0.0022 + 0.0025×0.285²)×1600 ≈ 3.85 m/s² → throttle = 3.85/6.0 ≈ 0.64.
- **Top level speed ≈ 51 m/s** (full throttle: 6.0 = DRAG_P-dominated drag → v ≈ √(6.0/0.0023)). Dives can exceed it; that's fine and fun.
- **Takeoff roll ≈ 50–75 m** from brake release to 22 m/s at full throttle (thrust 6.0 minus rolling friction 0.6 minus growing drag), scaling with cargo `mf` — a 250 kg load pushes it past 90 m, which is why strip lengths matter.

The unit tests pin these exact numbers, not vibes.

### Per-tick integration (`stepPlane(state, input, plane, env, dt)` — pure)

```
airVx = vx - env.windX          // aero forces use AIRspeed
airVy = vy - env.windY
airspeed  = hypot(airVx, airVy)
flightDir = atan2(airVy, airVx) // direction of airflow over wings
aoa    = wrapAngle(pitch - flightDir)          // angle of attack
cl     = clamp(CL_SLOPE * aoa, -CL_MAX, CL_MAX)
if |aoa| > STALL_AOA: cl *= max(0, 1 - (|aoa| - STALL_AOA) / 0.35)  // stall taper

mf     = 1 + cargoKg / 1000                    // heavier = sluggish
thrust = (fuel > 0 ? throttle : 0) * MAX_THRUST / mf
lift   = LIFT_K * airspeed² * cl / mf          // ⟂ to airflow (rotate flightDir +90°)
drag   = (DRAG_P + DRAG_I * cl²) * airspeed²   // opposite airflow

ax = thrust*cos(pitch) - drag*cos(flightDir) - lift*sin(flightDir)
ay = thrust*sin(pitch) - drag*sin(flightDir) + lift*cos(flightDir) - GRAVITY

// pitch control: authority scales with airspeed (no elevator at standstill)
authority = clamp(airspeed / 20, 0, 1)
pitch += input.pitch * PITCH_RATE * authority * dt   // input.pitch ∈ [-1, 1]

vx += ax*dt ; vy += ay*dt ; x += vx*dt ; y += vy*dt
fuel = max(0, fuel - (FUEL_BURN_IDLE + (FUEL_BURN_MAX - FUEL_BURN_IDLE)*throttle) * dt)
```

**Ground contact** (`resolveGround(state, terrainY, onRunway)` — pure): if `y <= terrainY(x)` and descending → either touchdown (on runway, within §5 tolerances), crash (off runway, or tolerances busted), or continue rolling. While `onGround`: `y` pinned to ground, `vy = 0`, `pitch` clamped to `[0, 0.35]`, apply `ROLL_FRICTION` (+ `BRAKE_DECEL` if braking) against `vx`. Leaving ground: automatic when lift + thrust make `vy > 0` and `y > terrainY`.

**Wind** (`windAt(env, x, t)` — pure): `windX = base + gustAmp * sin(t * 0.5 + x * 0.01) * sin(t * 1.3)`, `windY = updraftFromZones(x)`. Deterministic (no RNG in physics) → replayable and testable.

**Why this model:** one force diagram, six constants doing all the work, and every regime we need falls out naturally — can't take off below rotation speed (lift < g), stall when you yank the nose past 16° AoA, glide when fuel runs dry, headwind shortens takeoff roll. Each behavior is a 5-line unit test:

```js
// example acceptance tests, node --test, zero deps
test('no lift at standstill', () => assert.equal(liftAccel(0, 0.2), 0));
test('level cruise ~40 m/s trims near 65% throttle', ...);
test('stall: cl at aoa=0.5 rad < cl at aoa=0.28 rad', ...);
test('full-throttle takeoff roll from 0 to 22 m/s takes 50–75 m', ...);
```

---

## 4. Controls

Minimal. Keyboard only in MVP. All inputs are read into a plain `{pitch, throttleDelta, brake}` object — physics never touches the DOM.

| Key | Action |
|---|---|
| **↑ / ↓** | Pitch up / pitch down (held; analog value ±1) |
| **W / S** | Throttle up / down (held; ±60%/s slew, so ~1.7 s idle→full) |
| **B** (hold) | Wheel brakes (ground only) |
| **R** | Restart mission |
| **P** or **Esc** | Pause |

Cut from scope: flaps, rudder/yaw, trim, gear. Flaps are the only tempting one — **deferred, not designed in**; the flight model handles slow flight fine without them. Touch controls deferred (see §11).

---

## 5. Takeoff & Landing Rules

### Takeoff
No pass/fail gate — takeoff is self-enforcing physics. You *can't* lift off below ~stall speed, and each strip has a length; run off the end at ground level and you hit the overrun (crash if terrain rises, bumpy grass drag penalty of 3 m/s² if flat). Rotation guidance: HUD shows "ROTATE" flash at 22 m/s. **Takeoff is "complete" when altitude > strip elevation + 15 m** — this timestamps the flight for the mission log.

### Landing — the tolerances (checked at the instant of touchdown, pure function `gradeTouchdown(state, runway)`)

| Check | Crash if | Notes |
|---|---|---|
| Vertical speed | `vy < -CRASH_VY` (base **−4.0** m/s, per-plane; tires +1.2) | retuned from −2.5 after round-1 playtesting: 79 simulated casual crashes clustered at −2.5…−4.3 m/s. Survival is forgiving; the grade formula (unchanged) keeps ★★★ hard — a −4 m/s arrival survives but scores ★ and pays the inspection fee |
| Ground speed | `vx > CRASH_VX` (base **34** m/s, per-plane) | retuned from 30: every observed too-fast touchdown was 30.3–31.5 m/s |
| Pitch attitude | `pitch < -0.05` rad (−3°) → **nose-gear strike**; `pitch > 0.24` rad (+14°) → **tail strike** | widened from −2°/+12° |
| Position | touchdown point outside `[runway.x, runway.x + runway.length]` | terrain contact off-runway is always a crash |
| Stop | rolling off runway end after touchdown → crash | brake! |

### Landing grade (0–100 → stars, shown big on debrief)

```
score = 100
score -= 25 * clamp((|vy| - 0.6) / 1.9, 0, 1)          // softness: ≤0.6 m/s is "greased"
score -= 20 * clamp((vx - 18) / 12, 0, 1)              // touchdown speed near stall = best
score -= 20 * (distance from runway 1/3 point / runway.length)  // touchdown zone accuracy
score -= 15 * clamp((|pitch - 0.10|) / 0.10, 0, 1)     // ideal flare attitude ≈ +6°
score -= 20 if you bounced (left ground again after first contact)
```
- **90–100 = ★★★ "Greased it"** → payout × 1.3
- **70–89 = ★★ "Solid"** → payout × 1.0
- **1–69 = ★ "Hard arrival"** → payout × 0.7, plus $25 "airframe inspection" fee
- **Crash** → mission failed, no payout, no lasting damage (retry is free — money is the stakes, not save-wipes)

Feedback at touchdown: instant grade toast ("−2.1 m/s · ★★"), thump screen-shake scaled to |vy|, dust particles, tire-chirp lines. The player must always know *why* the grade was what it was — debrief lists each deduction.

---

## 6. Missions

Three mission archetypes (all data-driven, same code path):
- **CARGO** — deliver N kg to strip B. Weight raises `mf` (sluggish climb) and raises stall/rotation speeds ~10–20%.
- **URGENT** — cargo + a time par. Beat par for +50% bonus; missing par still pays base. (Timer pressure without fail-state frustration.)
- **CHARTER** — passenger: pays big but landing grade ≤★ *fails* the mission ("passenger complaint"). Landing-skill check.

### Campaign: 8 missions, gated linearly (finish N to unlock N+1)

| # | Name | Type | Dist | Cargo | Wind (base / gust) | Hazard / twist | Fuel given | Reward |
|---|---|---|---|---|---|---|---|---|
| 1 | First Solo | CARGO | 1.5 km | 0 kg | 0 / 0 | None. Flat terrain, 400 m strips. Tutorial prompts. | 40 L | $80 |
| 2 | Mail Run | CARGO | 3 km | 50 kg | +1 m/s tail / 0 | Gentle hills | 40 L | $120 |
| 3 | Feed Drop | CARGO | 3 km | 250 kg | 0 / 0 | Heavy: rotation ~25 m/s, climb is a slog | 40 L | $180 |
| 4 | Headwind Haul | CARGO | 4 km | 100 kg | **−5 m/s head** / 1 | Headwind: watch fuel, groundspeed ≠ airspeed lesson | 40 L | $220 |
| 5 | The Notch | CARGO | 5 km | 100 kg | −2 / 1 | **Mountain pass**: 300 m ridge with a 60 m-wide gap; fly through or climb over | 40 L | $300 |
| 6 | Doc Whitfield | CHARTER | 4 km | 90 kg | −3 / 2 | Must land ★★ or better; destination strip only 180 m | 40 L | $400 |
| 7 | Long Haul | URGENT | 9 km | 150 kg | −4 / 2 | **Fuel is the boss**: 30 L given; full-throttle the whole way flames out short | **33 L** | $450 |
| 8 | Storm Strip | CARGO | 6 km | 200 kg | −6 / **4 gust** | Gusts + downdraft zone on final + 150 m cliff-edge strip | 40 L | $600 |

After mission 8: **Free Contracts** — infinite procedurally-parameterized missions (seeded from a counter, so deterministic) with reward scaling by distance × weight × wind. This is the retention loop; it's cheap because missions are data (§8).

---

## 7. Progression & Economy

**Currency: dollars.** Earned per mission (× landing-grade multiplier). No XP system — money *is* progression. Repeat any completed mission for 50% payout (grind valve, keeps the tuning honest).

### Hangar (3 aircraft — different feels, not strict tiers)

| Plane | Cost | MAX_THRUST | PITCH_RATE | Tank | Notes |
|---|---|---|---|---|---|
| **Kestrel** | starter | 6.0 | 1.6 | 40 L | The honest trainer. |
| **Mule** | $1,200 | 7.5 | 1.1 | 60 L | Cargo penalty halved (`/2000`), stall 2 m/s higher, lands hot. For M3/M7-style hauls. |
| **Swift** | $2,400 | 8.5 | 2.2 | 35 L | Fast (cruise ~52 m/s), twitchy, DRAG_P −20%, tolerances feel tight at its speeds. For URGENT + Free Contracts scoring. |

Planes are just constant-override objects — zero extra code.

### Upgrades (per-plane, one-time)

| Upgrade | Cost | Effect |
|---|---|---|
| Tundra tires | $300 | Crash tolerance `vy` −2.5 → −3.2 m/s; rough-strip drag penalty halved |
| Engine tune | $500 | MAX_THRUST +15% |
| Long-range tank | $400 | Tank +50% |

Total sink ≈ $6,800; campaign pays ≈ $2,350 at ★★ — Free Contracts fund the rest. First upgrade affordable by mission 4 (feels good early).

### localStorage persistence (`save.js`, single key, versioned)

```json
{
  "v": 1,
  "money": 780,
  "missionsCompleted": { "m1": { "bestScore": 94, "stars": 3 }, "m2": { "bestScore": 71, "stars": 2 } },
  "planesOwned": ["kestrel"],
  "activePlane": "kestrel",
  "upgrades": { "kestrel": ["tires"] },
  "freeContractCounter": 0,
  "settings": { "shake": true }
}
```

Key: `"skyhaul.save"`. Write on debrief + purchase only. `migrate(save)` is a pure function (old shape in → current shape out) so `v2` later is a unit test, not a prayer. Corrupt/missing JSON → fresh save, never a crash.

---

## 8. World / Level Structure

**A level is pure data.** Terrain = polyline of `[x, elevation]` control points, linearly interpolated by pure `terrainHeightAt(points, x)` (physics collision) and rendered with a smoothed pass (visual only — collision uses the linear version so tests are exact). Everything the renderer draws (trees, windsock, buildings) is decoration derived from the same data.

### Schema

```json
{
  "id": "m5",
  "name": "The Notch",
  "type": "CARGO",
  "briefing": "Machine parts for the Notch mine. The pass is tighter than it looks.",
  "cargoKg": 100,
  "fuelL": 40,
  "parTimeS": null,
  "reward": 300,
  "wind": { "baseX": -2, "gustAmp": 1 },
  "terrain": [[0,20],[900,20],[1400,80],[2200,300],[2400,300],[2460,180],[2520,300],[2700,300],[3600,90],[4400,35],[5200,35]],
  "startRunway": { "x": 100, "length": 400 },
  "endRunway":   { "x": 4600, "length": 300 },
  "zones": [
    { "kind": "downdraft", "x": 2700, "width": 400, "vy": -3 }
  ]
}
```

- Runway elevation is derived: `terrainHeightAt(runway.x)` — terrain must be flat across a runway span; a `validateLevel(level)` pure function asserts this (and start < end, terrain covers runways, etc.) and runs in the test suite over *all* shipped missions. Bad data fails CI, not the player.
- `zones` kinds in MVP: `downdraft` / `updraft` (adds `windY` inside the span). That's the whole hazard system; gusts + terrain + weight cover the rest of the difficulty space.
- Missions live in `data/missions.js` (an ES module exporting an array — still "just data," but importable with zero fetch/CORS issues when opened via `file://`).

---

## 9. HUD & Feedback

**Layout: bottom instrument strip** (60 px, semi-transparent panel), because the action is horizontal and vertical screen space is precious.

Left → right:
1. **Airspeed** (m/s, big) — turns amber below 22, red flashing below 19 with "STALL" + subtle warble tone (WebAudio oscillator, no assets).
2. **Altitude** AGL (radar altimeter — height above terrain; more useful than MSL in a mountain game).
3. **VSI** — vertical bar ±5 m/s with color bands: green |vy|≤1, amber ≤2.5, red beyond. *This is the landing instrument; make it the prettiest.*
4. **Throttle** — vertical slider mirroring W/S.
5. **Fuel** — bar + liters; amber <25%, red flashing <10%.
6. **Distance-to-destination** — "3.2 km ▸" plus an off-screen arrow when the strip is near.

**Cheap juice (all procedural, ~150 lines total):**
- Screen shake: touchdown thump scaled to |vy| (2–10 px, 250 ms decay); light rumble during ground roll.
- Particles: dust puffs at wheel contact, prop-wash streaks at full throttle, smoke + tumbling debris rects on crash.
- Tire chirp: 40 ms noise burst on touchdown (WebAudio, generated).
- Grade toast: big "★★★ GREASED IT · −0.4 m/s" slam-in on debrief.
- Parallax: 3 background layers (far ridge 0.2×, near hills 0.5×, cloud blobs 0.8×) — biggest visual win per line of code in the game.
- **Flight-path rings** (post-launch, from player feedback): guide rings (cream, dashed) trace the ideal climb/cruise/glide path on m1–m2; gold bonus rings on m3+ pay $10 each on delivery. Pure course generation in `rings.js`; pass detection in the shell; chime + sparkle on pass.
- **Altitude readability**: ground shadow under the plane (scales/fades with AGL ≤120 m); when the ground is off-screen, a dashed plumb line with "▼ N m" shows how far down it is.

---

## 10. Code Architecture

```
skyhaul/
  index.html            shell: <canvas>, ES-module bootstrap        —
  src/
    physics.js          stepPlane, resolveGround, windAt            PURE ✅
    terrain.js          terrainHeightAt, validateLevel              PURE ✅
    landing.js          gradeTouchdown, checkCrash, scoreBreakdown  PURE ✅
    sim.js              full mission tick: physics+ground+mission
                        phase machine (ROLLOUT→AIRBORNE→LANDED)     PURE ✅
    economy.js          payout calc, canAfford, applyPurchase       PURE ✅
    migrate.js          save-shape migration old→current            PURE ✅
    data/planes.js      3 plane constant-sets + upgrade defs        data
    data/missions.js    8 missions + free-contract generator (seeded, pure) data/PURE ✅
    save.js             localStorage read/write wrapper (thin)      impure (thin)
    input.js            keydown/up → {pitch, throttleDelta, brake}  impure (thin)
    renderer.js         canvas draw: terrain, plane, parallax       impure
    hud.js              instrument strip + toasts                   impure
    juice.js            shake, particles, WebAudio blips            impure
    game.js             rAF loop, fixed-step accumulator, screen
                        state machine (MENU/BRIEF/FLY/DEBRIEF/HANGAR) impure
    main.js             wire everything, boot                       impure
  test/
    physics.test.js  terrain.test.js  landing.test.js
    sim.test.js  economy.test.js  missions.test.js  migrate.test.js
```

Rule: **impure modules may import pure ones; never the reverse.** `sim.js` is the seam — it advances a whole mission from `(state, input, level, dt)` with zero DOM/canvas knowledge, which means an entire mission can be flown headlessly in a test (`assert` a scripted input sequence in mission 1 achieves a ★★★ landing — the ultimate regression test).

### Parallel work chunks (4 devs, minimal coupling — interfaces above are the contracts)

1. **Sim core** — `physics.js`, `terrain.js`, `landing.js`, `sim.js` + tests. The critical path; start first.
2. **Presentation** — `renderer.js`, `hud.js`, `juice.js` against a mocked/scripted sim state object.
3. **Meta game** — `economy.js`, `save.js`, `migrate.js`, `data/planes.js`, `data/missions.js` + tests. Fully independent.
4. **Shell** — `index.html`, `game.js`, `input.js`, `main.js`: loop, screen state machine, integration. Integrates 1–3; owns the final wiring.

(Chunk 1 publishing the `state` shape (§3) and `sim.step()` signature on day one unblocks everyone.)

---

## 11. MVP Cut Line

**MVP = fun in the hand + every mandated feature demonstrable:**
- Full flight model, takeoff, landing tolerances + grading — no cuts here, this *is* the game.
- **1 plane** (Kestrel), **missions 1–5**, money + localStorage persistence, **1 upgrade** (Tundra tires) — proves the whole economy pipeline end-to-end with minimum content.
- HUD instruments 1–6, touchdown shake + grade toast, 1 parallax layer.
- Full test suite for all pure modules (tests are cheapest at MVP time, not after).

**Deferred (in order we'd add them back):** missions 6–8 → Free Contracts → Mule & Swift + remaining upgrades → full juice pass (particles, audio) → CHARTER/URGENT types → touch controls → flaps. Nothing in the deferred list requires architectural change — that's the test of the cut.

---

## 12. Monetization Paths

| Path | Effort | Revenue realism | Keep-the-door-open requirement (NOW) |
|---|---|---|---|
| **Web-portal licensing (CrazyGames / Poki rev-share)** | Low — submit build; add their SDK *only in the portal build* | **Most realistic**: solid casual web games earn $50–500/mo; portals bring the traffic you don't have | One hook point (below); interstitial-safe pause points already exist (debrief screen) |
| itch.io pay-what-you-want | Near-zero | $20–200 total, mostly goodwill; great for feedback | Nothing |
| Self-hosted ads (AdSense etc.) vs. paid ad-free | Medium | Poor without your own traffic; ad-free upsell needs payments infra (violates zero-dep spirit) | Skip |
| Cosmetic plane skins (one-time purchase) | Medium-high (payments, entitlements) | Weak at web-game scale | Skins are already just renderer palettes — free door |
| **Premium mission packs** | Low *if* missions stay data | Decent as a portal/itch upsell later | **Missions as data modules with an id namespace — already our architecture (§8)** |
| Mobile-store wrapper (Capacitor etc.) later | High | Real but a separate project | Touch input isolated in `input.js`; don't hardcode keyboard anywhere else |

**Recommendation: web-portal licensing (CrazyGames first) as the primary path**, with itch.io as a free marketing mirror. It's the only option where someone else supplies distribution, it pays on play-time (our retry-for-a-better-grade loop is exactly what portals reward), and its integration cost is one adapter file.

**Architecture requirement for MVP — this and nothing more:** a single `monetize.js` hook module with no-op defaults:

```js
export const hooks = {
  onMissionEnd: () => Promise.resolve(),  // portal build: interstitial slot
  onGameLoaded: () => {},                 // portal build: sdk.gameLoadingFinished()
  isPackOwned: (packId) => packId === 'core',
};
```

`game.js` awaits `hooks.onMissionEnd()` before showing the debrief; mission list filters on `isPackOwned`. The portal build swaps this one file for an SDK-backed version — the core game never imports an SDK and stays zero-dependency. **No other monetization code in MVP.**

---

*End of design doc. Constants in §3 and tolerances in §5 are the tuning contract — change them only alongside their unit tests.*
