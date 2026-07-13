// sim.test.js — mission phase machine + the crown jewel: a full scripted
// mission flown headlessly from brake release to a graded stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimState, step } from '../src/sim.js';
import { gradeTouchdown } from '../src/landing.js';
import { validateLevel } from '../src/terrain.js';

// Local copy of the Kestrel constants, verbatim from DESIGN §3
// (src/data/planes.js is another dev's file — not imported here).
const KESTREL = {
  GRAVITY: 9.8,
  MAX_THRUST: 6.0,
  LIFT_K: 0.0215,
  CL_SLOPE: 5.0,
  CL_MAX: 1.4,
  STALL_AOA: 0.28,
  DRAG_P: 0.0022,
  DRAG_I: 0.0025,
  PITCH_RATE: 1.6,
  FUEL_BURN_IDLE: 0.02,
  FUEL_BURN_MAX: 0.15,
  ROLL_FRICTION: 0.6,
  BRAKE_DECEL: 3.5,
  MASS_FACTOR_PER_KG: 1 / 1000,
};

const DT = 1 / 60;

// Flat tutorial level in the shape of mission 1 (§6/§8), defined locally.
const LEVEL = {
  id: 'm1-test',
  name: 'First Solo (test twin)',
  type: 'CARGO',
  briefing: 'Flat terrain, calm air. Fly it clean.',
  cargoKg: 0,
  fuelL: 40,
  parTimeS: null,
  reward: 80,
  wind: { baseX: 0, gustAmp: 0 },
  terrain: [[0, 20], [2600, 20]],
  startRunway: { x: 100, length: 400 },
  endRunway: { x: 1700, length: 400 },
  zones: [],
};
const ELEV = 20;

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// The mission script: a deterministic feedback controller (pure function of the
// current sim state) — full throttle → rotate at 22 → climb → cruise → descend
// → flare → brake. This is "scripted input" in the §10 sense: no DOM, no RNG.
// Tuned for the statically-stable pitch model (physics.js applies AoA damping, so
// holding a target pitch needs a touch more elevator and trims into a steady climb).
function autopilot(sim, level) {
  const p = sim.plane;
  const airspeed = Math.hypot(p.vx, p.vy); // calm level: airspeed == groundspeed
  const agl = p.y - ELEV;

  if (sim.phase === 'ROLLOUT') {
    // Full throttle; rotate when passing 22 m/s, hold ~11° until climb-out.
    const wantPitch = airspeed >= 22 ? 0.20 : 0;
    return { pitch: clamp((wantPitch - p.pitch) * 12, -1, 1), throttleDelta: 1, brake: false };
  }

  if (sim.phase === 'AIRBORNE') {
    const aim = level.endRunway.x + level.endRunway.length / 3; // touchdown zone
    const dist = aim - p.x;
    let vyTarget;
    let speedTarget;
    if (dist > 620) {
      // Climb to ~55 m AGL, then cruise.
      vyTarget = agl < 55 ? 2.2 : 0;
      speedTarget = 32;
    } else {
      // Descend on a slope that arrives at the aim point; bleed speed.
      const timeToAim = dist / Math.max(p.vx, 5);
      vyTarget = clamp(-agl / Math.max(timeToAim, 1), -2.0, 0);
      speedTarget = 25;
      if (agl < 4) { // flare
        vyTarget = -0.5;
        speedTarget = 20;
      }
    }
    const pitchTarget = clamp(0.06 + 0.09 * (vyTarget - p.vy), -0.15, 0.34);
    return {
      pitch: clamp((pitchTarget - p.pitch) * 12, -1, 1),
      throttleDelta: clamp((speedTarget - airspeed) * 0.8, -1, 1),
      brake: false,
    };
  }

  // LANDED: nose down, throttle off, brakes on, roll to a stop.
  return { pitch: -1, throttleDelta: -1, brake: true };
}

function flyMission(level, plane, maxTicks = 60 * 180) {
  let sim = createSimState(level, plane);
  const seen = new Set();
  for (let i = 0; i < maxTicks; i++) {
    sim = step(sim, autopilot(sim, level), level, plane, DT);
    for (const e of sim.events) seen.add(e);
    if (sim.phase === 'CRASHED') break;
    if (sim.phase === 'LANDED' && sim.plane.vx === 0) break;
  }
  return { sim, seen };
}

// --- createSimState -----------------------------------------------------------

test('createSimState: parked at the start threshold, engine idle, full mission fuel', () => {
  const sim = createSimState(LEVEL, KESTREL);
  assert.equal(sim.phase, 'ROLLOUT');
  assert.deepEqual(sim.plane, {
    x: 100, y: 20, vx: 0, vy: 0, pitch: 0, throttle: 0, fuel: 40,
    onGround: true, braking: false, crashed: false,
  });
  assert.equal(sim.t, 0);
  assert.equal(sim.bounced, false);
  assert.equal(sim.touchdown, null);
  assert.equal(sim.grade, null);
  assert.equal(sim.crashReason, null);
  assert.deepEqual(sim.events, []);
});

