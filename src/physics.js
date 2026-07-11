// physics.js — PURE. Flight model: stepPlane, resolveGround, windAt.
// Owned by: Dev A (sim core). See docs/DESIGN.md §3 for equations & constants.
// Rule: no DOM, no canvas, no Date/RNG. Deterministic given inputs.

/**
 * Plane state shape (the contract — do not add/rename fields without lead approval):
 * { x, y, vx, vy, pitch, throttle, fuel, onGround, braking, crashed }
 * Units: meters, seconds, radians. +pitch = nose up.
 */

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
  throw new Error('not implemented');
}

/**
 * Ground contact resolution. Called by sim after stepPlane.
 * @param {object} state     plane state
 * @param {number} terrainY  ground elevation at state.x
 * @param {object|null} runway  runway span {x, length, elevation} if over one, else null
 * @returns {{ state: object, event: null|'touchdown'|'crash'|'liftoff' }}
 */
export function resolveGround(state, terrainY, runway) {
  throw new Error('not implemented');
}

/**
 * Deterministic wind at position/time. No RNG. DESIGN §3.
 * @param {object} env  { baseX, gustAmp, zones: [{kind,x,width,vy}] }
 * @param {number} x
 * @param {number} t   elapsed sim time, s
 * @returns {{ windX: number, windY: number }}
 */
export function windAt(env, x, t) {
  throw new Error('not implemented');
}
