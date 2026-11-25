/**
 * Black Sands Exchange — Automated Cloud Backups & 1-Click Restore Engine
 *
 * Provides:
 *  - Zero-overhead daily automated Firestore snapshots (`auto_YYYY-MM-DD`, 14-day retention)
 *  - On-demand manual Officer cloud snapshots (`manual_<timestamp>`)
 *  - Automatic `pre_restore_<timestamp>` safety snapshot prior to every restore / raw override
 *  - Portable `.json` archive export & validated restore (accepts envelope or raw state)
 */

import { normalizeStateObjects } from './firestore.js';
import { recordTransaction } from './discord.js';

export const BACKUP_COLLECTION = 'exchange_backups';
export const FALLBACK_COLLECTION = 'exchange';
export const FALLBACK_DOC_PREFIX = 'bse_backup_';
export const BACKUP_META_FIELDS = ['id', 'createdAt', 'kind', 'label', 'createdBy', 'stats'];
export const DEFAULT_AUTO_BACKUP_RETENTION = 14;

/**
 * Compute summary statistics for a BSE state object
 */
export function computeBackupStats(state = {}) {
  const wallets = Object.values(state?.wallets || {});
  const bounties = Array.isArray(state?.bounties) ? state.bounties : Object.values(state?.bounties || {});
  const claims = Object.values(state?.claims || {});
  const auditLog = Array.isArray(state?.auditLog) ? state.auditLog : [];

  let totalSpendableBones = 0;
  let totalCareerScore = 0;
  for (const w of wallets) {
    totalSpendableBones += Number(w?.spendableBones || 0);
    totalCareerScore += Number(w?.boneScore || 0);
  }

  return {
    walletCount: wallets.length,
    activeBounties: bounties.filter(b => (b?.status || 'active') === 'active').length,
    totalBounties: bounties.length,
    pendingClaims: claims.filter(c => c?.status === 'pending').length,
    totalSpendableBones,
    totalCareerScore,
    auditEntries: auditLog.length,
    season: Number(state?.season || 1)
  };
}

/**
 * Deep-clone and strip internal Firestore underscore fields (`_id`, `_documentPath`)
 */
export function sanitizeStateForBackup(state) {
  if (!state || typeof state !== 'object') {
    throw new Error('Cannot back up an empty or invalid state object');
  }
  const cloned = JSON.parse(JSON.stringify(state));
  for (const key of Object.keys(cloned)) {
    if (key.startsWith('_')) {
      delete cloned[key];
    }
  }
  return normalizeStateObjects(cloned);
}

/**
 * Build portable downloadable JSON backup archive envelope
 */
export function buildBackupEnvelope(state, {
  id = `export_${Date.now()}`,
  createdAt = new Date().toISOString(),
  kind = 'export',
  label = 'Manual JSON Export',
  createdBy = 'Officer'
} = {}) {
  const cleanState = sanitizeStateForBackup(state);
  const stats = computeBackupStats(cleanState);
  return {
    format: 'bse_backup_v1',
    id,
    createdAt,
    kind,
    label,
    createdBy,
    stats,
    state: cleanState
  };
}

/**
 * Validate and extract a restorable `bse_state` object from a cloud doc, backup envelope, or raw state JSON
 */
export function extractRestorableState(input) {
  let parsed = input;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return { ok: false, error: 'Backup payload is not valid JSON.' };
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Backup payload must be a JSON object.' };
  }

  let candidate = null;
  if (typeof parsed.stateJson === 'string' && parsed.stateJson.trim().length > 0) {
    try {
      candidate = JSON.parse(parsed.stateJson);
    } catch {
      return { ok: false, error: 'Stored cloud backup stateJson is corrupted.' };
    }
  } else if (parsed.state && typeof parsed.state === 'object' && !Array.isArray(parsed.state)) {
    candidate = parsed.state;
  } else if (parsed.rawState && typeof parsed.rawState === 'object' && !Array.isArray(parsed.rawState)) {
    candidate = parsed.rawState;
  } else {
    candidate = parsed;
  }

  const hasRecognizedKeys = Boolean(
    candidate &&
    typeof candidate === 'object' &&
    ('wallets' in candidate || 'bounties' in candidate || 'ranks' in candidate || 'config' in candidate || 'branding' in candidate)
  );
  if (!hasRecognizedKeys) {
    return {
      ok: false,
      error: 'JSON file does not appear to be a valid Black Sands Exchange backup (missing wallets/bounties/config).'
    };
  }

  const cleanState = sanitizeStateForBackup(candidate);
  return {
    ok: true,
    state: cleanState,
    stats: computeBackupStats(cleanState)
  };
}

