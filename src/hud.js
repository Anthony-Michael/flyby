// hud.js — IMPURE. Bottom instrument strip + toasts + screen overlays. docs/DESIGN.md §9.
// Owned by: Dev C (presentation).
// Instruments L→R: airspeed (amber<22, red<19 + STALL), altitude AGL, VSI bar (the star
// instrument), throttle, fuel, distance-to-destination. Also: ROTATE cue, grade toast,
// briefing/debrief/menu/hangar panels (canvas-drawn, keyboard-navigated).
//
// Notes for integration (game.js):
// - selection params are plain integers (highlighted row / option index).
// - drawDebrief payoutLines: array of strings OR {label, amount} objects — both accepted.
// - Airspeed shown is approximated as ground velocity minus level.wind.baseX (HUD has no
//   physics import); if sim later exposes simState.airspeed the HUD will prefer it.

const STRIP_H = 60;

const P = {
  panel: 'rgba(24,18,12,0.78)',
  panelLine: 'rgba(242,227,192,0.25)',
  cream: '#f2e3c0',
  creamDim: 'rgba(242,227,192,0.55)',
  creamFaint: 'rgba(242,227,192,0.28)',
  amber: '#e8a33c',
  red: '#d94f35',
  green: '#8fb34f',
  gold: '#e8b64c',
  ox: '#8a3324',
  oxDark: '#5e2015',
  ink: '#2c2013',
  paper: '#f0e2c2',
  bgTop: '#2b2115',
  bgBot: '#1a130c',
};

const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const SERIF = "Georgia, 'Times New Roman', serif";

function fmtMoney(n) {
  const v = Math.round(Math.abs(n));
  return (n < 0 ? '−$' : '$') + v.toLocaleString('en-US');
}

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

function windLabel(wind) {
  if (!wind || (!wind.baseX && !wind.gustAmp)) return 'Calm';
  const b = wind.baseX || 0;
  let s = b === 0 ? 'Calm' : `${Math.abs(b)} m/s ${b < 0 ? 'headwind' : 'tailwind'}`;
  if ((wind.gustAmp || 0) >= 2) s += ', gusty';
  else if (wind.gustAmp > 0) s += ', light gusts';
  return s;
}

