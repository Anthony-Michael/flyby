// hud.js — IMPURE. Bottom instrument strip + toasts + screen overlays. docs/DESIGN.md §9.
// Owned by: Dev C (presentation).
// Instruments L→R: airspeed (amber<22, red<19 + STALL), altitude AGL, VSI bar (the star
// instrument), throttle, fuel, distance-to-destination. Also: ROTATE cue, grade toast,
// briefing/debrief/menu/hangar panels (canvas-drawn, keyboard-navigated).

/**
 * @param {CanvasRenderingContext2D} ctx
 * @returns {{
 *   drawFlightHUD: (simState, level, plane) => void,
 *   drawBriefing: (mission, selection) => void,
 *   drawDebrief: (grade, payoutLines, selection) => void,
 *   drawMenu: (save, missions, selection) => void,
 *   drawHangar: (save, planes, upgrades, selection) => void,
 * }}
 */
export function createHud(ctx) {
  throw new Error('not implemented');
}
