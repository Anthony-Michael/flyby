// physics.js — PURE. Flight model: stepPlane, resolveGround, windAt.
// Owned by: Dev A (sim core). See docs/DESIGN.md §3 for equations & constants.
// Rule: no DOM, no canvas, no Date/RNG. Deterministic given inputs.

import { checkCrash } from './landing.js';

/**
 * Plane state shape (the contract — do not add/rename fields without lead approval):
 * { x, y, vx, vy, pitch, throttle, fuel, onGround, braking, crashed }
 * Units: meters, seconds, radians. +pitch = nose up.
 */

// Throttle slew rate from DESIGN §4: W/S held gives ±60%/s, so ~1.7 s idle→full.
// Applied here (not in input.js) so the sim stays deterministic and headless-testable.
const THROTTLE_SLEW = 0.6; // fraction of full throttle per second

// Ground pitch clamp per DESIGN §3 "Ground contact".
const GROUND_PITCH_MIN = 0;
const GROUND_PITCH_MAX = 0.35;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrapAngle(a) {
  let r = (a + Math.PI) % (2 * Math.PI);
  if (r < 0) r += 2 * Math.PI;
  return r - Math.PI;
}

/**
 * Advance the plane one fixed tick.
 * @param {object} state   plane state (above)
 * @param {object} input   { pitch: -1..1, throttleDelta: -1..1, brake: bool }
 * @param {object} plane   constants object from data/planes.js (GRAVITY..MASS_FACTOR_PER_KG per DESIGN §3)
 * @param {object} env     { windX, windY, cargoKg }
 * @param {number} dt      fixed timestep, 1/60
 * @returns {object} new state (do not mutate input state)
 */
export function stepPlane(state, input, plane, env, dt) {
  const {
    GRAVITY, MAX_THRUST, LIFT_K, CL_SLOPE, CL_MAX, STALL_AOA,
    DRAG_P, DRAG_I, PITCH_RATE, FUEL_BURN_IDLE, FUEL_BURN_MAX,
    ROLL_FRICTION, BRAKE_DECEL, MASS_FACTOR_PER_KG,
  } = plane;

  const windX = env.windX ?? 0;
  const windY = env.windY ?? 0;
  const cargoKg = env.cargoKg ?? 0;

  // Throttle slews toward the held input (§4); braking flag is a straight copy.
  const throttle = clamp(state.throttle + (input.throttleDelta ?? 0) * THROTTLE_SLEW * dt, 0, 1);
  const braking = !!input.brake;

  // Aero forces use AIRspeed (§3).
  const airVx = state.vx - windX;
  const airVy = state.vy - windY;
  const airspeed = Math.hypot(airVx, airVy);
  const flightDir = Math.atan2(airVy, airVx); // atan2(0,0) = 0: harmless at standstill (lift/drag are 0 anyway)
  const aoa = wrapAngle(state.pitch - flightDir);

  let cl = clamp(CL_SLOPE * aoa, -CL_MAX, CL_MAX);
  if (Math.abs(aoa) > STALL_AOA) {
    cl *= Math.max(0, 1 - (Math.abs(aoa) - STALL_AOA) / 0.35); // stall taper
  }

  const mf = 1 + cargoKg * MASS_FACTOR_PER_KG; // heavier = sluggish
  const thrust = (state.fuel > 0 ? throttle : 0) * MAX_THRUST / mf;
  const lift = LIFT_K * airspeed * airspeed * cl / mf; // ⟂ to airflow
  const drag = (DRAG_P + DRAG_I * cl * cl) * airspeed * airspeed; // opposite airflow

  // Forces computed with the pre-update pitch, exactly per the §3 pseudocode order.
  const ax = thrust * Math.cos(state.pitch) - drag * Math.cos(flightDir) - lift * Math.sin(flightDir);
  const ay = thrust * Math.sin(state.pitch) - drag * Math.sin(flightDir) + lift * Math.cos(flightDir) - GRAVITY;

  // Pitch control: authority scales with airspeed (no elevator at standstill).
  // A restoring term proportional to angle of attack gives the airframe static
  // pitch stability — sustained up-input settles into a steady climb attitude
  // instead of ramping the nose past vertical into a tumble, and hands-off the
  // nose weathervanes toward the flight path. Both the damping and the authority
  // vanish in every AoA==0 / standstill case, so the §3 tuning tests are exact.
  const authority = clamp(airspeed / 20, 0, 1);
  const PITCH_DAMP = plane.PITCH_DAMP ?? 7.0; // 1/s; full up-input trims near AoA = PITCH_RATE/PITCH_DAMP
  const pitchRate = (input.pitch ?? 0) * PITCH_RATE - PITCH_DAMP * aoa;
  let pitch = wrapAngle(state.pitch + pitchRate * authority * dt);
  // Hard safety envelope: the elevator can never force AoA past ±0.5 rad.
  const MAX_AOA = 0.5;
  const aoaNew = wrapAngle(pitch - flightDir);
  if (aoaNew > MAX_AOA) pitch = wrapAngle(flightDir + MAX_AOA);
  else if (aoaNew < -MAX_AOA) pitch = wrapAngle(flightDir - MAX_AOA);

  let vx = state.vx + ax * dt;
  let vy = state.vy + ay * dt;

  // Rolling friction (+ brakes) lives here rather than in resolveGround because
  // resolveGround's locked signature has no access to plane constants or dt.
  if (state.onGround) {
    const decel = (ROLL_FRICTION + (braking ? BRAKE_DECEL : 0)) * dt;
    vx = Math.sign(vx) * Math.max(0, Math.abs(vx) - decel);
  }

  const x = state.x + vx * dt;
  const y = state.y + vy * dt;
  const fuel = Math.max(0, state.fuel - (FUEL_BURN_IDLE + (FUEL_BURN_MAX - FUEL_BURN_IDLE) * throttle) * dt);

  return { ...state, x, y, vx, vy, pitch, throttle, fuel, braking };
}

