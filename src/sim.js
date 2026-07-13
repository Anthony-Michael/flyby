// sim.js — PURE. Whole-mission tick: physics + ground + wind + mission phase machine.
// Owned by: Dev A (sim core). This is THE seam between game logic and presentation.
// A full mission must be flyable headlessly in a test via repeated step() calls.

import { stepPlane, resolveGround, windAt } from './physics.js';
import { terrainHeightAt } from './terrain.js';
import { checkCrash, gradeTouchdown } from './landing.js';

/**
 * Mission phases: 'ROLLOUT' → 'AIRBORNE' → 'LANDED' | 'CRASHED'.
 * SimState shape (contract):
 * {
 *   plane: <plane state, physics.js>,
 *   phase: 'ROLLOUT'|'AIRBORNE'|'LANDED'|'CRASHED',
 *   t: number,             // elapsed sim seconds
 *   bounced: boolean,      // left ground again after first touchdown
 *   touchdown: null|{ vy, vx, pitch, x, bounced },
 *   grade: null|{ score, stars, breakdown },   // set when LANDED
 *   crashReason: null|string,
 *   events: string[],      // events emitted THIS tick ('liftoff','touchdown','crash','stall-warning',...) for juice/audio
 * }
 */

const TAKEOFF_COMPLETE_AGL = 15; // §5: takeoff complete when altitude > strip elevation + 15 m
const ROTATE_FACTOR = 1.22; // §3: rotation speed = stall speed × 1.22
const GRASS_DRAG = 3; // m/s² bumpy-grass penalty when overrunning a flat strip on takeoff (§5)
const STOP_SPEED = 0.05; // m/s: below this on the ground, the plane is considered stopped
const STALL_WARN_MARGIN = 1; // m/s above stall speed at which the warning starts (HUD red band, §9)

function airspeedOf(plane, wind) {
  return Math.hypot(plane.vx - wind.windX, plane.vy - wind.windY);
}

function windEnvOf(level) {
  return {
    baseX: level.wind?.baseX ?? 0,
    gustAmp: level.wind?.gustAmp ?? 0,
    zones: level.zones ?? [],
  };
}

// Runway span (with derived elevation) containing x, else null.
function runwayAt(level, x) {
  for (const r of [level.startRunway, level.endRunway]) {
    if (r && x >= r.x && x <= r.x + r.length) {
      return { x: r.x, length: r.length, elevation: terrainHeightAt(level.terrain, r.x) };
    }
  }
  return null;
}

// Stall speed rises with load: lift is divided by mf, so v_stall scales with √mf.
function stallSpeed(level, plane) {
  const mf = 1 + (level.cargoKg ?? 0) * (plane.MASS_FACTOR_PER_KG ?? 1 / 1000);
  return Math.sqrt((mf * plane.GRAVITY) / (plane.LIFT_K * plane.CL_MAX));
}

/**
 * Build initial sim state for a mission.
 * @param {object} level  mission/level object (DESIGN §8)
 * @param {object} plane  plane constants (with upgrades applied)
 * @returns {object} SimState positioned at start runway, engine idle
 */
export function createSimState(level, plane) {
  const elevation = terrainHeightAt(level.terrain, level.startRunway.x);
  return {
    plane: {
      x: level.startRunway.x,
      y: elevation,
      vx: 0,
      vy: 0,
      pitch: 0,
      throttle: 0,
      fuel: level.fuelL ?? plane.TANK_L ?? 40,
      onGround: true,
      braking: false,
      crashed: false,
    },
    phase: 'ROLLOUT',
    t: 0,
    bounced: false,
    touchdown: null,
    grade: null,
    crashReason: null,
    events: [],
  };
}

/**
 * Advance the mission one fixed tick. Pure: (state, input, level, plane, dt) → new state.
 * @param {object} simState
 * @param {object} input   { pitch, throttleDelta, brake }
 * @param {object} level
 * @param {object} plane
 * @param {number} dt      1/60
 * @returns {object} new SimState
 */
