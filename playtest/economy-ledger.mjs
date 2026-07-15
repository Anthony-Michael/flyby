// economy-ledger.mjs — realistic playthrough ledger. Flies the campaign in
// order (m1..m8, linear gating), retrying each mission with fresh seeds until
// the pilot actually lands on the destination strip (matching game.js's
// landedAtDestination gate, not just sim.phase==='LANDED'), applies the real
// economy.js payout/persistence path, and reports $/minute plus the sim-time
// at which tires ($300) / tank ($400) / engine ($500) / Mule ($1200) /
// Swift ($2400) first become affordable. Two pilots: warmedUp (casual ceiling)
// and robot (near-optimal) bound the realistic range.
import { MISSIONS } from '../src/data/missions.js';
import { PLANES } from '../src/data/planes.js';
import { createSimState, step } from '../src/sim.js';
import { terrainHeightAt } from '../src/terrain.js';
import { createHumanPilot, SKILLS } from './humanPilot.js';
import { missionPayout, recordCompletion } from '../src/economy.js';
import { migrate } from '../src/migrate.js';

const DT = 1 / 60;
const MAX_TICKS = 60 * 300;
const MAX_RETRIES = 40;

function attempt(level, plane, skillName, seed) {
  const pilot = createHumanPilot(SKILLS[skillName], seed);
  let sim = createSimState(level, plane);
  for (let i = 0; i < MAX_TICKS; i++) {
    const input = pilot.next(sim, level, plane, DT);
    sim = step(sim, input, level, plane, DT);
    if (sim.phase === 'CRASHED') break;
    if (sim.phase === 'LANDED' && sim.plane.vx === 0) break;
  }
  const r = level.endRunway;
  const tdx = sim.touchdown?.x;
  const landedAtDest = sim.phase === 'LANDED' && sim.plane.vx === 0 && tdx != null && tdx >= r.x && tdx <= r.x + r.length;
  return { sim, landedAtDest, timeS: sim.t };
}

const PRICES = [
  { label: 'Tundra tires', cost: 300 },
  { label: 'Long-range tank', cost: 400 },
  { label: 'Engine tune', cost: 500 },
  { label: 'Mule', cost: 1200 },
  { label: 'Swift', cost: 2400 },
];

function runLedger(skillName) {
  console.log(`\n=== ${skillName} ===`);
  let save = migrate(null);
  let totalPlaytimeS = 0;
  let totalAttempts = 0;
  const affordedAt = new Map();

  for (let mIdx = 0; mIdx < MISSIONS.length; mIdx++) {
    const mission = MISSIONS[mIdx];
    let landed = null;
    let attemptsHere = 0;
    for (let tryN = 0; tryN < MAX_RETRIES; tryN++) {
      attemptsHere++;
      totalAttempts++;
      const seed = mIdx * 1000 + tryN + 1;
      const { sim, landedAtDest, timeS } = attempt(mission, PLANES.kestrel, skillName, seed);
      totalPlaytimeS += timeS;
      if (landedAtDest) { landed = sim; break; }
    }
    if (!landed) {
      console.log(
        `${mission.id} ${mission.name}: STUCK — ${skillName} did not land at destination in ${MAX_RETRIES} attempts. ` +
        `Ledger stops here (linear gating blocks m${mIdx + 2}+). Playtime so far: ${(totalPlaytimeS / 60).toFixed(1)} min, money=$${save.money}.`
      );
      break;
    }
    const isRepeat = Boolean(save.missionsCompleted[mission.id]);
    const result = { stars: landed.grade.stars, score: landed.grade.score, timeS: landed.t };
    const { payout } = missionPayout(mission, result, isRepeat);
    save = recordCompletion(save, mission.id, { ...result, payout });
    console.log(
      `${mission.id} ${mission.name}: landed after ${attemptsHere} attempt(s), ★${result.stars} score=${result.score}, ` +
      `payout=$${payout}, money=$${save.money}, cum-playtime=${(totalPlaytimeS / 60).toFixed(1)} min`
    );
    for (const p of PRICES) {
      if (!affordedAt.has(p.label) && save.money >= p.cost) {
        affordedAt.set(p.label, { mission: mission.id, playtimeMin: totalPlaytimeS / 60, money: save.money });
      }
    }
  }

  console.log(`\n${skillName} summary:`);
  console.log(`  total playtime: ${(totalPlaytimeS / 60).toFixed(1)} min across ${totalAttempts} attempts`);
  console.log(`  final money: $${save.money}`);
  console.log(`  $/min (avg over full ledger): ${totalPlaytimeS > 0 ? (save.money / (totalPlaytimeS / 60)).toFixed(1) : '—'}`);
  for (const p of PRICES) {
    const a = affordedAt.get(p.label);
    console.log(
      `  ${p.label.padEnd(18)} $${String(p.cost).padStart(5)}: ` +
      (a ? `affordable after ${a.mission} (${a.playtimeMin.toFixed(1)} min, $${a.money})` : 'not affordable within this ledger')
    );
  }
  return { save, totalPlaytimeS, totalAttempts };
}

runLedger('warmedUp');
runLedger('robot');
