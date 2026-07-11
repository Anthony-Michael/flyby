// dev/harness.js — standalone presentation harness (Dev C). NOT part of the game.
// Feeds hand-written fake simState/level objects (shapes copied from src/sim.js,
// src/physics.js docs and DESIGN §8) into renderer/hud/input/juice. No sim imports.

import { createRenderer } from '../src/renderer.js';
import { createHud } from '../src/hud.js';
import { createInput } from '../src/input.js';
import { createJuice } from '../src/juice.js';

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');

const renderer = createRenderer(ctx);
const hud = createHud(ctx);
const input = createInput(window);
const juice = createJuice();

// ---------- fake data (DESIGN §8 example: The Notch) ----------
const LEVEL = {
  id: 'm5',
  name: 'The Notch',
  type: 'CARGO',
  briefing:
    'Machine parts for the Notch mine. The pass is tighter than it looks — thread the gap at 2,450 or climb over the ridge with room to spare. Downdraft on the far side.',
  cargoKg: 100,
  fuelL: 40,
  parTimeS: null,
  reward: 300,
  wind: { baseX: -2, gustAmp: 1 },
  terrain: [
    [0, 20], [900, 20], [1400, 80], [2200, 300], [2400, 300], [2460, 180],
    [2520, 300], [2700, 300], [3600, 90], [4400, 35], [5200, 35],
  ],
  startRunway: { x: 100, length: 400 },
  endRunway: { x: 4600, length: 300 },
  zones: [{ kind: 'downdraft', x: 2700, width: 400, vy: -3 }],
};

const KESTREL = { id: 'kestrel', name: 'Kestrel', tankL: 40 };

