// renderer.js — IMPURE. Canvas world drawing: parallax, terrain, runways, plane, zones.
// Owned by: Dev C (presentation). Reads sim state + level; NEVER mutates them.
// Camera: plane at 35% from left, soft vertical follow, 6 px/m (DESIGN §2).
// Art: flat-color vector (DESIGN §1) — silhouette ridges, two-tone plane, windsock at runways.

/**
 * @param {CanvasRenderingContext2D} ctx
 * @returns {{ render: (simState, level, viewFx) => void }}
 *   viewFx: { shakeX, shakeY, particles } from juice.js (already computed offsets)
 */
export function createRenderer(ctx) {
  throw new Error('not implemented');
}
