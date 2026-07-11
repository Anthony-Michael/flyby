// data/planes.js — data. Plane constant-sets + upgrade definitions. docs/DESIGN.md §3, §7.
// Owned by: Dev B (meta game). Physics reads these via the `plane` param — no imports needed.

/**
 * Each plane: full physics constants (DESIGN §3 names) + display info.
 * MVP ships Kestrel only; Mule/Swift included as data (hangar can hide them).
 */
export const PLANES = {
  // kestrel: { id, name, cost, GRAVITY: 9.8, MAX_THRUST: 6.0, LIFT_K: 0.0215, CL_SLOPE: 5.0,
  //            CL_MAX: 1.4, STALL_AOA: 0.28, DRAG_P: 0.0022, DRAG_I: 0.0025, PITCH_RATE: 1.6,
  //            FUEL_BURN_IDLE: 0.02, FUEL_BURN_MAX: 0.15, ROLL_FRICTION: 0.6, BRAKE_DECEL: 3.5,
  //            MASS_FACTOR_PER_KG: 1/1000, tankL: 40, ... }
};

/** Upgrade defs: id, name, cost, applies(planeConstants) → new constants. DESIGN §7. */
export const UPGRADES = {};

/**
 * Plane constants with a save's owned upgrades applied. PURE.
 * @param {string} planeId
 * @param {object} save
 * @returns {object} effective plane constants
 */
export function effectivePlane(planeId, save) {
  throw new Error('not implemented');
}
