/**
 * Shared Guild Tithing Proportionality Helpers
 * Models B = floor(G * (X / Y)) where Y Gold = X Bones and k = X / Y.
 */

export function resolveTithingConfig(configOrState) {
  const raw = (configOrState && typeof configOrState === 'object')
    ? ('config' in configOrState ? configOrState.config?.tithing : configOrState)
    : null;

  const goldAmount = Number(raw?.goldAmount);
  const bonesAmount = Number(raw?.bonesAmount);

  const validGold = Number.isFinite(goldAmount) && goldAmount > 0 ? Number(goldAmount.toFixed(6)) : 1;
  const validBones = Number.isFinite(bonesAmount) && bonesAmount > 0 ? Number(bonesAmount.toFixed(6)) : 1;

  return {
    goldAmount: validGold,
    bonesAmount: validBones,
    ratio: validBones / validGold
  };
}

export function getTithingConfig(state) {
  return resolveTithingConfig(state?.config?.tithing || null);
}

/**
 * Calculate whole Bones earned for a given Gold donation using floor((gold * X) / Y + 1e-9).
 */
export function calculateTithingBones(goldDonated, configOrState) {
  const cfg = resolveTithingConfig(configOrState);
  const gold = Number(goldDonated);
  if (!Number.isFinite(gold) || gold <= 0) return 0;
  return Math.max(0, Math.floor((gold * cfg.bonesAmount) / cfg.goldAmount + 1e-9));
}

/**
 * Minimum Gold needed to earn at least 1 Bone at the configured proportionality constant.
 */
export function getMinimumGoldForOneBone(configOrState) {
  const cfg = resolveTithingConfig(configOrState);
  return cfg.goldAmount / cfg.bonesAmount;
}

export function formatTithingNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  const rounded = Number(num.toFixed(6));
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

/**
 * Format human-readable guild rate banner: "Y Gold = X Bones" (or "1 Gold = 1 Bone").
 */
export function formatTithingRate(configOrState, currencyName = 'Bones') {
  const cfg = resolveTithingConfig(configOrState);
  const goldStr = formatTithingNumber(cfg.goldAmount);
  const bonesStr = formatTithingNumber(cfg.bonesAmount);
  const unitLabel = String(currencyName || 'Bones').toLowerCase() === 'bones'
    ? (Math.abs(cfg.bonesAmount - 1) < 1e-9 ? 'Bone' : 'Bones')
    : currencyName;
  return `${goldStr} Gold = ${bonesStr} ${unitLabel}`;
}

/**
 * Convert a proportionality constant k (Bones per 1 Gold) into a clean (Y Gold, X Bones) pair.
 */
export function deriveTithingPairFromConstant(kValue) {
  const k = Number(kValue);
  if (!Number.isFinite(k) || k <= 0) {
    return { goldAmount: 1, bonesAmount: 1 };
  }

  if (k < 1) {
    const inv = 1 / k;
    const roundedInv = Math.round(inv);
    if (roundedInv >= 1 && Math.abs(inv - roundedInv) < 1e-6) {
      return { goldAmount: roundedInv, bonesAmount: 1 };
    }
    for (let denom = 2; denom <= 100; denom++) {
      const scaled = k * denom;
      const roundedScaled = Math.round(scaled);
      if (roundedScaled >= 1 && Math.abs(scaled - roundedScaled) < 1e-6) {
        return { goldAmount: denom, bonesAmount: roundedScaled };
      }
    }
  }

  return {
    goldAmount: 1,
    bonesAmount: Number(k.toFixed(6))
  };
}
