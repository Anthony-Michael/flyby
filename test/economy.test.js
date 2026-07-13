// test/economy.test.js — economy.js + data/planes.js. node --test, zero deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  missionPayout,
  canAfford,
  applyPurchase,
  unlockedMissions,
  recordCompletion,
} from '../src/economy.js';
import { freshSave } from '../src/migrate.js';
import { PLANES, UPGRADES, effectivePlane } from '../src/data/planes.js';

const M = (over = {}) => ({ id: 'mx', reward: 100, type: 'CARGO', parTimeS: null, ...over });

// --- missionPayout: grade multipliers (DESIGN §5) -------------------------

test('payout: 3 stars = reward x1.3', () => {
  const { payout } = missionPayout(M(), { stars: 3, score: 95 }, false);
  assert.equal(payout, 130);
});

test('payout: 2 stars = reward x1.0', () => {
  const { payout } = missionPayout(M(), { stars: 2, score: 75 }, false);
  assert.equal(payout, 100);
});

test('payout: 1 star = reward x0.7 minus $25 inspection fee', () => {
  const { payout } = missionPayout(M(), { stars: 1, score: 40 }, false);
  assert.equal(payout, 45); // 70 - 25
});

test('payout: crash (0 stars) pays nothing', () => {
  const { payout } = missionPayout(M(), { stars: 0, score: 0 }, false);
  assert.equal(payout, 0);
});

test('payout: repeat halves the contract before grade multiplier', () => {
  assert.equal(missionPayout(M(), { stars: 2, score: 75 }, true).payout, 50);
  assert.equal(missionPayout(M(), { stars: 3, score: 95 }, true).payout, 65); // 50 x 1.3
  assert.equal(missionPayout(M(), { stars: 1, score: 40 }, true).payout, 10); // 35 - 25
});

test('payout: never negative (fee cannot take money)', () => {
  const { payout } = missionPayout(M({ reward: 20 }), { stars: 1, score: 30 }, true);
  assert.equal(payout, 0); // 7 - 25 clamps at 0
});

test('payout: URGENT beating par adds +50% of contract', () => {
  const m = M({ type: 'URGENT', parTimeS: 120 });
  assert.equal(missionPayout(m, { stars: 2, score: 75, timeS: 100 }, false).payout, 150);
  assert.equal(missionPayout(m, { stars: 2, score: 75, timeS: 130 }, false).payout, 100); // missed par still pays base
});

test('payout: lines sum to the payout (debrief breakdown is honest)', () => {
  for (const [result, isRepeat] of [
    [{ stars: 3, score: 95 }, false],
    [{ stars: 2, score: 75 }, true],
    [{ stars: 1, score: 40 }, false],
  ]) {
    const { payout, lines } = missionPayout(M(), result, isRepeat);
    const sum = Math.round(lines.reduce((s, l) => s + l.amount, 0));
    assert.equal(payout, Math.max(0, sum));
    assert.ok(lines.every((l) => typeof l.label === 'string' && typeof l.amount === 'number'));
  }
});

// --- canAfford / applyPurchase ---------------------------------------------

const planeItem = { kind: 'plane', id: 'mule', cost: 1200 };
const upgradeItem = { kind: 'upgrade', id: 'tires', cost: 300, planeId: 'kestrel' };

test('canAfford: strict money check', () => {
  assert.equal(canAfford({ ...freshSave(), money: 1200 }, planeItem), true);
  assert.equal(canAfford({ ...freshSave(), money: 1199 }, planeItem), false);
});

test('applyPurchase: insufficient funds rejected, save untouched', () => {
  const save = { ...freshSave(), money: 100 };
  const { save: out, ok, error } = applyPurchase(save, planeItem);
  assert.equal(ok, false);
  assert.equal(error, 'insufficient funds');
  assert.equal(out, save);
  assert.equal(save.money, 100);
});

