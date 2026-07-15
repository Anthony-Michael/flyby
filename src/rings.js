// rings.js — PURE. Flight-path rings: guide rings that trace the ideal route on
// tutorial missions, and bonus rings worth money on later ones.
// A ring is { x, y, r, kind: 'guide'|'bonus' }. Hit = plane crosses the ring's x
// while within r of its center (checked by the shell each tick via ringHit).

import { terrainHeightAt } from './terrain.js';

export const BONUS_PER_RING = 10; // $ per bonus ring collected

/**
 * Ring course for a level. PURE, derived entirely from level data.
 * - m1/m2 (`guide`): rings along the nominal path — climb-out, cruise legs
 *   terrain-following at a safe height, then a straight glide slope into the
 *   touchdown zone. Fly ring to ring and you land.
 * - m3+ (`bonus`): three rings on the cruise legs, worth $ each — a reason to
 *   fly a line rather than drone along.
 * @param {object} level  DESIGN §8 level object
 * @returns {Array<{x:number, y:number, r:number, kind:string}>}
 */
export function ringsForLevel(level) {
  const guide = level.id === 'm1' || level.id === 'm2';
  const start = level.startRunway;
  const end = level.endRunway;
  const startElev = terrainHeightAt(level.terrain, start.x);
  const endElev = terrainHeightAt(level.terrain, end.x);
  const aimX = end.x + end.length / 3; // touchdown zone
  const climbX = start.x + start.length + 150; // first ring shortly after the strip
  const finalX = end.x - 250; // last ring on short final

  const rings = [];
  const cruiseH = 55; // nominal AGL for the cruise legs

  if (guide) {
    // climb-out ring
    rings.push(ring(level, climbX, startElev + 30, 26, 'guide'));
    // cruise rings: evenly spaced, terrain-following
    const legStart = climbX + 250;
    const n = 3;
    for (let i = 0; i < n; i++) {
      const x = legStart + ((finalX - 300 - legStart) * (i + 0.5)) / n;
      rings.push(ring(level, x, terrainHeightAt(level.terrain, x) + cruiseH, 24, 'guide'));
    }
    // glide-slope rings: straight line down to the touchdown zone
    for (const frac of [0.66, 0.33]) {
      const gx = aimX + (finalX - aimX) * frac;
      rings.push(ring(level, gx, endElev + 4 + (cruiseH - 8) * frac, 22, 'guide'));
    }
  } else {
    // bonus rings on the middle of the route
    const legStart = climbX + 300;
    const legEnd = end.x - 600;
    for (let i = 0; i < 3; i++) {
      const x = legStart + ((legEnd - legStart) * (i + 0.5)) / 3;
      rings.push(ring(level, x, terrainHeightAt(level.terrain, x) + 45 + (i % 2) * 35, 22, 'bonus'));
    }
  }
  // keep rings ordered and sane (above ground, inside the route)
  return rings
    .filter((r) => r.x > start.x && r.x < end.x + end.length && r.y > terrainHeightAt(level.terrain, r.x) + 8)
    .sort((a, b) => a.x - b.x);
}

function ring(level, x, y, r, kind) {
  return { x, y, r, kind };
}

/**
 * Did the plane pass through the ring on this tick? PURE.
 * @param {{x,y}} prev  plane position last tick
 * @param {{x,y}} curr  plane position this tick
 * @param {{x,y,r}} rg
 * @returns {boolean}
 */
export function ringHit(prev, curr, rg) {
  if (prev.x > rg.x || curr.x < rg.x) return false; // must cross the ring plane left→right
  const t = (rg.x - prev.x) / Math.max(curr.x - prev.x, 1e-9);
  const yAt = prev.y + (curr.y - prev.y) * t;
  return Math.abs(yAt - rg.y) <= rg.r;
}
