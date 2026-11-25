/**
 * Rank-Scaled Member Bounty / Contract Creation Cost & Escrow Helpers
 *
 * Cost rule:
 *   - Lowest rank (step 0): 10 Bones
 *   - Each higher rank: -2 Bones (10, 8, 6, 4, 2, 0...)
 *   - Minimum cost: 0 Bones (Free at step 5 / Rank 6+)
 */

export const BASE_BOUNTY_CREATION_COST = 10;
export const RANK_COST_STEP_DISCOUNT = 2;

/**
 * Resolve a member's 0-based rank progression index from `rankTier` and `ranks`.
 */
export function resolveRankIndex(rankTier = 0, ranks = []) {
  const numericTier = Math.max(0, Math.floor(Number(rankTier) || 0));
  if (!Array.isArray(ranks) || ranks.length === 0) {
    return numericTier;
  }

  const sorted = [...ranks].sort((a, b) => (Number(a?.tier) || 0) - (Number(b?.tier) || 0));
  const exactIdx = sorted.findIndex(r => (Number(r?.tier) || 0) === numericTier);
  if (exactIdx >= 0) {
    return exactIdx;
  }

  const maxConfiguredTier = Number(sorted[sorted.length - 1]?.tier) || 0;
  if (numericTier > maxConfiguredTier) {
    return Math.max(sorted.length, numericTier);
  }

  // Find highest rank step whose tier <= numericTier
  let bestIdx = 0;
  for (let i = 0; i < sorted.length; i++) {
    if ((Number(sorted[i]?.tier) || 0) <= numericTier) {
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Calculate the Spendable Bones cost for a member to post a bounty/contract.
 * Lowest rank = 10 Bones, then -2 Bones for each higher rank (clamped at 0).
 */
export function calculateBountyCreationCost(rankTier = 0, ranks = []) {
  const step = resolveRankIndex(rankTier, ranks);
  return Math.max(0, BASE_BOUNTY_CREATION_COST - RANK_COST_STEP_DISCOUNT * step);
}

/**
 * Build the full rank fee schedule (at least 6 steps so the progression down to Free is always visible).
 */
export function buildRankBountyCostSchedule(ranks = []) {
  const sorted = Array.isArray(ranks) && ranks.length > 0
    ? [...ranks].sort((a, b) => (Number(a?.tier) || 0) - (Number(b?.tier) || 0))
    : [];

  const totalSteps = Math.max(6, sorted.length);
  const schedule = [];
  for (let step = 0; step < totalSteps; step++) {
    const rankObj = sorted[step] || null;
    const costBones = Math.max(0, BASE_BOUNTY_CREATION_COST - RANK_COST_STEP_DISCOUNT * step);
    schedule.push({
      step,
      tier: rankObj ? (Number(rankObj.tier) || step) : step,
      rankNumber: step + 1,
      title: rankObj?.title ? String(rankObj.title) : `Rank ${step + 1}`,
      hasConfiguredRank: Boolean(rankObj),
      costBones,
      isFree: costBones === 0
    });
  }
  return schedule;
}

/**
 * Resolve standard payout rules for player-created contracts (`help` vs `kill`).
 */
export function resolveContractPayoutDefaults(contractType = 'help') {
  const normalized = String(contractType || '').trim().toLowerCase() === 'kill' ? 'kill' : 'help';
  if (normalized === 'kill') {
    return {
      contractType: 'kill',
      baseRewardBones: 1,
      maxRewardBones: 10,
      defaultCategory: 'PvP',
      payoutLabel: '1 Bone / Kill (Max 10)'
    };
  }
  return {
    contractType: 'help',
    baseRewardBones: 5,
    maxRewardBones: 5,
    defaultCategory: 'Dungeon',
    payoutLabel: '5 Bones per Helper'
  };
}

/**
 * Extract the exact Spendable Bones held in escrow for a player-created bounty.
 * Preserves backwards compatibility with legacy bounties created before `escrowBones` was decoupled from `rewardBones`.
 */
export function getBountyEscrowBones(bounty) {
  if (!bounty || typeof bounty !== 'object') return 0;
  if (bounty.escrowBones !== undefined && bounty.escrowBones !== null) {
    return Math.max(0, Math.floor(Number(bounty.escrowBones) || 0));
  }
  const fallback = bounty.baseRewardBones !== undefined ? bounty.baseRewardBones : (bounty.rewardBones || 0);
  return Math.max(0, Math.floor(Number(fallback) || 0));
}
