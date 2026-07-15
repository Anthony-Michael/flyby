// rings.test.js — guide/bonus ring courses and pass-through detection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ringsForLevel, ringHit, BONUS_PER_RING } from '../src/rings.js';
import { terrainHeightAt } from '../src/terrain.js';
import { MISSIONS } from '../src/data/missions.js';

test('m1/m2 get guide rings, later missions get exactly 3 bonus rings', () => {
  for (const m of MISSIONS) {
    const rings = ringsForLevel(m);
    const kinds = new Set(rings.map((r) => r.kind));
    if (m.id === 'm1' || m.id === 'm2') {
      assert.ok(rings.length >= 4, `${m.id} should have a guide course, got ${rings.length}`);
      assert.deepEqual([...kinds], ['guide']);
    } else {
      assert.equal(rings.length, 3, `${m.id} should have 3 bonus rings`);
      assert.deepEqual([...kinds], ['bonus']);
    }
  }
});

test('every ring floats clear of the terrain and inside the route', () => {
  for (const m of MISSIONS) {
    for (const r of ringsForLevel(m)) {
      assert.ok(r.y - terrainHeightAt(m.terrain, r.x) >= 8, `${m.id} ring at x=${r.x} too low`);
      assert.ok(r.x > m.startRunway.x && r.x < m.endRunway.x + m.endRunway.length);
      assert.ok(r.r > 0);
    }
  }
});

test('guide rings descend along final approach toward the touchdown zone', () => {
  const m1 = MISSIONS.find((m) => m.id === 'm1');
  const rings = ringsForLevel(m1);
  const finals = rings.slice(-2); // the two glide-slope rings
  assert.ok(finals[0].y > finals[1].y, 'glide slope rings step down');
  assert.ok(finals[1].x > finals[0].x, 'and forward');
});

test('ringHit: interpolated crossing inside/outside the radius, and direction', () => {
  const rg = { x: 100, y: 50, r: 10 };
  assert.ok(ringHit({ x: 95, y: 48 }, { x: 105, y: 52 }, rg), 'through the middle');
  assert.ok(!ringHit({ x: 95, y: 70 }, { x: 105, y: 70 }, rg), 'over the top');
  assert.ok(!ringHit({ x: 105, y: 50 }, { x: 95, y: 50 }, rg), 'wrong direction');
  assert.ok(!ringHit({ x: 80, y: 50 }, { x: 90, y: 50 }, rg), 'not yet reached');
  // steep pass: crosses x=100 exactly at y edge of radius
  assert.ok(ringHit({ x: 99, y: 30 }, { x: 101, y: 90 }, rg), 'interpolated y within radius');
});

test('bonus value is a sane positive dollar amount', () => {
  assert.ok(BONUS_PER_RING > 0 && BONUS_PER_RING <= 25);
});
