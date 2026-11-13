export const WEEK_DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
];

/**
 * Resolve weekly cap configuration with defaults (50 Bones/week, Tuesday reset).
 */
export function getWeeklyCapConfig(state) {
  const raw = state?.config?.weeklyCap || {};
  const enabled = raw.enabled !== false;
  const parsedCap = parseInt(raw.cap, 10);
  const cap = Number.isFinite(parsedCap) && parsedCap >= 1 ? parsedCap : 50;
  const parsedDay = parseInt(raw.resetDay, 10);
  const resetDay = Number.isInteger(parsedDay) && parsedDay >= 0 && parsedDay <= 6 ? parsedDay : 2;
  return { enabled, cap, resetDay };
}

/**
 * Compute the UTC ISO timestamp for the start of the current weekly cap window.
 */
export function getWeeklyWindowStart(resetDay = 2, now = new Date()) {
  const day = Number.isInteger(resetDay) && resetDay >= 0 && resetDay <= 6 ? resetDay : 2;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const currentDay = d.getUTCDay();
  const diff = (currentDay - day + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString();
}

/**
 * Get the member's effective Bones earned in the current weekly window.
 */
export function getEffectiveWeeklyEarned(wallet, config, now = new Date()) {
  if (!wallet) return 0;
  const windowStart = getWeeklyWindowStart(config?.resetDay ?? 2, now);
  if (wallet.weeklyWindowStart !== windowStart) return 0;
  return Math.max(0, wallet.weeklyBonesEarned || 0);
}

/**
 * Apply an earned Bone award to a wallet while enforcing the weekly earning cap.
 * Spendable Bones can still exceed the weekly cap across multiple weeks.
 */
export function applyWeeklyBoneAward(wallet, requestedAmount, state, now = new Date()) {
  const config = getWeeklyCapConfig(state);
  const windowStart = getWeeklyWindowStart(config.resetDay, now);

  if (wallet.weeklyWindowStart !== windowStart) {
    wallet.weeklyWindowStart = windowStart;
    wallet.weeklyBonesEarned = 0;
  } else {
    wallet.weeklyBonesEarned = Math.max(0, wallet.weeklyBonesEarned || 0);
  }

  const requested = Math.max(0, parseInt(requestedAmount, 10) || 0);

  if (!config.enabled) {
    wallet.spendableBones = (wallet.spendableBones || 0) + requested;
    wallet.boneScore = (wallet.boneScore || 0) + requested;
    wallet.weeklyBonesEarned += requested;
    return {
      enabled: false,
      requested,
      granted: requested,
      capped: false,
      hitCap: false,
      weeklyEarned: wallet.weeklyBonesEarned,
      cap: config.cap,
      resetDay: config.resetDay,
      remainingAfter: null
    };
  }

  const remainingBefore = Math.max(0, config.cap - wallet.weeklyBonesEarned);
  const granted = Math.min(requested, remainingBefore);

  wallet.spendableBones = (wallet.spendableBones || 0) + granted;
  wallet.boneScore = (wallet.boneScore || 0) + granted;
  wallet.weeklyBonesEarned += granted;

  return {
    enabled: true,
    requested,
    granted,
    capped: granted < requested,
    hitCap: remainingBefore === 0,
    weeklyEarned: wallet.weeklyBonesEarned,
    cap: config.cap,
    resetDay: config.resetDay,
    remainingAfter: Math.max(0, config.cap - wallet.weeklyBonesEarned)
  };
}
