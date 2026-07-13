// Where in the flight do casual pilots die? Stage funnel per skill.
import { MISSIONS } from '../src/data/missions.js';
import { PLANES } from '../src/data/planes.js';
import { createSimState, step } from '../src/sim.js';
import { createHumanPilot, SKILLS } from './humanPilot.js';
const DT=1/60;
for (const skill of ['firstTimer','secondTry','warmedUp']) {
  const stages = {};
  for (const mid of ['m1','m2','m3']) {
    const level = MISSIONS.find(m=>m.id===mid);
    for (let seed=1; seed<=10; seed++) {
      const pilot = createHumanPilot(SKILLS[skill], seed);
      let sim = createSimState(level, PLANES.kestrel);
      let before = sim.plane;
      let sawTouchdown = false;
      let stage = 'timeout';
      for (let i=0;i<60*300;i++) {
        const input = pilot.next(sim, level, PLANES.kestrel, DT);
        before = sim.plane;
        sim = step(sim, input, level, PLANES.kestrel, DT);
        if (sim.events.includes('touchdown')) sawTouchdown = true;
        if (sim.phase==='CRASHED') {
          const nearEnd = Math.abs(before.x - (level.endRunway.x + level.endRunway.length)) < 60;
          stage = sawTouchdown ? `rollout-${sim.crashReason}${nearEnd?'(end)':''}`
                : `${sim.crashReason} vy=${before.vy.toFixed(1)} vx=${before.vx.toFixed(0)}`;
          break;
        }
        if (sim.phase==='LANDED' && sim.plane.vx===0) { stage='LANDED ★'.concat(String(sim.grade.stars)); break; }
      }
      const key = stage.replace(/vy=[-\d.]+ vx=\d+/,'').trim();
      (stages[key] ||= []).push(stage);
    }
  }
  console.log(`\n${skill}:`);
  for (const [k,v] of Object.entries(stages).sort((a,b)=>b[1].length-a[1].length)) {
    console.log(`  ${k}  x${v.length}`, k.startsWith('hard-impact')||k.startsWith('too-fast') ? ' e.g. '+v.slice(0,4).join(' | ') : '');
  }
}