// --- the crown jewel ----------------------------------------------------------

test('full scripted mission: rollout, liftoff, cruise, touchdown, graded stop', () => {
  assert.deepEqual(validateLevel(LEVEL), [], 'test level itself must be valid');

  const { sim, seen } = flyMission(LEVEL, KESTREL);

  assert.equal(sim.phase, 'LANDED', `expected LANDED, got ${sim.phase} (${sim.crashReason ?? 'no reason'})`);
  assert.equal(sim.plane.vx, 0, 'plane must come to a full stop');
  assert.equal(sim.plane.crashed, false);

  // Events along the way.
  assert.ok(seen.has('rotate-speed'), 'ROTATE callout while accelerating on the strip');
  assert.ok(seen.has('liftoff'), 'liftoff event');
  assert.ok(seen.has('touchdown'), 'touchdown event');
  assert.ok(!seen.has('crash'));

  // Touchdown must be on the destination runway, within §5 tolerances.
  const td = sim.touchdown;
  assert.ok(td, 'touchdown record present');
  assert.ok(td.x >= LEVEL.endRunway.x && td.x <= LEVEL.endRunway.x + LEVEL.endRunway.length,
    `touched down at x=${td.x}, outside the destination strip`);
  assert.ok(td.vy >= -2.5, `sink rate ${td.vy} within tolerance`);
  assert.ok(td.vx <= 30, `speed ${td.vx} within tolerance`);

  // A valid grade, consistent with the pure grading function.
  assert.ok(sim.grade, 'grade present when LANDED');
  assert.ok(sim.grade.score > 0 && sim.grade.score <= 100);
  assert.ok([1, 2, 3].includes(sim.grade.stars));
  assert.deepEqual(sim.grade, gradeTouchdown(td, LEVEL.endRunway));
  // The script flies a decent approach — anything under two stars means the
  // physics or the phase machine regressed.
  assert.ok(sim.grade.stars >= 2, `expected at least a two-star landing, got ${sim.grade.stars} (score ${sim.grade.score}, breakdown ${JSON.stringify(sim.grade.breakdown)})`);

  // Fuel actually burned, time actually passed.
  assert.ok(sim.plane.fuel < 40 && sim.plane.fuel > 0);
  assert.ok(sim.t > 30 && sim.t < 180);
});

test('the mission is deterministic: two runs give identical final states', () => {
  const a = flyMission(LEVEL, KESTREL).sim;
  const b = flyMission(LEVEL, KESTREL).sim;
  assert.deepEqual(a, b);
});

// --- phase machine details ------------------------------------------------------

test('ROLLOUT becomes AIRBORNE only above strip elevation + 15 m', () => {
  let sim = createSimState(LEVEL, KESTREL);
  const plane = KESTREL;
  let liftoffSeen = false;
  for (let i = 0; i < 60 * 60 && sim.phase === 'ROLLOUT'; i++) {
    sim = step(sim, autopilot(sim, LEVEL), LEVEL, plane, DT);
    if (sim.events.includes('liftoff')) {
      liftoffSeen = true;
      assert.equal(sim.phase, 'ROLLOUT', 'leaving the ground is not yet takeoff-complete');
    }
  }
  assert.ok(liftoffSeen);
  assert.equal(sim.phase, 'AIRBORNE');
  assert.ok(sim.plane.y > ELEV + 15);
});

test('stall-warning fires when slow in the air', () => {
  const sim = {
    ...createSimState(LEVEL, KESTREL),
    phase: 'AIRBORNE',
    plane: { x: 800, y: 90, vx: 17, vy: 0, pitch: 0.1, throttle: 0.3, fuel: 30, onGround: false, braking: false, crashed: false },
  };
  const next = step(sim, { pitch: 0, throttleDelta: 0, brake: false }, LEVEL, KESTREL, DT);
  assert.ok(next.events.includes('stall-warning'));
});

test('slamming into the strip crashes with hard-impact and no grade', () => {
  let sim = {
    ...createSimState(LEVEL, KESTREL),
    phase: 'AIRBORNE',
    plane: { x: 1750, y: 21, vx: 25, vy: -5, pitch: 0.05, throttle: 0, fuel: 30, onGround: false, braking: false, crashed: false },
  };
  for (let i = 0; i < 30 && sim.phase !== 'CRASHED'; i++) {
    sim = step(sim, { pitch: 0, throttleDelta: 0, brake: false }, LEVEL, KESTREL, DT);
  }
  assert.equal(sim.phase, 'CRASHED');
  assert.equal(sim.crashReason, 'hard-impact');
  assert.equal(sim.grade, null);
  assert.equal(sim.plane.crashed, true);
});

