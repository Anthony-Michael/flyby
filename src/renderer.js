// renderer.js — IMPURE. Canvas world drawing: parallax, terrain, runways, plane, zones.
// Owned by: Dev C (presentation). Reads sim state + level; NEVER mutates them.
// Camera: plane at 35% from left, soft vertical follow, 6 px/m (DESIGN §2).
// Art: flat-color vector (DESIGN §1) — silhouette ridges, two-tone plane, windsock at runways.
//
// viewFx contract (from game.js):
//   { shakeX, shakeY, particles }
//   `particles` may be a FUNCTION (ctx, camera) => void — renderer calls it after the
//   world is drawn so juice.drawParticles can render in world space. camera passed is
//   { x, y, pxPerM, w, h, toScreen(wx, wy) => [sx, sy] }.
//   (An array of particle objects is also tolerated and drawn as simple dots.)

const PX = 6; // px per meter, fixed (DESIGN §2)

// palette — warm weathered, dawn light (DESIGN §1)
const C = {
  skyTop: '#f6e8c6',
  skyMid: '#f3c98b',
  skyLow: '#e9945c',
  sun: '#fff6dc',
  farRidge: '#98a0b6',
  nearHill: '#5f6a83',
  cloud: '#fbf1da',
  terrainTop: '#8a8b58',
  terrainDeep: '#6c6544',
  outline: '#2c2517',
  runway: '#bda274',
  runwayEdge: '#3a3122',
  stripe: '#f4ecd8',
  tree: '#48523a',
  treeDark: '#37402c',
  plane: '#8a3324', // oxblood
  planeDark: '#6b241a',
  planeStripe: '#f2e3c0',
  planeOutline: '#26130f',
  wheel: '#241d15',
  downdraft: '#3c4a6e',
  updraft: '#c47a3a',
  cabin: '#6e5637',
  cabinRoof: '#7c2f22',
};

function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
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

function ridgeProfile(u, seed) {
  return (
    0.55 * Math.sin(u * 0.0042 + seed) +
    0.3 * Math.sin(u * 0.0113 + seed * 2.7) +
    0.15 * Math.sin(u * 0.031 + seed * 5.3)
  );
}

