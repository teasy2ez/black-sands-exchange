/**
 * Audit Trail Reversal (Undo) & Compact Snapshot Helpers
 *
 * Ensures every ledger action can be cleanly reversed by Officers without
 * corrupting Weekly Earn Caps, double-refunding escrow/orders, or bloating
 * the Firestore document.
 */

import { getWeeklyCapConfig, getWeeklyWindowStart } from './weeklyCap.js';
import { pruneMissingCraftersFromCraftingState } from './armory.js';

/**
 * Create a compact wallet snapshot safe to embed inside an audit entry's undoMeta.
 */
export function compactWalletSnapshot(wallet) {
  if (!wallet || typeof wallet !== 'object') return null;
  return {
    discordId: wallet.discordId,
    username: wallet.username || null,
    globalName: wallet.globalName || null,
    serverNickname: wallet.serverNickname || null,
    avatarHash: wallet.avatarHash || null,
    roles: Array.isArray(wallet.roles) ? [...wallet.roles] : [],
    spendableBones: wallet.spendableBones || 0,
    boneScore: wallet.boneScore || 0,
    bountiesCompleted: wallet.bountiesCompleted || 0,
    postedBountiesCompleted: wallet.postedBountiesCompleted || 0,
    rankTier: wallet.rankTier || 0,
    rankTitle: wallet.rankTitle || null,
    guildNote: wallet.guildNote || '',
    officerHidden: Boolean(wallet.officerHidden),
    primaryCharacter: wallet.primaryCharacter || null,
    characters: Array.isArray(wallet.characters) ? wallet.characters.map(c => ({ ...c })) : [],
    weeklyBonesEarned: wallet.weeklyBonesEarned || 0,
    weeklyCapRollover: wallet.weeklyCapRollover || 0,
    weeklyWindowStart: wallet.weeklyWindowStart || null,
    createdAt: wallet.createdAt || null,
    updatedAt: wallet.updatedAt || null
  };
}

/**
 * Create a compact bounty snapshot safe to embed inside an audit entry's undoMeta.
 */
export function compactBountySnapshot(bounty) {
  if (!bounty || typeof bounty !== 'object') return null;
  const snap = {
    id: bounty.id,
    title: bounty.title || 'Bounty',
    description: bounty.description || '',
    category: bounty.category || 'General',
    bountyType: bounty.bountyType || 'fixed',
    contractType: bounty.contractType || null,
    creatorId: bounty.creatorId || null,
    creatorUsername: bounty.creatorUsername || null,
    creatorNickname: bounty.creatorNickname || null,
    escrowBones: bounty.escrowBones !== undefined ? bounty.escrowBones : undefined,
    baseRewardBones: bounty.baseRewardBones !== undefined ? bounty.baseRewardBones : (bounty.rewardBones || 0),
    maxRewardBones: bounty.maxRewardBones !== undefined ? bounty.maxRewardBones : undefined,
    officerBonusBones: bounty.officerBonusBones || 0,
    rewardBones: bounty.rewardBones || 0,
    status: bounty.status || 'active',
    bonuses: Array.isArray(bounty.bonuses) ? bounty.bonuses.map(b => ({ ...b })) : [],
    approvedBy: bounty.approvedBy || null,
    approvedAt: bounty.approvedAt || null,
    createdAt: bounty.createdAt || new Date().toISOString()
  };
  if (snap.escrowBones === undefined) delete snap.escrowBones;
  if (snap.maxRewardBones === undefined) delete snap.maxRewardBones;
  if (!snap.contractType) delete snap.contractType;
  return snap;
}

function extractClaimId(entry) {
  if (entry?.undoMeta?.claimId) return entry.undoMeta.claimId;
  const m = String(entry?.reason || '').match(/(claim_[a-zA-Z0-9_]+)/);
  return m ? m[1] : null;
}

function extractOrderId(entry) {
  if (entry?.undoMeta?.orderId) return entry.undoMeta.orderId;
  const m = String(entry?.reason || '').match(/(order_[a-zA-Z0-9_]+)/);
  return m ? m[1] : null;
}

function extractQuotedTitle(reason) {
  const m = String(reason || '').match(/"([^"]+)"/);
  return m ? m[1] : null;
}

function resolveRankTitle(ranks, tier) {
  const found = (ranks || []).find(r => (r.tier || 0) === tier);
  return found ? found.title : null;
}

