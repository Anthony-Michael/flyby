// data/missions.js — data + PURE generator. 8 campaign missions per docs/DESIGN.md §6/§8 schema.
// Owned by: Dev B (meta game). MVP requires missions m1–m5 fully tuned; m6–m8 included as data.
// Every mission must pass terrain.validateLevel() — enforced in test/missions.test.js.

/** @type {Array<object>} DESIGN §8 schema objects, ids m1..m8 */
export const MISSIONS = [
  {
    id: 'm1',
    name: 'First Solo',
    type: 'CARGO',
    briefing:
      'Just you, the Kestrel, and a bag of mail nobody is in a hurry for. ' +
      'Get her up, get her down soft — the range will teach you the rest.',
    cargoKg: 0,
    fuelL: 40,
    parTimeS: null,
    reward: 80,
    wind: { baseX: 0, gustAmp: 0 },
    terrain: [
      [0, 20],
      [2600, 20],
    ],
    startRunway: { x: 100, length: 400 },
    endRunway: { x: 1600, length: 400 },
    zones: [],
  },
  {
    id: 'm2',
    name: 'Mail Run',
    type: 'CARGO',
    briefing:
      'Two sacks of letters for the folks at Birch Landing. ' +
      'Tailwind today — she will fly like she has had her coffee.',
    cargoKg: 50,
    fuelL: 40,
    parTimeS: null,
    reward: 120,
    wind: { baseX: 2, gustAmp: 0 },
    terrain: [
      [0, 25],
      [500, 25],
      [900, 60],
      [1300, 40],
      [1700, 75],
      [2100, 45],
      [2500, 70],
      [2900, 30],
      [3100, 30],
      [3500, 30],
      [4000, 30],
    ],
    startRunway: { x: 100, length: 400 },
    endRunway: { x: 3100, length: 400 },
    zones: [],
  },
  {
    id: 'm3',
    name: 'Feed Drop',
    type: 'CARGO',
    briefing:
      'Two hundred fifty kilos of feed pellets for the Hollis farm. ' +
      'She will roll long and climb like she is dragging a plow — be patient with her.',
    cargoKg: 250,
    fuelL: 40,
    parTimeS: null,
    reward: 180,
    wind: { baseX: 0, gustAmp: 0 },
    terrain: [
      [0, 20],
      [4000, 20],
    ],
    startRunway: { x: 100, length: 400 },
    endRunway: { x: 3100, length: 400 },
    zones: [],
  },
  {
    id: 'm4',
    name: 'Headwind Haul',
    type: 'CARGO',
    briefing:
      'Fuel drums for the survey camp upriver, and a stiff wind on the nose the whole way. ' +
      'Your airspeed will lie sweet while the ground crawls by — watch the gauge, not the gut.',
    cargoKg: 100,
    fuelL: 40,
    parTimeS: null,
    reward: 220,
    wind: { baseX: -5, gustAmp: 1 },
    terrain: [
      [0, 30],
      [500, 30],
      [1200, 90],
      [2000, 60],
      [2800, 110],
      [3700, 40],
      [4100, 40],
      [4500, 40],
      [4900, 40],
    ],
    startRunway: { x: 100, length: 400 },
    endRunway: { x: 4100, length: 400 },
    zones: [],
  },
  {
    // §8 example JSON — used verbatim as designed.
    id: 'm5',
    name: 'The Notch',
    type: 'CARGO',
    briefing: 'Machine parts for the Notch mine. The pass is tighter than it looks.',
    cargoKg: 100,
    fuelL: 40,
    parTimeS: null,
    reward: 300,
    wind: { baseX: -2, gustAmp: 1 },
    terrain: [
      [0, 20],
      [900, 20],
      [1400, 80],
      [2200, 300],
      [2400, 300],
      [2460, 180],
      [2520, 300],
      [2700, 300],
      [3600, 90],
      [4400, 35],
      [5200, 35],
    ],
    startRunway: { x: 100, length: 400 },
    endRunway: { x: 4600, length: 300 },
    zones: [{ kind: 'downdraft', x: 2700, width: 400, vy: -3 }],
  },
  {
    id: 'm6',
    name: 'Doc Whitfield',
    type: 'CHARTER',
    briefing:
      'Doc Whitfield needs a lift out to Coldwater, and she remembers every bounce since 1978. ' +
      'Grease it onto that little shelf strip or hear about it all winter.',
    cargoKg: 90,
    fuelL: 40,
    parTimeS: null,
    reward: 400,
    wind: { baseX: -3, gustAmp: 2 },
    terrain: [
      [0, 25],
      [500, 25],
      [1000, 100],
      [1600, 170],
      [2200, 120],
      [2800, 200],
      [3400, 140],
      [3900, 95],
      [4100, 95],
      [4280, 95],
      [4600, 60],
      [5000, 60],
    ],
    startRunway: { x: 100, length: 400 },
    endRunway: { x: 4100, length: 180 },
    zones: [],
  },
  {
    id: 'm7',
    name: 'Long Haul',
    type: 'URGENT',
    briefing:
      'Winter stores for Fardown, nine klicks out, and the bowser only gave you thirty liters. ' +
      'Throttle like you are paying for it — because you are.',
    cargoKg: 150,
    fuelL: 30,
    parTimeS: 320,
    reward: 450,
    wind: { baseX: -4, gustAmp: 2 },
    terrain: [
      [0, 20],
      [500, 20],
      [1500, 70],
      [2500, 140],
      [3500, 90],
      [4500, 180],
      [5500, 120],
      [6500, 190],
      [7500, 100],
      [8600, 45],
      [9100, 45],
      [9500, 45],
      [10000, 45],
    ],
    startRunway: { x: 100, length: 400 },
    endRunway: { x: 9100, length: 400 },
    zones: [],
  },
  {
    id: 'm8',
    name: 'Storm Strip',
    type: 'CARGO',
    briefing:
      'Two hundred kilos of stove parts for the crew at Razorback. The wind is foul, the final is a ' +
      'washboard, and the strip ends where the cliff begins. Welcome to the big leagues.',
    cargoKg: 200,
    fuelL: 40,
    parTimeS: null,
    reward: 600,
    wind: { baseX: -6, gustAmp: 4 },
    terrain: [
      [0, 25],
      [500, 25],
      [1300, 110],
      [2300, 240],
      [3300, 150],
      [4300, 260],
      [5200, 90],
      [6040, 90],
      [6060, 220],
      [6100, 220],
      [6250, 220],
      [6310, 60],
      [6900, 60],
    ],
    startRunway: { x: 100, length: 400 },
    endRunway: { x: 6100, length: 150 },
    zones: [{ kind: 'downdraft', x: 5400, width: 600, vy: -4 }],
  },
];

