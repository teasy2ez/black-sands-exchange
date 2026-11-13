export const WEEK_DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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
 * Compute the member's current weekly state (earned, rollover, effective cap) without mutating.
 */
export function getEffectiveWeeklyState(wallet, config, now = new Date()) {
  const baseCap = config?.cap ?? 50;
  const currentWindowStart = getWeeklyWindowStart(config?.resetDay ?? 2, now);

  if (!wallet || !wallet.weeklyWindowStart) {
    return {
      windowStart: currentWindowStart,
      weeklyEarned: 0,
      rollover: 0,
      effectiveCap: baseCap
    };
  }

  const prevRollover = Math.max(0, wallet.weeklyCapRollover || 0);
  const prevEarned = Math.max(0, wallet.weeklyBonesEarned || 0);

  if (wallet.weeklyWindowStart === currentWindowStart) {
    return {
      windowStart: currentWindowStart,
      weeklyEarned: prevEarned,
      rollover: prevRollover,
      effectiveCap: baseCap + prevRollover
    };
  }

  const currentMs = Date.parse(currentWindowStart);
  const prevMs = Date.parse(wallet.weeklyWindowStart);
  const weeksElapsed = (Number.isFinite(currentMs) && Number.isFinite(prevMs) && currentMs > prevMs)
    ? Math.round((currentMs - prevMs) / WEEK_MS)
    : 0;

  if (weeksElapsed <= 0) {
    return {
      windowStart: currentWindowStart,
      weeklyEarned: prevEarned,
      rollover: prevRollover,
      effectiveCap: baseCap + prevRollover
    };
  }

  const prevEffectiveCap = baseCap + prevRollover;
  const unusedFromPrevWeek = Math.max(0, prevEffectiveCap - prevEarned);
  const newRollover = unusedFromPrevWeek + (weeksElapsed - 1) * baseCap;

  return {
    windowStart: currentWindowStart,
    weeklyEarned: 0,
    rollover: newRollover,
    effectiveCap: baseCap + newRollover
  };
}

/**
 * Apply an earned Bone award to a wallet while enforcing the weekly catch-up cap.
 * Unused cap from previous weeks rolls over into the current week's cap.
 * Spendable Bones can still exceed the weekly cap across multiple weeks.
 */
export function applyWeeklyBoneAward(wallet, requestedAmount, state, now = new Date()) {
  const config = getWeeklyCapConfig(state);
  const weeklyState = getEffectiveWeeklyState(wallet, config, now);

  wallet.weeklyWindowStart = weeklyState.windowStart;
  wallet.weeklyCapRollover = weeklyState.rollover;
  wallet.weeklyBonesEarned = weeklyState.weeklyEarned;

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
      cap: weeklyState.effectiveCap,
      baseCap: config.cap,
      rollover: weeklyState.rollover,
      resetDay: config.resetDay,
      remainingAfter: null
    };
  }

  const remainingBefore = Math.max(0, weeklyState.effectiveCap - wallet.weeklyBonesEarned);
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
    cap: weeklyState.effectiveCap,
    baseCap: config.cap,
    rollover: weeklyState.rollover,
    resetDay: config.resetDay,
    remainingAfter: Math.max(0, weeklyState.effectiveCap - wallet.weeklyBonesEarned)
  };
}
