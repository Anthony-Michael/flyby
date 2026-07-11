// monetize.js — no-op hook module. docs/DESIGN.md §12.
// The portal build (CrazyGames/Poki) swaps THIS ONE FILE for an SDK-backed version.
// Core game must never import an SDK. Do not add more hooks without lead approval.

export const hooks = {
  /** Awaited before showing debrief — portal builds put interstitials here. */
  onMissionEnd: () => Promise.resolve(),
  /** Called once when the game is interactive — portal sdk.gameLoadingFinished(). */
  onGameLoaded: () => {},
  /** Mission-pack entitlement check. Core pack is always owned. */
  isPackOwned: (packId) => packId === 'core',
};
