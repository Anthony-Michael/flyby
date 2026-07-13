// run.js — playtest matrix: missions 1-3 x skill levels x 10 seeded human
// variations. Headless, deterministic. Usage:
//   node playtest/run.js            # summary table
//   node playtest/run.js --json     # raw per-run records as JSON
//   node playtest/run.js --trace m1 firstTimer 3   # 1 Hz flight log of one run

import { MISSIONS } from '../src/data/missions.js';
import { PLANES } from '../src/data/planes.js';
import { createSimState, step } from '../src/sim.js';
import { terrainHeightAt } from '../src/terrain.js';
import { createHumanPilot, SKILLS } from './humanPilot.js';

const DT = 1 / 60;
const MAX_TICKS = 60 * 300; // 5 min then Casey has closed the tab
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const MISSION_IDS = ['m1', 'm2', 'm3'];
const SKILL_NAMES = ['firstTimer', 'secondTry', 'warmedUp', 'robot'];

export function flyOnce(level, plane, skillName, seed, trace = false) {
  const pilot = createHumanPilot(SKILLS[skillName], seed);
  let sim = createSimState(level, plane);
  let liftoffT = null;
  let stallTicks = 0;
  let lastLogT = -1;

  for (let i = 0; i < MAX_TICKS; i++) {
    const input = pilot.next(sim, level, plane, DT);
    sim = step(sim, input, level, plane, DT);
    if (sim.events.includes('liftoff') && liftoffT === null) liftoffT = sim.t;
    if (sim.events.includes('stall-warning')) stallTicks++;

    if (trace && sim.t - lastLogT >= 1) {
      lastLogT = sim.t;
      const p = sim.plane;
      const agl = p.y - terrainHeightAt(level.terrain, p.x);
      console.log(
        `t=${sim.t.toFixed(0).padStart(3)}s ${sim.phase.padEnd(8)} x=${p.x.toFixed(0).padStart(5)} ` +
        `agl=${agl.toFixed(1).padStart(6)} vx=${p.vx.toFixed(1).padStart(5)} vy=${p.vy.toFixed(2).padStart(6)} ` +
        `pitch=${p.pitch.toFixed(2).padStart(5)} thr=${p.throttle.toFixed(2)} ` +
        `in=[${input.pitch},${input.throttleDelta},${input.brake ? 'B' : '-'}]`
      );
    }

    if (sim.phase === 'CRASHED') break;
    if (sim.phase === 'LANDED' && sim.plane.onGround && sim.plane.vx === 0) break;
  }

  const outcome =
    sim.phase === 'CRASHED' ? 'CRASHED'
    : sim.phase === 'LANDED' && sim.plane.vx === 0 ? 'LANDED'
    : 'TIMEOUT';

  return {
    mission: level.id, skill: skillName, seed,
    outcome,
    reason: sim.crashReason,
    score: sim.grade?.score ?? null,
    stars: sim.grade?.stars ?? null,
    timeS: Math.round(sim.t),
    liftoffT: liftoffT === null ? null : Math.round(liftoffT * 10) / 10,
    tdVy: sim.touchdown ? Math.round(sim.touchdown.vy * 100) / 100 : null,
    tdVx: sim.touchdown ? Math.round(sim.touchdown.vx * 10) / 10 : null,
    bounced: sim.bounced,
    stallWarnS: Math.round(stallTicks * DT * 10) / 10,
    fuelLeft: Math.round(sim.plane.fuel * 10) / 10,
    brakes: pilot.params.brakeDelayS === Infinity ? 'forgot' : 'used',
  };
}

function pct(n, d) { return d === 0 ? '—' : `${Math.round((100 * n) / d)}%`; }
function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null; }

function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--trace') {
    const level = MISSIONS.find((m) => m.id === args[1]);
    const rec = flyOnce(level, PLANES.kestrel, args[2], Number(args[3] ?? 1), true);
    console.log(JSON.stringify(rec, null, 2));
    return;
  }

  const records = [];
  for (const mid of MISSION_IDS) {
    const level = MISSIONS.find((m) => m.id === mid);
    for (const skill of SKILL_NAMES) {
      const seeds = skill === 'robot' ? [1] : SEEDS; // robot has no variation
      for (const seed of seeds) records.push(flyOnce(level, PLANES.kestrel, skill, seed));
    }
  }

  if (args[0] === '--json') {
    console.log(JSON.stringify(records, null, 2));
    return;
  }

  console.log('mission  skill        n   crash  landed  meanScore  stars(1/2/3)  meanTime  crashReasons');
  console.log('-'.repeat(110));
  for (const mid of MISSION_IDS) {
    for (const skill of SKILL_NAMES) {
      const rs = records.filter((r) => r.mission === mid && r.skill === skill);
      const crashed = rs.filter((r) => r.outcome === 'CRASHED');
      const landed = rs.filter((r) => r.outcome === 'LANDED');
      const timeouts = rs.filter((r) => r.outcome === 'TIMEOUT');
      const reasons = {};
      for (const r of crashed) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
      const scores = landed.map((r) => r.score);
      const starC = [1, 2, 3].map((s) => landed.filter((r) => r.stars === s).length);
      console.log(
        `${mid.padEnd(8)} ${skill.padEnd(12)} ${String(rs.length).padStart(2)}  ` +
        `${pct(crashed.length, rs.length).padStart(5)}  ${pct(landed.length, rs.length).padStart(6)}  ` +
        `${(scores.length ? mean(scores).toFixed(0) : '—').padStart(9)}  ` +
        `${`${starC[0]}/${starC[1]}/${starC[2]}`.padStart(12)}  ` +
        `${(landed.length ? `${mean(landed.map((r) => r.timeS)).toFixed(0)}s` : '—').padStart(8)}  ` +
        `${Object.entries(reasons).map(([k, v]) => `${k}x${v}`).join(' ')}` +
        `${timeouts.length ? ` TIMEOUTx${timeouts.length}` : ''}`
      );
    }
    console.log();
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) main();