test('applyPurchase: plane purchase deducts money and adds plane', () => {
  const save = { ...freshSave(), money: 1500 };
  const { save: out, ok, error } = applyPurchase(save, planeItem);
  assert.equal(ok, true);
  assert.equal(error, null);
  assert.equal(out.money, 300);
  assert.deepEqual(out.planesOwned, ['kestrel', 'mule']);
  assert.deepEqual(out.upgrades.mule, []);
  // input not mutated
  assert.equal(save.money, 1500);
  assert.deepEqual(save.planesOwned, ['kestrel']);
});

test('applyPurchase: already-owned plane rejected', () => {
  const save = { ...freshSave(), money: 5000 };
  const bought = applyPurchase(save, planeItem).save;
  const again = applyPurchase(bought, planeItem);
  assert.equal(again.ok, false);
  assert.equal(again.error, 'already owned');
  assert.equal(again.save.money, bought.money);
});

test('applyPurchase: upgrade path adds to the plane list, one-time only', () => {
  const save = { ...freshSave(), money: 1000 };
  const first = applyPurchase(save, upgradeItem);
  assert.equal(first.ok, true);
  assert.equal(first.save.money, 700);
  assert.deepEqual(first.save.upgrades.kestrel, ['tires']);
  const second = applyPurchase(first.save, upgradeItem);
  assert.equal(second.ok, false);
  assert.equal(second.error, 'already owned');
  // input not mutated
  assert.deepEqual(save.upgrades.kestrel, []);
});

test('applyPurchase: upgrade defaults to activePlane; unowned plane rejected', () => {
  const save = { ...freshSave(), money: 1000 };
  const noPlaneId = applyPurchase(save, { kind: 'upgrade', id: 'engine', cost: 500 });
  assert.equal(noPlaneId.ok, true);
  assert.deepEqual(noPlaneId.save.upgrades.kestrel, ['engine']);

  const forSwift = applyPurchase(save, { ...upgradeItem, planeId: 'swift' });
  assert.equal(forSwift.ok, false);
  assert.equal(forSwift.error, 'plane not owned');
});

test('applyPurchase: unknown kind rejected, never throws', () => {
  const save = freshSave();
  const res = applyPurchase(save, { kind: 'hat', id: 'fedora', cost: 5 });
  assert.equal(res.ok, false);
  assert.equal(typeof res.error, 'string');
});

// --- unlockedMissions: linear gating ---------------------------------------

const CAMPAIGN = ['m1', 'm2', 'm3', 'm4'].map((id) => ({ id }));
const withDone = (...ids) => {
  const s = freshSave();
  for (const id of ids) s.missionsCompleted[id] = { bestScore: 80, stars: 2 };
  return s;
};

test('unlock: m1 always unlocked on a fresh save', () => {
  assert.deepEqual(unlockedMissions(freshSave(), CAMPAIGN), ['m1']);
});

test('unlock: completing mN unlocks mN+1', () => {
  assert.deepEqual(unlockedMissions(withDone('m1'), CAMPAIGN), ['m1', 'm2']);
  assert.deepEqual(unlockedMissions(withDone('m1', 'm2', 'm3'), CAMPAIGN), ['m1', 'm2', 'm3', 'm4']);
});

test('unlock: a gap in completions blocks everything past it', () => {
  // m3 somehow marked done but m2 is not — gating is strictly linear
  assert.deepEqual(unlockedMissions(withDone('m1', 'm3'), CAMPAIGN), ['m1', 'm2']);
});

// --- recordCompletion --------------------------------------------------------

test('recordCompletion: adds money and records best score/stars', () => {
  const save = freshSave();
  const out = recordCompletion(save, 'm1', { score: 82, stars: 2, payout: 80 });
  assert.equal(out.money, 80);
  assert.deepEqual(out.missionsCompleted.m1, { bestScore: 82, stars: 2 });
  // input not mutated
  assert.equal(save.money, 0);
  assert.deepEqual(save.missionsCompleted, {});
});