/**
 * Ground contact resolution. Called by sim after stepPlane.
 * @param {object} state     plane state
 * @param {number} terrainY  ground elevation at state.x
 * @param {object|null} runway  runway span {x, length, elevation} if over one, else null
 * @returns {{ state: object, event: null|'touchdown'|'crash'|'liftoff' }}
 */
export function resolveGround(state, terrainY, runway) {
  if (state.crashed) return { state, event: null };

  if (state.onGround) {
    // Leaving ground: automatic when lift + thrust made vy > 0 and we rose above terrain (§3).
    if (state.vy > 0 && state.y > terrainY) {
      return { state: { ...state, onGround: false }, event: 'liftoff' };
    }
    // Pinned: y on ground, no vertical speed, pitch clamped to [0, 0.35].
    return {
      state: {
        ...state,
        y: terrainY,
        vy: 0,
        pitch: clamp(state.pitch, GROUND_PITCH_MIN, GROUND_PITCH_MAX),
      },
      event: null,
    };
  }

  // Airborne: contact when at/below terrain.
  if (state.y <= terrainY) {
    const { crashed } = checkCrash(state, runway);
    if (crashed) {
      return {
        state: { ...state, y: terrainY, vy: 0, onGround: true, crashed: true },
        event: 'crash',
      };
    }
    return {
      state: {
        ...state,
        y: terrainY,
        vy: 0,
        onGround: true,
        pitch: clamp(state.pitch, GROUND_PITCH_MIN, GROUND_PITCH_MAX),
      },
      event: 'touchdown',
    };
  }

  return { state, event: null };
}

/**
 * Deterministic wind at position/time. No RNG. DESIGN §3.
 * @param {object} env  { baseX, gustAmp, zones: [{kind,x,width,vy}] }
 * @param {number} x
 * @param {number} t   elapsed sim time, s
 * @returns {{ windX: number, windY: number }}
 */
export function windAt(env, x, t) {
  const base = env.baseX ?? 0;
  const gustAmp = env.gustAmp ?? 0;
  const windX = base + gustAmp * Math.sin(t * 0.5 + x * 0.01) * Math.sin(t * 1.3);
  let windY = 0;
  for (const z of env.zones ?? []) {
    if (x >= z.x && x <= z.x + z.width) windY += z.vy ?? 0;
  }
  return { windX, windY };
}
