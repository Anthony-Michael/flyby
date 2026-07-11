// physics.test.js — acceptance tests from DESIGN §3. node --test, zero deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepPlane, resolveGround, windAt } from '../src/physics.js';

// Local copy of the Kestrel constants, verbatim from DESIGN §3.
// Deliberately NOT imported from src/data/ (built in parallel by another dev).
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
const CALM = { windX: 0, windY: 0, cargoKg: 0 };
const NO_INPUT = { pitch: 0, throttleDelta: 0, brake: false };

function planeState(over = {}) {
  return {
    x: 0, y: 100, vx: 0, vy: 0, pitch: 0, throttle: 0, fuel: 40,
    onGround: false, braking: false, crashed: false,
    ...over,
  };
}

// Lift acceleration observed via one tick of level flight (flightDir = 0):
// ay = lift - GRAVITY when throttle = 0 → lift = vy'/dt + GRAVITY.
function measuredLift(airspeed, aoa) {
  const s = planeState({ vx: airspeed, vy: 0, pitch: aoa, throttle: 0, fuel: 40 });
  const out = stepPlane(s, NO_INPUT, KESTREL, CALM, DT);
  return out.vy / DT + KESTREL.GRAVITY;
}

test('stall speed is 18.0 m/s: max lift equals gravity at √(G / (LIFT_K·CL_MAX))', () => {
  const vStall = Math.sqrt(KESTREL.GRAVITY / (KESTREL.LIFT_K * KESTREL.CL_MAX));
  assert.ok(Math.abs(vStall - 18.0) < 0.05, `derived stall speed ${vStall} should be 18.0 ± 0.05`);
  // Physical check through stepPlane: at max-lift AoA (CL_SLOPE·0.28 = CL_MAX exactly),
  // lift ≥ gravity just above stall speed, < gravity just below.
  assert.ok(measuredLift(vStall + 0.1, 0.28) >= KESTREL.GRAVITY);
  assert.ok(measuredLift(vStall - 0.1, 0.28) < KESTREL.GRAVITY);
});

test('no lift at standstill: free fall is exactly -G·dt regardless of pitch', () => {
  const s = planeState({ vx: 0, vy: 0, pitch: 0.2, throttle: 0 });
  const out = stepPlane(s, NO_INPUT, KESTREL, CALM, DT);
  assert.equal(out.vy, -KESTREL.GRAVITY * DT);
});

test('level cruise at 40 m/s trims near ~64% throttle', () => {
  // §3: CL = 0.285 (AoA ≈ 0.057 rad), drag ≈ 3.85 m/s² → throttle ≈ 0.64.
  const aoa = KESTREL.GRAVITY / (KESTREL.LIFT_K * 40 * 40) / KESTREL.CL_SLOPE;
  const trimmed = planeState({ vx: 40, vy: 0, pitch: aoa, throttle: 0.64 });
  const out = stepPlane(trimmed, NO_INPUT, KESTREL, CALM, DT);
  assert.ok(Math.abs(out.vx - 40) / DT < 0.15, `ax should be ~0, got ${(out.vx - 40) / DT}`);
  assert.ok(Math.abs(out.vy) / DT < 0.35, `ay should be ~0, got ${out.vy / DT}`);
  // Bracket: meaningfully less throttle decelerates, meaningfully more accelerates.
  const low = stepPlane(planeState({ vx: 40, vy: 0, pitch: aoa, throttle: 0.5 }), NO_INPUT, KESTREL, CALM, DT);
  const high = stepPlane(planeState({ vx: 40, vy: 0, pitch: aoa, throttle: 0.8 }), NO_INPUT, KESTREL, CALM, DT);
  assert.ok((low.vx - 40) / DT < -0.3, 'at 50% throttle the plane should decelerate');
  assert.ok((high.vx - 40) / DT > 0.3, 'at 80% throttle the plane should accelerate');
});

test('stall taper: lift (hence cl) at aoa 0.5 rad < at aoa 0.28 rad, same airspeed', () => {
  const liftDeep = measuredLift(25, 0.5);
  const liftEdge = measuredLift(25, 0.28);
  assert.ok(liftDeep < liftEdge, `stalled lift ${liftDeep} must be below max-CL lift ${liftEdge}`);
  // Taper factor at 0.5 rad: 1 - (0.5 - 0.28)/0.35 ≈ 0.371 → lift ratio ≈ 0.371.
  assert.ok(liftDeep / liftEdge < 0.5, 'deep-stall lift should collapse, not merely dip');
});

// Roll the plane down a flat strip at full throttle until reaching target airspeed.
function takeoffRoll(windX, targetAirspeed) {
  let s = planeState({ x: 0, y: 0, vx: 0, vy: 0, throttle: 1, onGround: true });
  const env = { windX, windY: 0, cargoKg: 0 };
  const runway = { x: -1000, length: 10000, elevation: 0 };
  for (let i = 0; i < 60 * 60; i++) {
    s = stepPlane(s, { pitch: 0, throttleDelta: 1, brake: false }, KESTREL, env, DT);
    s = resolveGround(s, 0, runway).state;
    if (Math.hypot(s.vx - windX, s.vy) >= targetAirspeed) return s.x;
  }
  throw new Error('never reached target airspeed');
}

test('full-throttle takeoff roll from 0 to 22 m/s takes 50-75 m', () => {
  const dist = takeoffRoll(0, 22);
  assert.ok(dist >= 50 && dist <= 75, `takeoff roll was ${dist} m, expected 50-75 m`);
});

test('headwind shortens the takeoff roll', () => {
  const calm = takeoffRoll(0, 22);
  const headwind = takeoffRoll(-5, 22);
  assert.ok(headwind < calm, `roll with 5 m/s headwind (${headwind} m) should beat calm (${calm} m)`);
});

