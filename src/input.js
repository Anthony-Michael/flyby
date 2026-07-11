// input.js — IMPURE (thin). Keyboard → plain input object. docs/DESIGN.md §4.
// Owned by: Dev C (presentation/shell). Keep ALL key handling here (mobile door stays open).

/**
 * Attach listeners; returns a handle whose .read() yields the per-tick input object.
 * Bindings: ↑/↓ pitch ±1 · W/S throttleDelta ±1 · B brake · R restart · P/Esc pause.
 *
 * CONTRACT ADDITIONS (for lead ratification — menus need them):
 *   consumeNav()    → {dx, dy}  edge-triggered arrow presses since last call (dy: ↑=−1, ↓=+1)
 *   consumeHangar() → boolean   H pressed (edge)
 *   consumeBack()   → boolean   Esc pressed (edge). NOTE: Esc raises BOTH pause and back
 *                               flags — input only reports; game.js decides which applies
 *                               to the current screen (pause in FLY, back in menus).
 *
 * All game keys are preventDefault-ed (unless a modifier is held) so the page never scrolls.
 *
 * @param {Window} win
 * @returns {{ read: () => {pitch:number, throttleDelta:number, brake:boolean},
 *             consumeRestart: () => boolean, consumePause: () => boolean,
 *             consumeConfirm: () => boolean,  // Enter/Space for menus
 *             consumeNav: () => {dx:number, dy:number},
 *             consumeHangar: () => boolean, consumeBack: () => boolean,
 *             detach: () => void }}
 */
export function createInput(win) {
  const held = new Set();
  let restart = false;
  let pause = false;
  let confirm = false;
  let hangar = false;
  let back = false;
  let navDx = 0;
  let navDy = 0;

  const GAME_KEYS = new Set([
    'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
    ' ', 'enter', 'escape', 'w', 's', 'b', 'r', 'p', 'h',
  ]);

  function norm(e) {
    return e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  }

  function onKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = norm(e);
    if (!GAME_KEYS.has(k)) return;
    e.preventDefault();
    if (!e.repeat) {
      if (k === 'r') restart = true;
      else if (k === 'p') pause = true;
      else if (k === 'escape') {
        pause = true; // game.js decides: pause in FLY,
        back = true; //                  back in menus
      } else if (k === 'enter' || k === ' ') confirm = true;
      else if (k === 'h') hangar = true;
      else if (k === 'arrowup') navDy -= 1;
      else if (k === 'arrowdown') navDy += 1;
      else if (k === 'arrowleft') navDx -= 1;
      else if (k === 'arrowright') navDx += 1;
    }
    held.add(k);
  }

  function onKeyUp(e) {
    held.delete(norm(e));
  }

  function onBlur() {
    held.clear(); // no stuck controls when the tab loses focus
  }

  win.addEventListener('keydown', onKeyDown);
  win.addEventListener('keyup', onKeyUp);
  win.addEventListener('blur', onBlur);

  return {
    read() {
      return {
        pitch: (held.has('arrowup') ? 1 : 0) + (held.has('arrowdown') ? -1 : 0),
        throttleDelta: (held.has('w') ? 1 : 0) + (held.has('s') ? -1 : 0),
        brake: held.has('b'),
      };
    },
    consumeRestart() {
      const v = restart;
      restart = false;
      return v;
    },
    consumePause() {
      const v = pause;
      pause = false;
      return v;
    },
    consumeConfirm() {
      const v = confirm;
      confirm = false;
      return v;
    },
    consumeNav() {
      const v = { dx: navDx, dy: navDy };
      navDx = 0;
      navDy = 0;
      return v;
    },
    consumeHangar() {
      const v = hangar;
      hangar = false;
      return v;
    },
    consumeBack() {
      const v = back;
      back = false;
      return v;
    },
    detach() {
      win.removeEventListener('keydown', onKeyDown);
      win.removeEventListener('keyup', onKeyUp);
      win.removeEventListener('blur', onBlur);
    },
  };
}
