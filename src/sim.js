// sim.js — PURE. Whole-mission tick: physics + ground + wind + mission phase machine.
// Owned by: Dev A (sim core). This is THE seam between game logic and presentation.
// A full mission must be flyable headlessly in a test via repeated step() calls.

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

/**
 * Build initial sim state for a mission.
 * @param {object} level  mission/level object (DESIGN §8)
 * @param {object} plane  plane constants (with upgrades applied)
 * @returns {object} SimState positioned at start runway, engine idle
 */
export function createSimState(level, plane) {
  throw new Error('not implemented');
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
  throw new Error('not implemented');
}