export function createRenderer(ctx) {
  let camX = 0;
  let camY = null;
  let facing = 1;

  function toScreen(wx, wy, w, h) {
    return [(wx - camX) * PX, h * 0.55 - (wy - camY) * PX];
  }

  // ---------- background ----------
  function drawSky(w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, C.skyTop);
    g.addColorStop(0.55, C.skyMid);
    g.addColorStop(1, C.skyLow);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // low dawn sun, fixed in the sky
    const sx = w * 0.68;
    const sy = h * 0.30;
    const rg = ctx.createRadialGradient(sx, sy, 4, sx, sy, 90);
    rg.addColorStop(0, 'rgba(255,246,220,0.95)');
    rg.addColorStop(0.25, 'rgba(255,240,205,0.55)');
    rg.addColorStop(1, 'rgba(255,240,205,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(sx - 90, sy - 90, 180, 180);
    ctx.fillStyle = C.sun;
    ctx.beginPath();
    ctx.arc(sx, sy, 22, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawRidgeLayer(w, h, factor, vFactor, baseFrac, ampPx, seed, color) {
    const baseY = h * baseFrac + (40 - camY) * PX * vFactor;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-4, h + 4);
    for (let sx = -4; sx <= w + 4; sx += 6) {
      const u = camX * factor * PX + sx;
      const y = baseY - (ridgeProfile(u, seed) * 0.5 + 0.5) * ampPx;
      ctx.lineTo(sx, y);
    }
    ctx.lineTo(w + 4, h + 4);
    ctx.closePath();
    ctx.fill();
  }

  function drawClouds(w, h) {
    const span = w + 700;
    ctx.fillStyle = C.cloud;
    for (let i = 0; i < 8; i++) {
      const worldX = hash(i) * 9000;
      let sx = ((worldX - camX * 0.8) * PX) % span;
      if (sx < 0) sx += span;
      sx -= 350;
      const cy = 160 + hash(i + 13) * 260; // cloud altitude, m
      const sy = h * 0.55 - (cy - 40 - (camY - 40) * 0.8) * PX * 0.8;
      if (sy < -60 || sy > h + 60) continue;
      const s = 0.7 + hash(i + 31) * 0.9;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.ellipse(sx, sy, 46 * s, 13 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(sx - 30 * s, sy + 4 * s, 26 * s, 9 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(sx + 34 * s, sy + 5 * s, 30 * s, 10 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // ---------- world ----------
  function drawTerrain(level, w, h) {
    const pts = level.terrain;
    // smoothed fill (VISUAL ONLY — collision stays linear, DESIGN §8)
    ctx.beginPath();
    let [sx0, sy0] = toScreen(pts[0][0], pts[0][1], w, h);
    ctx.moveTo(sx0 - 2000, sy0);
    ctx.lineTo(sx0, sy0);
    for (let i = 1; i < pts.length - 1; i++) {
      const [ax, ay] = toScreen(pts[i][0], pts[i][1], w, h);
      const [bx, by] = toScreen(pts[i + 1][0], pts[i + 1][1], w, h);
      ctx.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
    }
    const last = pts[pts.length - 1];
    const [lx, ly] = toScreen(last[0], last[1], w, h);
    ctx.lineTo(lx, ly);
    ctx.lineTo(lx + 2000, ly);
    // close down to bottom
    ctx.lineTo(lx + 2000, h + 40);
    ctx.lineTo(sx0 - 2000, h + 40);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, h * 0.2, 0, h);
    g.addColorStop(0, C.terrainTop);
    g.addColorStop(1, C.terrainDeep);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawTrees(level, w, h) {
    const pts = level.terrain;
    const x0 = camX - 40;
    const x1 = camX + w / PX + 40;
    const spacing = 41;
    const runways = [level.startRunway, level.endRunway].filter(Boolean);
    for (let k = Math.floor(x0 / spacing); k * spacing < x1; k++) {
      const jx = k * spacing + hash(k) * 26;
      let onStrip = false;
      for (const r of runways) {
        if (jx > r.x - 28 && jx < r.x + r.length + 28) onStrip = true;
      }
      if (onStrip || hash(k + 7) < 0.35) continue;
      const gy = terrainYAt(pts, jx);
      const [tx, ty] = toScreen(jx, gy, w, h);
      if (tx < -30 || tx > w + 30) continue;
      const hgt = (5 + hash(k * 3) * 5) * PX;
      const half = hgt * 0.34;
      ctx.fillStyle = hash(k + 2) > 0.5 ? C.tree : C.treeDark;
      ctx.strokeStyle = C.outline;
      ctx.lineWidth = 1.5;
      // trunk
      ctx.fillRect(tx - 1.5, ty - hgt * 0.25, 3, hgt * 0.25);
      // two stacked triangles
      ctx.beginPath();
      ctx.moveTo(tx, ty - hgt);
      ctx.lineTo(tx - half * 0.7, ty - hgt * 0.55);
      ctx.lineTo(tx + half * 0.7, ty - hgt * 0.55);
      ctx.closePath();
      ctx.moveTo(tx, ty - hgt * 0.78);
      ctx.lineTo(tx - half, ty - hgt * 0.18);
      ctx.lineTo(tx + half, ty - hgt * 0.18);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  function drawRunway(level, runway, wind, w, h) {
    if (!runway) return;
    const elev = terrainYAt(level.terrain, runway.x);
    const [ax, ay] = toScreen(runway.x, elev, w, h);
    const lenPx = runway.length * PX;
    if (ax + lenPx < -50 || ax > w + 50) return;
    // strip surface
    ctx.fillStyle = C.runway;
    ctx.strokeStyle = C.runwayEdge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(ax, ay - 4, lenPx, 5);
    ctx.fill();
    ctx.stroke();
    // threshold piano keys, both ends
    ctx.fillStyle = C.stripe;
    for (const ex of [ax + 4, ax + lenPx - 4 - 22]) {
      for (let i = 0; i < 4; i++) ctx.fillRect(ex + i * 6, ay - 3, 3.4, 3.4);
    }
    // centerline dashes
    ctx.globalAlpha = 0.55;
    for (let dx = 40; dx < lenPx - 40; dx += 32) {
      ctx.fillRect(ax + dx, ay - 2.2, 13, 1.6);
    }
    ctx.globalAlpha = 1;
    drawWindsock(ax - 9 * PX, ay, wind);
    drawCabin(ax - 24 * PX, ay);
  }

  function drawWindsock(sx, groundY, wind) {
    const baseX = (wind && wind.baseX) || 0;
    const poleH = 5.5 * PX;
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, groundY);
    ctx.lineTo(sx, groundY - poleH);
    ctx.stroke();
    // sock points DOWNWIND (direction wind blows toward = sign of baseX)
    const str = Math.min(Math.abs(baseX) / 6, 1);
    const dir = baseX === 0 ? 1 : Math.sign(baseX);
    const droop = (1 - str) * 1.15 + 0.12; // rad below horizontal
    ctx.save();
    ctx.translate(sx, groundY - poleH);
    ctx.scale(dir, 1);
    ctx.rotate(droop);
    const L = (1.4 + str * 1.3) * PX;
    ctx.beginPath();
    ctx.moveTo(0, -3);
    ctx.lineTo(L, -1.1);
    ctx.lineTo(L, 1.1);
    ctx.lineTo(0, 3);
    ctx.closePath();
    ctx.fillStyle = C.plane;
    ctx.fill();
    ctx.strokeStyle = C.planeOutline;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = C.planeStripe;
    ctx.fillRect(L * 0.38, -2.4, L * 0.26, 4.8);
    ctx.restore();
  }

  function drawCabin(sx, groundY) {
    const wpx = 6 * PX;
    const hpx = 3.4 * PX;
    ctx.fillStyle = C.cabin;
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(sx, groundY - hpx, wpx, hpx);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.cabinRoof;
    ctx.beginPath();
    ctx.moveTo(sx - 4, groundY - hpx);
    ctx.lineTo(sx + wpx / 2, groundY - hpx - 2.2 * PX);
    ctx.lineTo(sx + wpx + 4, groundY - hpx);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.skyTop;
    ctx.fillRect(sx + wpx * 0.6, groundY - hpx * 0.72, 7, 7);
  }

  function drawZones(level, t, w, h) {
    if (!level.zones) return;
    for (const z of level.zones) {
      const down = z.kind === 'downdraft';
      const col = down ? C.downdraft : C.updraft;
      const dir = down ? 1 : -1;
      const drift = ((t * 9) % 30) * dir;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.18;
      for (let zx = z.x + 30; zx < z.x + z.width; zx += 68) {
        const gy = terrainYAt(level.terrain, zx);
        for (let lvl = 0; lvl < 3; lvl++) {
          const wy = gy + 26 + lvl * 42;
          const [sx, sy0] = toScreen(zx, wy, w, h);
          if (sx < -20 || sx > w + 20) continue;
          const sy = sy0 + drift;
          ctx.beginPath();
          ctx.moveTo(sx - 8, sy - 6 * dir);
          ctx.lineTo(sx, sy + 6 * dir);
          ctx.lineTo(sx + 8, sy - 6 * dir);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---------- the plane ----------
  // Artwork in METERS, y-up, nose facing +x, wheel contact at y=0.
  function drawPlane(plane, t, w, h) {
    if (Math.abs(plane.vx) > 1) facing = plane.vx >= 0 ? 1 : -1;
    const [sx, sy] = toScreen(plane.x, plane.y, w, h);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(facing * PX, -PX);
    if (plane.crashed) {
      ctx.rotate(plane.pitch - 0.55);
    } else {
      ctx.rotate(plane.pitch);
    }
    const lw = (px) => (ctx.lineWidth = px / PX);

    // tailplane (behind body)
    ctx.fillStyle = C.planeDark;
    ctx.strokeStyle = C.planeOutline;
    lw(2);
    ctx.beginPath();
    ctx.moveTo(-3.1, 1.72);
    ctx.lineTo(-4.35, 1.95);
    ctx.lineTo(-4.35, 1.62);
    ctx.lineTo(-3.1, 1.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // fuselage + fin silhouette
    const body = new Path2D();
    body.moveTo(3.6, 1.5);
    body.quadraticCurveTo(3.15, 2.05, 2.2, 2.08);
    body.lineTo(-2.75, 1.78);
    body.lineTo(-3.5, 2.95);
    body.quadraticCurveTo(-3.75, 3.1, -4.05, 2.95);
    body.lineTo(-4.2, 1.55);
    body.lineTo(-2.9, 1.32);
    body.lineTo(1.2, 0.95);
    body.quadraticCurveTo(3.2, 1.0, 3.6, 1.5);
    body.closePath();
    ctx.fillStyle = C.plane;
    ctx.fill(body);
    // cream stripe along the flank, clipped to the body
    ctx.save();
    ctx.clip(body);
    ctx.fillStyle = C.planeStripe;
    ctx.beginPath();
    ctx.moveTo(3.6, 1.62);
    ctx.lineTo(-4.3, 1.98);
    ctx.lineTo(-4.3, 1.7);
    ctx.lineTo(3.6, 1.34);
    ctx.closePath();
    ctx.fill();
    if (plane.crashed) {
      ctx.fillStyle = 'rgba(30,20,14,0.4)';
      ctx.fillRect(-4.5, 0.5, 8.5, 3.5);
    }
    ctx.restore();
    ctx.strokeStyle = C.planeOutline;
    lw(2);
    ctx.stroke(body);

    // cabin glass
    ctx.fillStyle = '#31404a';
    ctx.beginPath();
    ctx.moveTo(1.95, 2.02);
    ctx.lineTo(0.95, 2.06);
    ctx.lineTo(0.85, 1.62);
    ctx.lineTo(1.85, 1.6);
    ctx.closePath();
    ctx.fill();
    lw(1.5);
    ctx.stroke();

    // wing strut
    ctx.strokeStyle = C.planeOutline;
    lw(2);
    ctx.beginPath();
    ctx.moveTo(0.55, 1.05);
    ctx.lineTo(1.05, 2.28);
    ctx.stroke();

    // high wing slab (drawn over cabin)
    if (plane.crashed) {
      // torn off, lying behind
      ctx.save();
      ctx.translate(-2.4, 1.1);
      ctx.rotate(0.7);
      wingShape(lw);
      ctx.restore();
    } else {
      wingShape(lw);
    }

    // landing gear
    ctx.strokeStyle = C.planeOutline;
    lw(2.5);
    ctx.beginPath();
    ctx.moveTo(0.95, 1.05);
    ctx.lineTo(0.72, 0.38);
    ctx.moveTo(0.45, 1.02);
    ctx.lineTo(0.72, 0.38);
    ctx.stroke();
    ctx.fillStyle = C.wheel;
    ctx.beginPath();
    ctx.arc(0.72, 0.35, 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.planeStripe;
    ctx.beginPath();
    ctx.arc(0.72, 0.35, 0.1, 0, Math.PI * 2);
    ctx.fill();
    if (!plane.crashed) {
      ctx.fillStyle = C.wheel;
      ctx.beginPath();
      ctx.arc(-3.95, 0.16, 0.16, 0, Math.PI * 2);
      ctx.fill();
    }

    // prop
    if (!plane.crashed) {
      if (plane.throttle > 0.01) {
        ctx.fillStyle = 'rgba(242,227,192,0.16)';
        ctx.beginPath();
        ctx.ellipse(3.8, 1.5, 0.16, 1.55, 0, 0, Math.PI * 2);
        ctx.fill();
        const blade = 1.5 * Math.cos(t * (18 + plane.throttle * 42));
        ctx.strokeStyle = 'rgba(38,19,15,0.8)';
        lw(2.5);
        ctx.beginPath();
        ctx.moveTo(3.8, 1.5 - blade);
        ctx.lineTo(3.8, 1.5 + blade);
        ctx.stroke();
      } else {
        ctx.strokeStyle = C.planeOutline;
        lw(3);
        ctx.beginPath();
        ctx.moveTo(3.8, 0.4);
        ctx.lineTo(3.8, 2.6);
        ctx.stroke();
      }
      // spinner
      ctx.fillStyle = C.planeStripe;
      ctx.beginPath();
      ctx.arc(3.72, 1.5, 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = C.planeOutline;
      lw(1.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function wingShape(lw) {
    const wing = new Path2D();
    wing.moveTo(1.95, 2.5);
    wing.lineTo(-1.35, 2.2);
    wing.quadraticCurveTo(-1.55, 2.34, -1.35, 2.46);
    wing.lineTo(1.75, 2.72);
    wing.quadraticCurveTo(2.05, 2.66, 1.95, 2.5);
    wing.closePath();
    ctx.fillStyle = C.planeDark;
    ctx.fill(wing);
    ctx.strokeStyle = C.planeOutline;
    lw(2);
    ctx.stroke(wing);
    // cream leading-edge band
    ctx.fillStyle = C.planeStripe;
    ctx.beginPath();
    ctx.moveTo(1.95, 2.5);
    ctx.lineTo(1.25, 2.44);
    ctx.lineTo(1.1, 2.66);
    ctx.lineTo(1.75, 2.72);
    ctx.quadraticCurveTo(2.05, 2.66, 1.95, 2.5);
    ctx.closePath();
    ctx.fill();
  }

  function drawVignette(w, h) {
    const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, h * 0.95);
    g.addColorStop(0, 'rgba(40,20,10,0)');
    g.addColorStop(1, 'rgba(40,20,10,0.18)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // ---------- main ----------
  function render(simState, level, viewFx = {}) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const p = simState.plane;
    const shakeX = viewFx.shakeX || 0;
    const shakeY = viewFx.shakeY || 0;

    // camera: plane 35% from left; vertical soft deadzone follow
    camX = p.x - (0.35 * w) / PX;
    if (camY === null) camY = p.y;
    const dz = 10;
    if (p.y > camY + dz) camY += (p.y - dz - camY) * 0.08;
    else if (p.y < camY - dz) camY += (p.y + dz - camY) * 0.08;

    ctx.save();
    ctx.translate(shakeX, shakeY);

    drawSky(w, h);
    drawRidgeLayer(w, h, 0.2, 0.07, 0.62, 130, 3.1, C.farRidge);
    drawRidgeLayer(w, h, 0.5, 0.16, 0.78, 150, 9.7, C.nearHill);
    drawClouds(w, h);
    drawTerrain(level, w, h);
    drawZones(level, simState.t || 0, w, h);
    drawRunway(level, level.startRunway, level.wind, w, h);
    drawRunway(level, level.endRunway, level.wind, w, h);
    drawTrees(level, w, h);
    drawPlane(p, simState.t || 0, w, h);

    // particles (juice) — drawn in world space via camera
    const camera = {
      x: camX,
      y: camY,
      pxPerM: PX,
      w,
      h,
      toScreen: (wx, wy) => toScreen(wx, wy, w, h),
    };
    if (typeof viewFx.particles === 'function') {
      viewFx.particles(ctx, camera);
    } else if (Array.isArray(viewFx.particles)) {
      ctx.fillStyle = 'rgba(200,180,140,0.5)';
      for (const pt of viewFx.particles) {
        const [px2, py2] = camera.toScreen(pt.x, pt.y);
        ctx.fillRect(px2 - 2, py2 - 2, 4, 4);
      }
    }

    ctx.restore();
    drawVignette(w, h);
  }

  return { render };
}