function isPermissionError(err) {
  const msg = String(err?.message || '');
  return msg.includes('[403]') || msg.includes('PERMISSION_DENIED');
}

async function writeBackupDocWithFallback(firestore, backupId, docPayload) {
  try {
    await firestore.saveCollectionDoc(BACKUP_COLLECTION, backupId, docPayload);
    return { collection: BACKUP_COLLECTION, docId: backupId };
  } catch (err) {
    if (!isPermissionError(err)) throw err;
    const fallbackId = `${FALLBACK_DOC_PREFIX}${backupId}`;
    await firestore.saveCollectionDoc(FALLBACK_COLLECTION, fallbackId, docPayload);
    return { collection: FALLBACK_COLLECTION, docId: fallbackId };
  }
}

async function readBackupDocWithFallback(firestore, backupId) {
  const cleanId = String(backupId || '').trim();
  if (!cleanId) return null;

  const primary = await firestore.getCollectionDoc(BACKUP_COLLECTION, cleanId);
  if (primary && (primary.stateJson || primary.state)) return primary;

  const fallbackId = cleanId.startsWith(FALLBACK_DOC_PREFIX) ? cleanId : `${FALLBACK_DOC_PREFIX}${cleanId}`;
  const fallback = await firestore.getCollectionDoc(FALLBACK_COLLECTION, fallbackId);
  if (fallback && (fallback.stateJson || fallback.state)) return fallback;

  return null;
}

async function deleteBackupDocWithFallback(firestore, backupId) {
  const cleanId = String(backupId || '').trim();
  if (!cleanId) return false;
  let deleted = false;
  if (typeof firestore.deleteCollectionDoc === 'function') {
    try {
      await firestore.deleteCollectionDoc(BACKUP_COLLECTION, cleanId);
      deleted = true;
    } catch (err) {
      if (!isPermissionError(err)) throw err;
    }
    try {
      const fallbackId = cleanId.startsWith(FALLBACK_DOC_PREFIX) ? cleanId : `${FALLBACK_DOC_PREFIX}${cleanId}`;
      await firestore.deleteCollectionDoc(FALLBACK_COLLECTION, fallbackId);
      deleted = true;
    } catch {
      // Ignore fallback delete miss
    }
  }
  return deleted;
}

/**
 * Save a snapshot of `state` to Firestore cloud backups
 */
export async function createCloudBackup(firestore, state, {
  id = null,
  kind = 'manual',
  label = '',
  createdBy = 'System',
  now = new Date()
} = {}) {
  const activeState = state || await firestore.getBseState();
  const cleanState = sanitizeStateForBackup(activeState);
  const createdAt = now.toISOString();
  const safeKind = ['auto', 'manual', 'pre_restore'].includes(kind) ? kind : 'manual';
  const backupId = id || `${safeKind}_${now.getTime()}`;
  const stats = computeBackupStats(cleanState);

  const defaultLabel = safeKind === 'auto'
    ? `Automated Daily Backup (${createdAt.slice(0, 10)})`
    : (safeKind === 'pre_restore' ? 'Pre-Restore Safety Snapshot' : 'Manual Officer Snapshot');

  const docPayload = {
    id: backupId,
    createdAt,
    kind: safeKind,
    label: String(label || defaultLabel).trim().slice(0, 140),
    createdBy: String(createdBy || 'System'),
    stats,
    stateJson: JSON.stringify(cleanState)
  };

  await writeBackupDocWithFallback(firestore, backupId, docPayload);

  return {
    id: backupId,
    createdAt,
    kind: safeKind,
    label: docPayload.label,
    createdBy: docPayload.createdBy,
    stats
  };
}

