// landing.js — PURE. Touchdown crash checks + landing grade.
// Owned by: Dev A (sim core). Tolerances/scoring: docs/DESIGN.md §5.

// §5 tolerance contract — change only alongside the unit tests.
const MAX_SINK = -2.5; // m/s: vy below this at contact = hard impact
const MAX_SPEED = 30; // m/s ground speed at contact
const MIN_PITCH = -0.03; // rad: below = nose-gear strike
const MAX_PITCH = 0.21; // rad: above = tail strike

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Crash check at instant of ground contact.
 * @param {object} state   plane state at contact
 * @param {object|null} runway  {x, length, elevation} or null (off-runway contact = crash)
 * @returns {{ crashed: boolean, reason: string|null }}  reason e.g. 'hard-impact'|'too-fast'|'nose-strike'|'tail-strike'|'off-runway'
 */
export function checkCrash(state, runway) {
  if (!runway || state.x < runway.x || state.x > runway.x + runway.length) {
    return { crashed: true, reason: 'off-runway' };
  }
  if (state.vy < MAX_SINK) {
    return { crashed: true, reason: 'hard-impact' };
  }
  // |vx| so a plane landing while headed left is judged by the same speed limit.
  if (Math.abs(state.vx) > MAX_SPEED) {
    return { crashed: true, reason: 'too-fast' };
  }
  if (state.pitch < MIN_PITCH) {
    return { crashed: true, reason: 'nose-strike' };
  }
  if (state.pitch > MAX_PITCH) {
    return { crashed: true, reason: 'tail-strike' };
  }
  return { crashed: false, reason: null };
}

/**
 * Grade a successful touchdown, 0-100 with per-factor breakdown (DESIGN §5).
 * @param {object} touchdown  { vy, vx, pitch, x, bounced }
 * @param {object} runway     { x, length }
 * @returns {{ score: number, stars: 1|2|3, breakdown: Array<{label: string, deduction: number}> }}
 */
export function gradeTouchdown(touchdown, runway) {
  const softness = 25 * clamp((Math.abs(touchdown.vy) - 0.6) / 1.9, 0, 1);
  const speed = 20 * clamp((Math.abs(touchdown.vx) - 18) / 12, 0, 1);
  const aimPoint = runway.x + runway.length / 3;
  const zone = 20 * (Math.abs(touchdown.x - aimPoint) / runway.length);
  const attitude = 15 * clamp(Math.abs(touchdown.pitch - 0.10) / 0.10, 0, 1);

  const breakdown = [
    { label: 'softness', deduction: softness },
    { label: 'speed', deduction: speed },
    { label: 'touchdown-zone', deduction: zone },
    { label: 'attitude', deduction: attitude },
  ];

  let total = softness + speed + zone + attitude;
  if (touchdown.bounced) {
    breakdown.push({ label: 'bounce', deduction: 20 });
    total += 20;
  }

  const score = clamp(Math.round(100 - total), 0, 100);
  const stars = score >= 90 ? 3 : score >= 70 ? 2 : 1;
  return { score, stars, breakdown };
}