test('fuel burns per throttle and thrust dies at zero fuel', () => {
  const idle = stepPlane(planeState({ throttle: 0 }), NO_INPUT, KESTREL, CALM, DT);
  assert.ok(Math.abs((40 - idle.fuel) - KESTREL.FUEL_BURN_IDLE * DT) < 1e-12);
  const full = stepPlane(planeState({ throttle: 1 }), NO_INPUT, KESTREL, CALM, DT);
  assert.ok(Math.abs((40 - full.fuel) - KESTREL.FUEL_BURN_MAX * DT) < 1e-12);
  // Flame-out: same state with fuel 0 produces no thrust (vx decays instead of growing).
  const dry = stepPlane(planeState({ vx: 30, throttle: 1, fuel: 0 }), NO_INPUT, KESTREL, CALM, DT);
  assert.ok(dry.vx < 30, 'no thrust without fuel: drag must win');
  assert.equal(dry.fuel, 0, 'fuel never goes negative');
});

test('throttle slews at 60%/s toward held input and clamps to [0, 1]', () => {
  const up = stepPlane(planeState({ throttle: 0 }), { pitch: 0, throttleDelta: 1, brake: false }, KESTREL, CALM, DT);
  assert.ok(Math.abs(up.throttle - 0.6 * DT) < 1e-12);
  const capped = stepPlane(planeState({ throttle: 1 }), { pitch: 0, throttleDelta: 1, brake: false }, KESTREL, CALM, DT);
  assert.equal(capped.throttle, 1);
});

test('pitch authority scales with airspeed: no elevator at standstill', () => {
  const still = stepPlane(planeState({ vx: 0 }), { pitch: 1, throttleDelta: 0, brake: false }, KESTREL, CALM, DT);
  assert.equal(still.pitch, 0);
  const fast = stepPlane(planeState({ vx: 25 }), { pitch: 1, throttleDelta: 0, brake: false }, KESTREL, CALM, DT);
  assert.ok(Math.abs(fast.pitch - KESTREL.PITCH_RATE * DT) < 1e-12, 'full authority at 25 m/s');
});

test('cargo mass factor blunts thrust and lift', () => {
  const empty = stepPlane(planeState({ throttle: 1, onGround: true, y: 0 }), NO_INPUT, KESTREL, CALM, DT);
  const laden = stepPlane(planeState({ throttle: 1, onGround: true, y: 0 }), NO_INPUT, KESTREL, { ...CALM, cargoKg: 250 }, DT);
  assert.ok(laden.vx < empty.vx, '250 kg of cargo must slow acceleration');
});

test('stepPlane does not mutate its inputs', () => {
  const s = Object.freeze(planeState({ vx: 30, throttle: 0.5 }));
  const input = Object.freeze({ pitch: 0.5, throttleDelta: 1, brake: true });
  const out = stepPlane(s, input, KESTREL, CALM, DT); // throws under strict mode if mutated
  assert.notEqual(out, s);
  assert.equal(s.vx, 30);
});

test('resolveGround pins to terrain, zeroes vy, clamps pitch to [0, 0.35]', () => {
  const rolling = planeState({ y: -0.4, vy: -1, vx: 10, pitch: -0.2, onGround: true });
  const { state, event } = resolveGround(rolling, 0, { x: -100, length: 500, elevation: 0 });
  assert.equal(event, null);
  assert.equal(state.y, 0);
  assert.equal(state.vy, 0);
  assert.equal(state.pitch, 0, 'negative pitch clamps to 0 on ground');
});

test('resolveGround emits liftoff when climbing off the ground', () => {
  const s = planeState({ y: 0.05, vy: 0.5, vx: 24, onGround: true });
  const { state, event } = resolveGround(s, 0, { x: -100, length: 500, elevation: 0 });
  assert.equal(event, 'liftoff');
  assert.equal(state.onGround, false);
});

test('resolveGround: gentle on-runway contact is a touchdown, off-runway contact is a crash', () => {
  const contact = planeState({ x: 100, y: -0.01, vy: -1, vx: 20, pitch: 0.1, onGround: false });
  const ok = resolveGround(contact, 0, { x: 0, length: 400, elevation: 0 });
  assert.equal(ok.event, 'touchdown');
  assert.equal(ok.state.onGround, true);
  assert.equal(ok.state.vy, 0);

  const offField = resolveGround(contact, 0, null);
  assert.equal(offField.event, 'crash');
  assert.equal(offField.state.crashed, true);
});

test('windAt: calm base is exact, gusts stay within amplitude, deterministic', () => {
  assert.deepEqual(windAt({ baseX: -5, gustAmp: 0, zones: [] }, 1234, 56), { windX: -5, windY: 0 });
  for (let t = 0; t < 20; t += 0.37) {
    const { windX } = windAt({ baseX: -2, gustAmp: 1.5, zones: [] }, 800, t);
    assert.ok(Math.abs(windX - -2) <= 1.5 + 1e-12);
  }
  const a = windAt({ baseX: -2, gustAmp: 1.5, zones: [] }, 800, 7.3);
  const b = windAt({ baseX: -2, gustAmp: 1.5, zones: [] }, 800, 7.3);
  assert.deepEqual(a, b);
});

test('windAt: downdraft zone adds windY inside its span only', () => {
  const env = { baseX: 0, gustAmp: 0, zones: [{ kind: 'downdraft', x: 2700, width: 400, vy: -3 }] };
  assert.equal(windAt(env, 2900, 10).windY, -3);
  assert.equal(windAt(env, 2699, 10).windY, 0);
  assert.equal(windAt(env, 3101, 10).windY, 0);
});