export function step(simState, input, level, plane, dt) {
  // Terminal phases: CRASHED freezes entirely; LANDED freezes once the plane has stopped.
  if (simState.phase === 'CRASHED') {
    return { ...simState, events: [] };
  }
  if (simState.phase === 'LANDED' && simState.plane.onGround && simState.plane.vx === 0) {
    return { ...simState, t: simState.t + dt, events: [] };
  }

  const t = simState.t + dt;
  const events = [];
  const windEnv = windEnvOf(level);
  const wind = windAt(windEnv, simState.plane.x, t);
  const env = {
    windX: wind.windX,
    windY: wind.windY,
    cargoKg: level.cargoKg ?? 0,
    groundY: terrainHeightAt(level.terrain, simState.plane.x), // ground effect
    wow: simState.phase === 'LANDED' && simState.plane.onGround, // lift dump after touchdown
  };

  const flown = stepPlane(simState.plane, input, plane, env, dt);
  const terrainY = terrainHeightAt(level.terrain, flown.x);
  const runway = runwayAt(level, flown.x);
  const resolved = resolveGround(flown, terrainY, runway, plane, simState.phase === 'ROLLOUT');

  let plane2 = resolved.state;
  let { phase, bounced, touchdown, grade, crashReason } = simState;

  const vStall = stallSpeed(level, plane);
  const startElev = terrainHeightAt(level.terrain, level.startRunway.x);

  // --- events from ground resolution -------------------------------------
  if (resolved.event === 'liftoff') {
    events.push('liftoff');
    if (phase === 'LANDED' && !bounced) {
      // Bounce: left the ground again after first touchdown, before stopping.
      // Per §5 we grade at FINAL settle; the simplest compliant approach used here
      // is: grade at first touchdown, then on bounce re-grade the SAME touchdown
      // with the flat 20-point bounce deduction applied. The recorded contact
      // numbers (vy/vx/pitch/x) stay those of the first touchdown.
      bounced = true;
      touchdown = { ...touchdown, bounced: true };
      const rw = runwayAt(level, touchdown.x);
      grade = gradeTouchdown(touchdown, rw ?? level.endRunway);
    }
  }

  if (resolved.event === 'crash') {
    events.push('crash');
    phase = 'CRASHED';
    crashReason = resolved.reason ?? checkCrash(flown, runway, plane).reason ?? 'terrain';
    grade = null;
  }

  if (resolved.event === 'touchdown') {
    events.push('touchdown');
    // A touchdown on the DESTINATION runway is a landing even if the flight
    // never crossed the +15 m takeoff-complete gate (hedge-hopping the whole
    // route at 10 m AGL is flying; without this the mission could never end).
    const onEndRunway = runway && level.endRunway && runway.x === level.endRunway.x;
    if (phase === 'AIRBORNE' || (phase === 'ROLLOUT' && onEndRunway)) {
      // First touchdown of the landing: record contact numbers and grade now
      // (bounce, if it happens later, re-grades with the deduction — see above).
      touchdown = { vy: flown.vy, vx: flown.vx, pitch: flown.pitch, x: flown.x, bounced: false };
      grade = gradeTouchdown(touchdown, runway);
      phase = 'LANDED';
    }
    // In ROLLOUT on the start strip (settled back before takeoff-complete) or
    // LANDED (bounce re-contact) the phase does not change.
  }

  // --- rotate-speed callout (on ground, crossing rotation speed upward) ---
  if (simState.plane.onGround && plane2.onGround && phase === 'ROLLOUT') {
    const prevWind = windAt(windEnv, simState.plane.x, simState.t);
    const prevAir = airspeedOf(simState.plane, prevWind);
    const nowAir = airspeedOf(plane2, wind);
    const vRotate = ROTATE_FACTOR * vStall;
    if (prevAir < vRotate && nowAir >= vRotate) events.push('rotate-speed');
  }

  // --- stall warning while flying -----------------------------------------
  if (!plane2.onGround && !plane2.crashed && airspeedOf(plane2, wind) < vStall + STALL_WARN_MARGIN) {
    events.push('stall-warning');
  }

  // --- takeoff complete: ROLLOUT → AIRBORNE at strip elevation + 15 m (§5) --
  if (phase === 'ROLLOUT' && plane2.y > startElev + TAKEOFF_COMPLETE_AGL) {
    phase = 'AIRBORNE';
  }

  // --- rolling off a runway end (§5) ---------------------------------------
  if (plane2.onGround && !plane2.crashed && !runway) {
    if (phase === 'LANDED') {
      if (Math.abs(plane2.vx) > 15) {
        // Rolling off the runway end after touchdown at speed → crash. Brake!
        phase = 'CRASHED';
        crashReason = 'overrun';
        grade = null;
        plane2 = { ...plane2, crashed: true };
        events.push('crash');
      } else {
        // Trundling off the end at jogging pace just bumps into the grass —
        // extra drag stops the plane; the landing grade stands.
        const cut = GRASS_DRAG * dt;
        plane2 = { ...plane2, vx: Math.sign(plane2.vx) * Math.max(0, Math.abs(plane2.vx) - cut) };
      }
    } else if (phase === 'ROLLOUT') {
      if (terrainY > startElev + 0.5) {
        // Overrun into rising terrain → crash.
        phase = 'CRASHED';
        crashReason = 'overrun';
        plane2 = { ...plane2, crashed: true };
        events.push('crash');
      } else {
        // Flat overrun: bumpy grass drag penalty of 3 m/s² (§5).
        const cut = GRASS_DRAG * dt;
        plane2 = { ...plane2, vx: Math.sign(plane2.vx) * Math.max(0, Math.abs(plane2.vx) - cut) };
      }
    }
  }

  // --- settle to a full stop after landing ---------------------------------
  if (phase === 'LANDED' && plane2.onGround && Math.abs(plane2.vx) < STOP_SPEED) {
    plane2 = { ...plane2, vx: 0 };
  }

  return { plane: plane2, phase, t, bounced, touchdown, grade, crashReason, events };
}
