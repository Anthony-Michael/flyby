// migrate.js — PURE. Save-shape migration + fresh save. docs/DESIGN.md §7.
// Owned by: Dev B (meta game).

export const SAVE_VERSION = 1;

/** @returns {object} a brand-new v-current save (DESIGN §7 shape) */
export function freshSave() {
  return {
    v: SAVE_VERSION,
    money: 0,
    missionsCompleted: {},
    planesOwned: ['kestrel'],
    activePlane: 'kestrel',
    upgrades: { kestrel: [] },
    freeContractCounter: 0,
    settings: { shake: true },
  };
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Normalize a v1-shaped save: fill any missing/broken fields with fresh
 * defaults, deep-copy everything (never returns references into `raw`).
 * A well-formed v1 save round-trips unchanged (deep-equal passthrough).
 */
function normalizeV1(raw) {
  const fresh = freshSave();

  const planesOwned =
    Array.isArray(raw.planesOwned) && raw.planesOwned.some((p) => typeof p === 'string')
      ? raw.planesOwned.filter((p) => typeof p === 'string')
      : [...fresh.planesOwned];
  if (!planesOwned.includes('kestrel')) planesOwned.unshift('kestrel');

  const activePlane =
    typeof raw.activePlane === 'string' && planesOwned.includes(raw.activePlane)
      ? raw.activePlane
      : 'kestrel';

  const missionsCompleted = {};
  if (isObject(raw.missionsCompleted)) {
    for (const [id, entry] of Object.entries(raw.missionsCompleted)) {
      if (isObject(entry) && isNum(entry.bestScore) && isNum(entry.stars)) {
        missionsCompleted[id] = { bestScore: entry.bestScore, stars: entry.stars };
      }
    }
  }

  const upgrades = {};
  if (isObject(raw.upgrades)) {
    for (const [planeId, list] of Object.entries(raw.upgrades)) {
      if (Array.isArray(list)) {
        upgrades[planeId] = list.filter((u) => typeof u === 'string');
      }
    }
  }
  for (const planeId of planesOwned) {
    if (!Array.isArray(upgrades[planeId])) upgrades[planeId] = [];
  }

  return {
    v: SAVE_VERSION,
    money: isNum(raw.money) ? raw.money : fresh.money,
    missionsCompleted,
    planesOwned,
    activePlane,
    upgrades,
    freeContractCounter: isNum(raw.freeContractCounter) ? raw.freeContractCounter : 0,
    settings: {
      ...fresh.settings,
      ...(isObject(raw.settings) ? raw.settings : {}),
    },
  };
}

/**
 * Migrate any older/unknown save shape to current. Corrupt/missing → freshSave().
 * Never throws.
 * @param {unknown} raw  parsed JSON (or anything)
 * @returns {object} valid current-version save
 */
export function migrate(raw) {
  try {
    if (!isObject(raw)) return freshSave();
    if (raw.v === SAVE_VERSION) return normalizeV1(raw);
    // Future migrations chain here: v1 → v2 → ... → current.
    return freshSave();
  } catch {
    return freshSave();
  }
}
