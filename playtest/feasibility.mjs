// Physical completability check, no clever piloting: fly a max-performance
// climber (full throttle, best-climb pitch) through the real sim and record the
// altitude envelope vs x. If envelope clears terrain+margin everywhere and fuel
// lasts and the strip out-lengths the landing roll, the mission is beatable.
import { MISSIONS } from '../src/data/missions.js';
import { PLANES } from '../src/data/planes.js';
import { createSimState, step } from '../src/sim.js';
import { terrainHeightAt } from '../src/terrain.js';
const DT = 1/60;

for (const m of MISSIONS) {
  const plane = PLANES.kestrel;
  let sim = createSimState(m, plane);
  let maxNeededClimb = 0, worstX = 0, minClearance = Infinity, minClearX = 0;
  let fuelAtStrip = null, tAtStrip = null;
  // max-perf: full throttle; pitch to hold ~best climb without stalling
  for (let i = 0; i < 60*600; i++) {
    const p = sim.plane;
    const airspeed = Math.hypot(p.vx, p.vy);
    // hold 26-30 m/s in the climb by modulating pitch
    const pitchT = p.onGround ? (airspeed > 22 ? 0.20 : 0) : (airspeed > 30 ? 0.22 : airspeed > 26 ? 0.14 : 0.02);
    const input = { pitch: Math.sign(pitchT - p.pitch) * (Math.abs(pitchT-p.pitch) > 0.01 ? 1 : 0), throttleDelta: 1, brake: false };
    sim = step(sim, input, m, plane, DT);
    if (sim.phase === 'CRASHED') { console.log(`${m.id}: max-perf climber CRASHED (${sim.crashReason}) at x=${sim.plane.x.toFixed(0)}`); break; }
    const x = sim.plane.x;
    if (x > m.endRunway.x) { fuelAtStrip = sim.plane.fuel; tAtStrip = sim.t; break; }
    const clr = sim.plane.y - terrainHeightAt(m.terrain, x);
    if (!sim.plane.onGround && clr < minClearance) { minClearance = clr; minClearX = x; }
  }
  const over = m.terrain.reduce((a,[x,e]) => Math.max(a, e), 0);
  console.log(`${m.id} ${m.name}: peakTerrain=${over}m  minClearance=${minClearance===Infinity?'n/a':minClearance.toFixed(0)+'m @x='+minClearX.toFixed(0)}  reachedStrip=${fuelAtStrip!=null} fuelLeft=${fuelAtStrip?.toFixed(1) ?? '—'}L t=${tAtStrip?.toFixed(0) ?? '—'}s  stripLen=${m.endRunway.length}m (landing roll from 22m/s ≈ ${((22*22)/(2*4.1)).toFixed(0)}m braked)`);
}