export function createHud(ctx) {
  // internal presentation state (timing driven by simState.t — no Date)
  let rotateUntil = -1;
  let toastT0 = null;
  let hadGrade = false;

  const W = () => ctx.canvas.width;
  const H = () => ctx.canvas.height;

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  }

  function star(cx, cy, r, filled) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr2 = i % 2 === 0 ? r : r * 0.44;
      const x = cx + Math.cos(ang) * rr2;
      const y = cy + Math.sin(ang) * rr2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    if (filled) {
      ctx.fillStyle = P.gold;
      ctx.fill();
      ctx.strokeStyle = P.ink;
      ctx.lineWidth = Math.max(1.5, r * 0.08);
      ctx.stroke();
    } else {
      ctx.strokeStyle = P.creamFaint;
      ctx.lineWidth = Math.max(1.5, r * 0.07);
      ctx.stroke();
    }
  }

  function wrapText(text, x, y, maxW, lineH, font, color) {
    ctx.font = font;
    ctx.fillStyle = color;
    const words = String(text).split(/\s+/);
    let line = '';
    let yy = y;
    for (const wd of words) {
      const t = line ? line + ' ' + wd : wd;
      if (ctx.measureText(t).width > maxW && line) {
        ctx.fillText(line, x, yy);
        line = wd;
        yy += lineH;
      } else line = t;
    }
    if (line) ctx.fillText(line, x, yy);
    return yy + lineH;
  }

  function flash(t, hz = 3.5) {
    return (t * hz) % 1 < 0.55;
  }

  // ============================== FLIGHT HUD ==============================
  function drawFlightHUD(simState, level, plane) {
    const w = W();
    const h = H();
    const p = simState.plane;
    const t = simState.t || 0;

    // strip panel
    const y0 = h - STRIP_H;
    ctx.fillStyle = P.panel;
    ctx.fillRect(0, y0, w, STRIP_H);
    ctx.strokeStyle = P.panelLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y0 + 0.5);
    ctx.lineTo(w, y0 + 0.5);
    ctx.stroke();

    const cy = y0 + STRIP_H / 2;
    const sep = (x) => {
      ctx.strokeStyle = 'rgba(242,227,192,0.12)';
      ctx.beginPath();
      ctx.moveTo(x, y0 + 9);
      ctx.lineTo(x, y0 + STRIP_H - 9);
      ctx.stroke();
    };
    const label = (txt, x, cw) => {
      ctx.font = `600 9px ${MONO}`;
      ctx.fillStyle = P.creamDim;
      ctx.textAlign = 'center';
      ctx.fillText(txt, x + cw / 2, y0 + 15);
    };

    // --- 1. airspeed ---
    const airspeed =
      simState.airspeed != null
        ? simState.airspeed
        : Math.hypot(p.vx - ((level.wind && level.wind.baseX) || 0), p.vy);
    let x = 10;
    const cwAS = 108;
    label('AIRSPEED  m/s', x, cwAS);
    let asColor = P.cream;
    if (airspeed < 19) asColor = flash(t, 5) ? P.red : P.creamDim;
    else if (airspeed < 22) asColor = P.amber;
    ctx.font = `700 24px ${MONO}`;
    ctx.fillStyle = asColor;
    ctx.textAlign = 'center';
    ctx.fillText(airspeed.toFixed(1), x + cwAS / 2, cy + 15);
    if (airspeed < 19 && !p.onGround && flash(t, 5)) {
      ctx.font = `800 15px ${MONO}`;
      ctx.fillStyle = P.red;
      ctx.fillText('STALL', x + cwAS / 2, y0 - 10);
    }
    x += cwAS;
    sep(x);

    // --- 2. altitude AGL ---
    const cwALT = 108;
    const agl = Math.max(0, p.y - terrainYAt(level.terrain, p.x));
    label('ALT AGL  m', x, cwALT);
    ctx.font = `700 24px ${MONO}`;
    ctx.fillStyle = P.cream;
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(agl).toString(), x + cwALT / 2, cy + 15);
    x += cwALT;
    sep(x);

    // --- 3. VSI — the star instrument ---
    const cwVSI = 96;
    label('VERT SPEED', x, cwVSI);
    const bx = x + cwVSI / 2 - 7;
    const by = y0 + 20;
    const bh = STRIP_H - 28;
    const bw = 14;
    // track with color bands (top = climb)
    const grd = ctx.createLinearGradient(0, by, 0, by + bh);
    grd.addColorStop(0.0, 'rgba(217,79,53,0.75)');
    grd.addColorStop(0.25, 'rgba(232,163,60,0.75)');
    grd.addColorStop(0.4, 'rgba(143,179,79,0.8)');
    grd.addColorStop(0.6, 'rgba(143,179,79,0.8)');
    grd.addColorStop(0.75, 'rgba(232,163,60,0.75)');
    grd.addColorStop(1.0, 'rgba(217,79,53,0.75)');
    rr(bx, by, bw, bh, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();
    ctx.save();
    rr(bx, by, bw, bh, 4);
    ctx.clip();
    ctx.fillStyle = grd;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(bx, by, bw, bh);
    ctx.globalAlpha = 1;
    // center line
    ctx.fillStyle = P.creamFaint;
    ctx.fillRect(bx, by + bh / 2 - 0.5, bw, 1);
    ctx.restore();
    // needle
    const vy = Math.max(-5, Math.min(5, p.vy));
    const ny = by + bh / 2 - (vy / 5) * (bh / 2);
    const avy = Math.abs(p.vy);
    const nColor = avy <= 1 ? P.green : avy <= 2.5 ? P.amber : P.red;
    ctx.fillStyle = nColor;
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx - 7, ny - 5);
    ctx.lineTo(bx + 1, ny);
    ctx.lineTo(bx - 7, ny + 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(bx, ny - 1, bw, 2);
    // glow on the needle row
    ctx.globalAlpha = 0.25;
    ctx.fillRect(bx, ny - 3, bw, 6);
    ctx.globalAlpha = 1;
    // numeric readout
    ctx.font = `700 12px ${MONO}`;
    ctx.fillStyle = nColor;
    ctx.textAlign = 'left';
    ctx.fillText((p.vy >= 0 ? '+' : '−') + Math.abs(p.vy).toFixed(1), bx + bw + 6, ny + 4);
    x += cwVSI;
    sep(x);

    // --- 4. throttle ---
    const cwTHR = 72;
    label('THR', x, cwTHR);
    const tx = x + cwTHR / 2 - 5;
    rr(tx, by, 10, bh, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();
    const th = bh * (p.throttle || 0);
    if (th > 0) {
      rr(tx, by + bh - th, 10, th, 3);
      ctx.fillStyle = P.cream;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.font = `700 11px ${MONO}`;
    ctx.fillStyle = P.creamDim;
    ctx.textAlign = 'left';
    ctx.fillText(Math.round((p.throttle || 0) * 100) + '%', tx + 15, by + bh - 1);
    x += cwTHR;
    sep(x);

    // --- 5. fuel ---
    const cwFUEL = 140;
    label('FUEL', x, cwFUEL);
    const tank = (plane && plane.tankL) || (level && level.fuelL) || 40;
    const frac = Math.max(0, Math.min(1, p.fuel / tank));
    let fColor = P.green;
    if (frac < 0.1) fColor = flash(t, 4) ? P.red : 'rgba(217,79,53,0.35)';
    else if (frac < 0.25) fColor = P.amber;
    const fbx = x + 14;
    const fby = cy + 2;
    const fbw = cwFUEL - 62;
    rr(fbx, fby, fbw, 10, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();
    if (frac > 0) {
      rr(fbx, fby, fbw * frac, 10, 3);
      ctx.fillStyle = fColor;
      ctx.fill();
    }
    ctx.font = `700 13px ${MONO}`;
    ctx.fillStyle = frac < 0.25 ? fColor : P.cream;
    ctx.textAlign = 'left';
    ctx.fillText(p.fuel.toFixed(1) + ' L', fbx + fbw + 8, fby + 10);
    x += cwFUEL;
    sep(x);

    // --- 6. distance to destination (directional: negative = strip behind you) ---
    const endR = level.endRunway || { x: 0, length: 0 };
    const stripEnd = endR.x + endR.length;
    const past = p.x > stripEnd; // overflew the strip
    const distM = past ? p.x - stripEnd : Math.max(0, endR.x - p.x);
    const dTxt = distM >= 1000 ? (distM / 1000).toFixed(1) + ' km' : Math.round(distM) + ' m';
    ctx.font = `700 20px ${MONO}`;
    ctx.fillStyle = past ? P.amber : P.cream;
    ctx.textAlign = 'right';
    const arrowPulse = (past || distM < 800) && flash(t, 2) ? P.gold : P.creamDim;
    if (past) {
      // strip is behind: arrow on the left, amber
      ctx.fillText(dTxt, w - 14, cy + 12);
      ctx.fillStyle = arrowPulse;
      ctx.textAlign = 'left';
      ctx.fillText('◂', w - 34 - ctx.measureText(dTxt).width - 14, cy + 12);
      ctx.textAlign = 'right';
    } else {
      ctx.fillText(dTxt, w - 34, cy + 12);
      ctx.fillStyle = arrowPulse;
      ctx.fillText('▸', w - 14, cy + 12);
    }
    ctx.font = `600 9px ${MONO}`;
    ctx.fillStyle = past ? P.amber : P.creamDim;
    ctx.fillText(past ? 'STRIP BEHIND' : 'TO STRIP', w - 14, y0 + 15);

    // ---- overfly warning: you cannot turn around in this ship ----
    if (past && !p.onGround && simState.phase === 'AIRBORNE' && distM > 60) {
      ctx.textAlign = 'center';
      ctx.font = `800 22px ${MONO}`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(30,20,12,0.85)';
      ctx.strokeText('YOU PASSED THE STRIP', w / 2, h * 0.24);
      ctx.fillStyle = flash(t, 2) ? P.amber : P.cream;
      ctx.fillText('YOU PASSED THE STRIP', w / 2, h * 0.24);
      ctx.font = `600 14px ${MONO}`;
      ctx.fillStyle = P.creamDim;
      ctx.fillText('R — RETRY THE RUN', w / 2, h * 0.24 + 26);
    }

    // ---- tutorial hints (First Solo only): teach the four beats of a flight ----
    if (level.id === 'm1' && simState.phase !== 'CRASHED') {
      let hint = null;
      const airspeed2 = airspeed; // instrument 1's value
      if (simState.phase === 'ROLLOUT' && p.onGround && p.throttle < 0.95 && airspeed2 < 21) {
        hint = 'HOLD  W  — THROTTLE UP';
      } else if (simState.phase === 'ROLLOUT' && p.onGround && airspeed2 >= 21) {
        hint = 'HOLD  ↑  — PULL BACK TO LIFT OFF';
      } else if (simState.phase === 'ROLLOUT' && !p.onGround) {
        hint = 'EASE OFF  ↑  — CLIMB GENTLY';
      } else if (simState.phase === 'AIRBORNE' && !past && distM > 500) {
        hint = '↑/↓ PITCH  ·  W/S THROTTLE  ·  FLY RIGHT TO THE NEXT STRIP  ▸';
      } else if (simState.phase === 'AIRBORNE' && !past && distM <= 500) {
        hint = 'THROTTLE DOWN · DESCEND · TOUCH DOWN SOFT (WATCH VERT SPEED)';
      } else if (simState.phase === 'LANDED' && Math.abs(p.vx) > 0.5) {
        hint = 'HOLD  B  — BRAKE TO A STOP';
      }
      if (hint) {
        ctx.textAlign = 'center';
        ctx.font = `700 15px ${MONO}`;
        const tw = ctx.measureText(hint).width;
        rr(w / 2 - tw / 2 - 14, h * 0.115 - 17, tw + 28, 28, 6);
        ctx.fillStyle = 'rgba(24,18,12,0.72)';
        ctx.fill();
        ctx.fillStyle = P.gold;
        ctx.fillText(hint, w / 2, h * 0.115 + 3);
      }
    }

    // ---- ROTATE cue ----
    const evts = simState.events || [];
    if (p.onGround && evts.some((e) => typeof e === 'string' && e.startsWith('rotate'))) {
      rotateUntil = t + 1.4;
    }
    if (t < rotateUntil && p.onGround && flash(t, 4)) {
      ctx.font = `800 30px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(30,20,12,0.85)';
      ctx.strokeText('ROTATE', w / 2, h * 0.36);
      ctx.fillStyle = P.cream;
      ctx.fillText('ROTATE', w / 2, h * 0.36);
    }

    // ---- crash banner ----
    if (simState.phase === 'CRASHED') {
      ctx.textAlign = 'center';
      ctx.font = `800 44px ${MONO}`;
      ctx.lineWidth = 7;
      ctx.strokeStyle = 'rgba(20,10,6,0.9)';
      ctx.strokeText('CRASHED', w / 2, h * 0.3);
      ctx.fillStyle = P.red;
      ctx.fillText('CRASHED', w / 2, h * 0.3);
      if (simState.crashReason) {
        ctx.font = `600 15px ${MONO}`;
        ctx.fillStyle = P.cream;
        ctx.fillText(String(simState.crashReason).replace(/-/g, ' ').toUpperCase(), w / 2, h * 0.3 + 28);
      }
      ctx.font = `600 13px ${MONO}`;
      ctx.fillStyle = P.creamDim;
      ctx.fillText('R — RETRY', w / 2, h * 0.3 + 52);
    }

    // ---- grade toast (slam-in) ----
    if (simState.grade && !hadGrade) {
      toastT0 = t;
      hadGrade = true;
    }
    if (!simState.grade) {
      hadGrade = false;
      toastT0 = null;
    }
    if (simState.grade && toastT0 != null) {
      drawGradeToast(simState, t - toastT0, w, h);
    }
    ctx.textAlign = 'left';
  }

  function drawGradeToast(simState, age, w, h) {
    if (age > 5) return;
    const g = simState.grade;
    const k = Math.min(1, age / 0.28);
    const scale = 1 + Math.pow(1 - k, 3) * 2.4;
    const alpha = Math.min(1, k * 1.6) * (age > 4.2 ? Math.max(0, 1 - (age - 4.2) / 0.8) : 1);
    const verdict = g.stars >= 3 ? 'GREASED IT' : g.stars === 2 ? 'SOLID' : 'HARD ARRIVAL';
    const vyTxt =
      simState.touchdown && simState.touchdown.vy != null
        ? ` · −${Math.abs(simState.touchdown.vy).toFixed(1)} m/s`
        : '';
    const starsTxt = '★'.repeat(g.stars) + '☆'.repeat(3 - g.stars);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(w / 2, h * 0.3);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.font = `800 34px ${MONO}`;
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(20,12,6,0.9)';
    const txt = `${starsTxt} ${verdict}${vyTxt}`;
    ctx.strokeText(txt, 0, 0);
    ctx.fillStyle = g.stars >= 3 ? P.gold : g.stars === 2 ? P.cream : P.amber;
    ctx.fillText(txt, 0, 0);
    ctx.restore();
  }

  // ============================== PANELS ==============================
  function panelBg(opaque) {
    const w = W();
    const h = H();
    if (opaque) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, P.bgTop);
      g.addColorStop(1, P.bgBot);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // decorative ridge silhouettes
      for (const [frac, amp, seed, a] of [
        [0.86, 70, 4.2, 0.18],
        [0.94, 46, 8.9, 0.28],
      ]) {
        ctx.fillStyle = `rgba(95,106,131,${a})`;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let sx = 0; sx <= w; sx += 8) {
          const y =
            h * frac -
            (0.5 + 0.5 * (Math.sin(sx * 0.008 + seed) * 0.6 + Math.sin(sx * 0.021 + seed * 3) * 0.4)) * amp;
          ctx.lineTo(sx, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      ctx.fillStyle = 'rgba(18,12,8,0.62)';
      ctx.fillRect(0, 0, w, h);
    }
  }

  function hintBar(text) {
    const w = W();
    const h = H();
    ctx.font = `600 12px ${MONO}`;
    ctx.fillStyle = P.creamDim;
    ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, h - 18);
    ctx.textAlign = 'left';
  }

  function moneyTag(money) {
    const w = W();
    ctx.font = `700 20px ${MONO}`;
    ctx.fillStyle = P.gold;
    ctx.textAlign = 'right';
    ctx.fillText(fmtMoney(money || 0), w - 28, 42);
    ctx.textAlign = 'left';
  }

  // --- briefing ---
  function drawBriefing(mission, selection) {
    panelBg(false);
    const w = W();
    const h = H();
    const cw = Math.min(560, w - 60);
    const ch = 380;
    const cx = (w - cw) / 2;
    const cyTop = (h - ch) / 2;
    // paper card
    rr(cx + 5, cyTop + 6, cw, ch, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();
    rr(cx, cyTop, cw, ch, 8);
    ctx.fillStyle = P.paper;
    ctx.fill();
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 2;
    ctx.stroke();
    // header band
    ctx.save();
    rr(cx, cyTop, cw, 62, 8);
    ctx.clip();
    ctx.fillStyle = P.ox;
    ctx.fillRect(cx, cyTop, cw, 62);
    ctx.restore();
    ctx.font = `700 26px ${SERIF}`;
    ctx.fillStyle = P.paper;
    ctx.textAlign = 'left';
    ctx.fillText(mission.name || 'MISSION', cx + 24, cyTop + 40);
    // type tag
    const tag = mission.type || 'CARGO';
    ctx.font = `700 11px ${MONO}`;
    const tw = ctx.measureText(tag).width + 16;
    rr(cx + cw - tw - 20, cyTop + 20, tw, 22, 4);
    ctx.fillStyle = P.paper;
    ctx.fill();
    ctx.fillStyle = P.ox;
    ctx.textAlign = 'center';
    ctx.fillText(tag, cx + cw - tw / 2 - 20, cyTop + 35);
    ctx.textAlign = 'left';
    // briefing text
    let yy = cyTop + 94;
    yy = wrapText(
      mission.briefing || '',
      cx + 24,
      yy,
      cw - 48,
      22,
      `italic 16px ${SERIF}`,
      '#4a3a24'
    );
    yy += 14;
    // detail rows
    const distKm =
      mission.endRunway && mission.startRunway
        ? ((mission.endRunway.x - mission.startRunway.x) / 1000).toFixed(1) + ' km'
        : mission.distKm
          ? mission.distKm + ' km'
          : '—';
    const rows = [
      ['CARGO', (mission.cargoKg || 0) + ' kg'],
      ['DISTANCE', distKm],
      ['WIND', windLabel(mission.wind)],
      ['FUEL', (mission.fuelL || 40) + ' L'],
      ['REWARD', fmtMoney(mission.reward || 0)],
    ];
    if (mission.parTimeS) rows.push(['PAR TIME', mission.parTimeS + ' s']);
    ctx.font = `700 13px ${MONO}`;
    for (const [k, v] of rows) {
      ctx.fillStyle = 'rgba(74,58,36,0.6)';
      ctx.fillText(k, cx + 24, yy);
      ctx.fillStyle = k === 'REWARD' ? P.ox : P.ink;
      ctx.textAlign = 'right';
      ctx.fillText(String(v), cx + cw - 24, yy);
      ctx.textAlign = 'left';
      ctx.strokeStyle = 'rgba(44,32,19,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + 24, yy + 8);
      ctx.lineTo(cx + cw - 24, yy + 8);
      ctx.stroke();
      yy += 26;
    }
    // controls strip — onboarding: every pilot sees the stick layout before flying
    ctx.font = `600 12px ${MONO}`;
    ctx.fillStyle = 'rgba(74,58,36,0.85)';
    ctx.textAlign = 'center';
    ctx.fillText('W/S THROTTLE  ·  ↑/↓ PITCH  ·  B BRAKES  ·  R RESTART', cx + cw / 2, cyTop + ch - 50);
    // footer
    ctx.font = `700 15px ${MONO}`;
    ctx.fillStyle = P.ox;
    ctx.fillText('ENTER — TAKE THE JOB', cx + cw / 2, cyTop + ch - 22);
    ctx.textAlign = 'left';
    void selection;
  }

  // --- debrief ---
  function drawDebrief(grade, payoutLines, selection) {
    panelBg(false);
    const w = W();
    const h = H();
    const cx = w / 2;
    // A crash or a wrong-strip arrival comes through with zero stars; only a real
    // landing ever grades 1-3 stars. Treat anything else as a failed mission.
    const failed = !grade || grade.crashed || grade.stars === 0;
    let yy = h * 0.16;

    if (failed) {
      ctx.font = `700 44px ${SERIF}`;
      ctx.fillStyle = P.red;
      ctx.textAlign = 'center';
      ctx.fillText('MISSION FAILED', cx, yy + 40);
      yy += 78;
      // Surface the reason (crash cause or "wrong airstrip") so the player learns.
      const reason = grade && grade.breakdown && grade.breakdown[0] && grade.breakdown[0].label;
      if (reason) {
        ctx.font = `600 17px ${MONO}`;
        ctx.fillStyle = P.creamDim;
        ctx.fillText(reason, cx, yy);
      }
      yy += 34;
    } else {
      // big stars
      const r = 30;
      for (let i = 0; i < 3; i++) star(cx + (i - 1) * (r * 2.5), yy + r, r, i < grade.stars);
      yy += r * 2 + 34;
      const verdict = grade.stars >= 3 ? 'GREASED IT' : grade.stars === 2 ? 'SOLID' : 'HARD ARRIVAL';
      ctx.font = `700 38px ${SERIF}`;
      ctx.fillStyle = P.cream;
      ctx.textAlign = 'center';
      ctx.fillText(verdict, cx, yy);
      yy += 30;
      ctx.font = `700 18px ${MONO}`;
      ctx.fillStyle = P.creamDim;
      ctx.fillText(`${Math.round(grade.score)} / 100`, cx, yy);
      yy += 30;
    }

    // deduction breakdown
    const colW = Math.min(420, w - 80);
    const lx = cx - colW / 2;
    ctx.textAlign = 'left';
    if (!failed && grade.breakdown) {
      ctx.font = `600 13px ${MONO}`;
      for (const b of grade.breakdown) {
        const ded = b.deduction || 0;
        ctx.fillStyle = ded > 0 ? P.creamDim : P.creamFaint;
        ctx.fillText(b.label, lx, yy);
        ctx.textAlign = 'right';
        ctx.fillStyle = ded > 0 ? P.amber : P.green;
        ctx.fillText(ded > 0 ? '−' + ded : '✓', lx + colW, yy);
        ctx.textAlign = 'left';
        yy += 21;
      }
      yy += 6;
    }
    // payout lines
    if (payoutLines && payoutLines.length) {
      ctx.strokeStyle = P.creamFaint;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lx, yy - 12);
      ctx.lineTo(lx + colW, yy - 12);
      ctx.stroke();
      ctx.font = `700 14px ${MONO}`;
      for (const pl of payoutLines) {
        if (typeof pl === 'string') {
          ctx.fillStyle = P.cream;
          ctx.fillText(pl, lx, yy);
        } else {
          ctx.fillStyle = P.creamDim;
          ctx.fillText(pl.label, lx, yy);
          ctx.textAlign = 'right';
          ctx.fillStyle = P.gold;
          ctx.fillText(
            typeof pl.amount === 'number' ? fmtMoney(pl.amount) : String(pl.amount),
            lx + colW,
            yy
          );
          ctx.textAlign = 'left';
        }
        yy += 24;
      }
    }
    // options
    const sel = selection || 0;
    const opts = failed ? ['RETRY  (R)'] : ['NEXT MISSION  (ENTER)', 'RETRY  (R)'];
    ctx.textAlign = 'center';
    ctx.font = `700 16px ${MONO}`;
    const oy = h - 56;
    const gap = 250;
    opts.forEach((o, i) => {
      const ox = cx + (i - (opts.length - 1) / 2) * gap;
      const active = i === sel;
      ctx.fillStyle = active ? P.gold : P.creamDim;
      ctx.fillText((active ? '▸ ' : '') + o, ox, oy);
    });
    ctx.textAlign = 'left';
  }

  // --- menu ---
  function drawMenu(save, missions, selection) {
    panelBg(true);
    const w = W();
    const sel = selection || 0;
    // title
    ctx.textAlign = 'center';
    ctx.font = `700 62px ${SERIF}`;
    ctx.fillStyle = P.cream;
    ctx.fillText('SKYHAUL', w / 2, 84);
    ctx.fillStyle = P.ox;
    ctx.fillRect(w / 2 - 120, 98, 240, 4);
    ctx.font = `600 11px ${MONO}`;
    ctx.fillStyle = P.creamDim;
    // letterspaced tagline
    const tag = 'K E T T L E   R A N G E   A I R   F R E I G H T';
    ctx.fillText(tag, w / 2, 122);
    moneyTag(save && save.money);

    // mission rows
    const rowH = 37;
    const listW = Math.min(620, w - 80);
    const lx = (w - listW) / 2;
    let yy = 152;
    const done = (save && save.missionsCompleted) || {};
    missions.forEach((m, i) => {
      const prev = i === 0 ? null : missions[i - 1];
      const unlocked = i === 0 || (prev && done[prev.id]);
      const rec = done[m.id];
      const active = i === sel;
      if (active) {
        rr(lx - 10, yy - 24, listW + 20, rowH - 4, 6);
        ctx.fillStyle = 'rgba(242,227,192,0.1)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(242,227,192,0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.textAlign = 'left';
      // number chip
      ctx.font = `700 12px ${MONO}`;
      rr(lx, yy - 18, 30, 22, 4);
      ctx.fillStyle = unlocked ? P.ox : 'rgba(90,70,50,0.4)';
      ctx.fill();
      ctx.fillStyle = unlocked ? P.cream : P.creamFaint;
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), lx + 15, yy - 2);
      ctx.textAlign = 'left';
      // name
      ctx.font = `700 17px ${SERIF}`;
      ctx.fillStyle = unlocked ? (active ? P.cream : P.creamDim) : P.creamFaint;
      ctx.fillText(m.name, lx + 44, yy);
      if (!unlocked) {
        // little padlock
        const px2 = lx + listW - 12;
        ctx.strokeStyle = P.creamFaint;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px2, yy - 10, 4.5, Math.PI, 0);
        ctx.stroke();
        ctx.fillStyle = P.creamFaint;
        rr(px2 - 7, yy - 10, 14, 10, 2);
        ctx.fill();
      } else {
        // stars + best + reward
        for (let s = 0; s < 3; s++)
          star(lx + listW - 150 + s * 20, yy - 6, 7.5, rec ? s < rec.stars : false);
        ctx.font = `600 12px ${MONO}`;
        ctx.textAlign = 'right';
        ctx.fillStyle = P.creamDim;
        if (rec) ctx.fillText('best ' + rec.bestScore, lx + listW - 170, yy);
        ctx.fillStyle = P.gold;
        ctx.fillText(fmtMoney(m.reward || 0), lx + listW - 12, yy);
        ctx.textAlign = 'left';
      }
      yy += rowH;
    });
    hintBar('↑↓ SELECT   ·   ENTER FLY   ·   H HANGAR');
  }

  // --- hangar ---
  function drawHangar(save, planes, upgrades, selection) {
    panelBg(true);
    const w = W();
    const sel = selection || 0;
    const planeArr = Array.isArray(planes) ? planes : Object.values(planes || {});
    const upgArr = Array.isArray(upgrades) ? upgrades : Object.values(upgrades || {});
    const owned = (save && save.planesOwned) || [];
    const money = (save && save.money) || 0;
    const upgOwned =
      (save && save.upgrades && save.upgrades[save.activePlane]) || [];

    ctx.textAlign = 'center';
    ctx.font = `700 44px ${SERIF}`;
    ctx.fillStyle = P.cream;
    ctx.fillText('HANGAR', w / 2, 62);
    moneyTag(money);

    const colW = Math.min(380, w / 2 - 60);
    const lxP = w / 2 - colW - 24;
    const lxU = w / 2 + 24;

    const section = (x, title) => {
      ctx.textAlign = 'left';
      ctx.font = `700 12px ${MONO}`;
      ctx.fillStyle = P.creamDim;
      ctx.fillText(title, x, 110);
      ctx.strokeStyle = P.creamFaint;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 118);
      ctx.lineTo(x + colW, 118);
      ctx.stroke();
    };
    section(lxP, 'AIRCRAFT');
    section(lxU, 'UPGRADES — ' + String((save && save.activePlane) || '').toUpperCase());

    const row = (x, yy, idx, name, blurb, status, statusColor) => {
      const active = idx === sel;
      if (active) {
        rr(x - 10, yy - 26, colW + 20, 62, 6);
        ctx.fillStyle = 'rgba(242,227,192,0.1)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(242,227,192,0.3)';
        ctx.stroke();
      }
      ctx.textAlign = 'left';
      ctx.font = `700 19px ${SERIF}`;
      ctx.fillStyle = active ? P.cream : P.creamDim;
      ctx.fillText(name, x, yy);
      ctx.font = `500 11px ${MONO}`;
      ctx.fillStyle = P.creamFaint;
      ctx.fillText(blurb, x, yy + 18);
      ctx.font = `700 13px ${MONO}`;
      ctx.textAlign = 'right';
      ctx.fillStyle = statusColor;
      ctx.fillText(status, x + colW, yy);
      ctx.textAlign = 'left';
    };

    let idx = 0;
    let yy = 156;
    for (const pl of planeArr) {
      const isOwned = owned.includes(pl.id);
      const isActive = save && save.activePlane === pl.id;
      let status;
      let sc;
      if (isActive) {
        status = '● ACTIVE';
        sc = P.green;
      } else if (isOwned) {
        status = 'OWNED';
        sc = P.creamDim;
      } else {
        status = fmtMoney(pl.cost || 0);
        sc = money >= (pl.cost || 0) ? P.gold : P.creamFaint;
      }
      row(lxP, yy, idx, pl.name || pl.id, pl.blurb || pl.notes || '', status, sc);
      idx++;
      yy += 72;
    }
    yy = 156;
    for (const up of upgArr) {
      const isOwned = upgOwned.includes(up.id);
      const status = isOwned ? '✓ OWNED' : fmtMoney(up.cost || 0);
      const sc = isOwned ? P.green : money >= (up.cost || 0) ? P.gold : P.creamFaint;
      row(lxU, yy, idx, up.name || up.id, up.blurb || up.effect || '', status, sc);
      idx++;
      yy += 72;
    }
    hintBar('↑↓ SELECT   ·   ENTER BUY / EQUIP   ·   ESC BACK');
  }

  return { drawFlightHUD, drawBriefing, drawDebrief, drawMenu, drawHangar };
}
