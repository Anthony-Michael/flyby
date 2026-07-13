// landing.js — PURE. Touchdown crash checks + landing grade.
// Owned by: Dev A (sim core). Tolerances/scoring: docs/DESIGN.md §5.

// §5 tolerance contract — change only alongside the unit tests.
// Retuned after the round-1 playtest program: across 90 simulated casual-player
// crashes, hard impacts had median sink −4.3 m/s and EVERY too-fast touchdown was
// 30.3–31.5 m/s — players miss by 20–50%, not by miles. Survival is now forgiving;
// the grade formula (unchanged) keeps excellence hard: a −4 m/s "arrival" survives
// but scores ★ and pays the inspection fee.
export const DEFAULT_TOLERANCES = {
  CRASH_VY: 4.0, // m/s sink at contact beyond this = hard impact (was 2.5)
  CRASH_VX: 34, // m/s ground speed at contact beyond this = too fast (was 30)
  MIN_PITCH: -0.05, // rad: below = nose-gear strike (was -0.03)
  MAX_PITCH: 0.24, // rad: above = tail strike (was 0.21)
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Crash check at instant of ground contact.
 * @param {object} state   plane state at contact
 * @param {object|null} runway  {x, length, elevation} or null (off-runway contact = crash)
 * @param {object} [plane]  plane constants; reads CRASH_VY/CRASH_VX (upgrades like
 *                          Tundra tires raise them). Omitted → DEFAULT_TOLERANCES.
 * @returns {{ crashed: boolean, reason: string|null }}  reason e.g. 'hard-impact'|'too-fast'|'nose-strike'|'tail-strike'|'off-runway'
 */
export function checkCrash(state, runway, plane) {
  const maxSink = -(plane?.CRASH_VY ?? DEFAULT_TOLERANCES.CRASH_VY);
  const maxSpeed = plane?.CRASH_VX ?? DEFAULT_TOLERANCES.CRASH_VX;
  if (!runway || state.x < runway.x || state.x > runway.x + runway.length) {
    return { crashed: true, reason: 'off-runway' };
  }
  if (state.vy < maxSink) {
    return { crashed: true, reason: 'hard-impact' };
  }
  // |vx| so a plane landing while headed left is judged by the same speed limit.
  if (Math.abs(state.vx) > maxSpeed) {
    return { crashed: true, reason: 'too-fast' };
  }
  if (state.pitch < DEFAULT_TOLERANCES.MIN_PITCH) {
    return { crashed: true, reason: 'nose-strike' };
  }
  if (state.pitch > DEFAULT_TOLERANCES.MAX_PITCH) {
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
