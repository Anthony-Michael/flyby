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
  if (!Array.isArray(points) || points.length === 0) return 0;
  if (x <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1];
    const [x2, y2] = points[i];
    if (x <= x2) {
      if (x2 === x1) return y2; // duplicate x: take the later point
      return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
    }
  }
  return last[1]; // unreachable, but explicit
}

const FLAT_EPS = 1e-9;

/**
 * Validate a level object (DESIGN §8 schema). Returns list of problems, [] if valid.
 * Checks: terrain flat across runway spans, start < end runway, terrain covers
 * both runways, points sorted, required fields present.
 * @param {object} level
 * @returns {string[]} problems
 */
export function validateLevel(level) {
  const problems = [];
  if (level === null || typeof level !== 'object') {
    return ['level is not an object'];
  }

  if (typeof level.id !== 'string' || level.id.length === 0) {
    problems.push('missing or invalid "id"');
  }

  // Terrain
  const terrain = level.terrain;
  let terrainOk = false;
  if (!Array.isArray(terrain) || terrain.length < 2) {
    problems.push('"terrain" must be an array of at least 2 [x, elevation] points');
  } else {
    terrainOk = true;
    for (let i = 0; i < terrain.length; i++) {
      const p = terrain[i];
      if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
        problems.push(`terrain point ${i} is not a finite [x, elevation] pair`);
        terrainOk = false;
      }
    }
    if (terrainOk) {
      for (let i = 1; i < terrain.length; i++) {
        if (terrain[i][0] < terrain[i - 1][0]) {
          problems.push(`terrain points not sorted by x at index ${i}`);
          terrainOk = false;
        }
      }
    }
  }

  // Runways
  const checkRunway = (rw, name) => {
    if (rw === null || typeof rw !== 'object' || !Number.isFinite(rw.x) || !Number.isFinite(rw.length) || rw.length <= 0) {
      problems.push(`missing or invalid "${name}" (needs finite x and positive length)`);
      return false;
    }
    return true;
  };
  const startOk = checkRunway(level.startRunway, 'startRunway');
  const endOk = checkRunway(level.endRunway, 'endRunway');

  if (startOk && endOk) {
    if (level.startRunway.x + level.startRunway.length > level.endRunway.x) {
      problems.push('startRunway must end before endRunway begins');
    }
  }

  if (terrainOk) {
    const xMin = terrain[0][0];
    const xMax = terrain[terrain.length - 1][0];
    for (const [rw, name] of [
      [startOk ? level.startRunway : null, 'startRunway'],
      [endOk ? level.endRunway : null, 'endRunway'],
    ]) {
      if (!rw) continue;
      const a = rw.x;
      const b = rw.x + rw.length;
      if (a < xMin || b > xMax) {
        problems.push(`terrain does not cover ${name} span [${a}, ${b}]`);
        continue;
      }
      // Flatness: elevation identical at span ends and at every control point inside the span.
      const elev = terrainHeightAt(terrain, a);
      const samples = [terrainHeightAt(terrain, b)];
      for (const [px, py] of terrain) {
        if (px > a && px < b) samples.push(py);
      }
      if (samples.some((e) => Math.abs(e - elev) > FLAT_EPS)) {
        problems.push(`terrain is not flat across ${name} span [${a}, ${b}]`);
      }
    }
  }

  // Optional numeric fields
  if (level.cargoKg !== undefined && level.cargoKg !== null && (!Number.isFinite(level.cargoKg) || level.cargoKg < 0)) {
    problems.push('"cargoKg" must be a non-negative finite number');
  }
  if (level.fuelL !== undefined && level.fuelL !== null && (!Number.isFinite(level.fuelL) || level.fuelL <= 0)) {
    problems.push('"fuelL" must be a positive finite number');
  }

  // Zones (optional)
  if (level.zones !== undefined && level.zones !== null) {
    if (!Array.isArray(level.zones)) {
      problems.push('"zones" must be an array');
    } else {
      level.zones.forEach((z, i) => {
        if (z === null || typeof z !== 'object' || typeof z.kind !== 'string'
          || !Number.isFinite(z.x) || !Number.isFinite(z.width) || z.width <= 0
          || !Number.isFinite(z.vy)) {
          problems.push(`zone ${i} is invalid (needs kind, finite x, positive width, finite vy)`);
        }
      });
    }
  }

  return problems;
}
