// hardcore-lib.mjs — Rey's headless playtest harness for SkyHaul.
// A competent feedback autopilot (adapted from test/sim.test.js) that handles
// wind (flies airspeed, not groundspeed), terrain lookahead, downdraft zones,
// steep-shelf approaches (m8), and fuel-economy cruise (m7).
import { createSimState, step } from '../src/sim.js';
import { windAt } from '../src/physics.js';
import { terrainHeightAt } from '../src/terrain.js';

export const DT = 1 / 60;

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export function stallSpeed(level, plane) {
  const mf = 1 + (level.cargoKg ?? 0) * (plane.MASS_FACTOR_PER_KG ?? 1 / 1000);
  return Math.sqrt((mf * plane.GRAVITY) / (plane.LIFT_K * plane.CL_MAX));
}

/**
 * Build a feedback pilot for a level+plane. Returns pilot(sim) → input.
 * opts (all sweepable):
 *   cruiseSpeed   target airspeed in cruise (default 34)
 *   approachSpeed target airspeed on final (default vStall*1.30)
 *   touchSpeed    target airspeed in the flare (default vStall*1.12)
 *   climbVy       max climb rate demanded (default 4)
 *   clearance     terrain clearance target in cruise (default 55)
 *   lookahead     terrain lookahead distance m (default 800)
 *   flareH        AGL to begin flare (default 4)
 *   flareVy       target sink in flare (default -0.45)
 *   flarePitch    base pitch attitude in flare (default 0.10)
 *   aimFrac       where on the runway to aim, fraction of length (default 1/3)
 *   maxSink       steepest commanded descent (default -3.4)
 *   holdS         sit at brakes for N seconds before rolling (gust-phase experiments)
 */
export function makePilot(level, plane, opts = {}) {
  const o = {
    cruiseSpeed: 34, climbVy: 4, clearance: 55, lookahead: 800,
    flareH: 4, flareVy: -0.45, flarePitch: 0.10, aimFrac: 1 / 3,
    maxSink: -3.4, holdS: 0, ...opts,
  };
  const vStall = stallSpeed(level, plane);
  o.approachSpeed = opts.approachSpeed ?? vStall * 1.30;
  o.touchSpeed = opts.touchSpeed ?? vStall * 1.12;
  const vRot = 1.22 * vStall;
  const windEnv = { baseX: level.wind?.baseX ?? 0, gustAmp: level.wind?.gustAmp ?? 0, zones: level.zones ?? [] };
  const aim = level.endRunway.x + level.endRunway.length * o.aimFrac;
  const aimElev = terrainHeightAt(level.terrain, level.endRunway.x);
  const startElev = terrainHeightAt(level.terrain, level.startRunway.x);

  const PITCH_DAMP = plane.PITCH_DAMP ?? 7.0;

  let mode = 'TAXI'; // TAXI → ROLL → FLY → APPROACH → FLARE

  function lookMax(x, from, to) {
    let m = -Infinity;
    for (let d = from; d <= to; d += 25) m = Math.max(m, terrainHeightAt(level.terrain, x + d));
    return m;
  }

  return function pilot(sim) {
    const p = sim.plane;
    const wind = windAt(windEnv, p.x, sim.t);
    const airVx = p.vx - wind.windX;
    const airVy = p.vy - wind.windY;
    const airspeed = Math.hypot(airVx, airVy);
    const flightDir = Math.atan2(airVy, airVx);
    const aoa = p.pitch - flightDir;
    const gs = Math.max(p.vx, 3);
    const distToAim = aim - p.x;
    const aglEnd = p.y - aimElev;

    // feedforward that holds the current AoA against the pitch damper
    const ff = clamp(PITCH_DAMP * aoa / plane.PITCH_RATE, -0.9, 0.9);
    const pitchTo = (target) => clamp(ff + (target - p.pitch) * 10, -1, 1);
    const throttleTo = (spdTarget) => clamp((spdTarget - airspeed) * 0.8, -1, 1);

    if (sim.phase === 'LANDED') {
      if (p.onGround) return { pitch: -1, throttleDelta: -1, brake: true };
      // bounced back into the air: re-flare
      return { pitch: pitchTo(clamp(o.flarePitch + 0.12 * (o.flareVy - p.vy), 0.02, 0.2)), throttleDelta: -1, brake: false };
    }

    if (mode === 'TAXI') {
      if (sim.t >= o.holdS) mode = 'ROLL';
      return { pitch: 0, throttleDelta: -1, brake: true };
    }

    if (mode === 'ROLL') {
      if (!p.onGround && p.y > startElev + 12) mode = 'FLY';
      if (p.onGround) {
        const wantPitch = airspeed >= vRot ? 0.20 : 0;
        return { pitch: clamp((wantPitch - p.pitch) * 12, -1, 1), throttleDelta: 1, brake: false };
      }
      // climb-out
      return { pitch: pitchTo(0.16), throttleDelta: 1, brake: false };
    }

    // --- approach/flare latching -----------------------------------------
    const reqSlope = (p.y - aimElev - 2) / Math.max(distToAim, 1);
    if (mode === 'FLY' && distToAim < 2500 && (reqSlope >= 0.05 || distToAim < 600)) mode = 'APPROACH';
    if (mode === 'APPROACH' && aglEnd < o.flareH && distToAim < 500) mode = 'FLARE';

    // stall guard applies everywhere in the air
    const stallGuard = airspeed < vStall + 1.2;

    if (mode === 'FLARE') {
      let pitchTarget = clamp(o.flarePitch + 0.12 * (o.flareVy - p.vy), 0.02, 0.20);
      const thr = airspeed < o.touchSpeed ? throttleTo(o.touchSpeed) : -1;
      return { pitch: pitchTo(pitchTarget), throttleDelta: thr, brake: false };
    }

    let vyTarget;
    let speedTarget;

    if (mode === 'APPROACH') {
      const t2a = distToAim / gs;
      vyTarget = clamp(-(p.y - aimElev - 1) / Math.max(t2a, 1), o.maxSink, 1.5);
      // terrain guard: never descend into a face (m8 cliff, m6 shelf)
      const guardY = lookMax(p.x, 30, 260) + 8;
      if (p.y < guardY) vyTarget = Math.max(vyTarget, clamp((guardY - p.y) * 0.3, 0.5, 3));
      // blend speed down as we near the strip
      speedTarget = distToAim > 500 ? o.approachSpeed : o.approachSpeed + (o.touchSpeed - o.approachSpeed) * (1 - distToAim / 500);
    } else {
      // CRUISE with altitude band terrain-following
      const ahead = lookMax(p.x, 40, o.lookahead);
      let desired = ahead + o.clearance;
      if (distToAim < 2200) desired = Math.max(desired, aimElev + 45); // don't duck below a high strip
      const floor = ahead + 25;
      if (p.y < floor) vyTarget = clamp((floor - p.y) * 0.2, 1.5, o.climbVy);
      else if (p.y < desired) vyTarget = clamp((desired - p.y) * 0.12, 0, o.climbVy);
      else vyTarget = clamp((desired - p.y) * 0.05, -2.2, 0);
      speedTarget = o.cruiseSpeed;
    }

    if (stallGuard) {
      return { pitch: pitchTo(Math.min(0.05, p.pitch)), throttleDelta: 1, brake: false };
    }

    const pitchTarget = clamp(0.05 + 0.085 * (vyTarget - p.vy), -0.20, 0.34);
    return { pitch: pitchTo(pitchTarget), throttleDelta: throttleTo(speedTarget), brake: false };
  };
}

