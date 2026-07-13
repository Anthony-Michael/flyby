// humanPilot.js — a human-imperfect pilot controller for headless playtesting.
// Models: perception delay (acts on stale state), discrete decision cadence,
// tri-state key inputs (full up / neutral / full down, like real key holds),
// overcorrection gain, late flare, forgotten brakes, post-touchdown flare-hold
// (bounce risk). All variation is seeded (mulberry32) — fully deterministic.

import { windAt } from '../src/physics.js';
import { terrainHeightAt } from '../src/terrain.js';
import { mulberry32 } from './prng.js';

// ---------------------------------------------------------------------------
// Skill profiles ("Casey" at three warm-up levels)
// ---------------------------------------------------------------------------
export const SKILLS = {
  // Never played before. Full throttle everywhere, reacts late, flares at the
  // last second, comes in hot, often forgets the brakes exist.
  firstTimer: {
    reactionDelayS: 0.30, decisionS: 0.28,
    climbPitch: 0.24, climbVy: 2.5,
    cruiseSpeed: 38,
    approachDist: 500, maxDescent: 3.0, approachSpeed: 28,
    flareAGL: 2.2, flarePitch: 0.13,
    deadband: 0.045, gain: 1.8,
    lookAheadM: 350, terrainMargin: 25,
    rotateErrAmp: 3.0,
    brakeDelayS: 2.5, brakeNeverProb: 0.35,
    holdFlareS: 0.45,
  },
  // Crashed once or twice, has the idea now. Still sloppy.
  secondTry: {
    reactionDelayS: 0.22, decisionS: 0.20,
    climbPitch: 0.20, climbVy: 2.4,
    cruiseSpeed: 34,
    approachDist: 700, maxDescent: 2.6, approachSpeed: 25.5,
    flareAGL: 4.0, flarePitch: 0.12,
    deadband: 0.035, gain: 1.35,
    lookAheadM: 500, terrainMargin: 40,
    rotateErrAmp: 1.5,
    brakeDelayS: 1.2, brakeNeverProb: 0.10,
    holdFlareS: 0.25,
  },
  // Ten minutes in, knows the plane. A decent casual player on a good day.
  warmedUp: {
    reactionDelayS: 0.16, decisionS: 0.13,
    climbPitch: 0.17, climbVy: 2.2,
    cruiseSpeed: 32,
    approachDist: 900, maxDescent: 2.2, approachSpeed: 23,
    flareAGL: 6.0, flarePitch: 0.11,
    deadband: 0.025, gain: 1.0,
    lookAheadM: 700, terrainMargin: 55,
    rotateErrAmp: 0.8,
    brakeDelayS: 0.5, brakeNeverProb: 0,
    holdFlareS: 0.10,
  },
  // Reference ceiling: analog stick, zero delay, per-tick decisions. Not a
  // human — used to separate "controller is dumb" from "game is hard".
  robot: {
    reactionDelayS: 0, decisionS: 1 / 60,
    climbPitch: 0.17, climbVy: 2.2,
    cruiseSpeed: 32,
    approachDist: 620, maxDescent: 2.0, approachSpeed: 25,
    flareAGL: 6.0, flarePitch: 0.11,
    deadband: 0, gain: 1.0,
    lookAheadM: 800, terrainMargin: 55,
    rotateErrAmp: 0,
    brakeDelayS: 0.1, brakeNeverProb: 0,
    holdFlareS: 0,
    analog: true, noJitter: true,
  },
};

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function maxTerrainAhead(terrain, x0, lookAhead) {
  let m = -Infinity;
  for (let x = x0; x <= x0 + lookAhead; x += 50) {
    const h = terrainHeightAt(terrain, x);
    if (h > m) m = h;
  }
  return m;
}

/**
 * Create a stateful human pilot. Call pilot.next(sim, level, plane, dt) each
 * tick; returns a { pitch, throttleDelta, brake } input object.
 * @param {object} base   one of SKILLS
 * @param {number} seed   deterministic variation seed
 */
