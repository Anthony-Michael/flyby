// input.js — IMPURE (thin). Keyboard → plain input object. docs/DESIGN.md §4.
// Owned by: Dev C (presentation/shell). Keep ALL key handling here (mobile door stays open).

/**
 * Attach listeners; returns a handle whose .read() yields the per-tick input object.
 * Bindings: ↑/↓ pitch ±1 · W/S throttleDelta ±1 · B brake · R restart · P/Esc pause.
 * @param {Window} win
 * @returns {{ read: () => {pitch:number, throttleDelta:number, brake:boolean},
 *             consumeRestart: () => boolean, consumePause: () => boolean,
 *             consumeConfirm: () => boolean,  // Enter/Space for menus
 *             detach: () => void }}
 */
export function createInput(win) {
  throw new Error('not implemented');
}
