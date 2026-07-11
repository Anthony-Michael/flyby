// landing.js — PURE. Touchdown crash checks + landing grade.
// Owned by: Dev A (sim core). Tolerances/scoring: docs/DESIGN.md §5.

/**
 * Crash check at instant of ground contact.
 * @param {object} state   plane state at contact
 * @param {object|null} runway  {x, length, elevation} or null (off-runway contact = crash)
 * @returns {{ crashed: boolean, reason: string|null }}  reason e.g. 'hard-impact'|'too-fast'|'nose-strike'|'tail-strike'|'off-runway'
 */
export function checkCrash(state, runway) {
  throw new Error('not implemented');
}

/**
 * Grade a successful touchdown, 0-100 with per-factor breakdown (DESIGN §5).
 * @param {object} touchdown  { vy, vx, pitch, x, bounced }
 * @param {object} runway     { x, length }
 * @returns {{ score: number, stars: 1|2|3, breakdown: Array<{label: string, deduction: number}> }}
 */
export function gradeTouchdown(touchdown, runway) {
  throw new Error('not implemented');
}
