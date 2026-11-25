import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  BASE_BOUNTY_CREATION_COST,
  RANK_COST_STEP_DISCOUNT,
  calculateBountyCreationCost,
  buildRankBountyCostSchedule,
  resolveContractPayoutDefaults,
  getBountyEscrowBones
} from '../src/bountyCost.js';
import {
  buildBackupEnvelope,
  extractRestorableState,
  createCloudBackup,
  listCloudBackups,
  getCloudBackupEnvelope,
  runScheduledDailyBackup,
  restoreBseStateFromBackup
} from '../src/backups.js';
import { toFirestoreFields, fromFirestoreDoc, normalizeStateObjects, FirestoreClient } from '../src/firestore.js';
import { handleApplicationCommand } from '../src/commands.js';
import worker from '../worker.js';

const TEST_ENV = {
  SESSION_SECRET: 'test-session-secret-hmac',
  FIRESTORE_PROJECT_ID: 'bse-test-proj'
};

function signTestSession(payload, secret = TEST_ENV.SESSION_SECRET) {
  const b64Data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const b64Sig = crypto.createHmac('sha256', secret).update(b64Data).digest('base64url');
  return `bse_session=${b64Data}.${b64Sig}`;
}

function makeJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function createMemoryFirestore(initialState = null, { denyExternalCollections = false } = {}) {
  const client = new FirestoreClient(TEST_ENV);
  let stateDoc = initialState ? structuredClone(initialState) : client.getDefaultBseState();
  const collections = new Map();
  const auditLogs = [];

  const ensureCol = (name) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  };

  const checkPerm = (colName) => {
    if (denyExternalCollections && colName !== 'exchange') {
      throw new Error(`Firestore failure [403]: PERMISSION_DENIED on ${colName}`);
    }
  };

  return {
    collections,
    auditLogs,
    getBseState: async () => structuredClone(stateDoc),
    saveBseState: async (next) => { stateDoc = structuredClone(next); return stateDoc; },
    logAuditEvent: async (ev) => { auditLogs.push(ev); return ev; },
    getCollectionDoc: async (col, docId) => {
      if (denyExternalCollections && col !== 'exchange') return null;
      const val = ensureCol(col).get(String(docId));
      return val ? structuredClone(val) : null;
    },
    saveCollectionDoc: async (col, docId, data) => {
      checkPerm(col);
      ensureCol(col).set(String(docId), structuredClone(data));
      return data;
    },
    deleteCollectionDoc: async (col, docId) => {
      checkPerm(col);
      return ensureCol(col).delete(String(docId));
    },
    listCollectionDocsMetadata: async (col, fieldPaths = [], pageSize = 40) => {
      if (denyExternalCollections && col !== 'exchange') return [];
      const entries = Array.from(ensureCol(col).entries()).slice(0, pageSize);
      return entries.map(([docId, doc]) => {
        const picked = { _id: docId };
        for (const f of fieldPaths) {
          if (f in doc) picked[f] = structuredClone(doc[f]);
        }
        return picked;
      });
    }
  };
}

