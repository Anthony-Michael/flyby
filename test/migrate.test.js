// test/migrate.test.js — migrate.js + save.js (node has no localStorage). node --test, zero deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SAVE_VERSION, freshSave, migrate } from '../src/migrate.js';
import { loadSave, persistSave } from '../src/save.js';

test('SAVE_VERSION is 1', () => {
  assert.equal(SAVE_VERSION, 1);
});

test('freshSave matches the DESIGN §7 shape', () => {
  const s = freshSave();
  assert.deepEqual(s, {
    v: 1,
    money: 0,
    missionsCompleted: {},
    planesOwned: ['kestrel'],
    activePlane: 'kestrel',
    upgrades: { kestrel: [] },
    freeContractCounter: 0,
    settings: { shake: true },
  });
});

test('freshSave returns a new object every call (no shared references)', () => {
  const a = freshSave();
  const b = freshSave();
  assert.notEqual(a, b);
  a.money = 999;
  a.planesOwned.push('mule');
  a.upgrades.kestrel.push('tires');
  assert.equal(b.money, 0);
  assert.deepEqual(b.planesOwned, ['kestrel']);
  assert.deepEqual(b.upgrades.kestrel, []);
});

test('migrate: well-formed v1 save passes through unchanged (deep-equal)', () => {
  const v1 = {
    v: 1,
    money: 780,
    missionsCompleted: { m1: { bestScore: 94, stars: 3 }, m2: { bestScore: 71, stars: 2 } },
    planesOwned: ['kestrel', 'mule'],
    activePlane: 'mule',
    upgrades: { kestrel: ['tires'], mule: [] },
    freeContractCounter: 4,
    settings: { shake: false },
  };
  assert.deepEqual(migrate(v1), v1);
});

test('migrate: never returns references into the input', () => {
  const v1 = freshSave();
  v1.money = 500;
  const out = migrate(v1);
  assert.notEqual(out, v1);
  out.planesOwned.push('swift');
  out.upgrades.kestrel.push('tank');
  out.missionsCompleted.m1 = { bestScore: 1, stars: 1 };
  assert.deepEqual(v1.planesOwned, ['kestrel']);
  assert.deepEqual(v1.upgrades.kestrel, []);
  assert.deepEqual(v1.missionsCompleted, {});
});

test('migrate: corrupt / missing / non-object input → fresh save', () => {
  for (const junk of [null, undefined, 'garbage', 42, true, [], [1, 2], () => {}, NaN]) {
    assert.deepEqual(migrate(junk), freshSave());
  }
});

test('migrate: unknown version → fresh save', () => {
  assert.deepEqual(migrate({ v: 99, money: 100000 }), freshSave());
  assert.deepEqual(migrate({ money: 500 }), freshSave()); // no version at all
});

test('migrate: v1 with missing/broken fields is repaired, not crashed', () => {
  const out = migrate({ v: 1, money: 'lots', planesOwned: 'kestrel', settings: 7 });
  assert.equal(out.money, 0);
  assert.deepEqual(out.planesOwned, ['kestrel']);
  assert.equal(out.activePlane, 'kestrel');
  assert.deepEqual(out.settings, { shake: true });

  // activePlane pointing at an unowned plane falls back to kestrel
  const out2 = migrate({ ...freshSave(), activePlane: 'swift' });
  assert.equal(out2.activePlane, 'kestrel');

  // owned plane missing its upgrades entry gets one
  const out3 = migrate({ ...freshSave(), planesOwned: ['kestrel', 'mule'] });
  assert.deepEqual(out3.upgrades.mule, []);

  // malformed missionsCompleted entries are dropped
  const out4 = migrate({ ...freshSave(), missionsCompleted: { m1: 'yes', m2: { bestScore: 70, stars: 2 } } });
  assert.deepEqual(out4.missionsCompleted, { m2: { bestScore: 70, stars: 2 } });
});

// --- save.js under node (no localStorage) — must not crash ------------------

test('loadSave under node returns a fresh, valid save', () => {
  // On runtimes without localStorage (node), loadSave must not crash and
  // must hand back a valid current-version save.
  const s = loadSave();
  assert.equal(s.v, SAVE_VERSION);
  if (typeof localStorage === 'undefined') assert.deepEqual(s, freshSave());
});

test('persistSave under node is a safe no-op', () => {
  assert.doesNotThrow(() => persistSave(freshSave()));
});
