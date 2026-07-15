// juice.js — IMPURE. Screen shake, particles, WebAudio blips. docs/DESIGN.md §9.
// Owned by: Dev C (presentation). Consumes simState.events each tick
// ('touchdown','crash','liftoff','stall-warning'). All procedural, no assets.
//
// Audio note: the AudioContext is created LAZILY on the first sound-triggering call
// (never at import time). Browsers keep it suspended until a user gesture; we retry
// resume() on every use, so audio unmutes on the first key press. All references to
// `window` happen inside function bodies — plain `import` of this module is side-effect
// free and safe under node.
//
// drawParticles camera contract: { toScreen(wx, wy) => [sx, sy], pxPerM } — exactly what
// renderer.js passes to the viewFx.particles callback.

/**
 * @returns {{
 *   onEvents: (events, simState) => void,   // feed this tick's sim events
 *   update: (dt) => void,                    // advance shake decay + particles
 *   offset: () => ({x:number, y:number}),    // current shake offset, px
 *   drawParticles: (ctx, camera) => void,
 *   setEnabled: (opts) => void,              // {shake, sound}
 * }}
 */
export function createJuice() {
  const enabled = { shake: true, sound: true };

  // --- shake ---
  let shakeAmp = 0; // px
  let shakeLeft = 0; // s remaining
  let shakeDur = 0.25;
  let rumble = 0; // continuous ground-roll jitter, px

  // --- particles ---
  const particles = [];
  const MAX_PARTICLES = 400;

  // --- timing (advanced by update(dt), no Date) ---
  let time = 0;

  // --- audio ---
  let audio = null;
  let audioDead = false;
  let engineOsc = null;
  let engineGain = null;
  let engineFilter = null;
  let stallOsc = null;
  let stallGain = null;
  let stallUntil = -1;
  let lastThrottle = 0;
  let engineOn = false;

  function ac() {
    if (!enabled.sound || audioDead) return null;
    if (!audio) {
      try {
        const AC =
          typeof window !== 'undefined' &&
          (window.AudioContext || window.webkitAudioContext);
        if (!AC) {
          audioDead = true;
          return null;
        }
        audio = new AC();
      } catch (e) {
        audioDead = true;
        return null;
      }
    }
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    return audio;
  }

  function addShake(px, dur) {
    if (px > shakeAmp * (shakeLeft / (shakeDur || 1))) {
      shakeAmp = px;
      shakeDur = dur;
      shakeLeft = dur;
    }
  }

  function spawn(p) {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    particles.push(p);
  }

  function dustBurst(x, y, n, spread) {
    for (let i = 0; i < n; i++) {
      spawn({
        type: 'dust',
        x: x + (Math.random() - 0.5) * 2,
        y: y + Math.random() * 0.4,
        vx: (Math.random() - 0.5) * spread,
        vy: 1 + Math.random() * 2.5,
        r: 0.25 + Math.random() * 0.5,
        life: 0.5 + Math.random() * 0.5,
        maxLife: 1,
      });
    }
  }

  // ---------- sounds ----------
  function chirp() {
    const a = ac();
    if (!a) return;
    const len = Math.floor(a.sampleRate * 0.04);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource();
    src.buffer = buf;
    const bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 1.2;
    const g = a.createGain();
    g.gain.value = 0.22;
    src.connect(bp);
    bp.connect(g);
    g.connect(a.destination);
    src.start();
  }

  function crashNoise() {
    const a = ac();
    if (!a) return;
    const len = Math.floor(a.sampleRate * 0.5);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const src = a.createBufferSource();
    src.buffer = buf;
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = a.createGain();
    g.gain.value = 0.4;
    src.connect(lp);
    lp.connect(g);
    g.connect(a.destination);
    src.start();
  }

  // Bright two-note ring-pass chime (E6 → B6), short and cheerful.
  function chime() {
    const a = ac();
    if (!a) return;
    for (const [freq, when] of [[1318.5, 0], [1975.5, 0.09]]) {
      const osc = a.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = a.createGain();
      const t0 = a.currentTime + when;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      osc.connect(g);
      g.connect(a.destination);
      osc.start(t0);
      osc.stop(t0 + 0.25);
    }
  }

  function ensureEngine() {
    const a = ac();
    if (!a || engineOsc) return;
    engineOsc = a.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 45;
    engineFilter = a.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 320;
    engineGain = a.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(a.destination);
    engineOsc.start();
    engineOn = true;
  }

  function updateEngine(throttle) {
    lastThrottle = throttle;
    if (!enabled.sound) return;
    ensureEngine();
    if (!engineOsc || !audio) return;
    const t = audio.currentTime;
    engineOsc.frequency.setTargetAtTime(42 + throttle * 78, t, 0.08);
    // subtle: idle barely audible, full throttle still a hum not a roar
    engineGain.gain.setTargetAtTime(0.006 + throttle * 0.024, t, 0.1);
  }

  function stopEngine() {
    if (engineOsc) {
      try {
        engineOsc.stop();
      } catch (e) { /* already stopped */ }
      engineOsc.disconnect();
      engineOsc = null;
      engineGain = null;
      engineFilter = null;
      engineOn = false;
    }
  }

  function ensureStall() {
    const a = ac();
    if (!a || stallOsc) return;
    stallOsc = a.createOscillator();
    stallOsc.type = 'triangle';
    stallOsc.frequency.value = 760;
    stallGain = a.createGain();
    stallGain.gain.value = 0.035;
    stallOsc.connect(stallGain);
    stallGain.connect(a.destination);
    stallOsc.start();
  }

  function stopStall() {
    if (stallOsc) {
      try {
        stallOsc.stop();
      } catch (e) { /* already stopped */ }
      stallOsc.disconnect();
      stallOsc = null;
      stallGain = null;
    }
  }

  // ---------- API ----------
  function onEvents(events, simState) {
    const p = simState && simState.plane;
    if (!p) return;
    const groundY = p.y; // wheels ride at plane.y when onGround

    for (const ev of events || []) {
      if (ev === 'touchdown') {
        const vy = Math.abs(
          (simState.touchdown && simState.touchdown.vy) != null
            ? simState.touchdown.vy
            : p.vy
        );
        // 2–10 px scaled to |vy| over the graded range 0.6..2.5 m/s (DESIGN §9)
        const k = Math.min(1, Math.max(0, (vy - 0.4) / 2.1));
        addShake(2 + k * 8, 0.25);
        dustBurst(p.x, groundY, 8 + Math.round(k * 10), 6);
        chirp();
      } else if (ev === 'crash') {
        addShake(16, 0.8);
        crashNoise();
        stopEngine();
        // smoke
        for (let i = 0; i < 18; i++) {
          spawn({
            type: 'smoke',
            x: p.x + (Math.random() - 0.5) * 4,
            y: groundY + Math.random() * 2,
            vx: (Math.random() - 0.5) * 2,
            vy: 2 + Math.random() * 3,
            r: 0.8 + Math.random() * 1.2,
            life: 1.2 + Math.random() * 1.4,
            maxLife: 2.6,
          });
        }
        // tumbling debris rects
        for (let i = 0; i < 10; i++) {
          spawn({
            type: 'debris',
            x: p.x,
            y: groundY + 1,
            vx: (Math.random() - 0.5) * 16,
            vy: 4 + Math.random() * 9,
            w: 0.3 + Math.random() * 0.7,
            h: 0.15 + Math.random() * 0.35,
            ang: Math.random() * Math.PI,
            va: (Math.random() - 0.5) * 14,
            life: 1.4 + Math.random() * 0.8,
            maxLife: 2.2,
            dark: Math.random() > 0.5,
          });
        }
      } else if (ev === 'liftoff') {
        dustBurst(p.x, groundY, 5, 4);
      } else if (ev === 'stall-warning') {
        stallUntil = time + 0.3;
        if (enabled.sound) ensureStall();
      } else if (ev === 'ring-pass') {
        // sparkle burst at the plane + a bright two-note chime
        for (let i = 0; i < 12; i++) {
          const ang = (i / 12) * Math.PI * 2;
          spawn({
            type: 'streak',
            x: p.x, y: p.y,
            vx: Math.cos(ang) * (4 + Math.random() * 3),
            vy: Math.sin(ang) * (4 + Math.random() * 3),
            r: 0.5,
            life: 0.5 + Math.random() * 0.3,
            maxLife: 0.8,
          });
        }
        chime();
      }
    }

    // continuous: ground-roll rumble
    if (p.onGround && !p.crashed && Math.abs(p.vx) > 3) {
      rumble = Math.min(1.6, (Math.abs(p.vx) / 30) * 1.6);
      if (Math.abs(p.vx) > 8 && Math.random() < 0.3) {
        dustBurst(p.x - 2, groundY, 1, 3);
      }
    } else {
      rumble = 0;
    }

    // continuous: prop-wash streaks at full throttle
    if (!p.crashed && p.throttle > 0.85 && Math.random() < 0.5) {
      const facing = p.vx >= 0 ? 1 : -1;
      spawn({
        type: 'streak',
        x: p.x + 2 * facing,
        y: p.y + 1.2 + (Math.random() - 0.5) * 1.6,
        vx: -facing * (14 + Math.random() * 8),
        vy: (Math.random() - 0.5) * 1.5,
        life: 0.28,
        maxLife: 0.28,
      });
    }

    // continuous: engine hum
    if (!p.crashed && enabled.sound) updateEngine(p.throttle || 0);
    else if (p.crashed && engineOn) stopEngine();
  }

  function update(dt) {
    time += dt;
    if (shakeLeft > 0) shakeLeft = Math.max(0, shakeLeft - dt);

    // stall warble: modulate while active, kill when events stop flowing
    if (stallOsc) {
      if (time > stallUntil) stopStall();
      else if (audio) {
        stallOsc.frequency.setValueAtTime(
          720 + 170 * Math.sin(time * 26),
          audio.currentTime
        );
      }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      if (pt.type === 'dust') {
        pt.vy -= 3 * dt;
        pt.vx *= 1 - 1.5 * dt;
        pt.r += 0.8 * dt;
      } else if (pt.type === 'smoke') {
        pt.vy += 0.5 * dt; // buoyant
        pt.r += 1.4 * dt;
      } else if (pt.type === 'debris') {
        pt.vy -= 9.8 * dt;
        pt.ang += pt.va * dt;
      }
    }
  }

  function offset() {
    if (!enabled.shake) return { x: 0, y: 0 };
    let amp = rumble * 0.8;
    if (shakeLeft > 0 && shakeDur > 0) {
      const k = shakeLeft / shakeDur;
      amp += shakeAmp * k * k; // quadratic decay
    }
    if (amp <= 0.01) return { x: 0, y: 0 };
    return {
      x: (Math.random() - 0.5) * 2 * amp,
      y: (Math.random() - 0.5) * 2 * amp,
    };
  }

  function drawParticles(ctx, camera) {
    const px = camera.pxPerM || 6;
    for (const pt of particles) {
      const [sx, sy] = camera.toScreen(pt.x, pt.y);
      const a = Math.max(0, pt.life / pt.maxLife);
      if (pt.type === 'dust') {
        ctx.fillStyle = `rgba(196,172,128,${0.45 * a})`;
        ctx.beginPath();
        ctx.arc(sx, sy, pt.r * px, 0, Math.PI * 2);
        ctx.fill();
      } else if (pt.type === 'smoke') {
        ctx.fillStyle = `rgba(70,64,58,${0.5 * a})`;
        ctx.beginPath();
        ctx.arc(sx, sy, pt.r * px, 0, Math.PI * 2);
        ctx.fill();
      } else if (pt.type === 'debris') {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(pt.ang);
        ctx.fillStyle = pt.dark
          ? `rgba(38,19,15,${0.9 * a})`
          : `rgba(138,51,36,${0.9 * a})`;
        ctx.fillRect((-pt.w / 2) * px, (-pt.h / 2) * px, pt.w * px, pt.h * px);
        ctx.restore();
      } else if (pt.type === 'streak') {
        ctx.strokeStyle = `rgba(242,227,192,${0.3 * a})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - pt.vx * 0.06 * px, sy);
        ctx.stroke();
      }
    }
  }

  function setEnabled(opts) {
    if (!opts) return;
    if (typeof opts.shake === 'boolean') enabled.shake = opts.shake;
    if (typeof opts.sound === 'boolean') {
      enabled.sound = opts.sound;
      if (!opts.sound) {
        stopEngine();
        stopStall();
      }
    }
  }

  return { onEvents, update, offset, drawParticles, setEnabled };
}
