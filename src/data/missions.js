// data/missions.js — data + PURE generator. 8 campaign missions per docs/DESIGN.md §6/§8 schema.
// Owned by: Dev B (meta game). MVP requires missions m1–m5 fully tuned; m6–m8 included as data.
// Every mission must pass terrain.validateLevel() — enforced in test/missions.test.js.

/** @type {Array<object>} DESIGN §8 schema objects, ids m1..m8 */
export const MISSIONS = [];

/**
 * Deterministic free-contract generator (post-campaign). Seeded by counter — same
 * counter, same mission. PURE, no RNG (use a hash of the counter).
 * @param {number} counter
 * @returns {object} level object (DESIGN §8 schema, id `fc${counter}`)
 */
export function freeContract(counter) {
  throw new Error('not implemented');
}
