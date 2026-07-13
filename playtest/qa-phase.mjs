// Attack 4: phase machine abuse — bounce farming, land+takeoff, low-flight, taxi-to-destination.
import { createSimState, step, stepN, kestrel, m1, DT, IDLE } from './qa-lib.mjs';

let bugs = 0;
const report = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'BUG '}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) bugs++;
};
const info = (s) => console.log('  info: ' + s);

// Simple autopilot: climb to target AGL, cruise, then glide onto the end runway.
function flyMission(level, plane, { cruiseAGL = 60 } = {}) {
  let sim = createSimState(level, plane);
  const aim = level.endRunway.x + level.endRunway.length / 3;
  for (let i = 0; i < 60 * 600; i++) {
    const p = sim.plane;
    let input;
    if (sim.phase === 'ROLLOUT' || (p.y < 20 + cruiseAGL - 10 && p.x < aim - 900)) {
      input = { pitch: p.vx > 24 ? 0.45 : 0, throttleDelta: 1, brake: false };
    } else if (p.x < aim - 700) {
      input = { pitch: p.y > 20 + cruiseAGL ? -0.15 : 0.15, throttleDelta: p.vx > 33 ? -1 : 1, brake: false };
    } else {
      // approach: bleed speed, shallow descent, flare near ground
      const agl = p.y - 20;
      const wantVy = agl > 15 ? -2 : -0.5;
      input = {
        pitch: p.vy < wantVy ? 0.6 : -0.2,
        throttleDelta: p.vx > 22 ? -1 : (p.vx < 19 ? 1 : 0),
        brake: p.onGround,
      };
    }
    sim = step(sim, input, level, plane, DT);
    if (sim.phase === 'CRASHED') return sim;
    if (sim.phase === 'LANDED' && sim.plane.vx === 0) return sim;
  }
  return sim;
}

// 4a. Baseline: autopilot can complete m1 (sanity for the harness itself).
{
  const sim = flyMission(m1, kestrel);
  info(`baseline m1: phase=${sim.phase} score=${sim.grade?.score} stars=${sim.grade?.stars} tdx=${sim.touchdown?.x?.toFixed(0)} reason=${sim.crashReason ?? '-'}`);
}

// 4b. TAXI to destination: never lift off. m1 is flat — full throttle, hold nose down.
{
  let sim = createSimState(m1, kestrel);
  let ticks = 0;
  for (; ticks < 60 * 300; ticks++) {
    const onEnd = sim.plane.x >= m1.endRunway.x;
    sim = step(sim, { pitch: -1, throttleDelta: onEnd ? -1 : 1, brake: onEnd }, m1, kestrel, DT);
    if (sim.phase === 'CRASHED') break;
    if (sim.plane.vx === 0 && sim.plane.x >= m1.endRunway.x) break;
  }
  info(`taxi: x=${sim.plane.x.toFixed(0)} vx=${sim.plane.vx.toFixed(2)} phase=${sim.phase} grade=${JSON.stringify(sim.grade)} t=${sim.t.toFixed(0)}s`);
  report('taxi to destination runway should not leave the game in limbo (no LANDED/CRASHED = FLY never ends)',
    sim.phase === 'CRASHED' || sim.phase === 'LANDED',
    `phase=${sim.phase} — game.js finishFlight never fires; player is stuck in FLY forever (only R/Esc escape)`);
}

// 4c. LOW FLIGHT: lift off but never exceed 15 m AGL, land on destination runway.
{
  let sim = createSimState(m1, kestrel);
  for (let i = 0; i < 60 * 300; i++) {
    const p = sim.plane;
    const agl = p.y - 20;
    let input;
    if (p.x < m1.endRunway.x - 300) {
      // hold ~8 m AGL
      input = { pitch: agl < 6 && p.vx > 26 ? 0.5 : (agl > 10 ? -0.4 : 0.05), throttleDelta: p.vx < 30 ? 1 : -1, brake: false };
    } else {
      input = { pitch: p.vy < -1.5 ? 0.5 : -0.1, throttleDelta: -1, brake: p.onGround };
    }
    sim = step(sim, input, m1, kestrel, DT);
    if (sim.phase === 'CRASHED') break;
    if (p.onGround === false && sim.plane.onGround && sim.plane.x > m1.endRunway.x) {
      // touched down at destination
    }
    if (sim.plane.vx === 0 && sim.plane.x >= m1.endRunway.x && sim.plane.onGround) break;
  }
  info(`low flight: x=${sim.plane.x.toFixed(0)} phase=${sim.phase} touchdown=${JSON.stringify(sim.touchdown)} grade=${sim.grade ? sim.grade.score : null}`);
  report('sub-15m-AGL flight to destination must still be gradeable/endable',
    sim.phase === 'LANDED' || sim.phase === 'CRASHED',
    `phase=${sim.phase}: touchdown on destination strip while still ROLLOUT records no grade, mission cannot end`);
}