// ---------------------------------------------------------------------------
// Free contracts — deterministic procedural missions (DESIGN §6, post-campaign)
// ---------------------------------------------------------------------------

/**
 * mulberry32-style integer hash → [0, 1). PURE, no RNG state.
 * Same (counter, salt) always yields the same value.
 */
function hash01(counter, salt) {
  let t = (Math.imul(counter + 1, 2654435761) ^ Math.imul(salt + 1, 1597334677)) >>> 0;
  t = (t + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const FC_PLACES = [
  'Kettle Fork',
  'Silver Creek',
  'Larch Bend',
  'Coldwater',
  'Fardown',
  'Mica Lake',
  'Razorback',
  'Birch Landing',
];
const FC_KINDS = ['Mail Run', 'Supply Drop', 'Freight Haul', 'Parts Run'];
const FC_BRIEFINGS = [
  'The board says {place}, the manifest says heavy enough. Same bargain as always: up, over, and down gently.',
  'Folks at {place} have been waiting on this load since Tuesday. The strip is where you left it — mostly.',
  'Another day, another run out to {place}. The pay is honest and so is the wind, more or less.',
  'Word from {place}: bring it whole and bring it soon. The Kettle Range does not care which.',
];

/**
 * Deterministic free-contract generator (post-campaign). Seeded by counter — same
 * counter, same mission. PURE, no RNG (use a hash of the counter).
 * Difficulty (distance, cargo, wind, terrain height, strip length) scales with counter.
 * Reward = f(distance × weight × wind) per DESIGN §6.
 * @param {number} counter
 * @returns {object} level object (DESIGN §8 schema, id `fc${counter}`)
 */
export function freeContract(counter) {
  const r = (salt) => hash01(counter, salt);
  const growth = Math.min(counter, 40); // difficulty ramp caps at counter 40

  const distM = 2000 + Math.round(r(1) * 1500) + growth * 150; // 2000 .. ~9500 m
  const cargoKg = Math.round(r(2) * (100 + growth * 5)); // 0 .. ~300 kg
  const windMax = Math.min(6, 1 + counter * 0.12);
  const baseX = Math.round((r(3) * 2 - 1) * windMax * 10) / 10; // head or tail
  const gustAmp = Math.round(r(4) * Math.min(4, counter * 0.15) * 10) / 10;

  // Reward scales with distance × weight × wind (§6).
  const reward = Math.round(
    (distM / 1000) * 40 * (1 + cargoKg / 300) * (1 + (Math.abs(baseX) + gustAmp) / 8)
  );

  // Runways. Destination strips shrink as the counter climbs.
  const startX = 100;
  const startLen = 400;
  const endLen = Math.max(200, 400 - counter * 4);
  const endX = startX + distM;

  // Terrain: flat across the start runway, rolling interior hills (taller with
  // counter), flat across the destination runway. Strictly increasing x.
  const e0 = 20;
  const eEnd = 20 + Math.round(r(5) * 60);
  const hillMax = 40 + growth * 5; // up to 240 m
  const terrain = [
    [0, e0],
    [startX + startLen + 150, e0], // flat through x=650
  ];
  const xStop = endX - 250;
  let xCur = startX + startLen + 150;
  let i = 0;
  while (xCur + 850 <= xStop) {
    xCur += 500 + Math.round(r(100 + i) * 300); // 500–800 m spacing
    terrain.push([xCur, 20 + Math.round(r(200 + i) * hillMax)]);
    i += 1;
  }
  terrain.push([xStop, eEnd]);
  terrain.push([endX + endLen, eEnd]); // flat across destination runway
  terrain.push([endX + endLen + 500, eEnd]);

  // Occasional downdraft on the back half of longer, later contracts.
  const zones = [];
  if (counter >= 10 && distM > 3500 && r(6) > 0.55) {
    zones.push({ kind: 'downdraft', x: endX - 1600, width: 400, vy: -3 });
  }

  const place = FC_PLACES[Math.floor(r(7) * FC_PLACES.length)];
  const kind = FC_KINDS[Math.floor(r(8) * FC_KINDS.length)];
  const briefing = FC_BRIEFINGS[Math.floor(r(9) * FC_BRIEFINGS.length)].replace('{place}', place);

  return {
    id: `fc${counter}`,
    name: `${place} ${kind}`,
    type: 'CARGO',
    briefing,
    cargoKg,
    fuelL: 40,
    parTimeS: null,
    reward,
    wind: { baseX, gustAmp },
    terrain,
    startRunway: { x: startX, length: startLen },
    endRunway: { x: endX, length: endLen },
    zones,
  };
}
