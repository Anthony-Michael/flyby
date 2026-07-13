// Attack 4 continued: from a clean touchdown (state-injected short final), abuse LANDED phase.
import { createSimState, step, kestrel, m1, DT, IDLE } from './qa-lib.mjs';

let bugs = 0;
const report = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'BUG '}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) bugs++;
};
const info = (s) => console.log('  info: ' + s);

// Clean landing via short-final injection: 3 m over the aim point area, gentle sink.
function cleanLanding(level = m1, plane = kestrel) {
  let sim = createSimState(level, plane);
  sim = {
    ...sim,
    phase: 'AIRBORNE',
    plane: { ...sim.plane, x: level.endRunway.x + 80, y: 20 + 3, vx: 22, vy: -0.8, pitch: 0.08, onGround: false, throttle: 0.3 },
  };
  for (let i = 0; i < 600 && sim.phase === 'AIRBORNE'; i++) {
    sim = step(sim, { pitch: sim.plane.vy < -1 ? 0.3 : 0, throttleDelta: -1, brake: false }, level, plane, DT);
  }
  return sim;
}

// 4d'. Land clean, then firewall the throttle and take off again from LANDED.
{
  let sim = cleanLanding();
  info(`clean landing: phase=${sim.phase} score=${sim.grade?.score} stars=${sim.grade?.stars} tdx=${sim.touchdown?.x?.toFixed(0)}`);
  if (sim.phase !== 'LANDED') { console.log('setup failed'); process.exit(1); }
  const firstScore = sim.grade.score;

  // throttle up and rotate — can we leave the ground in LANDED?
  for (let i = 0; i < 60 * 40; i++) {
    const p = sim.plane;
    sim = step(sim, { pitch: p.vx > 23 ? 1 : 0, throttleDelta: 1, brake: false }, m1, kestrel, DT);
    if (!sim.plane.onGround && sim.plane.y > 20 + 30) break;
    if (sim.phase === 'CRASHED') break;
  }
  info(`after re-takeoff: phase=${sim.phase} y=${sim.plane.y.toFixed(1)} onGround=${sim.plane.onGround} bounced=${sim.bounced} grade=${sim.grade?.score} (was ${firstScore})`);
  report('phase should not remain LANDED while climbing away at 30+ m AGL',
    !(sim.phase === 'LANDED' && !sim.plane.onGround),
    'sim stays LANDED airborne: overfly failsafe (AIRBORNE-only) is off, and game.js ends the flight the moment |vx|<0.5');

  // 4d''. stall it to |vx|<0.5 airborne → game.js finishFlight condition
  let midair = null;
  for (let i = 0; i < 60 * 120 && sim.phase === 'LANDED'; i++) {
    sim = step(sim, { pitch: 1, throttleDelta: -1, brake: false }, m1, kestrel, DT);
    if (!sim.plane.onGround && Math.abs(sim.plane.vx) < 0.5) {
      midair = { y: sim.plane.y, vx: sim.plane.vx, vy: sim.plane.vy };
      break;
    }
  }
  report('|vx|<0.5 must not be reachable airborne in LANDED phase',
    !midair,
    midair && `y=${midair.y.toFixed(1)} vx=${midair.vx.toFixed(3)} vy=${midair.vy.toFixed(1)} → game.js finishFlight fires mid-air, pays out touchdown grade ${sim.grade?.score}, plane vanishes into DEBRIEF while falling`);
}

// 4e'. Multi-bounce: is the -20 applied once or per bounce? And can a bounce IMPROVE things?
{
  let sim = cleanLanding();
  const scores = [sim.grade.score];
  for (let hop = 0; hop < 3 && sim.phase === 'LANDED'; hop++) {
    // hop up
    for (let i = 0; i < 60 * 20; i++) {
      const p = sim.plane;
      sim = step(sim, p.onGround ? { pitch: p.vx > 23 ? 0.8 : 0, throttleDelta: 1, brake: false } : { pitch: 0.2, throttleDelta: -1, brake: false }, m1, kestrel, DT);
      if (sim.phase === 'CRASHED') break;
      if (!p.onGround && sim.plane.onGround) break;
    }
    scores.push(sim.grade?.score);
  }
  info(`scores across hops: ${scores.join(' → ')} (phase=${sim.phase} ${sim.crashReason ?? ''})`);
  report('bounce deduction applied exactly once (no stacking, no vanishing)',
    scores.length < 2 || scores[1] === undefined || scores[0] - scores[1] === 20 && new Set(scores.slice(1)).size <= 1,
    `deltas: ${scores.map((s, i) => i ? scores[i - 1] - s : 0).join(',')}`);
}

// 4g. Crash during LANDED rollout (roll off the end): grade wiped, crash reported?
{
  let sim = cleanLanding();
  for (let i = 0; i < 60 * 60 && sim.phase === 'LANDED'; i++) {
    sim = step(sim, { pitch: 0, throttleDelta: 1, brake: false }, m1, kestrel, DT); // power through the end
  }
  info(`rollout overrun: phase=${sim.phase} reason=${sim.crashReason} grade=${JSON.stringify(sim.grade)} x=${sim.plane.x.toFixed(0)}`);
  report('rollout overrun crashes with grade wiped', sim.phase === 'CRASHED' && sim.grade === null, `phase=${sim.phase} grade=${JSON.stringify(sim.grade)}`);
}

// 4h. LANDED freeze check: once stopped, sim ignores input forever (t still advances) — by design?
{
  let sim = cleanLanding();
  for (let i = 0; i < 60 * 30 && !(sim.plane.vx === 0); i++) sim = step(sim, { pitch: 0, throttleDelta: -1, brake: true }, m1, kestrel, DT);
  const t0 = sim.t;
  sim = step(sim, { pitch: 1, throttleDelta: 1, brake: false }, m1, kestrel, DT);
  info(`after stop: vx=${sim.plane.vx} throttle=${sim.plane.throttle} t advanced ${((sim.t - t0) * 60).toFixed(1)} ticks — full freeze, fine for game.js (debrief fires at |vx|<0.5 anyway)`);
}

console.log(bugs ? `\n${bugs} PHASE BUGS` : '\nall clean');