/**
 * Fly a mission headlessly. Returns rich metrics.
 */
export function flyMission(level, plane, opts = {}, maxTicks = 60 * 1200) {
  const pilot = opts.pilot ?? makePilot(level, plane, opts);
  let sim = createSimState(level, plane);
  const windEnv = { baseX: level.wind?.baseX ?? 0, gustAmp: level.wind?.gustAmp ?? 0, zones: level.zones ?? [] };
  let liftoffX = null, takeoffCompleteT = null, minClear = Infinity, minFuel = Infinity;
  let touchdownT = null, minAirspeed = Infinity, flamedOut = false;
  let prevPhase = sim.phase;

  for (let i = 0; i < maxTicks; i++) {
    sim = step(sim, pilot(sim), level, plane, DT);
    const p = sim.plane;
    if (sim.events.includes('liftoff') && liftoffX === null) liftoffX = p.x;
    if (prevPhase === 'ROLLOUT' && sim.phase === 'AIRBORNE') takeoffCompleteT = sim.t;
    if (sim.events.includes('touchdown') && touchdownT === null && sim.phase === 'LANDED') touchdownT = sim.t;
    if (!p.onGround) {
      minClear = Math.min(minClear, p.y - terrainHeightAt(level.terrain, p.x));
      const w = windAt(windEnv, p.x, sim.t);
      minAirspeed = Math.min(minAirspeed, Math.hypot(p.vx - w.windX, p.vy - w.windY));
    }
    if (p.fuel <= 0) flamedOut = true;
    minFuel = Math.min(minFuel, p.fuel);
    prevPhase = sim.phase;
    if (sim.phase === 'CRASHED') break;
    if (sim.phase === 'LANDED' && p.onGround && p.vx === 0) break;
  }

  const outcome = sim.phase === 'LANDED' && sim.plane.vx === 0 ? 'LANDED'
    : sim.phase === 'CRASHED' ? 'CRASHED' : 'TIMEOUT';

  return {
    outcome,
    crashReason: sim.crashReason,
    score: sim.grade?.score ?? null,
    stars: sim.grade?.stars ?? 0,
    breakdown: sim.grade?.breakdown ?? null,
    touchdown: sim.touchdown,
    bounced: sim.bounced,
    timeS: sim.t,
    touchdownT,
    takeoffRollM: liftoffX !== null ? liftoffX - level.startRunway.x : null,
    takeoffCompleteT,
    minClear: Number.isFinite(minClear) ? minClear : null,
    minFuel,
    minAirspeed: Number.isFinite(minAirspeed) ? minAirspeed : null,
    flamedOut,
    fuelLeft: sim.plane.fuel,
    stopX: sim.plane.x,
  };
}

export function fmt(r) {
  if (r.outcome !== 'LANDED') return `${r.outcome} (${r.crashReason ?? 'timeout'}) t=${r.timeS.toFixed(0)}s minClear=${r.minClear?.toFixed(1)} fuel=${r.fuelLeft.toFixed(1)}`;
  const td = r.touchdown;
  return `LANDED score=${r.score} (${'★'.repeat(r.stars)}) t=${r.timeS.toFixed(0)}s td[vy=${td.vy.toFixed(2)} gs=${td.vx.toFixed(1)} pitch=${(td.pitch).toFixed(3)} x=${td.x.toFixed(0)}]${r.bounced ? ' BOUNCED' : ''} fuelLeft=${r.fuelLeft.toFixed(1)}L roll=${r.takeoffRollM?.toFixed(0)}m minClear=${r.minClear?.toFixed(1)}m`;
}
