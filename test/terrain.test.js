// terrain.test.js — DESIGN §8: elevation lookup + level validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { terrainHeightAt, validateLevel } from '../src/terrain.js';

// The Notch (§8 example) terrain, verbatim.
const NOTCH = [[0, 20], [900, 20], [1400, 80], [2200, 300], [2400, 300], [2460, 180], [2520, 300], [2700, 300], [3600, 90], [4400, 35], [5200, 35]];

test('terrainHeightAt returns exact elevations at control points', () => {
  for (const [x, y] of NOTCH) assert.equal(terrainHeightAt(NOTCH, x), y);
});

test('terrainHeightAt interpolates linearly between control points', () => {
  assert.equal(terrainHeightAt(NOTCH, 450), 20); // flat span
  assert.equal(terrainHeightAt(NOTCH, 1150), 50); // midpoint of 20→80 rise
  assert.equal(terrainHeightAt(NOTCH, 2430), 240); // midpoint of 300→180 notch wall
  assert.equal(terrainHeightAt(NOTCH, 1800), 80 + (300 - 80) * 0.5); // 1400→2200 halfway
});

test('terrainHeightAt clamps beyond the first and last points', () => {
  assert.equal(terrainHeightAt(NOTCH, -500), 20);
  assert.equal(terrainHeightAt(NOTCH, 99999), 35);
});

function flatLevel(over = {}) {
  return {
    id: 'm-test',
    name: 'Test Flat',
    type: 'CARGO',
    cargoKg: 0,
    fuelL: 40,
    reward: 80,
    wind: { baseX: 0, gustAmp: 0 },
    terrain: [[0, 20], [2600, 20]],
    startRunway: { x: 100, length: 400 },
    endRunway: { x: 1700, length: 400 },
    zones: [],
    ...over,
  };
}

test('validateLevel accepts a well-formed flat level', () => {
  assert.deepEqual(validateLevel(flatLevel()), []);
});

test('validateLevel accepts the §8 example mission (The Notch)', () => {
  const m5 = {
    id: 'm5',
    name: 'The Notch',
    type: 'CARGO',
    cargoKg: 100,
    fuelL: 40,
    parTimeS: null,
    reward: 300,
    wind: { baseX: -2, gustAmp: 1 },
    terrain: NOTCH,
    startRunway: { x: 100, length: 400 },
    endRunway: { x: 4600, length: 300 },
    zones: [{ kind: 'downdraft', x: 2700, width: 400, vy: -3 }],
  };
  assert.deepEqual(validateLevel(m5), []);
});

test('validateLevel flags unsorted terrain points', () => {
  const problems = validateLevel(flatLevel({ terrain: [[0, 20], [900, 20], [400, 50], [2600, 20]] }));
  assert.ok(problems.some((p) => p.includes('sorted')), problems.join('; '));
});

test('validateLevel flags a runway on sloped terrain', () => {
  const problems = validateLevel(flatLevel({ terrain: [[0, 20], [300, 60], [2600, 60]] }));
  assert.ok(problems.some((p) => p.includes('flat') && p.includes('startRunway')), problems.join('; '));
});

test('validateLevel flags terrain that does not cover a runway', () => {
  const problems = validateLevel(flatLevel({ terrain: [[0, 20], [1800, 20]] }));
  assert.ok(problems.some((p) => p.includes('cover') && p.includes('endRunway')), problems.join('; '));
});

test('validateLevel flags start runway not before end runway', () => {
  const problems = validateLevel(flatLevel({ endRunway: { x: 350, length: 400 }, terrain: [[0, 20], [2600, 20]] }));
  assert.ok(problems.some((p) => p.includes('before')), problems.join('; '));
});

test('validateLevel flags missing required fields', () => {
  const problems = validateLevel({});
  assert.ok(problems.some((p) => p.includes('"id"')));
  assert.ok(problems.some((p) => p.includes('"terrain"')));
  assert.ok(problems.some((p) => p.includes('"startRunway"')));
  assert.ok(problems.some((p) => p.includes('"endRunway"')));
});

test('validateLevel flags malformed zones and bad numeric fields', () => {
  const problems = validateLevel(flatLevel({
    zones: [{ kind: 'downdraft', x: 500 }], // missing width/vy
    cargoKg: -5,
    fuelL: 0,
  }));
  assert.ok(problems.some((p) => p.includes('zone 0')));
  assert.ok(problems.some((p) => p.includes('cargoKg')));
  assert.ok(problems.some((p) => p.includes('fuelL')));
});

test('validateLevel handles a non-object without throwing', () => {
  assert.deepEqual(validateLevel(null), ['level is not an object']);
});