export function createHumanPilot(base, seed) {
  const rnd = mulberry32(seed * 2654435761 + 1);
  const jit = (v, frac) => (base.noJitter ? v : v * (1 + (rnd() * 2 - 1) * frac));

  // This individual run's parameters (seeded human variation).
  const P = {
    ...base,
    reactionDelayS: jit(base.reactionDelayS, 0.25),
    decisionS: jit(base.decisionS, 0.20),
    climbPitch: jit(base.climbPitch, 0.15),
    cruiseSpeed: jit(base.cruiseSpeed, 0.10),
    approachDist: jit(base.approachDist, 0.15),
    maxDescent: jit(base.maxDescent, 0.15),
    approachSpeed: jit(base.approachSpeed, 0.08),
    flareAGL: jit(base.flareAGL, 0.30),
    flarePitch: jit(base.flarePitch, 0.15),
    gain: jit(base.gain, 0.20),
    terrainMargin: jit(base.terrainMargin, 0.20),
    rotateErr: base.noJitter ? 0 : (rnd() * 2 - 1) * base.rotateErrAmp,
    brakeDelayS: rnd() < base.brakeNeverProb ? Infinity : jit(base.brakeDelayS, 0.5),
    holdFlareS: jit(base.holdFlareS, 0.5),
  };

  // Controller state (the "hands").
  let keyPitch = 0;      // -1 | 0 | 1 (or analog for robot)
  let keyThrottle = 0;   // -1 | 0 | 1
  let keyBrake = false;
  let decisionTimer = Infinity; // decide immediately on first tick
  let touchdownAt = null;       // sim.t of first landing touchdown
  const buffer = [];            // perception delay ring

  function decide(p, sim, level, plane) {
    const windEnv = { baseX: level.wind?.baseX ?? 0, gustAmp: level.wind?.gustAmp ?? 0, zones: level.zones ?? [] };
    const wind = windAt(windEnv, p.x, p.t);
    const airspeed = Math.hypot(p.vx - wind.windX, p.vy - wind.windY);
    const terrY = terrainHeightAt(level.terrain, p.x);
    const agl = p.y - terrY;

    const mf = 1 + (level.cargoKg ?? 0) * (plane.MASS_FACTOR_PER_KG ?? 1 / 1000);
    const vStall = Math.sqrt((mf * plane.GRAVITY) / (plane.LIFT_K * plane.CL_MAX));
    const vRotate = 1.22 * vStall;

    // Aim a quarter of the way in: float always eats forward margin, never gives it back.
    const aim = level.endRunway.x + level.endRunway.length / 4;
    const dist = aim - p.x;

    // --- after touchdown: roll-out ---------------------------------------
    if (sim.phase === 'LANDED' && p.onGround) {
      const since = touchdownAt == null ? 0 : sim.t - touchdownAt;
      keyPitch = since < P.holdFlareS ? 1 : 0; // sloppy: still hauling back on the stick
      keyThrottle = -1;
      keyBrake = since >= P.brakeDelayS;
      return;
    }

    // --- takeoff roll ------------------------------------------------------
    if (p.onGround && sim.phase === 'ROLLOUT') {
      keyThrottle = 1;
      keyBrake = false;
      if (airspeed >= vRotate + P.rotateErr) {
        keyPitch = p.pitch < P.climbPitch - P.deadband ? 1 : 0;
      } else {
        keyPitch = 0;
      }
      return;
    }

    // --- airborne ------------------------------------------------------------
    let vyT;
    let speedT;
    let flare = false;

    if (dist > P.approachDist) {
      // Cruise/climb: stay terrainMargin above the tallest ground you can see.
      const desiredY = maxTerrainAhead(level.terrain, p.x, P.lookAheadM) + P.terrainMargin;
      // A hill filling the windshield gets a firewall climb, not a polite one —
      // but only with speed in hand; heavy and slow, you stay patient (m3's
      // briefing says as much) or you mush.
      if (p.y < desiredY - 25 && airspeed > vStall * 1.35) vyT = P.climbVy * 2.2;
      else if (p.y < desiredY) vyT = P.climbVy;
      else if (p.y > desiredY + 40) vyT = -1.5;
      else vyT = 0;
      speedT = P.cruiseSpeed;
    } else {
      // Approach: fly an altitude profile, not a blind slope. Glide from ~55 m
      // over the strip elevation down to the aim point, but NEVER descend below
      // terrain you can see between here and the strip (real players have eyes;
      // the old slope-only planner flew into every hill short of the runway).
      const endElev = terrainHeightAt(level.terrain, level.endRunway.x);
      const slopeY = endElev + 2 + Math.max(0, dist / P.approachDist) * 55;
      const clearY = maxTerrainAhead(level.terrain, p.x, Math.max(60, Math.min(dist, 500))) + 10;
      const desiredY = Math.max(slopeY, clearY);
      vyT = clamp((desiredY - p.y) * 0.6, -P.maxDescent, P.climbVy);
      speedT = P.approachSpeed;
      // Flare on height above the STRIP once close (local AGL flickers over the
      // last hills and triggers phantom flares); on local AGL while further out.
      const nearStrip = dist < level.endRunway.length * 1.6;
      const flareHgt = nearStrip ? p.y - endElev : agl;
      if (flareHgt < P.flareAGL) {
        // Humans don't hold the flare forever: casuals settle for a firm-but-
        // fine touchdown (−0.8) rather than floating half the strip chasing a
        // grease, and once the zone is passing underneath they put it down.
        vyT = dist < 0 ? -1.4 : -0.8;
        speedT = P.approachSpeed - 4;
        flare = true;
      }
      if (dist <= 0) vyT = Math.min(vyT, -P.maxDescent * 0.8); // overshot — push down, no go-around
    }

    let pitchT = clamp(0.06 + 0.09 * P.gain * (vyT - p.vy), -0.15, 0.34);
    if (flare) pitchT = Math.max(pitchT, P.flarePitch);
    // Stall respect: when the HUD's STALL warning is flashing, every human drops
    // the nose (except in the flare, where slow is the point).
    if (airspeed < vStall + 2 && agl > 12) pitchT = Math.min(pitchT, 0.04);

    if (P.analog) {
      keyPitch = clamp((pitchT - p.pitch) * 12, -1, 1);
      keyThrottle = clamp((speedT - airspeed) * 0.8, -1, 1);
    } else {
      // Keyboard players micro-tap: the desired correction becomes a key held
      // for a FRACTION of the decision interval (pulse width ∝ error), not a
      // full-interval hold — a held ArrowUp is ~12°/decision, far too coarse
      // to control ±0.5 m/s of sink in the flare.
      keyPitch = clamp((pitchT - p.pitch) * 8, -1, 1);
      if (Math.abs(pitchT - p.pitch) < P.deadband) keyPitch = 0;
      keyThrottle = airspeed < speedT - 1 ? 1 : airspeed > speedT + 1.5 ? -1 : 0;
    }
    if (flare) keyThrottle = -1; // chop throttle in the flare
    keyBrake = false;
  }

  return {
    params: P,
    next(sim, level, plane, dt) {
      // Note first touchdown (the player hears/feels it immediately).
      if (touchdownAt == null && sim.phase === 'LANDED') touchdownAt = sim.t;

      // Perception delay: act on the state from reactionDelayS ago.
      buffer.push({ ...sim.plane, t: sim.t });
      const delaySteps = Math.round(P.reactionDelayS / dt);
      const idx = Math.max(0, buffer.length - 1 - delaySteps);
      const perceived = buffer[idx];
      if (buffer.length > 600) buffer.splice(0, buffer.length - 300);

      decisionTimer += dt;
      if (decisionTimer >= P.decisionS) {
        decisionTimer = 0;
        decide(perceived, sim, level, plane);
      }
      // Tri-state keys with pulse-width tapping: |keyPitch| ∈ [0,1] is the duty
      // cycle — the key is DOWN for that fraction of each decision interval and
      // released for the rest, like a human tapping the arrow. Analog (robot)
      // passes through untouched.
      let outPitch = keyPitch;
      if (!P.analog && keyPitch !== 0 && Math.abs(keyPitch) < 1) {
        const phase = decisionTimer / P.decisionS;
        outPitch = phase < Math.abs(keyPitch) ? Math.sign(keyPitch) : 0;
      }
      return { pitch: outPitch, throttleDelta: keyThrottle, brake: keyBrake };
    },
  };
}
