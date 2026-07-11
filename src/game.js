// game.js — IMPURE. rAF loop, fixed-step accumulator (dt = 1/60), screen state machine:
// MENU → BRIEF → FLY → DEBRIEF → (MENU|BRIEF) plus HANGAR. docs/DESIGN.md §2, §10.
// Owned by: Lead (integration). Wires sim/economy/save/renderer/hud/juice/input/monetize.

/**
 * Boot the game loop against a canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {Window} win
 */
export function startGame(canvas, win) {
  throw new Error('not implemented');
}
