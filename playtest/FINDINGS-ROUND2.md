# SkyHaul autonomous playtest — Round 2 findings & actions

Method: one headless browser-shell probe (fake DOM driving `src/game.js` for
real, no jsdom dependency) plus three data-gathering scripts against the pure
sim — full m1–m8 skill matrix, a realistic economy playthrough ledger, and a
targeted trace of the round-1 open backlog. Round-1 baseline (must not
regress): m1 70% / m2 80% / m3 20% landed, warmedUp casual, 10 seeded runs.

## Shipped this round

### 1. Debrief-transition restart race (state corruption, not double-payout)

`finishFlight()` sets `S.transitioning = true` synchronously, then `await
hooks.onMissionEnd()` before flipping the screen to `DEBRIEF`. The stock
`hooks.onMissionEnd` resolves on the same microtask, but portal builds swap
this file for one with a real interstitial-ad delay (`monetize.js` docstring:
"portal build swaps THIS ONE FILE for an SDK-backed version") — a real window
where the screen is still `FLY` but a flight has already been graded and paid.

`updateFlight()`'s restart handler ran unconditionally, before the
`S.transitioning` gate:
```js
if (input.consumeRestart()) { startFlight(S.mission); return; }
```
A restart press during that window called `startFlight()`, which resets
`S.sim`/`S.screen` but never touches `S.transitioning`. Net effect, reproduced
in a new headless probe that boots the real `game.js` against a fake
window/canvas/localStorage and holds `hooks.onMissionEnd()` open on demand
(`playtest/qa-restart-race.mjs`):
- The fresh attempt is **frozen** — the physics gate (`!S.paused &&
  !S.transitioning`) stays closed because `S.transitioning` is still `true`
  from the abandoned `finishFlight()`.
- When the delayed hook eventually resolves, the game force-jumps the player
  into `DEBRIEF` for the **old, already-scored** flight, discarding the
  restart.
- Money/save: exactly one `recordCompletion()` call happens (synchronously,
  before the `await`) — **no double-payout**. `save.money` landed at exactly
  one mission's worth ($104 for a clean 3★ m1) across the whole attack.

Fix: restart is now ignored while a transition is pending —
```js
if (input.consumeRestart() && !S.transitioning) { startFlight(S.mission); return; }
```
The keypress is still consumed (drained, not queued), so it doesn't leak into
the next screen. Verified: probe goes from 2 FAILs to all-clean; `npm test`
still 93/93; existing `qa-input-mash.mjs`/`qa-phase*.mjs` probes re-run clean
(the 2 `qa-phase.mjs` "BUG" lines are pre-existing — confirmed via `git
stash`, unrelated to this change, see Known-open below).

**Files:** `src/game.js` (1-line guard + comment), `playtest/qa-restart-race.mjs` (new regression probe).

### 2. Economy pacing ledger (`playtest/economy-ledger.mjs`, new)

