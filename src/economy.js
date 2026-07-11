// economy.js — PURE. Payouts, purchases, unlock gating.
// Owned by: Dev B (meta game). See docs/DESIGN.md §5 (multipliers), §6, §7.

/**
 * Mission payout from base reward + landing grade (+ URGENT par bonus).
 * 3-star ×1.3, 2-star ×1.0, 1-star ×0.7 minus $25 inspection fee.
 * Repeat of completed mission: ×0.5 on the contract before grade multipliers.
 * URGENT: beating parTimeS adds +50% of the (repeat-adjusted) contract.
 * Crash / no stars: no payout (§5 — mission failed).
 * @param {object} mission   { reward, type, parTimeS }
 * @param {object} result    { stars, score, timeS }
 * @param {boolean} isRepeat mission already completed before
 * @returns {{ payout: number, lines: Array<{label: string, amount: number}> }}
 */
export function missionPayout(mission, result, isRepeat) {
  const stars = (result && result.stars) || 0;
  if (stars < 1) {
    return { payout: 0, lines: [{ label: 'Mission failed - no payout', amount: 0 }] };
  }

  const lines = [{ label: 'Contract', amount: mission.reward }];
  let base = mission.reward;
  if (isRepeat) {
    lines.push({ label: 'Repeat contract (x0.5)', amount: -mission.reward * 0.5 });
    base = mission.reward * 0.5;
  }

  if (stars >= 3) {
    lines.push({ label: 'Greased it (x1.3)', amount: base * 0.3 });
  } else if (stars === 2) {
    lines.push({ label: 'Solid landing (x1.0)', amount: 0 });
  } else {
    lines.push({ label: 'Hard arrival (x0.7)', amount: -base * 0.3 });
    lines.push({ label: 'Airframe inspection fee', amount: -25 });
  }

  if (
    mission.type === 'URGENT' &&
    mission.parTimeS != null &&
    result.timeS != null &&
    result.timeS <= mission.parTimeS
  ) {
    lines.push({ label: 'Beat par time (+50%)', amount: base * 0.5 });
  }

  const payout = Math.max(0, Math.round(lines.reduce((sum, l) => sum + l.amount, 0)));
  return { payout, lines };
}

/**
 * @param {object} save   save object (DESIGN §7)
 * @param {object} item   { kind: 'plane'|'upgrade', id, cost, planeId? }
 * @returns {boolean}
 */
export function canAfford(save, item) {
  return save.money >= item.cost;
}

/**
 * Apply a purchase. Pure: returns new save object; throws/no-ops never — returns
 * { save, ok, error } so UI can show why.
 * @param {object} save
 * @param {object} item  as canAfford
 * @returns {{ save: object, ok: boolean, error: string|null }}
 */
export function applyPurchase(save, item) {
  if (!item || (item.kind !== 'plane' && item.kind !== 'upgrade')) {
    return { save, ok: false, error: 'unknown item kind' };
  }

  if (item.kind === 'plane') {
    if (save.planesOwned.includes(item.id)) {
      return { save, ok: false, error: 'already owned' };
    }
    if (!canAfford(save, item)) {
      return { save, ok: false, error: 'insufficient funds' };
    }
    return {
      save: {
        ...save,
        money: save.money - item.cost,
        planesOwned: [...save.planesOwned, item.id],
        upgrades: { ...save.upgrades, [item.id]: [...(save.upgrades[item.id] || [])] },
      },
      ok: true,
      error: null,
    };
  }

  // upgrade — per-plane, one-time (§7)
  const planeId = item.planeId || save.activePlane;
  if (!save.planesOwned.includes(planeId)) {
    return { save, ok: false, error: 'plane not owned' };
  }
  const owned = save.upgrades[planeId] || [];
  if (owned.includes(item.id)) {
    return { save, ok: false, error: 'already owned' };
  }
  if (!canAfford(save, item)) {
    return { save, ok: false, error: 'insufficient funds' };
  }
  return {
    save: {
      ...save,
      money: save.money - item.cost,
      upgrades: { ...save.upgrades, [planeId]: [...owned, item.id] },
    },
    ok: true,
    error: null,
  };
}

/**
 * Which mission ids are unlocked given the save (linear gating: m1 always; mN+1 after mN).
 * @param {object} save
 * @param {Array<object>} missions
 * @returns {string[]} unlocked mission ids
 */
export function unlockedMissions(save, missions) {
  const unlocked = [];
  for (let i = 0; i < missions.length; i += 1) {
    if (i === 0 || save.missionsCompleted[missions[i - 1].id]) {
      unlocked.push(missions[i].id);
    } else {
      break; // linear gating: first locked mission blocks the rest
    }
  }
  return unlocked;
}

/**
 * Record a mission completion into the save (best score/stars, money add). Pure.
 * @param {object} save
 * @param {string} missionId
 * @param {{score:number, stars:number, payout:number}} result
 * @returns {object} new save
 */
export function recordCompletion(save, missionId, result) {
  const prev = save.missionsCompleted[missionId];
  const entry =
    !prev || result.score > prev.bestScore
      ? { bestScore: result.score, stars: result.stars }
      : { ...prev };
  return {
    ...save,
    money: save.money + (result.payout || 0),
    missionsCompleted: { ...save.missionsCompleted, [missionId]: entry },
  };
}