function deductWeeklyAwardFromWallet(wallet, amount, timestamp, meta, state) {
  const cfg = getWeeklyCapConfig(state);
  const currentWindowStart = getWeeklyWindowStart(cfg.resetDay);
  const deltaWeekly = meta?.deltaWeeklyEarned !== undefined ? meta.deltaWeeklyEarned : amount;

  if (deltaWeekly <= 0) return;

  if (meta?.weeklyWindowStart || meta?.newWeeklyWindowStart) {
    const recordedWindow = meta.newWeeklyWindowStart || meta.weeklyWindowStart;
    if (wallet.weeklyWindowStart === recordedWindow) {
      wallet.weeklyBonesEarned = Math.max(0, (wallet.weeklyBonesEarned || 0) - deltaWeekly);
    }
    return;
  }

  // Legacy fallback without undoMeta: subtract if award happened inside the wallet's current active weekly window
  if (wallet.weeklyWindowStart === currentWindowStart && timestamp && timestamp >= currentWindowStart) {
    wallet.weeklyBonesEarned = Math.max(0, (wallet.weeklyBonesEarned || 0) - deltaWeekly);
  }
}

/**
 * Determine whether an audit trail entry can currently be undone safely.
 * Returns { allowed: boolean, reason: string }.
 */
export function canUndoAuditEntry(entry, state) {
  if (!entry || !entry.id) {
    return { allowed: false, reason: 'Invalid audit entry' };
  }
  if (entry.undoneAt) {
    return { allowed: false, reason: `Already undone by ${entry.undoneBy || 'an Officer'}` };
  }
  if (entry.action === 'AUDIT_UNDO') {
    return { allowed: false, reason: 'Reversal log entries cannot be undone directly' };
  }

  const wallets = state?.wallets || {};
  const bounties = state?.bounties || [];
  const claims = state?.claims || {};
  const deliveries = state?.deliveries || {};
  const meta = entry.undoMeta || null;

  switch (entry.action) {
    case 'AWARD':
    case 'DEDUCT':
    case 'PRESTIGE_PROMOTION':
    case 'MEMBER_HIDE':
    case 'MEMBER_UNHIDE': {
      const tid = meta?.targetId || entry.targetId;
      if (!tid || !wallets[tid]) {
        return { allowed: false, reason: 'Target member wallet not found in ledger' };
      }
      return { allowed: true, reason: '' };
    }

    case 'BOUNTY_REWARD': {
      const tid = meta?.targetId || entry.targetId;
      if (!tid || !wallets[tid]) {
        return { allowed: false, reason: 'Claimant wallet not found in ledger' };
      }
      return { allowed: true, reason: '' };
    }

    case 'SPENDABLE_BONES_OVERRIDE':
    case 'LIFETIME_BONES_ADJUST':
    case 'BOUNTY_STATS_ADJUST':
    case 'LEDGER_CORRECTION': {
      const tid = meta?.targetId || entry.targetId;
      if (!tid || !wallets[tid]) {
        return { allowed: false, reason: 'Target member wallet not found in ledger' };
      }
      if (meta?.kind === 'member_adjust') {
        if (!Array.isArray(meta.changedFields) || meta.changedFields.length === 0) {
          return { allowed: false, reason: 'No changed fields recorded in this entry' };
        }
        return { allowed: true, reason: '' };
      }
      // Legacy fallback checks
      if (entry.action === 'SPENDABLE_BONES_OVERRIDE' && entry.spendableBones !== null && entry.spendableBones !== undefined) {
        return { allowed: true, reason: '' };
      }
      if (entry.action === 'LEDGER_CORRECTION' && entry.spendableBones !== null && entry.spendableBones !== undefined && entry.amount) {
        return { allowed: true, reason: '' };
      }
      if (entry.action === 'LIFETIME_BONES_ADJUST' && /(\d+)\s*->\s*(\d+)/.test(String(entry.reason || ''))) {
        return { allowed: true, reason: '' };
      }
      return { allowed: false, reason: 'Legacy adjustment lacks previous values — adjust via Ledger Overrides' };
    }

    case 'BOUNTY_REQUEST_ESCROW': {
      const bountyId = meta?.bountyId;
      const quotedTitle = extractQuotedTitle(entry.reason);
      const bounty = bountyId
        ? bounties.find(b => b.id === bountyId)
        : bounties.find(b => b.creatorId === entry.targetId && quotedTitle && b.title === quotedTitle);

      if (!bounty) {
        return { allowed: false, reason: 'Bounty no longer exists (escrow already cancelled/resolved)' };
      }
      if (bounty.status === 'rejected') {
        return { allowed: false, reason: 'Escrow was already refunded when this request was rejected' };
      }
      const hasApprovedClaim = Object.values(claims).some(c => c.bountyId === bounty.id && c.status === 'approved');
      if (hasApprovedClaim) {
        return { allowed: false, reason: 'Cannot cancel escrow after a claim on this bounty was approved' };
      }
      return { allowed: true, reason: '' };
    }

    case 'BOUNTY_REQUEST_APPROVED': {
      const bountyId = meta?.bountyId;
      const quotedTitle = extractQuotedTitle(entry.reason);
      const bounty = bountyId
        ? bounties.find(b => b.id === bountyId)
        : bounties.find(b => b.creatorId === entry.targetId && quotedTitle && b.title === quotedTitle && b.status === 'active');

      if (!bounty) {
        return { allowed: false, reason: 'Bounty no longer exists in bounty board' };
      }
      if (bounty.status === 'rejected') {
        return { allowed: false, reason: 'Bounty was already rejected and refunded' };
      }
      const hasApprovedClaim = Object.values(claims).some(c => c.bountyId === bounty.id && c.status === 'approved');
      if (hasApprovedClaim) {
        return { allowed: false, reason: 'Cannot revert approval after a claim was approved' };
      }
      return { allowed: true, reason: '' };
    }

    case 'BOUNTY_ESCROW_REFUND': {
      if (meta?.kind === 'bounty_escrow_refund' && meta.mode === 'bounty_delete' && meta.bountySnapshot) {
        const exists = bounties.some(b => b.id === meta.bountySnapshot.id);
        if (exists) {
          return { allowed: false, reason: 'Cancelled bounty already exists again' };
        }
        return { allowed: true, reason: '' };
      }
      const bountyId = meta?.bountyId;
      const quotedTitle = extractQuotedTitle(entry.reason);
      const rejectedBounty = bountyId
        ? bounties.find(b => b.id === bountyId && b.status === 'rejected')
        : bounties.find(b => b.creatorId === entry.targetId && quotedTitle && b.title === quotedTitle && b.status === 'rejected');

      if (!rejectedBounty) {
        return { allowed: false, reason: 'Legacy deleted bounty lacks snapshot — recreate manually' };
      }
      return { allowed: true, reason: '' };
    }

    case 'SHOP_PURCHASE': {
      const orderId = extractOrderId(entry);
      const delivery = orderId ? deliveries[orderId] : null;
      if (!delivery) {
        return { allowed: false, reason: 'Shop order record no longer exists' };
      }
      if (delivery.status === 'refunded') {
        return { allowed: false, reason: 'Order was already refunded' };
      }
      if (!wallets[meta?.targetId || entry.targetId]) {
        return { allowed: false, reason: 'Buyer wallet not found in ledger' };
      }
      return { allowed: true, reason: '' };
    }

    case 'SHOP_REFUND': {
      const orderId = extractOrderId(entry);
      const delivery = orderId ? deliveries[orderId] : null;
      if (!delivery || delivery.status !== 'refunded') {
        return { allowed: false, reason: 'Refunded order record no longer exists' };
      }
      return { allowed: true, reason: '' };
    }

    case 'BATCH_AWARD': {
      if (meta?.kind === 'batch_award' && Array.isArray(meta.targetIds) && meta.targetIds.length > 0) {
        return { allowed: true, reason: '' };
      }
      const raw = String(entry.targetId || '');
      if (!raw || raw.includes('more')) {
        return { allowed: false, reason: 'Legacy batch award list truncated — adjust members individually' };
      }
      return { allowed: true, reason: '' };
    }

    case 'MEMBER_DELETE': {
      const tid = meta?.targetId || entry.targetId;
      if (!tid) return { allowed: false, reason: 'Missing deleted member ID' };
      if (wallets[tid]) {
        return { allowed: false, reason: 'Member wallet already exists in ledger' };
      }
      return { allowed: true, reason: '' };
    }

    case 'OFFICER_CHARACTER_LINK': {
      const tid = meta?.targetId || entry.targetId;
      if (!tid || !wallets[tid]) {
        return { allowed: false, reason: 'Target member wallet not found in ledger' };
      }
      if (!meta || meta.kind !== 'member_characters_override' || !Array.isArray(meta.prevCharacters)) {
        return { allowed: false, reason: 'Character link entry lacks previous snapshot' };
      }
      return { allowed: true, reason: '' };
    }

    case 'ROSTER_DISCORD_SYNC':
    case 'ROSTER_AUTO_SYNC': {
      if (meta?.kind === 'roster_sync') {
        const hasDiff = (meta.joinedIds?.length || 0) > 0 || (meta.removedWallets?.length || 0) > 0;
        if (hasDiff) return { allowed: true, reason: '' };
      }
      return { allowed: false, reason: 'No member additions or removals in this sync to revert' };
    }

    default:
      return { allowed: false, reason: `Undo not supported for ${entry.action || 'this event'}` };
  }
}

