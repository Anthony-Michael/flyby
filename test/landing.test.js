// landing.test.js — DESIGN §5 tolerances and grade formula, pinned exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCrash, gradeTouchdown } from '../src/landing.js';

const RUNWAY = { x: 1700, length: 400, elevation: 20 };

function contact(over = {}) {
  return { x: 1800, y: 20, vx: 22, vy: -1, pitch: 0.1, onGround: false, crashed: false, ...over };
}

// --- §5 crash tolerances, each side of every threshold -----------------------

test('vertical speed: vy < -2.5 m/s is a hard impact', () => {
  assert.deepEqual(checkCrash(contact({ vy: -2.49 }), RUNWAY), { crashed: false, reason: null });
  assert.deepEqual(checkCrash(contact({ vy: -2.51 }), RUNWAY), { crashed: true, reason: 'hard-impact' });
});

test('ground speed: vx > 30 m/s is too fast', () => {
  assert.deepEqual(checkCrash(contact({ vx: 29.9 }), RUNWAY), { crashed: false, reason: null });
  assert.deepEqual(checkCrash(contact({ vx: 30.1 }), RUNWAY), { crashed: true, reason: 'too-fast' });
});

test('pitch below -0.03 rad is a nose-gear strike', () => {
  assert.deepEqual(checkCrash(contact({ pitch: -0.029 }), RUNWAY), { crashed: false, reason: null });
  assert.deepEqual(checkCrash(contact({ pitch: -0.031 }), RUNWAY), { crashed: true, reason: 'nose-strike' });
});

test('pitch above 0.21 rad is a tail strike', () => {
  assert.deepEqual(checkCrash(contact({ pitch: 0.209 }), RUNWAY), { crashed: false, reason: null });
  assert.deepEqual(checkCrash(contact({ pitch: 0.211 }), RUNWAY), { crashed: true, reason: 'tail-strike' });
});

test('contact outside the runway span is always off-runway', () => {
  assert.deepEqual(checkCrash(contact({ x: 1699 }), RUNWAY), { crashed: true, reason: 'off-runway' });
  assert.deepEqual(checkCrash(contact({ x: 2101 }), RUNWAY), { crashed: true, reason: 'off-runway' });
  assert.deepEqual(checkCrash(contact({ x: 1700 }), RUNWAY), { crashed: false, reason: null }); // thresholds inclusive
  assert.deepEqual(checkCrash(contact({ x: 2100 }), RUNWAY), { crashed: false, reason: null });
  assert.deepEqual(checkCrash(contact(), null), { crashed: true, reason: 'off-runway' });
});

// --- §5 grade formula, pinned numbers ----------------------------------------

const THIRD_POINT = RUNWAY.x + RUNWAY.length / 3; // 1833.33

test('greased it: soft, slow, on the numbers, ideal flare = 98 and three stars', () => {
  // Deductions: softness 0 (|vy| ≤ 0.6), speed 20·(19−18)/12 = 1.67,
  // zone 0, attitude 0 → score round(98.33) = 98.
  const g = gradeTouchdown({ vy: -0.4, vx: 19, pitch: 0.10, x: THIRD_POINT, bounced: false }, RUNWAY);
  assert.equal(g.score, 98);
  assert.equal(g.stars, 3);
  const byLabel = Object.fromEntries(g.breakdown.map((b) => [b.label, b.deduction]));
  assert.equal(byLabel.softness, 0);
  assert.ok(Math.abs(byLabel.speed - 20 / 12) < 1e-9);
  assert.equal(byLabel['touchdown-zone'], 0);
  assert.equal(byLabel.attitude, 0);
  assert.equal(byLabel.bounce, undefined, 'no bounce entry when not bounced');
});

test('perfect touchdown scores 100', () => {
  const g = gradeTouchdown({ vy: -0.5, vx: 17.5, pitch: 0.10, x: THIRD_POINT, bounced: false }, RUNWAY);
  assert.equal(g.score, 100);
  assert.equal(g.stars, 3);
});

test('hard arrival: fast, flat, long = one star', () => {
  // softness 25·(2.4−0.6)/1.9 = 23.68, speed 20·11/12 = 18.33,
  // zone 20·(266.67/400) = 13.33, attitude 15·(0.10/0.10) = 15 → round(29.65) = 30.
  const g = gradeTouchdown({ vy: -2.4, vx: 29, pitch: 0, x: RUNWAY.x + RUNWAY.length, bounced: false }, RUNWAY);
  assert.equal(g.score, 30);
  assert.equal(g.stars, 1);
});

test('bounce costs exactly 20 points and appears in the breakdown', () => {
  const clean = gradeTouchdown({ vy: -0.4, vx: 19, pitch: 0.10, x: THIRD_POINT, bounced: false }, RUNWAY);
  const bounced = gradeTouchdown({ vy: -0.4, vx: 19, pitch: 0.10, x: THIRD_POINT, bounced: true }, RUNWAY);
  assert.equal(clean.score - bounced.score, 20);
  const entry = bounced.breakdown.find((b) => b.label === 'bounce');
  assert.deepEqual(entry, { label: 'bounce', deduction: 20 });
});

test('deductions clamp: score never leaves [0, 100] and floor gives one star', () => {
  const g = gradeTouchdown({ vy: -2.5, vx: 30, pitch: -0.03, x: RUNWAY.x, bounced: true }, RUNWAY);
  assert.ok(g.score >= 0 && g.score <= 100);
  assert.equal(g.stars, 1);
});

test('star bands: 90-100 = 3, 70-89 = 2, below = 1', () => {
  // speed deduction alone reaches every band: vx = 18 + 12·(d/20).
  const at = (vx) => gradeTouchdown({ vy: -0.5, vx, pitch: 0.10, x: THIRD_POINT, bounced: false }, RUNWAY);
  assert.equal(at(24).stars, 3); // −10 → 90
  assert.equal(at(24.7).stars, 2); // −11.17 → 89
  const hard = gradeTouchdown({ vy: -2.4, vx: 29.9, pitch: 0, x: RUNWAY.x + RUNWAY.length, bounced: false }, RUNWAY);
  assert.equal(hard.stars, 1);
});