Simulated a real playthrough end-to-end through the actual `economy.js`
payout/persistence path (not a spreadsheet estimate): fly the campaign in
order, retry a mission with fresh seeds until it's actually landed at the
destination strip (matching `game.js`'s `landedAtDestination` gate), apply
`missionPayout` + `recordCompletion`, track cumulative sim-time as a playtime
proxy.

**warmedUp (casual) ledger:** reaches m5 before getting stuck (consistent
with finding #3 below — m5 is a 100% wall for every pilot tier, not just
casuals). Up to that wall:
| Mission | Attempts to land | Cum. playtime | Money after |
|---|---|---|---|
| m1 | 1 | 1.2 min | $80 |
| m2 | 1 | 3.0 min | $200 |
| m3 | 6 | 12.0 min | $301 |
| m4 | 1 | 15.0 min | $430 |

- **Tundra tires ($300) affordable after m3** — 12 minutes in. Long-range
  tank ($400) after m4, 15 minutes in. This matches DESIGN.md §7's explicit
  target ("First upgrade affordable by mission 4 (feels good early)") almost
  exactly — tires actually land a mission early, tank lands right on m4.
- Engine tune ($500), Mule ($1200), Swift ($2400) are **not reachable within
  the campaign as currently gated** for a casual pilot, because m5 is a wall
  (see #3) — the design's own math (`campaign pays ≈ $2,350 at ★★`) assumes
  all 8 missions clear, which no calibrated pilot tier currently can. This
  isn't a new problem — it's the same completability gap round 1 flagged —
  but the ledger now puts a concrete dollar/time number on its consequence:
  **casual players are economically stuck at $430, unable to ever afford a
  second plane, until m5+ are made climbable.**
- $8.7/min average grind rate up to the wall — reasonable pacing where it works.

(A `robot`-tier ledger was also run for comparison but is not representative:
the deterministic zero-jitter "ceiling" pilot's fixed approach parameters
don't suit every mission's terrain — see #3 — so it stalls out even earlier
on m2 in a way no adaptive human would. Not included as a serious data point.)

### 3. Full m1–m8 skill matrix (extends `playtest/run.js`'s m1–m3-only matrix)

m1–m3 unchanged from round 1 (confirms no regression: 70/80/20%). New data
for m4–m8, 10 seeds × 4 skill tiers (`robot` ×1, deterministic):

| Mission | firstTimer | secondTry | warmedUp | robot |
|---|---|---|---|---|
| m4 Headwind Haul | 0% | 50% | **50%** | 100% (1★) |
| m5 The Notch | 0% | 0% | **0%** | 0% |
| m6 Doc Whitfield | 0% | 0% | **0%** | 0% |
| m7 Long Haul | 0% | 0% | **0%** (see below) | 0% (timeout) |
| m8 Storm Strip | 0% | 0% | **0%** | 0% |

All m5/m6/m8 failures are `off-runway` — for **every** skill tier, including
the zero-error deterministic `robot`. Round 1's feasibility addendum already
proved these are physically reachable by a max-performance climber with no
attempt at a graceful landing; this round confirms the reverse: none of the
four *calibrated* pilots, even the error-free one, can currently put the
plane down on these strips. That's strong evidence the gap is in the
playtest pilot model's route/energy planning (it doesn't manage a proper
top-of-descent for short, obstacle-guarded strips), not proof the levels
themselves are unfair — but it means **m4–m8 human-difficulty tuning is still
unvalidated**, exactly as round 1 flagged.

I attempted a fix (energy-managed descent: dive back onto the glide profile
when well above it, mirroring the existing climb-boost pattern) and it did
fix `robot` on m2 (0%→100% landed) — but it also introduced pitch
oscillation/undershoot in the imprecise (jittered) human pilots and dropped
the **pinned** warmedUp m2 baseline from 80%→70% landed. Per this round's
explicit non-regression constraint, I reverted it (`playtest/humanPilot.js`
is back to its round-1 state; verified `run.js` m1–m3 output is
byte-identical to before). A real fix needs a proper top-of-descent
calculation (required sink rate from remaining distance/altitude, not a
threshold-switched boost) — that's a bigger, dedicated piece of work,
carried forward as the top backlog item again.

**m7 Long Haul** deserves a separate note: all 10 warmedUp runs either
**TIMEOUT'd at the probe's 300s cap with 0–2.7 L fuel left**, or **crashed
off-runway right as the tank ran dry** (t=292–295s, 0.0 L). This is not a
probe artifact — it's the plane genuinely running the tank down to fumes
while still short of the strip. Round 1 raised m7's fuel from 30 L to 33 L
(~10% margin) and called it "fuel is the boss"; this data says that margin is
still razor-thin against warmedUp's real cruise efficiency into a −4 m/s
headwind over 9 km. Not touched this round (retuning fuel/route without the
smarter pilot risks tuning against a route-inefficient reference), but it's
now backed by hard numbers instead of a guess.

## Known-open (round 3 candidates, carried/updated from round 1)

1. **Smarter reference pilot (top priority, unchanged from round 1).** Needs
   real top-of-descent energy planning, not a threshold-switched dive boost
   (tried, reverted — see #3). Required before m4–m8 human-difficulty tuning,
   m7 fuel-margin tuning, or m3's 20% casual wall can be responsibly adjusted.
2. **m5/m6/m8 are a 100% wall for every current pilot tier** (new, sharper
   version of round 1's "campaign m4–m8 completability unproven" item) —
   physically possible (round 1 feasibility.mjs) but not landable by anything
   calibrated yet.
3. **Casual economic dead-end at $430** (new, quantified this round) —
   downstream of #2; players can't reach Engine tune/Mule/Swift while m5+ is
   a wall. Re-measure with `playtest/economy-ledger.mjs` once #1/#2 land.
4. **★★★ score ceiling per mission still unmeasured** (carried from round 1)
   — blocked on #1 too; a route-planning-limited pilot can't be trusted to
   find the score ceiling either.
5. **Two stale assertions in `playtest/qa-phase.mjs`** (4b taxi-to-destination,
   4c sub-15m-AGL flight) report "BUG" for scenarios that are already handled
   one layer up, in `game.js`'s taxi-limbo failsafe (`updateFlight`'s
   `ROLLOUT && onGround && vx===0 && at destination` check, shipped round 1)
   — the probe only drives the pure `sim.js` phase machine in isolation and
   was never updated after that fix landed at the shell level. Confirmed via
   `git stash` that both predate this round and are unrelated to this
   round's `game.js` change. Not a real bug; the probe assertions should be
   retired or rewritten to drive `game.js` (now that `qa-restart-race.mjs`
   has established the pattern for doing that) in a future round.
6. **Free-contract fuzz at high counters** (carried from round 1, untouched).

## Rerunnable tools in this directory

`run.js` (m1–m3 matrix) · `impact-probe.mjs` · `funnel-probe.mjs` ·
`miss-probe.mjs` · `campaign-probe.mjs` · `hardcore-campaign.mjs` ·
`feasibility.mjs` · `qa-input-mash.mjs` · `qa-phase.mjs` · `qa-phase2.mjs` ·
`qa-restart-race.mjs` (new — browser-shell restart-race regression probe) ·
`economy-ledger.mjs` (new — realistic playthrough $/time ledger)
