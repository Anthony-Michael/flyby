// save.js — IMPURE (thin). localStorage wrapper around migrate.js.
// Owned by: Dev B (meta game). Key: 'skyhaul.save'. Write on debrief + purchase only.

import { migrate } from './migrate.js';

const KEY = 'skyhaul.save';

/** @returns {object} valid save (migrated / fresh on corruption) */
export function loadSave() {
  throw new Error('not implemented');
}

/** @param {object} save */
export function persistSave(save) {
  throw new Error('not implemented');
}
