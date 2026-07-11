// juice.js — IMPURE. Screen shake, particles, WebAudio blips. docs/DESIGN.md §9.
// Owned by: Dev C (presentation). Consumes simState.events each tick
// ('touchdown','crash','liftoff','stall-warning'). All procedural, no assets.

/**
 * @returns {{
 *   onEvents: (events, simState) => void,   // feed this tick's sim events
 *   update: (dt) => void,                    // advance shake decay + particles
 *   offset: () => ({x:number, y:number}),    // current shake offset, px
 *   drawParticles: (ctx, camera) => void,
 *   setEnabled: (opts) => void,              // {shake, sound}
 * }}
 */
export function createJuice() {
  throw new Error('not implemented');
}
