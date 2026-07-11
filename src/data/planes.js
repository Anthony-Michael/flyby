// data/planes.js — data. Plane constant-sets + upgrade definitions. docs/DESIGN.md §3, §7.
// Owned by: Dev B (meta game). Physics reads these via the `plane` param — no imports needed.

/**
 * Each plane: full physics constants (DESIGN §3 names) + display info.
 * MVP ships Kestrel only; Mule/Swift included as data (hangar can hide them).
 *
 * Beyond the §3 physics constants, each plane carries the §5 crash tolerances
 * (CRASH_VY, CRASH_VX) and the rough-strip drag penalty (ROUGH_DRAG) so that
 * upgrades like Tundra tires can modify them via applies() — landing/ground
 * code reads whatever plane object it is handed.
 *
 * Derived-feel notes (§7):
 * - Mule: "stall 2 m/s higher" → stall = sqrt(GRAVITY / (LIFT_K * CL_MAX)) = 20.0 m/s
 *   with LIFT_K = 9.8 / (20² × 1.4) = 0.0175. Cargo penalty halved via /2000.
 * - Swift: DRAG_P −20% → 0.0022 × 0.8 = 0.00176 (cruise ~52 m/s at ~58% throttle).
 */
export const PLANES = {
  kestrel: {
    id: 'kestrel',
    name: 'Kestrel',
    cost: 0,
    desc: 'The honest trainer.',
    GRAVITY: 9.8,
    MAX_THRUST: 6.0,
    LIFT_K: 0.0215,
    CL_SLOPE: 5.0,
    CL_MAX: 1.4,
    STALL_AOA: 0.28,
    DRAG_P: 0.0022,
    DRAG_I: 0.0025,
    PITCH_RATE: 1.6,
    FUEL_BURN_IDLE: 0.02,
    FUEL_BURN_MAX: 0.15,
    ROLL_FRICTION: 0.6,
    BRAKE_DECEL: 3.5,
    MASS_FACTOR_PER_KG: 1 / 1000,
    tankL: 40,
    CRASH_VY: 2.5,
    CRASH_VX: 30,
    ROUGH_DRAG: 3.0,
  },
  mule: {
    id: 'mule',
    name: 'Mule',
    cost: 1200,
    desc: 'Cargo hauler. Half the load penalty, stalls 2 m/s higher, lands hot.',
    GRAVITY: 9.8,
    MAX_THRUST: 7.5,
    LIFT_K: 0.0175, // stall 20.0 m/s (Kestrel + 2)
    CL_SLOPE: 5.0,
    CL_MAX: 1.4,
    STALL_AOA: 0.28,
    DRAG_P: 0.0022,
    DRAG_I: 0.0025,
    PITCH_RATE: 1.1,
    FUEL_BURN_IDLE: 0.02,
    FUEL_BURN_MAX: 0.15,
    ROLL_FRICTION: 0.6,
    BRAKE_DECEL: 3.5,
    MASS_FACTOR_PER_KG: 1 / 2000, // cargo penalty halved
    tankL: 60,
    CRASH_VY: 2.5,
    CRASH_VX: 30,
    ROUGH_DRAG: 3.0,
  },
  swift: {
    id: 'swift',
    name: 'Swift',
    cost: 2400,
    desc: 'Fast and twitchy. For URGENT runs and contract scoring.',
    GRAVITY: 9.8,
    MAX_THRUST: 8.5,
    LIFT_K: 0.0215,
    CL_SLOPE: 5.0,
    CL_MAX: 1.4,
    STALL_AOA: 0.28,
    DRAG_P: 0.00176, // −20%
    DRAG_I: 0.0025,
    PITCH_RATE: 2.2,
    FUEL_BURN_IDLE: 0.02,
    FUEL_BURN_MAX: 0.15,
    ROLL_FRICTION: 0.6,
    BRAKE_DECEL: 3.5,
    MASS_FACTOR_PER_KG: 1 / 1000,
    tankL: 35,
    CRASH_VY: 2.5,
    CRASH_VX: 30,
    ROUGH_DRAG: 3.0,
  },
};

/** Upgrade defs: id, name, cost, applies(planeConstants) → new constants. DESIGN §7. */
export const UPGRADES = {
  tires: {
    id: 'tires',
    name: 'Tundra tires',
    cost: 300,
    desc: 'Crash tolerance vy −2.5 → −3.2 m/s; rough-strip drag penalty halved.',
    applies: (c) => ({ ...c, CRASH_VY: 3.2, ROUGH_DRAG: c.ROUGH_DRAG / 2 }),
  },
  engine: {
    id: 'engine',
    name: 'Engine tune',
    cost: 500,
    desc: 'MAX_THRUST +15%.',
    applies: (c) => ({ ...c, MAX_THRUST: c.MAX_THRUST * 1.15 }),
  },
  tank: {
    id: 'tank',
    name: 'Long-range tank',
    cost: 400,
    desc: 'Tank +50%.',
    applies: (c) => ({ ...c, tankL: c.tankL * 1.5 }),
  },
};

/**
 * Plane constants with a save's owned upgrades applied. PURE.
 * @param {string} planeId
 * @param {object} save
 * @returns {object} effective plane constants
 */
export function effectivePlane(planeId, save) {
  const base = PLANES[planeId];
  if (!base) throw new Error(`unknown plane: ${planeId}`);
  const owned = (save && save.upgrades && save.upgrades[planeId]) || [];
  let out = { ...base };
  for (const uid of owned) {
    const up = UPGRADES[uid];
    if (up) out = up.applies(out);
  }
  return out;
}