/**
 * List available cloud backup metadata entries sorted newest-first
 */
export async function listCloudBackups(firestore, { limit = 40 } = {}) {
  if (typeof firestore.listCollectionDocsMetadata !== 'function') {
    return [];
  }

  let docs = await firestore.listCollectionDocsMetadata(BACKUP_COLLECTION, BACKUP_META_FIELDS, limit);
  if (!docs.length) {
    const fallbackDocs = await firestore.listCollectionDocsMetadata(FALLBACK_COLLECTION, BACKUP_META_FIELDS, limit + 5);
    docs = fallbackDocs.filter(d => {
      const docId = String(d?._id || '');
      return docId.startsWith(FALLBACK_DOC_PREFIX) && Boolean(d?.id && d?.createdAt);
    });
  }

  const normalized = docs
    .filter(d => d && (d.id || d._id) && d.createdAt)
    .map(d => ({
      id: d.id || String(d._id).replace(new RegExp(`^${FALLBACK_DOC_PREFIX}`), ''),
      createdAt: d.createdAt,
      kind: d.kind || 'manual',
      label: d.label || 'Snapshot',
      createdBy: d.createdBy || 'System',
      stats: d.stats || {}
    }));

  normalized.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return normalized.slice(0, limit);
}

/**
 * Load a full cloud backup envelope by `backupId`
 */
export async function getCloudBackupEnvelope(firestore, backupId) {
  const doc = await readBackupDocWithFallback(firestore, backupId);
  if (!doc) return null;

  const extracted = extractRestorableState(doc);
  if (!extracted.ok) {
    throw new Error(extracted.error);
  }

  return buildBackupEnvelope(extracted.state, {
    id: doc.id || backupId,
    createdAt: doc.createdAt || new Date().toISOString(),
    kind: doc.kind || 'manual',
    label: doc.label || 'Cloud Snapshot',
    createdBy: doc.createdBy || 'System'
  });
}

/**
 * Delete a cloud backup snapshot by ID
 */
export async function deleteCloudBackup(firestore, backupId) {
  return deleteBackupDocWithFallback(firestore, backupId);
}

/**
 * Daily automated backup check triggered during the Worker scheduled cron.
 * Uses `state.lastAutoBackupDate` so 287 of 288 5-minute ticks perform 0 extra Firestore reads.
 */
export async function runScheduledDailyBackup(firestore, {
  state = null,
  now = new Date(),
  retainCount = DEFAULT_AUTO_BACKUP_RETENTION
} = {}) {
  const todayUtc = now.toISOString().slice(0, 10);
  const activeState = state || await firestore.getBseState();

  if (activeState?.lastAutoBackupDate === todayUtc) {
    return { skipped: true, reason: 'ALREADY_BACKED_UP_TODAY', date: todayUtc };
  }

  const backupId = `auto_${todayUtc}`;
  const summary = await createCloudBackup(firestore, activeState, {
    id: backupId,
    kind: 'auto',
    label: `Automated Daily Backup (${todayUtc})`,
    createdBy: 'Scheduled Cron',
    now
  });

  activeState.lastAutoBackupDate = todayUtc;
  await firestore.saveBseState(activeState);

  // Prune expired auto_* backups beyond retainCount
  let prunedCount = 0;
  try {
    const allBackups = await listCloudBackups(firestore, { limit: 60 });
    const autoBackups = allBackups.filter(b => b.kind === 'auto' && String(b.id).startsWith('auto_'));
    if (autoBackups.length > retainCount) {
      const expired = autoBackups.slice(retainCount);
      for (const old of expired) {
        await deleteCloudBackup(firestore, old.id).catch(() => {});
        prunedCount++;
      }
    }
  } catch (err) {
    console.warn('Non-fatal auto-backup pruning warning:', err.message);
  }

  return {
    skipped: false,
    created: true,
    backup: summary,
    prunedCount
  };
}

