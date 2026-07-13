// qa-lib.mjs — shared helpers for Bex's headless abuse scripts.
import { createSimState, step } from '../src/sim.js';
import { PLANES, UPGRADES, effectivePlane } from '../src/data/planes.js';
import { MISSIONS, freeContract } from '../src/data/missions.js';

export const DT = 1 / 60;
export const kestrel = PLANES.kestrel;
export const m1 = MISSIONS.find((m) => m.id === 'm1');

export { createSimState, step, PLANES, UPGRADES, effectivePlane, MISSIONS, freeContract };

export const IDLE = { pitch: 0, throttleDelta: 0, brake: false };

export function stepN(sim, level, plane, n, inputFn) {
  for (let i = 0; i < n; i++) {
    sim = step(sim, typeof inputFn === 'function' ? inputFn(i, sim) : (inputFn ?? IDLE), level, plane, DT);
    if (sim.phase === 'CRASHED') break;
  }
  return sim;
}

export function badNums(obj, path = '') {
  const bad = [];
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`${path}${k}=${v}`);
    else if (v && typeof v === 'object') bad.push(...badNums(v, `${path}${k}.`));
  }
  return bad;
}

// Force an airborne sim just above the given x with chosen contact params, then
// step until ground contact. Uses only public state shape (the sim contract).
export function forceTouchdown(level, plane, { x, vy, vx, pitch }) {
  let sim = createSimState(level, plane);
  sim = {
    ...sim,
    phase: 'AIRBORNE',
    plane: { ...sim.plane, x: x - vx * DT, y: 20 + Math.abs(vy) * DT, vx, vy, pitch, onGround: false, throttle: 0 },
  };
  // hold pitch & speed as steady as physics allows for the last tick(s)
  for (let i = 0; i < 240; i++) {
    const prev = sim;
    sim = step(sim, IDLE, level, plane, DT);
    // restore intended contact params each tick until contact so drag/gravity don't drift them
    if (sim.plane.onGround || sim.phase === 'CRASHED' || sim.phase === 'LANDED') {
      return { sim, prev };
    }
    sim = { ...sim, plane: { ...sim.plane, vx, vy, pitch } };
  }
  return { sim, prev: sim };
}
