// impact-probe.mjs — measure HOW players crash: capture the plane state on the
// tick before ground contact, for every crash across the human-skill matrix.
import { MISSIONS } from '../src/data/missions.js';
import { PLANES } from '../src/data/planes.js';
import { createSimState, step } from '../src/sim.js';
import { createHumanPilot, SKILLS } from './humanPilot.js';

const DT = 1/60;
const buckets = {};                       // reason -> array of {vy, vx, pitch}
for (const mid of ['m1','m2','m3']) {
  const level = MISSIONS.find(m=>m.id===mid);
  for (const skill of ['firstTimer','secondTry','warmedUp']) {
    for (let seed=1; seed<=10; seed++) {
      const pilot = createHumanPilot(SKILLS[skill], seed);
      let sim = createSimState(level, PLANES.kestrel);
      let prev = sim.plane;
      for (let i=0;i<60*300;i++) {
        const input = pilot.next(sim, level, PLANES.kestrel, DT);
        const before = sim.plane;
        sim = step(sim, input, level, PLANES.kestrel, DT);
        if (sim.phase==='CRASHED') {
          (buckets[sim.crashReason] ||= []).push({vy:+before.vy.toFixed(2), vx:+before.vx.toFixed(1), pitch:+(before.pitch*57.3).toFixed(1)});
          break;
        }
        if (sim.phase==='LANDED' && sim.plane.vx===0) break;
        prev = before;
      }
    }
  }
}
for (const [reason, arr] of Object.entries(buckets)) {
  const vys = arr.map(a=>a.vy).sort((a,b)=>a-b);
  const med = vys[Math.floor(vys.length/2)];
  const q = (p)=>vys[Math.floor(vys.length*p)];
  console.log(`${reason}: n=${arr.length}  vy median=${med}  p25=${q(0.25)}  p75=${q(0.75)}  min=${vys[0]}  max=${vys[vys.length-1]}`);
  if (reason==='too-fast') console.log('   vx values:', arr.map(a=>a.vx).sort((a,b)=>a-b).join(', '));
}