/**
 * Restore `exchange/bse_state` from either a cloud `backupId` or an uploaded `backupData` object/JSON,
 * automatically saving a `pre_restore_<timestamp>` safety snapshot of live data first.
 */
export async function restoreBseStateFromBackup({
  firestore,
  backupId = null,
  backupData = null,
  officerId = null,
  officerName = 'Officer',
  reason = ''
} = {}) {
  let targetState = null;
  let sourceLabel = '';

  if (backupId) {
    const doc = await readBackupDocWithFallback(firestore, backupId);
    if (!doc) {
      const notFoundErr = new Error(`Cloud backup "${backupId}" was not found.`);
      notFoundErr.status = 404;
      throw notFoundErr;
    }
    const extracted = extractRestorableState(doc);
    if (!extracted.ok) {
      const badErr = new Error(extracted.error);
      badErr.status = 400;
      throw badErr;
    }
    targetState = extracted.state;
    sourceLabel = `cloud snapshot "${doc.label || backupId}" (${backupId})`;
  } else if (backupData !== null && backupData !== undefined) {
    const extracted = extractRestorableState(backupData);
    if (!extracted.ok) {
      const badErr = new Error(extracted.error);
      badErr.status = 400;
      throw badErr;
    }
    targetState = extracted.state;
    const uploadedMetaLabel = typeof backupData === 'object' && backupData?.label ? ` "${backupData.label}"` : '';
    const uploadedCreatedAt = typeof backupData === 'object' && backupData?.createdAt ? ` from ${String(backupData.createdAt).slice(0, 19)}` : '';
    sourceLabel = `uploaded JSON backup${uploadedMetaLabel}${uploadedCreatedAt}`;
  } else {
    const missingErr = new Error('Either backupId or backupData is required to restore.');
    missingErr.status = 400;
    throw missingErr;
  }

  // 1. Capture live state as a pre-restore safety snapshot before overwriting!
  const currentLiveState = await firestore.getBseState();
  let safetySnapshot = null;
  try {
    safetySnapshot = await createCloudBackup(firestore, currentLiveState, {
      id: `pre_restore_${Date.now()}`,
      kind: 'pre_restore',
      label: `Pre-Restore Safety Backup (before restoring ${backupId || 'uploaded JSON'})`,
      createdBy: officerName
    });
  } catch (err) {
    console.warn('Pre-restore cloud snapshot warning:', err.message);
  }

  // 2. Normalize & stamp restored state
  const nowIso = new Date().toISOString();
  targetState.updatedAt = nowIso;
  if (currentLiveState?.lastAutoBackupDate && !targetState.lastAutoBackupDate) {
    targetState.lastAutoBackupDate = currentLiveState.lastAutoBackupDate;
  }

  const stats = computeBackupStats(targetState);
  const auditDetail = reason
    ? `Restored ${sourceLabel} — ${reason} (${stats.walletCount} wallets, ${stats.totalBounties} bounties)`
    : `Restored ${sourceLabel} (${stats.walletCount} wallets, ${stats.totalBounties} bounties${safetySnapshot ? `, safety backup: ${safetySnapshot.id}` : ''})`;

  const logEntry = recordTransaction(targetState, {
    action: 'DATA_BACKUP_RESTORED',
    officerId,
    officerName,
    targetId: 'ALL',
    targetName: 'Central Database',
    amount: 0,
    spendableBones: null,
    boneScore: null,
    reason: auditDetail
  });

  await firestore.saveBseState(targetState);
  await firestore.logAuditEvent(logEntry).catch(() => {});

  return {
    success: true,
    restoredFrom: sourceLabel,
    safetyBackup: safetySnapshot,
    stats,
    state: targetState
  };
}
