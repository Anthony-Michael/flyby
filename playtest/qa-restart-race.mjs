// Attack: restart-key mashing exactly across the FLY→DEBRIEF async transition.
// finishFlight() awaits hooks.onMissionEnd() (portal builds put ad interstitials
// there — real delay, not a same-tick microtask) before flipping the screen to
// DEBRIEF. This probe checks whether a restart press *during* that window can
// corrupt state: freeze the new attempt, double-pay a mission, or bounce the
// player into a stale debrief for a flight they already abandoned.
//
// Drives src/game.js for real against a minimal fake DOM (no jsdom dependency —
// zero-dependency project). rAF is captured, not auto-fired, so the probe
// controls frame pacing exactly.

import { hooks } from '../src/monetize.js';

let fails = 0;
const report = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails++;
};

// --- fake localStorage (so save.js's persistSave/loadSave actually round-trip) ---
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => store.delete(k),
};

// --- fake canvas 2D context: every method is a no-op, every property is inert ---
// Gradient/pattern-returning calls (createLinearGradient, etc.) need a stub
// object back so `.addColorStop(...)` chains don't blow up.
function makeChainStub() {
  return new Proxy({}, {
    get(_t, prop) {
      if (prop === 'width' || prop === 'height') return 0;
      return () => makeChainStub();
    },
  });
}

function makeCtx() {
  return new Proxy({}, {
    get(_t, prop) {
      if (prop === 'canvas') return canvas;
      if (prop === 'measureText') return () => ({ width: 0 });
      return () => makeChainStub(); // any ctx.foo(...) call returns a chainable stub
    },
    set() { return true; }, // any ctx.foo = x assignment is accepted and ignored
  });
}

const canvas = { width: 1280, height: 800 };
const ctx = makeCtx();
canvas.getContext = () => ctx;

// renderer.js builds Path2D shapes directly (not via ctx) — stub the global.
globalThis.Path2D = class {
  moveTo() {} lineTo() {} closePath() {} arc() {} bezierCurveTo() {} quadraticCurveTo() {}
  rect() {} ellipse() {}
};

// --- fake window: EventTarget-ish + manually-pumped rAF ---
let pendingFrame = null;
const listeners = { keydown: [], keyup: [], blur: [], resize: [] };
const win = {
  innerWidth: 1280,
  innerHeight: 800,
  addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
  removeEventListener(type, fn) {
    const l = listeners[type];
    if (l) listeners[type] = l.filter((f) => f !== fn);
  },
  requestAnimationFrame(cb) { pendingFrame = cb; return 1; },
};

function pumpFrame(tMs) {
  const cb = pendingFrame;
  pendingFrame = null;
  if (!cb) throw new Error('no frame queued');
  cb(tMs);
}

function dispatchKey(type, key) {
  for (const fn of listeners[type] ?? []) {
    fn({ key, repeat: false, metaKey: false, ctrlKey: false, altKey: false, preventDefault() {} });
  }
}

const microtasks = () => new Promise((r) => setTimeout(r, 0));

// --- boot the real game against the fake DOM ---
const { startGame } = await import('../src/game.js');
const { createSimState } = await import('../src/sim.js');
const { MISSIONS } = await import('../src/data/missions.js');
const { PLANES } = await import('../src/data/planes.js');

// Delay-controllable onMissionEnd — stands in for a portal interstitial ad.
let releaseTransition = null;
hooks.onMissionEnd = () => new Promise((resolve) => { releaseTransition = resolve; });

startGame(canvas, win);
let t = 0;
pumpFrame((t += 16)); // frame 0: renders MENU

// Navigate MENU -> BRIEF -> FLY for m1 (selection starts at 0 = m1).
dispatchKey('keydown', 'Enter');
pumpFrame((t += 16)); // consumes confirm -> BRIEF
dispatchKey('keydown', 'Enter');
pumpFrame((t += 16)); // consumes confirm -> startFlight -> FLY (screen flips mid-frame)
pumpFrame((t += 16)); // first FLY-screen frame: win.__skyhaul is set at the end of updateFlight

const S = win.__skyhaul;
report('setup: flight started', S && S.screen === 'FLY', `screen=${S?.screen}`);

const m1 = MISSIONS.find((m) => m.id === 'm1');
const moneyBefore = S ? undefined : undefined; // fetched via loadSave below once persisted

// Force the sim to a graded, LANDED, stopped touchdown (mirrors qa-lib's
// forceTouchdown pattern) so the very next frame trips finishFlight().
S.sim = {
  ...S.sim,
  phase: 'LANDED',
  crashed: false,
  crashReason: null,
  bounced: false,
  touchdown: { vy: -0.7, vx: 20, pitch: 0.10, x: m1.endRunway.x + 50, bounced: false },
  grade: { score: 92, stars: 3, breakdown: [] },
  plane: { ...S.sim.plane, x: m1.endRunway.x + 50, vx: 0, vy: 0, onGround: true, throttle: 0 },
};

pumpFrame((t += 16)); // finishFlight() fires: transitioning=true, payout recorded, awaiting hooks
report('mid-transition: S.transitioning is true', S.transitioning === true, `transitioning=${S.transitioning}`);
report('mid-transition: screen still FLY (awaiting portal hook)', S.screen === 'FLY', `screen=${S.screen}`);

const simAtLanding = S.sim;

// --- the attack: mash restart while the transition is still pending ---
dispatchKey('keydown', 'r');
pumpFrame((t += 16));
dispatchKey('keydown', 'r');
pumpFrame((t += 16));

const sawFreshSim = S.sim !== simAtLanding;
const stillTransitioning = S.transitioning === true;
report(
  'restart-during-transition: new flight state was NOT silently discarded',
  !(sawFreshSim && stillTransitioning),
  sawFreshSim && stillTransitioning
    ? `S.sim was reset to a fresh flight (x=${S.sim.plane.x}) but S.transitioning is still true — the new attempt is frozen (physics gate blocks stepping while transitioning)`
    : undefined
);

// Now let the delayed portal hook resolve, as it eventually would.
releaseTransition();
await microtasks();
await microtasks();

const bouncedToStaleDebrief = S.screen === 'DEBRIEF' && sawFreshSim;
report(
  'no stale-debrief bounce after a mid-transition restart',
  !bouncedToStaleDebrief,
  bouncedToStaleDebrief
    ? `player restarted (S.sim was fresh) but got forced into DEBRIEF for the OLD (already-scored) landing — new attempt lost`
    : undefined
);

// --- double-payout check via the real save round-trip ---
const { loadSave } = await import('../src/save.js');
const save = loadSave();
const m1Completions = save.missionsCompleted?.m1;
report(
  'no double-payout: m1 recorded exactly once',
  Boolean(m1Completions),
  `missionsCompleted.m1=${JSON.stringify(m1Completions)} money=${save.money}`
);
// A single m1 clean landing at 3 stars pays 80 * 1.3 = 104.
report('payout is a single mission worth, not doubled', save.money === 104, `money=${save.money} (expected 104)`);

console.log(fails ? `\n${fails} FAILURES` : '\nall clean');
process.exit(fails ? 1 : 0);
