// Attack 1: input mashing — NaN/Infinity hunting, world-escape attempts.
import { createSimState, step, stepN, kestrel, m1, MISSIONS, DT, badNums, IDLE } from './qa-lib.mjs';
import { terrainHeightAt } from '../src/terrain.js';

let fails = 0;
const report = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails++;
};

// 1a. Alternate full up/down pitch every tick + throttle spam + airborne brake, 3 sim-minutes.
{
  let sim = createSimState(m1, kestrel);
  let bad = null, escaped = null;
  for (let i = 0; i < 60 * 180; i++) {
    const input = {
      pitch: i % 2 === 0 ? 1 : -1,
      throttleDelta: i % 3 === 0 ? 1 : -1,
      brake: i % 2 === 1, // brake while airborne too
    };
    sim = step(sim, input, m1, kestrel, DT);
    const b = badNums(sim.plane);
    if (b.length && !bad) bad = `tick ${i}: ${b.join(',')}`;
    const ty = terrainHeightAt(m1.terrain, sim.plane.x);
    if (!sim.plane.crashed && sim.plane.y < ty - 0.001 && !escaped) escaped = `tick ${i}: y=${sim.plane.y.toFixed(2)} < terrain ${ty}`;
    if (sim.phase === 'CRASHED') break;
  }
  report('mash pitch/throttle/brake: no NaN/Infinity', !bad, bad);
  report('mash: never below terrain uncrashed', !escaped, escaped);
}

// 1b. Full-throttle takeoff then alternate pitch every tick at altitude, 5 min.
{
  let sim = createSimState(m1, kestrel);
  sim = stepN(sim, m1, kestrel, 60 * 20, { pitch: 0.3, throttleDelta: 1, brake: false });
  let bad = null;
  for (let i = 0; i < 60 * 300 && sim.phase !== 'CRASHED'; i++) {
    sim = step(sim, { pitch: i % 2 ? 1 : -1, throttleDelta: 1, brake: false }, m1, kestrel, DT);
    const b = badNums(sim.plane);
    if (b.length) { bad = `tick ${i}: ${b.join(',')}`; break; }
  }
  report('airborne pitch flip 5min: finite state', !bad, bad);
}

// 1c. Insane input values (input.js clamps, but sim is the public seam — fuzz it).
{
  const weird = [
    { pitch: 1e9, throttleDelta: 1e9, brake: true },
    { pitch: -1e9, throttleDelta: -1e9, brake: false },
    { pitch: NaN, throttleDelta: NaN, brake: true },
    { pitch: Infinity, throttleDelta: -Infinity, brake: false },
  ];
  for (const input of weird) {
    let sim = createSimState(m1, kestrel);
    sim = stepN(sim, m1, kestrel, 600, input);
    const b = badNums(sim.plane);
    report(`weird input ${JSON.stringify(input)}: finite state`, b.length === 0, b.join(','));
  }
}

// 1d. Can x go negative / leave the world to the left?
{
  let sim = createSimState(m1, kestrel);
  // Taxi backwards? No reverse thrust; try wind. m1 has no wind. Use nose-down pitch on ground.
  sim = stepN(sim, m1, kestrel, 60 * 30, { pitch: -1, throttleDelta: 1, brake: false });
  report('ground mash stays sane', badNums(sim.plane).length === 0, badNums(sim.plane).join(','));
  console.log(`  info: after 30 s full throttle nose-down: x=${sim.plane.x.toFixed(1)} phase=${sim.phase} reason=${sim.crashReason}`);
}

// 1e. Fly left off the map on m1 (turn around is impossible, but a stall can drift left w/ wind).
{
  const m4 = MISSIONS.find((m) => m.id === 'm4'); // -5 m/s headwind
  let sim = createSimState(m4, kestrel);
  sim = stepN(sim, m4, kestrel, 60 * 15, { pitch: 0.5, throttleDelta: 1, brake: false });
  // now cut throttle, pitch full up, hang in the headwind and drift backwards
  let minX = sim.plane.x;
  for (let i = 0; i < 60 * 240 && sim.phase !== 'CRASHED'; i++) {
    sim = step(sim, { pitch: 1, throttleDelta: i < 600 ? -1 : (sim.plane.vx < -1 ? 0.4 : 0), brake: false }, m4, kestrel, DT);
    minX = Math.min(minX, sim.plane.x);
  }
  console.log(`  info: m4 backwards-drift attempt minX=${minX.toFixed(1)} endPhase=${sim.phase} reason=${sim.crashReason ?? '-'}`);
  report('backwards drift: state finite', badNums(sim.plane).length === 0, badNums(sim.plane).join(','));
}

console.log(fails ? `\n${fails} FAILURES` : '\nall clean');