describe('Rank-Scaled Member Bounty Creation Cost (10 - 2 * rank)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('computes 10, 8, 6, 4, 2, 0, 0 across ranks 0..6 and custom tier schedules', () => {
    assert.equal(BASE_BOUNTY_CREATION_COST, 10);
    assert.equal(RANK_COST_STEP_DISCOUNT, 2);

    const sixRanks = [
      { tier: 0, title: 'Rank 1' },
      { tier: 1, title: 'Rank 2' },
      { tier: 2, title: 'Rank 3' },
      { tier: 3, title: 'Rank 4' },
      { tier: 4, title: 'Rank 5' },
      { tier: 5, title: 'Rank 6' },
      { tier: 6, title: 'Rank 7' }
    ];

    assert.equal(calculateBountyCreationCost(0, sixRanks), 10);
    assert.equal(calculateBountyCreationCost(1, sixRanks), 8);
    assert.equal(calculateBountyCreationCost(2, sixRanks), 6);
    assert.equal(calculateBountyCreationCost(3, sixRanks), 4);
    assert.equal(calculateBountyCreationCost(4, sixRanks), 2);
    assert.equal(calculateBountyCreationCost(5, sixRanks), 0);
    assert.equal(calculateBountyCreationCost(6, sixRanks), 0);

    const schedule = buildRankBountyCostSchedule(sixRanks);
    assert.deepEqual(schedule.map(s => s.costBones), [10, 8, 6, 4, 2, 0, 0]);

    const helpDefaults = resolveContractPayoutDefaults('help');
    assert.equal(helpDefaults.contractType, 'help');
    assert.equal(helpDefaults.baseRewardBones, 5);
    assert.equal(helpDefaults.maxRewardBones, 5);

    const killDefaults = resolveContractPayoutDefaults('kill');
    assert.equal(killDefaults.contractType, 'kill');
    assert.equal(killDefaults.baseRewardBones, 1);
    assert.equal(killDefaults.maxRewardBones, 10);
  });

  function installWorkerFirestoreMock(initialState) {
    const fsClient = new FirestoreClient(TEST_ENV);
    const docs = new Map();
    docs.set('exchange/bse_state', structuredClone(initialState));

    globalThis.fetch = async (url, init = {}) => {
      const u = new URL(url);
      if (!u.hostname.includes('firestore.googleapis.com')) {
        return makeJsonResponse({ ok: true }, 200);
      }

      // List collection documents (e.g. .../documents/exchange_backups?pageSize=...)
      const listMatch = u.pathname.match(/\/documents\/([^/]+)$/);
      if (listMatch && (!init.method || init.method === 'GET')) {
        const colName = listMatch[1];
        const documents = [];
        for (const [key, val] of docs.entries()) {
          if (key.startsWith(`${colName}/`)) {
            documents.push({
              name: `projects/bse-test-proj/databases/(default)/documents/${key}`,
              ...toFirestoreFields(val)
            });
          }
        }
        return makeJsonResponse({ documents });
      }

      const marker = '/documents/';
      const idx = u.pathname.indexOf(marker);
      const rel = idx >= 0 ? u.pathname.slice(idx + marker.length) : '';

      if (init.method === 'PATCH') {
        const parsed = JSON.parse(init.body);
        const rawObj = fromFirestoreDoc({ fields: parsed.fields });
        const plain = rel === 'exchange/bse_state' ? normalizeStateObjects(rawObj) : rawObj;
        docs.set(rel, plain);
        return makeJsonResponse({ name: `${fsClient.docPathPrefix}/${rel}`, fields: parsed.fields });
      }
      if (init.method === 'DELETE') {
        docs.delete(rel);
        return makeJsonResponse({});
      }
      if (init.method === 'POST' && rel.endsWith('audit_logs')) {
        return makeJsonResponse({ name: 'audit_1' });
      }
      if (docs.has(rel)) {
        return makeJsonResponse({ name: `${fsClient.docPathPrefix}/${rel}`, ...toFirestoreFields(docs.get(rel)) });
      }
      return makeJsonResponse({}, 404);
    };

    return docs;
  }

  it('locks creator escrow strictly to rank fee (10, 8, 6, 4, 2, 0) while decoupling payout and refunds', async () => {
    const fsClient = new FirestoreClient(TEST_ENV);
    const baseState = fsClient.getDefaultBseState();
    baseState.ranks = [
      { tier: 0, title: 'Rank 1', costBones: 0 },
      { tier: 1, title: 'Rank 2', costBones: 25 },
      { tier: 2, title: 'Rank 3', costBones: 75 },
      { tier: 3, title: 'Rank 4', costBones: 150 },
      { tier: 4, title: 'Rank 5', costBones: 300 },
      { tier: 5, title: 'Rank 6', costBones: 500 }
    ];
    baseState.wallets = {
      lowRankPoor: { discordId: 'lowRankPoor', username: 'poor', rankTier: 0, spendableBones: 9, boneScore: 9 },
      tier2Member: { discordId: 'tier2Member', username: 'mid', rankTier: 2, spendableBones: 20, boneScore: 100 },
      tier5Free: { discordId: 'tier5Free', username: 'veteran', rankTier: 5, spendableBones: 0, boneScore: 600 }
    };

    const docs = installWorkerFirestoreMock(baseState);
    const poorCookie = signTestSession({ id: 'lowRankPoor', username: 'poor', isOfficer: false, issuedAt: Date.now() });
    const tier2Cookie = signTestSession({ id: 'tier2Member', username: 'mid', isOfficer: false, issuedAt: Date.now() });
    const freeCookie = signTestSession({ id: 'tier5Free', username: 'veteran', isOfficer: false, issuedAt: Date.now() });
    const officerCookie = signTestSession({ id: 'off1', username: 'officer', isOfficer: true, issuedAt: Date.now() });

    // 1. Rank 0 user with 9 Bones cannot afford 10-Bone fee -> 400
    const rInsufficient = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/bounty/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': poorCookie },
        body: JSON.stringify({ title: 'Help Deadmines', contractType: 'help', rewardBones: 0 })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(rInsufficient.status, 400);

    // 2. Rank 2 (3rd rank -> 10 - 2*2 = 6 Bones fee) posts a Help Contract -> deducts 6, payout is 5
    const rTier2 = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/bounty/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': tier2Cookie },
        body: JSON.stringify({ title: 'Help Attunement', contractType: 'help', category: 'Dungeon', description: 'Need jailbreak' })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(rTier2.status, 200);
    const tier2Out = await rTier2.json();
    assert.equal(tier2Out.escrowBones, 6);
    assert.equal(tier2Out.bounty.escrowBones, 6);
    assert.equal(tier2Out.bounty.rewardBones, 5);
    assert.equal(docs.get('exchange/bse_state').wallets.tier2Member.spendableBones, 14);

    // Officer approves with +3 treasury bonus -> payout becomes 8, escrowBones remains 6
    const rApprove = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/bounty/approve-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ bountyId: tier2Out.bounty.id, officerBonusBones: 3 })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(rApprove.status, 200);
    const approvedBounty = docs.get('exchange/bse_state').bounties.find(b => b.id === tier2Out.bounty.id);
    assert.equal(approvedBounty.rewardBones, 8);
    assert.equal(getBountyEscrowBones(approvedBounty), 6);

    // Deleting active un-claimed contract refunds exact 6 escrowed Bones (NOT 8 payout!)
    const rDel = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/bounty/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ bountyId: tier2Out.bounty.id })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(rDel.status, 200);
    const delOut = await rDel.json();
    assert.equal(delOut.refundedBones, 6);
    assert.equal(docs.get('exchange/bse_state').wallets.tier2Member.spendableBones, 20);

    // 3. Rank 5 (6th rank -> 10 - 2*5 = 0 Bones fee) can post a Kill Contract with 0 Spendable Bones!
    const rFree = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/bounty/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': freeCookie },
        body: JSON.stringify({ title: 'Kill Campers in STV', contractType: 'kill', category: 'PvP', description: 'Campers at Nesingwary' })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(rFree.status, 200);
    const freeOut = await rFree.json();
    assert.equal(freeOut.escrowBones, 0);
    assert.equal(freeOut.bounty.rewardBones, 1);
    assert.equal(freeOut.bounty.maxRewardBones, 10);

    // Rejecting free contract refunds 0 without error
    const rReject = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/bounty/reject-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ bountyId: freeOut.bounty.id, rejectReason: 'Resolved in-game' })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(rReject.status, 200);
    const rejOut = await rReject.json();
    assert.equal(rejOut.refundedBones, 0);
    assert.equal(docs.get('exchange/bse_state').wallets.tier5Free.spendableBones, 0);
  });

  it('Discord /bounty delete refunds exact rank escrowBones', async () => {
    const firestore = createMemoryFirestore();
    const state = await firestore.getBseState();
    state.wallets = {
      u1: { discordId: 'u1', username: 'raider', spendableBones: 12, boneScore: 100 }
    };
    state.bounties = [{
      id: 'bounty_req_99',
      title: 'Help Scholomance',
      escrowBones: 8,
      baseRewardBones: 5,
      rewardBones: 15,
      status: 'active',
      creatorId: 'u1'
    }];
    await firestore.saveBseState(state);

    const res = await handleApplicationCommand({
      data: {
        name: 'bounty',
        options: [{
          name: 'delete',
          type: 1,
          options: [{ name: 'bounty_id', value: 'bounty_req_99' }]
        }]
      },
      member: {
        permissions: '8', // ADMINISTRATOR
        roles: [],
        user: { id: 'off1', username: 'officer' }
      }
    }, TEST_ENV, firestore);

    assert.match(res.data.content, /Refunded \*\*8 Bones\*\* in escrow/);
    const updated = await firestore.getBseState();
    assert.equal(updated.wallets.u1.spendableBones, 20);
  });
});