function terrainYAt(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

function blankSim() {
  return {
    plane: {
      x: 300, y: 20, vx: 0, vy: 0, pitch: 0, throttle: 0, fuel: 33.4,
      onGround: true, braking: false, crashed: false,
    },
    phase: 'ROLLOUT',
    t: 0,
    bounced: false,
    touchdown: null,
    grade: null,
    crashReason: null,
    events: [],
  };
}

const FAKE_GRADE = {
  score: 93,
  stars: 3,
  breakdown: [
    { label: 'Softness (−0.4 m/s)', deduction: 0 },
    { label: 'Touchdown speed (19.5 m/s)', deduction: 3 },
    { label: 'Zone accuracy (+41 m)', deduction: 2 },
    { label: 'Flare attitude (+5.7°)', deduction: 2 },
    { label: 'No bounce', deduction: 0 },
  ],
};
const FAKE_PAYOUT = [
  { label: 'Base reward', amount: 300 },
  { label: '★★★ grade ×1.3', amount: '+$90' },
  { label: 'Total', amount: 390 },
];
const FAKE_SAVE = {
  v: 1,
  money: 780,
  missionsCompleted: {
    m1: { bestScore: 94, stars: 3 },
    m2: { bestScore: 71, stars: 2 },
    m3: { bestScore: 66, stars: 1 },
    m4: { bestScore: 88, stars: 2 },
  },
  planesOwned: ['kestrel'],
  activePlane: 'kestrel',
  upgrades: { kestrel: ['tires'] },
};
const FAKE_MISSIONS = [
  { id: 'm1', name: 'First Solo', reward: 80 },
  { id: 'm2', name: 'Mail Run', reward: 120 },
  { id: 'm3', name: 'Feed Drop', reward: 180 },
  { id: 'm4', name: 'Headwind Haul', reward: 220 },
  { id: 'm5', name: 'The Notch', reward: 300 },
  { id: 'm6', name: 'Doc Whitfield', reward: 400 },
  { id: 'm7', name: 'Long Haul', reward: 450 },
  { id: 'm8', name: 'Storm Strip', reward: 600 },
];
const FAKE_PLANES = [
  { id: 'kestrel', name: 'Kestrel', cost: 0, blurb: 'The honest trainer.' },
  { id: 'mule', name: 'Mule', cost: 1200, blurb: 'Hauls double. Lands hot.' },
  { id: 'swift', name: 'Swift', cost: 2400, blurb: 'Fast and twitchy.' },
];
const FAKE_UPGRADES = [
  { id: 'tires', name: 'Tundra tires', cost: 300, blurb: 'Softer crash tolerance.' },
  { id: 'engine', name: 'Engine tune', cost: 500, blurb: 'Thrust +15%.' },
  { id: 'tank', name: 'Long-range tank', cost: 400, blurb: 'Tank +50%.' },
];

// ---------- scenes ----------
let sim = blankSim();
let sceneT = 0;
let userPitch = 0;
let userThrottle = 0.65;
let flag = false; // per-scene one-shot

const scenes = {
  // 1 — scripted parabolic-ish cruise toward the notch (no physics)
  1: {
    name: 'FLIGHT',
    reset() {
      sim = blankSim();
      userPitch = 0;
      userThrottle = 0.65;
    },
    update(dt) {
      const inp = input.read();
      userThrottle = Math.max(0, Math.min(1, userThrottle + inp.throttleDelta * 0.6 * dt));
      userPitch = userPitch * 0.9 + inp.pitch * 0.25 * 0.1 + userPitch * 0; // damped
      const p = sim.plane;
      const vx = 30 + userThrottle * 25;
      const vy = 9 * Math.cos(sceneT * 0.45) + inp.pitch * 8;
      p.x = 700 + ((sceneT * 42) % 3400);
      p.y = Math.max(terrainYAt(LEVEL.terrain, p.x) + 12, 330 + 55 * Math.sin(sceneT * 0.45) + inp.pitch * 30);
      p.vx = vx;
      p.vy = vy;
      p.pitch = Math.atan2(vy, vx) * 0.6 + 0.04;
      p.throttle = userThrottle;
      p.fuel = Math.max(0, 33.4 - sceneT * 0.1);
      p.onGround = false;
      sim.phase = 'AIRBORNE';
      sim.events = [];
    },
  },

  // 2 — takeoff roll on the start strip, ROTATE cue at 22 m/s
  2: {
    name: 'ROLLOUT',
    reset() {
      sim = blankSim();
      flag = false;
    },
    update(dt) {
      const p = sim.plane;
      p.throttle = Math.min(1, sceneT * 0.8);
      p.vx = Math.min(30, sceneT * 4.4);
      p.x = 130 + (p.vx * sceneT) / 2;
      p.y = 20;
      p.onGround = true;
      p.pitch = 0.04;
      sim.events = [];
      if (p.vx >= 22 && !flag) {
        flag = true;
        sim.events = ['rotate'];
      }
      if (sceneT > 8) resetScene();
    },
  },

  // 3 — crashed on the far hillside
  3: {
    name: 'CRASHED',
    reset() {
      sim = blankSim();
      const p = sim.plane;
      p.x = 3300;
      p.y = terrainYAt(LEVEL.terrain, 3300);
      p.vx = 0;
      p.vy = 0;
      p.pitch = 0.15;
      p.throttle = 0;
      p.crashed = true;
      p.onGround = true;
      sim.phase = 'CRASHED';
      sim.crashReason = 'hard-impact';
      flag = false;
    },
    update() {
      sim.events = [];
      if (!flag) {
        flag = true;
        sim.events = ['crash'];
      }
      // keep it smoldering for the screenshot
      if (sceneT % 1.2 < 0.02) sim.events = [...sim.events, 'crash-smolder'];
    },
  },

  // 4 — approach → touchdown → rollout → grade toast, loops
  4: {
    name: 'LANDING',
    reset() {
      sim = blankSim();
      const p = sim.plane;
      p.x = LEVEL.endRunway.x - 620;
      p.y = 35 + 42;
      p.vx = 26;
      p.vy = -1.4;
      p.pitch = 0.02;
      p.throttle = 0.25;
      p.onGround = false;
      sim.phase = 'AIRBORNE';
      flag = false;
    },
    update(dt) {
      const p = sim.plane;
      const elev = 35;
      sim.events = [];
      if (!p.onGround) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        // flare in the last 6 m
        if (p.y - elev < 6) {
          p.vy = Math.min(-0.4, p.vy + 2.2 * dt);
          p.pitch = Math.min(0.1, p.pitch + 0.09 * dt);
          p.throttle = Math.max(0, p.throttle - 0.5 * dt);
        }
        if (p.y <= elev) {
          p.y = elev;
          sim.touchdown = { vy: -0.4, vx: 22, pitch: p.pitch, x: p.x, bounced: false };
          sim.grade = FAKE_GRADE;
          sim.phase = 'LANDED';
          p.onGround = true;
          p.vy = 0;
          sim.events = ['touchdown'];
        }
      } else {
        p.braking = true;
        p.vx = Math.max(0, p.vx - 3.5 * dt);
        p.x += p.vx * dt;
        p.pitch = Math.max(0.03, p.pitch - 0.05 * dt);
        p.throttle = 0;
        if (p.vx === 0 && sceneT > 0 && !flag) flag = true;
      }
      if (flag && sceneT > 14) resetScene();
    },
  },

  // 5–8 — panels (5/6 draw the world dimmed behind them)
  5: { name: 'BRIEFING', reset: setupHighFlight, update: idleFlight, panel: () => hud.drawBriefing(LEVEL, 0) },
  6: { name: 'DEBRIEF', reset: setupHighFlight, update: idleFlight, panel: () => hud.drawDebrief(FAKE_GRADE, FAKE_PAYOUT, 0) },
  7: { name: 'MENU', reset: setupHighFlight, update: idleFlight, panel: () => hud.drawMenu(FAKE_SAVE, FAKE_MISSIONS, 4) },
  8: { name: 'HANGAR', reset: setupHighFlight, update: idleFlight, panel: () => hud.drawHangar(FAKE_SAVE, FAKE_PLANES, FAKE_UPGRADES, 1) },

  // 9 — mushing along on the edge of a stall
  9: {
    name: 'STALL',
    reset() {
      sim = blankSim();
      const p = sim.plane;
      p.x = 1800;
      p.y = 380;
      p.onGround = false;
      sim.phase = 'AIRBORNE';
    },
    update(dt) {
      const p = sim.plane;
      p.vx = 16.5 + Math.sin(sceneT * 1.1);
      p.vy = -1.6 + Math.sin(sceneT * 2.2);
      p.pitch = 0.34;
      p.throttle = 0.9;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      sim.events = ['stall-warning'];
    },
  },
};