test('terrain contact away from any runway crashes as off-runway', () => {
  let sim = {
    ...createSimState(LEVEL, KESTREL),
    phase: 'AIRBORNE',
    plane: { x: 1000, y: 21, vx: 25, vy: -1, pitch: 0.1, throttle: 0.3, fuel: 30, onGround: false, braking: false, crashed: false },
  };
  for (let i = 0; i < 60 && sim.phase !== 'CRASHED'; i++) {
    sim = step(sim, { pitch: 0, throttleDelta: 0, brake: false }, LEVEL, KESTREL, DT);
  }
  assert.equal(sim.phase, 'CRASHED');
  assert.equal(sim.crashReason, 'off-runway');
});

test('bounce: leaving the ground after touchdown re-grades with the 20-point deduction', () => {
  const touchdown = { vy: -0.5, vx: 22, pitch: 0.1, x: 1833, bounced: false };
  const firstGrade = gradeTouchdown(touchdown, LEVEL.endRunway);
  // Landed but rolling very fast with the nose held high AND full throttle: even
  // through the weight-on-wheels lift dump (which kills accidental balloons),
  // a deliberate go-around attempt can still lift off — and counts as a bounce.
  let sim = {
    ...createSimState(LEVEL, KESTREL),
    phase: 'LANDED',
    touchdown,
    grade: firstGrade,
    plane: { x: 1840, y: 20, vx: 40, vy: 0, pitch: 0.3, throttle: 1, fuel: 30, onGround: true, braking: false, crashed: false },
  };
  let bouncedTick = null;
  for (let i = 0; i < 300 && bouncedTick === null; i++) {
    sim = step(sim, { pitch: 1, throttleDelta: 1, brake: false }, LEVEL, KESTREL, DT);
    if (sim.events.includes('liftoff')) bouncedTick = i;
  }
  assert.notEqual(bouncedTick, null, 'plane should balloon back into the air');
  assert.equal(sim.bounced, true);
  assert.equal(sim.touchdown.bounced, true);
  assert.equal(sim.grade.score, firstGrade.score - 20);
  assert.ok(sim.grade.breakdown.some((b) => b.label === 'bounce'));
  assert.equal(sim.phase, 'LANDED', 'a bounce is not (yet) a crash');
});

test('rolling off the runway end after touchdown is an overrun crash', () => {
  let sim = {
    ...createSimState(LEVEL, KESTREL),
    phase: 'LANDED',
    touchdown: { vy: -0.5, vx: 28, pitch: 0.1, x: 2080, bounced: false },
    grade: gradeTouchdown({ vy: -0.5, vx: 28, pitch: 0.1, x: 2080, bounced: false }, LEVEL.endRunway),
    plane: { x: 2090, y: 20, vx: 28, vy: 0, pitch: 0, throttle: 0, fuel: 30, onGround: true, braking: false, crashed: false },
  };
  for (let i = 0; i < 120 && sim.phase !== 'CRASHED'; i++) {
    sim = step(sim, { pitch: 0, throttleDelta: -1, brake: false }, LEVEL, KESTREL, DT); // no brakes!
  }
  assert.equal(sim.phase, 'CRASHED');
  assert.equal(sim.crashReason, 'overrun');
  assert.equal(sim.grade, null, 'overrun voids the landing grade');
});

test('CRASHED is terminal and LANDED freezes once stopped', () => {
  let crashed = {
    ...createSimState(LEVEL, KESTREL),
    phase: 'CRASHED',
    crashReason: 'hard-impact',
    plane: { x: 1750, y: 20, vx: 0, vy: 0, pitch: 0, throttle: 0, fuel: 30, onGround: true, braking: false, crashed: true },
  };
  const after = step(crashed, { pitch: 1, throttleDelta: 1, brake: false }, LEVEL, KESTREL, DT);
  assert.deepEqual({ ...after, events: [] }, { ...crashed, events: [] });
  assert.deepEqual(after.events, []);

  const stopped = {
    ...createSimState(LEVEL, KESTREL),
    phase: 'LANDED',
    touchdown: { vy: -0.5, vx: 20, pitch: 0.1, x: 1833, bounced: false },
    grade: gradeTouchdown({ vy: -0.5, vx: 20, pitch: 0.1, x: 1833, bounced: false }, LEVEL.endRunway),
    plane: { x: 1900, y: 20, vx: 0, vy: 0, pitch: 0, throttle: 0, fuel: 30, onGround: true, braking: true, crashed: false },
  };
  const later = step(stopped, { pitch: 0, throttleDelta: 1, brake: false }, LEVEL, KESTREL, DT);
  assert.equal(later.phase, 'LANDED');
  assert.deepEqual(later.plane, stopped.plane, 'stopped plane no longer moves');
  assert.ok(later.t > stopped.t, 'time still advances');
});

test('step does not mutate its inputs', () => {
  const sim = createSimState(LEVEL, KESTREL);
  Object.freeze(sim);
  Object.freeze(sim.plane);
  Object.freeze(sim.events);
  const input = Object.freeze({ pitch: 0, throttleDelta: 1, brake: false });
  const next = step(sim, input, LEVEL, KESTREL, DT); // strict mode: mutation would throw
  assert.notEqual(next, sim);
  assert.equal(sim.plane.throttle, 0);
});
