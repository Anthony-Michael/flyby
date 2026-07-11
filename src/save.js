// save.js — IMPURE (thin). localStorage wrapper around migrate.js.
// Owned by: Dev B (meta game). Key: 'skyhaul.save'. Write on debrief + purchase only.
// Guards `typeof localStorage === 'undefined'` so importing under node never crashes.

import { migrate } from './migrate.js';

const KEY = 'skyhaul.save';

/** @returns {object} valid save (migrated / fresh on corruption) */
export function loadSave() {
  if (typeof localStorage === 'undefined') return migrate(null);
  try {
    return migrate(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    return migrate(null); // corrupt JSON → fresh save, never a crash
  }
}

/** @param {object} save */
export function persistSave(save) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // storage full / disabled — persisting is best-effort by design
  }
}