/**
 * Reverse an audit trail entry in-place on `state`, mark it as undone,
 * and return the companion AUDIT_UNDO entry payload + side-effect metadata.
 */
export function revertAuditEntry(state, entryId, opts = {}) {
  state.auditLog = state.auditLog || [];
  state.wallets = state.wallets || {};
  state.bounties = state.bounties || [];
  state.claims = state.claims || {};
  state.deliveries = state.deliveries || {};

  const entry = state.auditLog.find(e => e && e.id === entryId);
  if (!entry) {
    return { ok: false, status: 404, error: 'Audit log entry not found (it may have aged out of the 300-entry window).' };
  }

  const check = canUndoAuditEntry(entry, state);
  if (!check.allowed) {
    return { ok: false, status: 400, error: check.reason };
  }

  const nowIso = new Date().toISOString();
  const officerId = opts.officerId || null;
  const officerName = opts.officerName || 'Officer';
  const customReason = String(opts.reason || '').trim();
  const meta = entry.undoMeta || null;

  let undoAmount = 0;
  let undoSpendable = null;
  let undoScore = null;
  let summary = '';
  let syncBounties = false;
  let discordRoleRemoval = null;

  switch (entry.action) {
    case 'AWARD': {
      const tid = meta?.targetId || entry.targetId;
      const w = state.wallets[tid];
      const deltaSpend = meta?.deltaSpendable !== undefined ? meta.deltaSpendable : Math.max(0, parseInt(entry.amount, 10) || 0);
      const deltaScore = meta?.deltaScore !== undefined ? meta.deltaScore : deltaSpend;
      const oldSpend = w.spendableBones || 0;

      w.spendableBones = Math.max(0, oldSpend - deltaSpend);
      w.boneScore = Math.max(0, (w.boneScore || 0) - deltaScore);
      deductWeeklyAwardFromWallet(w, deltaSpend, entry.timestamp, meta, state);
      w.updatedAt = nowIso;

      undoAmount = w.spendableBones - oldSpend;
      undoSpendable = w.spendableBones;
      undoScore = w.boneScore;
      summary = `Reversed +${deltaSpend} Bone award for ${entry.targetName || tid}`;
      break;
    }

    case 'DEDUCT': {
      const tid = meta?.targetId || entry.targetId;
      const w = state.wallets[tid];
      const restore = meta?.deltaSpendable !== undefined ? meta.deltaSpendable : Math.abs(parseInt(entry.amount, 10) || 0);
      const oldSpend = w.spendableBones || 0;

      w.spendableBones = oldSpend + restore;
      w.updatedAt = nowIso;

      undoAmount = w.spendableBones - oldSpend;
      undoSpendable = w.spendableBones;
      undoScore = w.boneScore || 0;
      summary = `Restored +${restore} Bones from reversed deduction for ${entry.targetName || tid}`;
      break;
    }

    case 'BOUNTY_REWARD': {
      const tid = meta?.targetId || entry.targetId;
      const w = state.wallets[tid];
      const deltaSpend = meta?.deltaSpendable !== undefined ? meta.deltaSpendable : Math.max(0, parseInt(entry.amount, 10) || 0);
      const deltaScore = meta?.deltaScore !== undefined ? meta.deltaScore : deltaSpend;
      const oldSpend = w.spendableBones || 0;

      w.spendableBones = Math.max(0, oldSpend - deltaSpend);
      w.boneScore = Math.max(0, (w.boneScore || 0) - deltaScore);
      w.bountiesCompleted = Math.max(0, (w.bountiesCompleted || 0) - 1);
      deductWeeklyAwardFromWallet(w, deltaSpend, entry.timestamp, meta, state);
      w.updatedAt = nowIso;

      if (meta?.creatorId && state.wallets[meta.creatorId]) {
        const cw = state.wallets[meta.creatorId];
        cw.postedBountiesCompleted = Math.max(0, (cw.postedBountiesCompleted || 0) - 1);
        cw.updatedAt = nowIso;
      }

      const claimId = extractClaimId(entry);
      const claim = claimId ? state.claims[claimId] : null;
      if (claim && claim.status === 'approved') {
        claim.status = meta?.prevClaimStatus || 'pending';
        if (meta && 'prevClaimRewardBones' in meta) {
          if (meta.prevClaimRewardBones === undefined || meta.prevClaimRewardBones === null) {
            delete claim.rewardBones;
          } else {
            claim.rewardBones = meta.prevClaimRewardBones;
          }
        }
        if (meta && Array.isArray(meta.prevClaimAchievedBonusIds)) {
          claim.achievedBonusIds = [...meta.prevClaimAchievedBonusIds];
        } else {
          delete claim.achievedBonusIds;
        }
        delete claim.reviewedBy;
        delete claim.reviewedById;
        delete claim.reviewedAt;
        delete claim.officerNote;
      }

      undoAmount = w.spendableBones - oldSpend;
      undoSpendable = w.spendableBones;
      undoScore = w.boneScore;
      summary = `Reverted bounty reward (-${deltaSpend} Bones${claim ? `, claim ${claimId} returned to pending` : ''})`;
      break;
    }

    case 'PRESTIGE_PROMOTION': {
      const tid = meta?.targetId || entry.targetId;
      const w = state.wallets[tid];
      const refund = meta?.refundBones !== undefined ? meta.refundBones : Math.abs(parseInt(entry.amount, 10) || 0);
      const oldSpend = w.spendableBones || 0;
      const nextTier = meta && meta.prevRankTier !== undefined ? meta.prevRankTier : Math.max(0, (w.rankTier || 0) - 1);

      w.spendableBones = oldSpend + refund;
      w.rankTier = nextTier;
      w.rankTitle = (meta && meta.prevRankTitle !== undefined)
        ? meta.prevRankTitle
        : (resolveRankTitle(state.ranks, nextTier) || w.rankTitle || null);
      w.updatedAt = nowIso;

      if (meta?.grantedRoleId) {
        discordRoleRemoval = { userId: tid, roleId: meta.grantedRoleId };
      }

      undoAmount = w.spendableBones - oldSpend;
      undoSpendable = w.spendableBones;
      undoScore = w.boneScore || 0;
      summary = `Reverted rank promotion to Tier ${nextTier} and refunded +${refund} Bones`;
      break;
    }

    case 'SPENDABLE_BONES_OVERRIDE':
    case 'LIFETIME_BONES_ADJUST':
    case 'BOUNTY_STATS_ADJUST':
    case 'LEDGER_CORRECTION': {
      const tid = meta?.targetId || entry.targetId;
      const w = state.wallets[tid];
      const oldSpend = w.spendableBones || 0;

      if (meta?.kind === 'member_adjust') {
        const changed = meta.changedFields || [];
        const prev = meta.prev || {};
        if (changed.includes('spendableBones')) w.spendableBones = Math.max(0, prev.spendableBones || 0);
        if (changed.includes('boneScore')) w.boneScore = Math.max(0, prev.boneScore || 0);
        if (changed.includes('bountiesCompleted')) w.bountiesCompleted = Math.max(0, prev.bountiesCompleted || 0);
        if (changed.includes('postedBountiesCompleted')) w.postedBountiesCompleted = Math.max(0, prev.postedBountiesCompleted || 0);
        if (changed.includes('rankTier')) {
          w.rankTier = Math.max(0, prev.rankTier || 0);
          w.rankTitle = prev.rankTitle !== undefined ? prev.rankTitle : resolveRankTitle(state.ranks, w.rankTier);
        }
        if (changed.includes('officerHidden')) w.officerHidden = Boolean(prev.officerHidden);
        w.updatedAt = nowIso;

        undoAmount = w.spendableBones - oldSpend;
        undoSpendable = w.spendableBones;
        undoScore = w.boneScore || 0;
        summary = `Restored ${changed.join(', ')} prior to ${entry.action} for ${entry.targetName || tid}`;
      } else {
        // Legacy fallback
        if (entry.action === 'SPENDABLE_BONES_OVERRIDE' || (entry.action === 'LEDGER_CORRECTION' && entry.spendableBones !== null && entry.amount)) {
          const prevSpendable = Math.max(0, (entry.spendableBones || 0) - (entry.amount || 0));
          w.spendableBones = prevSpendable;
        } else if (entry.action === 'LIFETIME_BONES_ADJUST') {
          const m = String(entry.reason || '').match(/(\d+)\s*->\s*(\d+)/);
          w.boneScore = Math.max(0, parseInt(m[1], 10) || 0);
        }
        w.updatedAt = nowIso;
        undoAmount = w.spendableBones - oldSpend;
        undoSpendable = w.spendableBones;
        undoScore = w.boneScore || 0;
        summary = `Restored prior balance before ${entry.action} for ${entry.targetName || tid}`;
      }
      break;
    }

    case 'MEMBER_HIDE':
    case 'MEMBER_UNHIDE': {
      const tid = meta?.targetId || entry.targetId;
      const w = state.wallets[tid];
      w.officerHidden = meta ? Boolean(meta.prevHidden) : (entry.action !== 'MEMBER_HIDE');
      w.updatedAt = nowIso;
      undoAmount = 0;
      undoSpendable = w.spendableBones || 0;
      undoScore = w.boneScore || 0;
      summary = w.officerHidden
        ? `Restored hidden status for ${entry.targetName || tid}`
        : `Restored leaderboard visibility for ${entry.targetName || tid}`;
      break;
    }

    case 'BOUNTY_REQUEST_ESCROW': {
      const bountyId = meta?.bountyId;
      const quotedTitle = extractQuotedTitle(entry.reason);
      const bounty = bountyId
        ? state.bounties.find(b => b.id === bountyId)
        : state.bounties.find(b => b.creatorId === entry.targetId && quotedTitle && b.title === quotedTitle);

      const refund = meta?.refundBones !== undefined ? meta.refundBones : Math.abs(parseInt(entry.amount, 10) || 0);
      const tid = meta?.targetId || entry.targetId;
      const w = state.wallets[tid];
      const oldSpend = w ? (w.spendableBones || 0) : 0;

      state.bounties = state.bounties.filter(b => b.id !== bounty.id);
      if (w && refund > 0) {
        w.spendableBones = oldSpend + refund;
        w.updatedAt = nowIso;
      }

      syncBounties = true;
      undoAmount = w ? (w.spendableBones - oldSpend) : 0;
      undoSpendable = w ? w.spendableBones : null;
      undoScore = w ? (w.boneScore || 0) : null;
      summary = `Cancelled escrowed bounty "${bounty.title}" and refunded +${refund} Bones`;
      break;
    }

    case 'BOUNTY_REQUEST_APPROVED': {
      const bountyId = meta?.bountyId;
      const quotedTitle = extractQuotedTitle(entry.reason);
      const bounty = bountyId
        ? state.bounties.find(b => b.id === bountyId)
        : state.bounties.find(b => b.creatorId === entry.targetId && quotedTitle && b.title === quotedTitle && b.status === 'active');

      bounty.status = meta?.prevStatus || 'pending_review';
      if (meta?.prevBaseRewardBones !== undefined) {
        bounty.baseRewardBones = meta.prevBaseRewardBones;
      }
      bounty.officerBonusBones = meta?.prevOfficerBonusBones ?? 0;
      bounty.rewardBones = meta?.prevRewardBones ?? (bounty.baseRewardBones !== undefined ? bounty.baseRewardBones : bounty.rewardBones || 0);
      delete bounty.approvedBy;
      delete bounty.approvedAt;
      bounty.updatedAt = nowIso;

      syncBounties = true;
      undoAmount = 0;
      summary = `Reverted approval of bounty "${bounty.title}" back to pending review`;
      break;
    }

    case 'BOUNTY_ESCROW_REFUND': {
      const tid = meta?.targetId || entry.targetId;
      const w = state.wallets[tid];
      const deduct = meta?.deductBones !== undefined ? meta.deductBones : Math.abs(parseInt(entry.amount, 10) || 0);
      const oldSpend = w ? (w.spendableBones || 0) : 0;

      if (meta?.kind === 'bounty_escrow_refund' && meta.mode === 'bounty_delete' && meta.bountySnapshot) {
        state.bounties.push(compactBountySnapshot(meta.bountySnapshot));
        if (w && deduct > 0) {
          w.spendableBones = Math.max(0, oldSpend - deduct);
          w.updatedAt = nowIso;
        }
        summary = `Restored deleted bounty "${meta.bountySnapshot.title}" and reclaimed ${deduct} refunded Bones`;
      } else {
        const bountyId = meta?.bountyId;
        const quotedTitle = extractQuotedTitle(entry.reason);
        const bounty = bountyId
          ? state.bounties.find(b => b.id === bountyId && b.status === 'rejected')
          : state.bounties.find(b => b.creatorId === entry.targetId && quotedTitle && b.title === quotedTitle && b.status === 'rejected');

        bounty.status = meta?.prevStatus || 'pending_review';
        delete bounty.rejectedBy;
        delete bounty.rejectedAt;
        delete bounty.rejectReason;
        bounty.updatedAt = nowIso;

        if (w && deduct > 0) {
          w.spendableBones = Math.max(0, oldSpend - deduct);
          w.updatedAt = nowIso;
        }
        summary = `Reverted rejection of bounty "${bounty.title}" and reclaimed ${deduct} refunded Bones`;
      }

      syncBounties = true;
      undoAmount = w ? (w.spendableBones - oldSpend) : 0;
      undoSpendable = w ? w.spendableBones : null;
      undoScore = w ? (w.boneScore || 0) : null;
      break;
    }

    case 'SHOP_PURCHASE': {
      const orderId = extractOrderId(entry);
      const delivery = state.deliveries[orderId];
      const tid = meta?.targetId || entry.targetId;
      const w = state.wallets[tid];
      const refund = meta?.refundBones ?? delivery.costBones ?? Math.abs(parseInt(entry.amount, 10) || 0);
      const oldSpend = w.spendableBones || 0;

      w.spendableBones = oldSpend + refund;
      w.updatedAt = nowIso;

      const item = (state.shop || []).find(i => i.id === (meta?.itemId || delivery.itemId));
      if (item && !item.unlimitedStock && (meta?.decrementedStock ?? true)) {
        item.stock = (item.stock || 0) + 1;
      }

      delete state.deliveries[orderId];

      undoAmount = w.spendableBones - oldSpend;
      undoSpendable = w.spendableBones;
      undoScore = w.boneScore || 0;
      summary = `Cancelled shop purchase ${delivery.itemTitle} (${orderId}) and refunded +${refund} Bones`;
      break;
    }

    case 'SHOP_REFUND': {
      const orderId = extractOrderId(entry);
      const delivery = state.deliveries[orderId];
      const tid = meta?.targetId || delivery.discordId || entry.targetId;
      const w = state.wallets[tid];
      const deduct = meta?.deductBones ?? delivery.costBones ?? Math.abs(parseInt(entry.amount, 10) || 0);
      const oldSpend = w ? (w.spendableBones || 0) : 0;

      delivery.status = meta?.prevStatus || 'pending';
      delete delivery.refundedBy;
      delete delivery.refundedAt;
      delete delivery.refundReason;

      if (w && deduct > 0) {
        w.spendableBones = Math.max(0, oldSpend - deduct);
        w.updatedAt = nowIso;
      }

      const item = (state.shop || []).find(i => i.id === (meta?.itemId || delivery.itemId));
      if (item && !item.unlimitedStock && (meta?.incrementedStock ?? true)) {
        item.stock = Math.max(0, (item.stock || 0) - 1);
      }

      undoAmount = w ? (w.spendableBones - oldSpend) : 0;
      undoSpendable = w ? w.spendableBones : null;
      undoScore = w ? (w.boneScore || 0) : null;
      summary = `Reverted refund on ${delivery.itemTitle} (${orderId}) and deducted ${deduct} Bones`;
      break;
    }

    case 'BATCH_AWARD': {
      const targetIds = meta?.kind === 'batch_award'
        ? meta.targetIds
        : String(entry.targetId || '').split(',').map(s => s.trim()).filter(Boolean);
      const amt = meta?.amount !== undefined ? meta.amount : Math.max(0, parseInt(entry.amount, 10) || 0);

      let revertedCount = 0;
      for (const tid of targetIds) {
        const w = state.wallets[tid];
        if (!w) continue;
        w.spendableBones = Math.max(0, (w.spendableBones || 0) - amt);
        w.boneScore = Math.max(0, (w.boneScore || 0) - amt);
        w.updatedAt = nowIso;
        revertedCount++;
      }

      undoAmount = -amt;
      undoSpendable = null;
      undoScore = null;
      summary = `Reversed Raid Multi-Award (-${amt} Bones & Pts across ${revertedCount} members)`;
      break;
    }

    case 'MEMBER_DELETE': {
      const tid = meta?.targetId || entry.targetId;
      if (meta?.kind === 'member_delete' && meta.walletSnapshot) {
        const restored = compactWalletSnapshot(meta.walletSnapshot);
        restored.updatedAt = nowIso;
        state.wallets[tid] = restored;
      } else {
        const reasonStr = String(entry.reason || '');
        const scoreMatch = reasonStr.match(/(\d+)\s*(?:Career\s*)?Pts/i);
        const spendMatch = reasonStr.match(/(\d+)\s*Bones/i);
        const restoredSpendable = Math.abs(parseInt(entry.amount, 10) || 0) || (spendMatch ? parseInt(spendMatch[1], 10) : 0);
        const restoredScore = scoreMatch ? parseInt(scoreMatch[1], 10) : restoredSpendable;
        state.wallets[tid] = {
          discordId: tid,
          username: entry.targetName || tid,
          serverNickname: entry.targetName || tid,
          spendableBones: restoredSpendable,
          boneScore: restoredScore,
          characters: [],
          primaryCharacter: null,
          officerHidden: false,
          createdAt: nowIso,
          updatedAt: nowIso
        };
      }
      const w = state.wallets[tid];
      undoAmount = w.spendableBones || 0;
      undoSpendable = w.spendableBones || 0;
      undoScore = w.boneScore || 0;
      summary = `Restored purged member ${entry.targetName || tid} (${undoSpendable} Bones, ${undoScore} Pts)`;
      break;
    }

    case 'OFFICER_CHARACTER_LINK': {
      const tid = meta?.targetId || entry.targetId;
      const w = state.wallets[tid];
      w.characters = Array.isArray(meta.prevCharacters) ? meta.prevCharacters.map(c => ({ ...c })) : [];
      w.primaryCharacter = meta.prevPrimaryCharacter !== undefined ? meta.prevPrimaryCharacter : (w.characters.find(c => c.isPrimary)?.name || w.characters[0]?.name || null);
      w.updatedAt = nowIso;
      pruneMissingCraftersFromCraftingState(state);

      undoAmount = 0;
      undoSpendable = w.spendableBones ?? null;
      undoScore = w.boneScore ?? null;
      summary = `Reverted officer character link for ${entry.targetName || tid} (Main: ${w.primaryCharacter || 'None'})`;
      break;
    }

    case 'ROSTER_DISCORD_SYNC':
    case 'ROSTER_AUTO_SYNC': {
      let restoredRemoved = 0;
      let removedEmptyJoined = 0;

      for (const snap of (meta?.removedWallets || [])) {
        if (snap?.discordId && !state.wallets[snap.discordId]) {
          state.wallets[snap.discordId] = { ...compactWalletSnapshot(snap), updatedAt: nowIso };
          restoredRemoved++;
        }
      }

      for (const uid of (meta?.joinedIds || [])) {
        const w = state.wallets[uid];
        if (w && (w.spendableBones || 0) === 0 && (w.boneScore || 0) === 0 && (w.bountiesCompleted || 0) === 0) {
          delete state.wallets[uid];
          removedEmptyJoined++;
        }
      }

      undoAmount = 0;
      summary = `Reverted roster sync (restored ${restoredRemoved} removed, cleaned ${removedEmptyJoined} empty imports)`;
      break;
    }

    default:
      return { ok: false, status: 400, error: `Undo is not supported for action "${entry.action}".` };
  }

  const undoEntryId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  entry.undoneAt = nowIso;
  entry.undoneBy = officerName;
  entry.undoneById = officerId;
  entry.undoEntryId = undoEntryId;
  state.updatedAt = nowIso;

  const fullReason = customReason
    ? `${customReason} (${summary})`
    : summary;

  return {
    ok: true,
    status: 200,
    undoneEntry: entry,
    syncBounties,
    discordRoleRemoval,
    auditPayload: {
      id: undoEntryId,
      action: 'AUDIT_UNDO',
      officerId,
      officerName,
      targetId: entry.targetId || null,
      targetName: entry.targetName || 'Member',
      amount: undoAmount,
      spendableBones: undoSpendable,
      boneScore: undoScore,
      reason: fullReason
    }
  };
}
