// terrain.js — PURE. Terrain elevation lookup + level validation.
// Owned by: Dev A (sim core). See docs/DESIGN.md §8.

/**
 * Linear interpolation over [[x, elevation], ...] control points.
 * Collision/physics use THIS (renderer may smooth visually).
 * @param {Array<[number,number]>} points  sorted by x
 * @param {number} x
 * @returns {number} elevation (clamps to first/last point beyond ends)
 */
export function terrainHeightAt(points, x) {
  throw new Error('not implemented');
}

/**
 * Validate a level object (DESIGN §8 schema). Returns list of problems, [] if valid.
 * Checks: terrain flat across runway spans, start < end runway, terrain covers
 * both runways, points sorted, required fields present.
 * @param {object} level
 * @returns {string[]} problems
 */
export function validateLevel(level) {
  throw new Error('not implemented');
}