describe('Automated Cloud Backups & 1-Click Restore', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('deduplicates daily scheduled backups via lastAutoBackupDate and prunes beyond retention count', async () => {
    const firestore = createMemoryFirestore();
    const state = await firestore.getBseState();
    state.wallets = { u1: { discordId: 'u1', username: 'thrall', spendableBones: 55, boneScore: 120 } };
    await firestore.saveBseState(state);

    // Run 4 daily backups with retainCount = 2
    for (const day of ['2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04']) {
      const r = await runScheduledDailyBackup(firestore, {
        now: new Date(`${day}T06:00:00Z`),
        retainCount: 2
      });
      assert.equal(r.skipped, false);
      assert.equal(r.created, true);
    }

    // Running again on the same UTC date skips immediately with 0 extra backup writes
    const dup = await runScheduledDailyBackup(firestore, {
      now: new Date('2026-04-04T18:30:00Z'),
      retainCount: 2
    });
    assert.equal(dup.skipped, true);
    assert.equal(dup.reason, 'ALREADY_BACKED_UP_TODAY');

    const listed = await listCloudBackups(firestore);
    assert.deepEqual(listed.map(b => b.id), ['auto_2026-04-04', 'auto_2026-04-03']);
  });

  it('falls back cleanly to exchange/bse_backup_* when Firestore rules block external collections with 403', async () => {
    const firestore = createMemoryFirestore(null, { denyExternalCollections: true });
    const state = await firestore.getBseState();
    state.wallets = { m1: { discordId: 'm1', username: 'jaina', spendableBones: 42, boneScore: 100 } };
    await firestore.saveBseState(state);

    const snap = await createCloudBackup(firestore, state, {
      id: 'manual_fallback_test',
      kind: 'manual',
      label: 'Fallback Rule Snapshot',
      createdBy: 'Officer'
    });
    assert.equal(snap.id, 'manual_fallback_test');

    const listed = await listCloudBackups(firestore);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, 'manual_fallback_test');

    const env = await getCloudBackupEnvelope(firestore, 'manual_fallback_test');
    assert.equal(env.state.wallets.m1.spendableBones, 42);

    // Mutate live state, then restore from fallback snapshot -> pre_restore safety backup also saved!
    state.wallets.m1.spendableBones = 0;
    await firestore.saveBseState(state);

    const res = await restoreBseStateFromBackup({
      firestore,
      backupId: 'manual_fallback_test',
      officerId: 'off1',
      officerName: 'Highlord'
    });
    assert.equal(res.success, true);
    assert.ok(res.safetyBackup?.id.startsWith('pre_restore_'));

    const restoredState = await firestore.getBseState();
    assert.equal(restoredState.wallets.m1.spendableBones, 42);
    assert.equal(restoredState.auditLog.at(-1).action, 'DATA_BACKUP_RESTORED');
  });

  it('exposes Officer backup create, list, download, and file/cloud restore Worker endpoints with pre_restore safety snapshot', async () => {
    const fsClient = new FirestoreClient(TEST_ENV);
    const initialState = fsClient.getDefaultBseState();
    initialState.wallets = {
      hero1: { discordId: 'hero1', username: 'saurfang', spendableBones: 250, boneScore: 500 }
    };

    const docs = new Map();
    docs.set('exchange/bse_state', structuredClone(initialState));

    globalThis.fetch = async (url, init = {}) => {
      const u = new URL(url);
      if (!u.hostname.includes('firestore.googleapis.com')) {
        return makeJsonResponse({ ok: true }, 200);
      }
      const listMatch = u.pathname.match(/\/documents\/([^/]+)$/);
      if (listMatch && (!init.method || init.method === 'GET')) {
        const colName = listMatch[1];
        const documents = [];
        for (const [key, val] of docs.entries()) {
          if (key.startsWith(`${colName}/`)) {
            documents.push({
              name: `projects/bse-test-proj/databases/(default)/documents/${key}`,
              ...toFirestoreFields(val)
            });
          }
        }
        return makeJsonResponse({ documents });
      }
      const marker = '/documents/';
      const idx = u.pathname.indexOf(marker);
      const rel = idx >= 0 ? u.pathname.slice(idx + marker.length) : '';
      if (init.method === 'PATCH') {
        const parsed = JSON.parse(init.body);
        const rawObj = fromFirestoreDoc({ fields: parsed.fields });
        const plain = rel === 'exchange/bse_state' ? normalizeStateObjects(rawObj) : rawObj;
        docs.set(rel, plain);
        return makeJsonResponse({ name: `${fsClient.docPathPrefix}/${rel}`, fields: parsed.fields });
      }
      if (init.method === 'DELETE') {
        docs.delete(rel);
        return makeJsonResponse({});
      }
      if (docs.has(rel)) {
        return makeJsonResponse({ name: `${fsClient.docPathPrefix}/${rel}`, ...toFirestoreFields(docs.get(rel)) });
      }
      return makeJsonResponse({}, 404);
    };

    const memberCookie = signTestSession({ id: 'hero1', username: 'saurfang', isOfficer: false, issuedAt: Date.now() });
    const officerCookie = signTestSession({ id: 'off1', username: 'officer', isOfficer: true, issuedAt: Date.now() });

    // Non-officer rejected with 403
    const rForbidden = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/backups', { headers: { Cookie: memberCookie } }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(rForbidden.status, 403);

    // Officer creates cloud snapshot
    const rCreate = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/backups/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: officerCookie },
        body: JSON.stringify({ label: 'Before Raid Night' })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(rCreate.status, 200);
    const created = await rCreate.json();
    assert.equal(created.backup.label, 'Before Raid Night');

    // Officer downloads JSON archive
    const rDownload = await worker.fetch(
      new Request(`https://bse.teasy2ez.win/api/exchange/backups/download?id=${created.backup.id}`, {
        headers: { Cookie: officerCookie }
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(rDownload.status, 200);
    assert.match(rDownload.headers.get('Content-Disposition') || '', /attachment; filename="bse_backup_/);
    const downloadedEnvelope = await rDownload.json();
    assert.equal(downloadedEnvelope.format, 'bse_backup_v1');
    assert.equal(downloadedEnvelope.state.wallets.hero1.spendableBones, 250);

    // Wipe live wallets, then restore from uploaded JSON envelope
    docs.get('exchange/bse_state').wallets = {};
    const rRestore = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/backups/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: officerCookie },
        body: JSON.stringify({ backupData: downloadedEnvelope })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(rRestore.status, 200);
    const restoreJson = await rRestore.json();
    assert.equal(restoreJson.stats.walletCount, 1);
    assert.ok(restoreJson.safetyBackup.id.startsWith('pre_restore_'));
    assert.equal(docs.get('exchange/bse_state').wallets.hero1.spendableBones, 250);

    // Verify extractRestorableState rejects invalid JSON objects safely
    assert.equal(extractRestorableState({ hello: 'world' }).ok, false);
    assert.equal(extractRestorableState(buildBackupEnvelope(initialState)).ok, true);
  });
});
