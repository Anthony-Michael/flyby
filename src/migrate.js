// migrate.js — PURE. Save-shape migration + fresh save. docs/DESIGN.md §7.
// Owned by: Dev B (meta game).

export const SAVE_VERSION = 1;

/** @returns {object} a brand-new v-current save (DESIGN §7 shape) */
export function freshSave() {
  throw new Error('not implemented');
}

/**
 * Migrate any older/unknown save shape to current. Corrupt/missing → freshSave().
 * Never throws.
 * @param {unknown} raw  parsed JSON (or anything)
 * @returns {object} valid current-version save
 */
export function migrate(raw) {
  throw new Error('not implemented');
}
