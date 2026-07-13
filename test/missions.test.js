// test/missions.test.js — data/missions.js against the real terrain.validateLevel.
// node --test, zero deps. DESIGN §6 (mission table), §8 (level schema).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MISSIONS, freeContract } from '../src/data/missions.js';
import { validateLevel, terrainHeightAt } from '../src/terrain.js';

const byId = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));
const dist = (m) => m.endRunway.x - m.startRunway.x;

// --- schema & validity -------------------------------------------------------

test('campaign is exactly m1..m8, in order', () => {
  assert.deepEqual(
    MISSIONS.map((m) => m.id),
    ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']
  );
});

test('all 8 campaign missions pass validateLevel', () => {
  for (const m of MISSIONS) {
    assert.deepEqual(validateLevel(m), [], `${m.id} (${m.name}) should be valid`);
  }
});

test('every mission has the full §8 schema and a briefing with some soul', () => {
  for (const m of MISSIONS) {
    assert.equal(typeof m.name, 'string');
    assert.ok(['CARGO', 'URGENT', 'CHARTER'].includes(m.type), m.id);
    assert.ok(typeof m.briefing === 'string' && m.briefing.length > 20, `${m.id} briefing`);
    assert.equal(typeof m.cargoKg, 'number');
    assert.equal(typeof m.fuelL, 'number');
    assert.ok(m.parTimeS === null || typeof m.parTimeS === 'number', m.id);
    assert.ok(m.reward > 0, m.id);
    assert.equal(typeof m.wind.baseX, 'number');
    assert.equal(typeof m.wind.gustAmp, 'number');
    assert.ok(Array.isArray(m.terrain) && m.terrain.length >= 2, m.id);
    assert.ok(Array.isArray(m.zones), m.id);
  }
});

test('start runway sits near x=100 and terrain points are sorted', () => {
  for (const m of MISSIONS) {
    assert.equal(m.startRunway.x, 100, m.id);
    for (let i = 1; i < m.terrain.length; i += 1) {
      assert.ok(m.terrain[i][0] > m.terrain[i - 1][0], `${m.id} terrain sorted at ${i}`);
    }
    // terrain covers both runways
    const first = m.terrain[0][0];
    const last = m.terrain[m.terrain.length - 1][0];
    assert.ok(first <= m.startRunway.x, m.id);
    assert.ok(last >= m.endRunway.x + m.endRunway.length, m.id);
  }
});

// --- §6 table, row by row ------------------------------------------------------

test('mission table matches DESIGN §6 exactly', () => {
  const rows = {
    //     type       km   kg   base gust fuel  reward
    m1: ['CARGO', 1.5, 0, 0, 0, 40, 80],
    m2: ['CARGO', 3, 50, 1, 0, 40, 120], // tailwind 2→1: round-1 playtests, all controllers floated past the strip
    m3: ['CARGO', 3, 250, 0, 0, 40, 180],
    m4: ['CARGO', 4, 100, -5, 1, 40, 220],
    m5: ['CARGO', 5, 100, -2, 1, 40, 300],
    m6: ['CHARTER', 4, 90, -3, 2, 40, 400],
    m7: ['URGENT', 9, 150, -4, 2, 33, 450], // fuel 30→33: 30 L was the exact required burn, zero margin
    m8: ['CARGO', 6, 200, -6, 4, 40, 600],
  };
  for (const [id, [type, km, kg, baseX, gustAmp, fuelL, reward]] of Object.entries(rows)) {
    const m = byId[id];
    assert.equal(m.type, type, `${id} type`);
    assert.equal(m.cargoKg, kg, `${id} cargo`);
    assert.equal(m.wind.baseX, baseX, `${id} wind base`);
    assert.equal(m.wind.gustAmp, gustAmp, `${id} gust`);
    assert.equal(m.fuelL, fuelL, `${id} fuel`);
    assert.equal(m.reward, reward, `${id} reward`);
    // nominal distance within 15% (the §8 example itself is m5 at 4.5 km for a "5 km" row)
    const d = dist(m);
    assert.ok(
      Math.abs(d - km * 1000) <= km * 1000 * 0.15,
      `${id} distance ${d} vs nominal ${km * 1000}`
    );
  }
});

