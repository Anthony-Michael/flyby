// game.js — IMPURE. rAF loop, fixed-step accumulator (dt = 1/60), screen state machine:
// MENU → BRIEF → FLY → DEBRIEF → (MENU|BRIEF) plus HANGAR. docs/DESIGN.md §2, §10.
// Owned by: Lead (integration). Wires sim/economy/save/renderer/hud/juice/input/monetize.

import { createSimState, step } from './sim.js';
import { missionPayout, applyPurchase, unlockedMissions, recordCompletion } from './economy.js';
import { loadSave, persistSave } from './save.js';
import { PLANES, UPGRADES, effectivePlane } from './data/planes.js';
import { MISSIONS, freeContract } from './data/missions.js';
import { createInput } from './input.js';
import { createRenderer } from './renderer.js';
import { createHud } from './hud.js';
import { createJuice } from './juice.js';
import { hooks } from './monetize.js';

const DT = 1 / 60;
const MAX_FRAME = 0.1; // clamp long frames (tab switch) so the accumulator doesn't spiral

/**
 * Boot the game loop against a canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {Window} win
 */
export function startGame(canvas, win) {
  const ctx = canvas.getContext('2d');

  // --- canvas sizing ---
  // The renderer and HUD lay everything out against ctx.canvas.width/height and were
  // tuned in CSS-pixel units, so the backing store must equal the CSS size 1:1 with no
  // dpr transform — otherwise their centering math lands off-screen on HiDPI displays
  // and font sizes drift. Trade a little retina sharpness for correct layout.
  function resize() {
    canvas.width = win.innerWidth;
    canvas.height = win.innerHeight;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  resize();
  win.addEventListener('resize', resize);

  const input = createInput(win);
  const renderer = createRenderer(ctx);
  const hud = createHud(ctx);
  const juice = createJuice();

  let save = loadSave();
  juice.setEnabled({ shake: save.settings?.shake !== false, sound: save.settings?.sound !== false });

  // --- screen state ---
  // screen: 'MENU' | 'HANGAR' | 'BRIEF' | 'FLY' | 'DEBRIEF'
  const S = {
    screen: 'MENU',
    selection: 0,                // shared cursor index for menu/hangar/brief/debrief panels
    hangarError: null,
    mission: null,               // active mission/level object
    plane: null,                 // effective plane constants for the flight
    sim: null,                   // SimState during FLY
    paused: false,
    accumulator: 0,
    lastTime: null,
    debrief: null,               // { grade, payoutLines, success, crashReason }
    transitioning: false,        // guards async onMissionEnd
  };

  // --- mission list shown in the menu (campaign + next free contract when done) ---
  function menuMissions() {
    const list = [...MISSIONS];
    const allDone = MISSIONS.every((m) => save.missionsCompleted[m.id]);
    if (allDone) list.push(freeContract(save.freeContractCounter));
    return list;
  }

  function startFlight(mission) {
    S.mission = mission;
    S.plane = effectivePlane(save.activePlane, save);
    S.sim = createSimState(mission, S.plane);
    S.paused = false;
    S.accumulator = 0;
    S.screen = 'FLY';
  }

  // Landing success requires stopping on the DESTINATION runway; the sim grades any
  // runway landing, so the wrong-strip case becomes a failed-but-retryable debrief.
  function landedAtDestination(sim, mission) {
    const r = mission.endRunway;
    const tx = sim.touchdown?.x ?? -1;
    return tx >= r.x && tx <= r.x + r.length;
  }

  async function finishFlight() {
    S.transitioning = true;
    const sim = S.sim;
    let debrief;
    if (sim.phase === 'CRASHED') {
      debrief = {
        grade: { score: 0, stars: 0, crashed: true, breakdown: [{ label: crashLabel(sim.crashReason), deduction: 100 }] },
        payoutLines: [],
        success: false,
      };
    } else if (!landedAtDestination(sim, S.mission)) {
      debrief = {
        grade: { ...sim.grade, stars: 0, breakdown: [{ label: 'Landed at the wrong airstrip', deduction: 100 }] },
        payoutLines: [{ label: 'Wrong airstrip — cargo undelivered', amount: 0 }],
        success: false,
      };
    } else {
      const isRepeat = Boolean(save.missionsCompleted[S.mission.id]);
      const result = { stars: sim.grade.stars, score: sim.grade.score, timeS: sim.t };
      const { payout, lines } = missionPayout(S.mission, result, isRepeat);
      save = recordCompletion(save, S.mission.id, { ...result, payout });
      if (S.mission.id.startsWith('fc')) save = { ...save, freeContractCounter: save.freeContractCounter + 1 };
      persistSave(save);
      debrief = { grade: sim.grade, payoutLines: lines, success: true };
    }
    await hooks.onMissionEnd();
    S.debrief = debrief;
    S.selection = 0;
    S.screen = 'DEBRIEF';
    S.transitioning = false;
  }

  // End the run as a failure for reasons the sim itself doesn't model (overfly).
  async function failFlight(label) {
    S.transitioning = true;
    await hooks.onMissionEnd();
    S.debrief = {
      grade: { score: 0, stars: 0, crashed: true, breakdown: [{ label, deduction: 100 }] },
      payoutLines: [],
      success: false,
    };
    S.selection = 0;
    S.screen = 'DEBRIEF';
    S.transitioning = false;
  }

  function crashLabel(reason) {
    return {
      'hard-impact': 'Hard impact — gear collapsed',
      'too-fast': 'Came in way too hot',
      'nose-strike': 'Nose gear strike',
      'tail-strike': 'Tail strike',
      'off-runway': 'Terrain contact off the strip',
    }[reason] || 'Crashed';
  }

  // --- per-screen update logic (menus are event-driven, FLY is fixed-step) ---
  function updateMenus() {
    const nav = input.consumeNav();
    if (S.screen === 'MENU') {
      const missions = menuMissions();
      const unlocked = new Set(unlockedMissions(save, missions));
      if (nav.dy) S.selection = clampIndex(S.selection + nav.dy, missions.length);
      if (input.consumeHangar()) { S.selection = 0; S.screen = 'HANGAR'; return; }
      if (input.consumeConfirm()) {
        const m = missions[S.selection];
        if (m && unlocked.has(m.id)) { S.selection = 0; S.mission = m; S.screen = 'BRIEF'; }
      }
      hud.drawMenu(save, missions, S.selection);
    } else if (S.screen === 'HANGAR') {
      const itemCount = Object.keys(PLANES).length + Object.keys(UPGRADES).length;
      if (nav.dy) S.selection = clampIndex(S.selection + nav.dy, itemCount);
      if (input.consumeBack()) { S.selection = 0; S.screen = 'MENU'; return; }
      if (input.consumeConfirm()) {
        const item = hangarItemAt(S.selection);
        if (item) {
          const res = applyPurchase(save, item);
          if (res.ok) { save = res.save; persistSave(save); }
          S.hangarError = res.ok ? null : res.error;
        }
      }
      hud.drawHangar(save, PLANES, UPGRADES, S.selection);
    } else if (S.screen === 'BRIEF') {
      if (input.consumeBack()) { S.screen = 'MENU'; return; }
      if (input.consumeConfirm()) { startFlight(S.mission); return; }
      hud.drawBriefing(S.mission, S.selection);
    } else if (S.screen === 'DEBRIEF') {
      if (input.consumeRestart()) { startFlight(S.mission); return; }
      if (input.consumeConfirm()) { S.selection = 0; S.screen = 'MENU'; return; }
      hud.drawDebrief(S.debrief.grade, S.debrief.payoutLines, S.selection);
    }
  }

  function hangarItemAt(index) {
    const planes = Object.values(PLANES).map((p) => ({ kind: 'plane', id: p.id, cost: p.cost }));
    const upgrades = Object.values(UPGRADES).map((u) => ({ kind: 'upgrade', id: u.id, cost: u.cost, planeId: save.activePlane }));
    return [...planes, ...upgrades][index] || null;
  }

  function updateFlight(frameSeconds) {
    if (input.consumeRestart()) { startFlight(S.mission); return; }
    if (input.consumePause()) S.paused = !S.paused;

    if (!S.paused && !S.transitioning) {
      S.accumulator += frameSeconds;
      while (S.accumulator >= DT) {
        S.accumulator -= DT;
        S.sim = step(S.sim, input.read(), S.mission, S.plane, DT);
        juice.onEvents(S.sim.events, S.sim);
      }
      juice.update(frameSeconds);
      if ((S.sim.phase === 'LANDED' && Math.abs(S.sim.plane.vx) < 0.5) || S.sim.phase === 'CRASHED') {
        if (!S.transitioning) finishFlight();
      }
      // Overfly: the plane can't turn around, so sailing far past the strip would
      // otherwise strand the flight in limbo. The HUD warns first (strip-behind
      // arrow + "YOU PASSED THE STRIP"); 400 m past the strip the run ends as a
      // failure — a few seconds of warning, not a scenic tour off the map.
      const endR = S.mission.endRunway;
      if (S.sim.phase === 'AIRBORNE' && S.sim.plane.x > endR.x + endR.length + 400 && !S.transitioning) {
        failFlight('Flew past the destination strip');
      }
    }

    win.__skyhaul = S; // dev hook: inspect live game state from the console

    const off = juice.offset();
    renderer.render(S.sim, S.mission, {
      shakeX: off.x,
      shakeY: off.y,
      particles: (pctx, camera) => juice.drawParticles(pctx, camera),
    });
    hud.drawFlightHUD(S.sim, S.mission, S.plane);
    if (S.paused) drawPauseOverlay();
  }

  function drawPauseOverlay() {
    const w = canvas.width, h = canvas.height;
    ctx.save();
    ctx.fillStyle = 'rgba(10, 14, 20, 0.55)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f4ead8';
    ctx.font = '700 42px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PAUSED', w / 2, h / 2);
    ctx.font = '400 16px system-ui, sans-serif';
    ctx.fillText('P to resume · R to restart', w / 2, h / 2 + 32);
    ctx.restore();
  }

  function clampIndex(i, n) {
    return Math.max(0, Math.min(n - 1, i));
  }

  // --- main loop ---
  function frame(tMs) {
    const t = tMs / 1000;
    const frameSeconds = Math.min(S.lastTime === null ? DT : t - S.lastTime, MAX_FRAME);
    S.lastTime = t;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (S.screen === 'FLY') updateFlight(frameSeconds);
    else updateMenus();

    win.requestAnimationFrame(frame);
  }

  hooks.onGameLoaded();
  win.requestAnimationFrame(frame);
}