test('recordCompletion: keeps the best score, still pays for worse runs', () => {
  let save = recordCompletion(freshSave(), 'm1', { score: 94, stars: 3, payout: 104 });
  save = recordCompletion(save, 'm1', { score: 55, stars: 1, payout: 20 });
  assert.deepEqual(save.missionsCompleted.m1, { bestScore: 94, stars: 3 });
  assert.equal(save.money, 124);
  save = recordCompletion(save, 'm1', { score: 97, stars: 3, payout: 52 });
  assert.deepEqual(save.missionsCompleted.m1, { bestScore: 97, stars: 3 });
});

// --- data/planes.js -----------------------------------------------------------

test('planes: three hangar entries with DESIGN §3/§7 constants', () => {
  assert.deepEqual(Object.keys(PLANES).sort(), ['kestrel', 'mule', 'swift']);
  const k = PLANES.kestrel;
  assert.equal(k.MAX_THRUST, 6.0);
  assert.equal(k.LIFT_K, 0.0215);
  assert.equal(k.PITCH_RATE, 1.6);
  assert.equal(k.tankL, 40);
  assert.equal(k.MASS_FACTOR_PER_KG, 1 / 1000);
  // Kestrel stall speed pins to 18.0 m/s (§3 derived target)
  const stall = Math.sqrt(k.GRAVITY / (k.LIFT_K * k.CL_MAX));
  assert.ok(Math.abs(stall - 18.0) < 0.05, `kestrel stall ${stall}`);

  const m = PLANES.mule;
  assert.equal(m.cost, 1200);
  assert.equal(m.MAX_THRUST, 7.5);
  assert.equal(m.PITCH_RATE, 1.1);
  assert.equal(m.tankL, 60);
  assert.equal(m.MASS_FACTOR_PER_KG, 1 / 2000); // cargo penalty halved
  const mStall = Math.sqrt(m.GRAVITY / (m.LIFT_K * m.CL_MAX));
  assert.ok(Math.abs(mStall - 20.0) < 0.05, `mule stall ${mStall}`); // 2 m/s higher

  const s = PLANES.swift;
  assert.equal(s.cost, 2400);
  assert.equal(s.MAX_THRUST, 8.5);
  assert.equal(s.PITCH_RATE, 2.2);
  assert.equal(s.tankL, 35);
  assert.ok(Math.abs(s.DRAG_P - 0.0022 * 0.8) < 1e-9); // DRAG_P −20%
});

test('upgrades: tires/engine/tank effects per DESIGN §7', () => {
  assert.deepEqual(Object.keys(UPGRADES).sort(), ['engine', 'tank', 'tires']);
  assert.equal(UPGRADES.tires.cost, 300);
  assert.equal(UPGRADES.engine.cost, 500);
  assert.equal(UPGRADES.tank.cost, 400);

  const k = PLANES.kestrel;
  const tired = UPGRADES.tires.applies(k);
  assert.equal(tired.CRASH_VY, 5.2); // base 4.0 + 1.2
  assert.equal(tired.ROUGH_DRAG, k.ROUGH_DRAG / 2);
  const tuned = UPGRADES.engine.applies(k);
  assert.ok(Math.abs(tuned.MAX_THRUST - 6.9) < 1e-9); // +15%
  const tanked = UPGRADES.tank.applies(k);
  assert.equal(tanked.tankL, 60); // +50%
});

test('effectivePlane: applies owned upgrades, never mutates PLANES', () => {
  const save = { ...freshSave(), upgrades: { kestrel: ['tires', 'engine'] } };
  const eff = effectivePlane('kestrel', save);
  assert.equal(eff.CRASH_VY, 5.2);
  assert.ok(Math.abs(eff.MAX_THRUST - 6.9) < 1e-9);
  assert.equal(PLANES.kestrel.CRASH_VY, 4.0);
  assert.equal(PLANES.kestrel.MAX_THRUST, 6.0);
  // no upgrades → deep-equal to base
  assert.deepEqual(effectivePlane('swift', freshSave()), PLANES.swift);
});