test('signature twists: strips, fuel, hazards per §6', () => {
  // m1 tutorial: flat terrain, 400 m strips
  assert.equal(byId.m1.startRunway.length, 400);
  assert.equal(byId.m1.endRunway.length, 400);
  const elevations = new Set(byId.m1.terrain.map(([, e]) => e));
  assert.equal(elevations.size, 1, 'm1 terrain is flat');

  // m5 uses the §8 Notch example: ridge with a gap, downdraft zone
  assert.deepEqual(byId.m5.zones, [{ kind: 'downdraft', x: 2700, width: 400, vy: -3 }]);
  assert.equal(terrainHeightAt(byId.m5.terrain, 2300), 300); // ridge shoulder
  assert.equal(terrainHeightAt(byId.m5.terrain, 2460), 180); // the notch itself

  // m6: 180 m destination shelf
  assert.equal(byId.m6.endRunway.length, 180);

  // m7: fuel is the boss — 33 L (~10% margin over the required burn), time par (URGENT)
  assert.equal(byId.m7.fuelL, 33);
  assert.ok(byId.m7.parTimeS > 0);

  // m8: 150 m cliff-edge strip + downdraft on final
  assert.equal(byId.m8.endRunway.length, 150);
  const strip = byId.m8.endRunway;
  const stripElev = terrainHeightAt(byId.m8.terrain, strip.x);
  const beyond = terrainHeightAt(byId.m8.terrain, strip.x + strip.length + 100);
  assert.ok(stripElev - beyond > 100, 'terrain falls away past the strip (cliff edge)');
  const dd = byId.m8.zones.find((z) => z.kind === 'downdraft');
  assert.ok(dd, 'm8 has a downdraft zone');
  assert.ok(dd.x + dd.width <= strip.x, 'downdraft sits on final, before the threshold');
});

// --- free contracts -------------------------------------------------------------

test('freeContract is deterministic: same counter, same mission', () => {
  assert.deepEqual(freeContract(7), freeContract(7));
  assert.deepEqual(freeContract(31), freeContract(31));
  assert.notDeepEqual(freeContract(7), freeContract(8));
});

test('freeContract produces valid levels for counters 0..50', () => {
  for (let c = 0; c <= 50; c += 1) {
    const level = freeContract(c);
    assert.deepEqual(validateLevel(level), [], `fc${c} should be valid`);
    assert.equal(level.id, `fc${c}`);
    assert.ok(level.reward > 0, `fc${c} reward`);
    assert.ok(typeof level.briefing === 'string' && level.briefing.length > 20, `fc${c} briefing`);
    assert.ok(level.fuelL > 0, `fc${c} fuel`);
    assert.ok(dist(level) >= 2000, `fc${c} distance`);
    for (let i = 1; i < level.terrain.length; i += 1) {
      assert.ok(level.terrain[i][0] > level.terrain[i - 1][0], `fc${c} terrain sorted`);
    }
  }
});

test('freeContract difficulty and reward scale with the counter', () => {
  const avg = (lo, hi, f) => {
    let sum = 0;
    for (let c = lo; c <= hi; c += 1) sum += f(freeContract(c));
    return sum / (hi - lo + 1);
  };
  assert.ok(avg(40, 50, dist) > avg(0, 10, dist), 'distance grows');
  assert.ok(avg(40, 50, (l) => l.reward) > avg(0, 10, (l) => l.reward), 'reward grows');
  assert.ok(
    avg(40, 50, (l) => Math.abs(l.wind.baseX) + l.wind.gustAmp) >
      avg(0, 10, (l) => Math.abs(l.wind.baseX) + l.wind.gustAmp),
    'wind gets meaner'
  );
  assert.ok(
    avg(40, 50, (l) => l.endRunway.length) < avg(0, 10, (l) => l.endRunway.length),
    'strips get shorter'
  );
});
