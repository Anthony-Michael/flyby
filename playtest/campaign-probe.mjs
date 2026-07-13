// Full-campaign completability with the terrain-aware human pilot (all skills + robot).
import { MISSIONS } from '../src/data/missions.js';
import { PLANES } from '../src/data/planes.js';
import { flyOnce } from './run.js';

for (const m of MISSIONS) {
  const rows = [];
  for (const skill of ['warmedUp','robot']) {
    const outs = [];
    for (let seed=1; seed<= (skill==='robot'?3:10); seed++) {
      const r = flyOnce(m, PLANES.kestrel, skill, seed);
      outs.push(r);
    }
    const landed = outs.filter(o=>o.outcome==='LANDED');
    rows.push(`${skill}: ${landed.length}/${outs.length} landed` +
      (landed.length? ` scores=[${landed.map(o=>o.score).join(',')}]` : '') +
      ` reasons=${outs.filter(o=>o.outcome!=='LANDED').map(o=>o.crashReason||o.outcome).join(',')||'-'}`);
  }
  console.log(`${m.id} ${m.name}`);
  rows.forEach(r=>console.log('   '+r));
}