// 4d. Bounce farming: grade at first touchdown, bounce, land again MUCH worse — which grade counts?
{
  const level = m1;
  // fly and land softly, then firewall throttle, lift off, and slam back down hard
  let sim = flyMission(level, kestrel);
  if (sim.phase === 'LANDED') {
    const firstGrade = sim.grade?.score;
    // takeoff again from LANDED
    for (let i = 0; i < 60 * 60 && !sim.plane.crashed; i++) {
      const p = sim.plane;
      let input;
      if (p.onGround && p.vx < 30) input = { pitch: 0, throttleDelta: 1, brake: false };
      else if (p.y < 60) input = { pitch: 0.5, throttleDelta: 1, brake: false };
      else break;
      sim = step(sim, input, level, kestrel, DT);
    }
    info(`re-takeoff from LANDED: phase=${sim.phase} y=${sim.plane.y.toFixed(1)} onGround=${sim.plane.onGround} grade=${sim.grade?.score} (first=${firstGrade}) bounced=${sim.bounced}`);
    report('phase stays LANDED while flying at 60m — game.js will end the flight mid-air if |vx| drops < 0.5',
      sim.phase !== 'LANDED' || sim.plane.onGround,
      `phase=${sim.phase}, airborne at y=${sim.plane.y.toFixed(0)} — also overfly failsafe only checks AIRBORNE`);
    // now stall it: pull up, cut throttle, watch vx
    let midairFinish = false;
    for (let i = 0; i < 60 * 120 && sim.phase !== 'CRASHED'; i++) {
      sim = step(sim, { pitch: 1, throttleDelta: -1, brake: false }, level, kestrel, DT);
      if (!sim.plane.onGround && Math.abs(sim.plane.vx) < 0.5 && sim.phase === 'LANDED') { midairFinish = true; break; }
    }
    report('cannot trigger the |vx|<0.5 LANDED finish while airborne',
      !midairFinish,
      `airborne y=${sim.plane.y.toFixed(1)} vy=${sim.plane.vy.toFixed(1)} vx=${sim.plane.vx.toFixed(2)} phase=LANDED → finishFlight() mid-air, payout for grade ${sim.grade?.score}`);
  } else {
    info(`bounce test setup failed: phase=${sim.phase} ${sim.crashReason ?? ''}`);
  }
}

// 4e. Multiple bounces: only one -20? (grade should not stack deductions per §5... check behavior)
{
  let sim = flyMission(m1, kestrel);
  if (sim.phase === 'LANDED') {
    const g1 = sim.grade.score;
    let grades = [g1];
    for (let b = 0; b < 3; b++) {
      // hop: throttle up till liftoff, then cut and settle
      for (let i = 0; i < 60 * 30; i++) {
        const p = sim.plane;
        sim = step(sim, p.onGround ? { pitch: 0.2, throttleDelta: 1, brake: false } : { pitch: 0.3, throttleDelta: -1, brake: false }, m1, kestrel, DT);
        if (sim.phase === 'CRASHED') break;
        if (!p.onGround && sim.plane.onGround) break; // re-contact
      }
      if (sim.phase === 'CRASHED') break;
      grades.push(sim.grade?.score);
    }
    info(`grade after each hop: ${grades.join(' → ')} (phase=${sim.phase}, reason=${sim.crashReason ?? '-'})`);
  }
}

// 4f. Land on the START runway — what does the sim report?
{
  let sim = createSimState(m1, kestrel);
  // take off, climb above 15m to go AIRBORNE, then land straight ahead... start runway is behind.
  // Instead: climb to 16m quickly with a steep pull, cut power, drop back onto start runway.
  for (let i = 0; i < 60 * 120; i++) {
    const p = sim.plane;
    let input;
    if (sim.phase === 'ROLLOUT') input = { pitch: p.vx > 23 ? 1 : 0, throttleDelta: 1, brake: false };
    else input = { pitch: p.vy < -2 ? 0.8 : -0.3, throttleDelta: -1, brake: p.onGround };
    sim = step(sim, input, m1, kestrel, DT);
    if (sim.phase === 'CRASHED') break;
    if (sim.phase === 'LANDED' && sim.plane.vx === 0) break;
  }
  info(`start-runway landing: phase=${sim.phase} tdx=${sim.touchdown?.x?.toFixed(0)} grade=${sim.grade?.score} reason=${sim.crashReason ?? '-'}`);
  info('game.js: landedAtDestination()=false → "wrong airstrip" debrief. Sim itself is fine with it.');
}

console.log(bugs ? `\n${bugs} PHASE BUGS` : '\nall clean');
