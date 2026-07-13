# SkyHaul autonomous playtest — Round 1 findings & actions

Method: three persona probes (casual skill-matrix, hardcore campaign audit, QA breaker)
run headlessly against the pure sim, 10 seeded human-variation runs per cell.
Human pilots model reaction delay, discrete decision cadence, micro-tap keyboard
input, overcorrection, late flares, and forgotten brakes (`humanPilot.js`).

## Fixed this round (all evidence-backed)

| # | Finding | Evidence | Action |
|---|---|---|---|
| 1 | Crash tolerances casual-hostile | 79 hard-impacts median −4.3 m/s vs −2.5 limit; all 11 too-fast at 30.3–31.5 vs 30 | CRASH_VY 2.5→4.0, CRASH_VX 30→34, pitch window −3°..+14°; grade formula unchanged so ★★★ stays hard |
| 2 | Tundra tires upgrade was a silent no-op | checkCrash ignored per-plane tolerances | checkCrash/resolveGround accept plane; tires now +1.2 CRASH_VY for real |
| 3 | Takeoff skips judged as landings | warmedUp died at x=500–1100 settling back at 35 m/s ("too-fast") or touching grass 10 m past the strip ("off-runway") while a *rolled* overrun was survivable | During ROLLOUT, ground contact is judged on impact/attitude only (wider skip window −7°..+17°) |
| 4 | Bounce balloon loop | Post-touchdown flare-holding re-lifted the plane, floating it off the strip | Weight-on-wheels lift dump (×0.35, cancels ground effect) after a graded touchdown |
| 5 | No flare cushion | Sims slammed −5..−8 with late flares | Ground effect: +25% lift below 6 m AGL — authentic float/cushion |
| 6 | Overrun always fatal | 8/10 warmedUp m2 deaths rolling off the end | Exit ≤15 m/s just trundles into the grass; grade stands |
| 7 | Mission limbo: taxi or hedge-hop to destination never ends | QA repro: phase stays ROLLOUT forever | Destination-strip touchdown grades even in ROLLOUT; taxi-park at destination fails with a message |
| 8 | NaN inputs poison state | `NaN` throttleDelta → whole state NaN | stepPlane sanitizes inputs to finite [-1,1] |
| 9 | m2 sequencing too hot | All three controllers failed m2: +2 tailwind float + terrain rising 2.6 m/s at the strip end | Tailwind 2→1, first rise moved 200 m later |
| 10 | m7 fuel zero-margin | 30 L = exactly the required burn; imperfect flight flames out | 33 L (~10% margin); still "fuel is the boss" |

## Outcome (warmedUp casual, 10 seeded runs)
m1: 0% → **70% landed** · m2: 0% → **80%** · m3: 0% → **20%** (heavy-cargo skill wall, partly intended)
First-timers still crash ~100% — their impacts are −6..−8 m/s (earned); tutorial hints + free retry carry them.

## Known-open (round 2 candidates)
- m3 completion rate low for casuals; consider cargo 250→200 or richer "be patient" hinting.
- Campaign m4–m8 completability still unproven by any controller (best controllers clear m1–m3; m5 Notch/m8 gusts need a smarter reference pilot).
- ★★★ ceiling per mission unmeasured (is 90+ reachable on m6's 180 m strip?).
- Economy pacing unvalidated (grind rate $/min).
- Browser-level QA (Enter/R spam, resize, mid-session storage corruption) not yet run.
- Free-contract fuzz beyond validateLevel (difficulty sanity at high counters).

## Rerunnable tools in this directory
`run.js` (skill matrix) · `impact-probe.mjs` · `funnel-probe.mjs` · `miss-probe.mjs` ·
`campaign-probe.mjs` · `hardcore-campaign.mjs` · `qa-input-mash.mjs` · `qa-phase*.mjs`

## Post-ship addendum: campaign feasibility verdict (feasibility.mjs)
A max-performance climber (full throttle, best-climb pitch, real sim) reaches the
destination strip on ALL 8 missions — no impossible walls. m7 at continuous full
throttle arrives with exactly 0.0 L (intended: cruise throttle leaves margin).
m6/m8 short strips are 3× the braked landing roll. m4 casual completion confirmed
at 5/10 (was 0/10 pre-retune). m5/m6/m8 persona failures are pilot-model route
planning, not level design — calibrating their human difficulty needs the smarter
reference pilot (round 2).
