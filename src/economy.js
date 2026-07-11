// economy.js — PURE. Payouts, purchases, unlock gating.
// Owned by: Dev B (meta game). See docs/DESIGN.md §5 (multipliers), §6, §7.

/**
 * Mission payout from base reward + landing grade (+ URGENT par bonus later).
 * ★★★ ×1.3, ★★ ×1.0, ★ ×0.7 minus $25 inspection fee. Repeat of completed mission: ×0.5.
 * @param {object} mission   { reward, type, parTimeS }
 * @param {object} result    { stars, score, timeS }
 * @param {boolean} isRepeat mission already completed before
 * @returns {{ payout: number, lines: Array<{label: string, amount: number}> }}
 */
export function missionPayout(mission, result, isRepeat) {
  throw new Error('not implemented');
}

/**
 * @param {object} save   save object (DESIGN §7)
 * @param {object} item   { kind: 'plane'|'upgrade', id, cost, planeId? }
 * @returns {boolean}
 */
export function canAfford(save, item) {
  throw new Error('not implemented');
}

/**
 * Apply a purchase. Pure: returns new save object; throws/no-ops never — returns
 * { save, ok, error } so UI can show why.
 * @param {object} save
 * @param {object} item  as canAfford
 * @returns {{ save: object, ok: boolean, error: string|null }}
 */
export function applyPurchase(save, item) {
  throw new Error('not implemented');
}

/**
 * Which mission ids are unlocked given the save (linear gating: m1 always; mN+1 after mN).
 * @param {object} save
 * @param {Array<object>} missions
 * @returns {string[]} unlocked mission ids
 */
export function unlockedMissions(save, missions) {
  throw new Error('not implemented');
}

/**
 * Record a mission completion into the save (best score/stars, money add). Pure.
 * @param {object} save
 * @param {string} missionId
 * @param {{score:number, stars:number, payout:number}} result
 * @returns {object} new save
 */
export function recordCompletion(save, missionId, result) {
  throw new Error('not implemented');
}