function setupHighFlight() {
  sim = blankSim();
  const p = sim.plane;
  p.x = 1500;
  p.y = 320;
  p.vx = 40;
  p.vy = 0;
  p.pitch = 0.05;
  p.throttle = 0.64;
  p.onGround = false;
  sim.phase = 'AIRBORNE';
}
function idleFlight(dt) {
  sim.plane.x = 1500 + ((sceneT * 12) % 400);
  sim.events = [];
}

let current = 1;
function resetScene() {
  sceneT = 0;
  sim = blankSim();
  scenes[current].reset();
}
window.addEventListener('keydown', (e) => {
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 9 && scenes[n]) {
    current = n;
    resetScene();
  }
});

// ---------- loop ----------
resetScene();
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  sceneT += dt;
  sim.t = (sim.t || 0) + dt;

  const scene = scenes[current];
  scene.update(dt);

  juice.onEvents(sim.events, sim);
  juice.update(dt);
  const off = juice.offset();

  renderer.render(sim, LEVEL, {
    shakeX: off.x,
    shakeY: off.y,
    particles: (c, cam) => juice.drawParticles(c, cam),
  });

  if (scene.panel) {
    scene.panel();
  } else {
    hud.drawFlightHUD(sim, LEVEL, KESTREL);
  }

  // harness label
  ctx.font = '600 11px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(242,227,192,0.5)';
  ctx.fillText(`scene ${current} — ${scene.name}`, 10, 16);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
