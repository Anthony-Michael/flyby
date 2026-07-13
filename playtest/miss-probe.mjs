// Where do warmedUp pilots touch relative to the strip?
import { MISSIONS } from '../src/data/missions.js';
import { PLANES } from '../src/data/planes.js';
import { createSimState, step } from '../src/sim.js';
import { createHumanPilot, SKILLS } from './humanPilot.js';
const DT=1/60;
for (const mid of ['m1','m2','m3']) {
  const level = MISSIONS.find(m=>m.id===mid);
  const R = level.endRunway;
  const rows=[];
  for (let seed=1; seed<=10; seed++) {
    const pilot = createHumanPilot(SKILLS.warmedUp, seed);
    let sim = createSimState(level, PLANES.kestrel);
    let before = sim.plane;
    for (let i=0;i<60*300;i++) {
      const input = pilot.next(sim, level, PLANES.kestrel, DT);
      before = sim.plane;
      sim = step(sim, input, level, PLANES.kestrel, DT);
      if (sim.phase==='CRASHED') { rows.push(`s${seed} ${sim.crashReason}@x=${before.x.toFixed(0)} (strip ${R.x}-${R.x+R.length}) vy=${before.vy.toFixed(1)} vx=${before.vx.toFixed(0)}`); break; }
      if (sim.phase==='LANDED' && sim.plane.vx===0) { rows.push(`s${seed} LANDED ★${sim.grade.stars} score=${sim.grade.score}`); break; }
    }
  }
  console.log(mid, R.x+'-'+(R.x+R.length)); rows.forEach(r=>console.log('  '+r));
}
