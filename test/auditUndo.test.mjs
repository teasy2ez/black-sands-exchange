import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { toFirestoreFields, fromFirestoreDoc, FirestoreClient } from '../src/firestore.js';
import { getWeeklyWindowStart } from '../src/weeklyCap.js';
import { canUndoAuditEntry, revertAuditEntry } from '../src/auditUndo.js';
import worker from '../worker.js';

const TEST_ENV = {
  SESSION_SECRET: 'test-session-secret-hmac',
  FIRESTORE_PROJECT_ID: 'bse-test-proj'
};

function makeJsonResponse(body, status = 200) {
  return new Response(body === null ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function signTestSession(payload, secret = TEST_ENV.SESSION_SECRET) {
  const b64Data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(b64Data).digest('base64url');
  return `bse_session=${b64Data}.${sig}`;
}

describe('worker.js & src/auditUndo.js — Audit Trail Undo', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function installFirestoreFetchMock(initialState = null) {
    const fsClient = new FirestoreClient(TEST_ENV);
    const docs = new Map();
    docs.set('exchange/bse_state', initialState || fsClient.getDefaultBseState());

    globalThis.fetch = async (url, init = {}) => {
      const urlStr = String(url);
      if (urlStr.startsWith('https://firestore.googleapis.com/v1/')) {
        const prefix = `https://firestore.googleapis.com/v1/${fsClient.docPathPrefix}/`;
        const rel = urlStr.slice(prefix.length);

        if (rel === 'exchange_audit_log' && init.method === 'POST') {
          return makeJsonResponse({ name: `${fsClient.docPathPrefix}/exchange_audit_log/${Date.now()}` });
        }

        if (init.method === 'PATCH') {
          const raw = JSON.parse(init.body || '{}');
          const parsed = fromFirestoreDoc({ name: `${fsClient.docPathPrefix}/${rel}`, fields: raw.fields || {} });
          delete parsed._documentPath;
          delete parsed._id;
          docs.set(rel, parsed);
          return makeJsonResponse({ name: `${fsClient.docPathPrefix}/${rel}`, ...toFirestoreFields(parsed) });
        }

        if (!docs.has(rel)) return makeJsonResponse({ error: { code: 404 } }, 404);
        return makeJsonResponse({ name: `${fsClient.docPathPrefix}/${rel}`, ...toFirestoreFields(docs.get(rel)) });
      }
      return makeJsonResponse({}, 404);
    };

    return docs;
  }

  it('enforces Officer auth and cleanly undoes AWARD (restoring spendable, career score, and weekly cap) without allowing double undo', async () => {
    const fsClient = new FirestoreClient(TEST_ENV);
    const baseState = fsClient.getDefaultBseState();
    const weekStart = getWeeklyWindowStart(2);

    baseState.config = {
      ...baseState.config,
      weeklyCap: { enabled: true, cap: 50, resetDay: 2 }
    };
    baseState.wallets = {
      m1: {
        discordId: 'm1',
        username: 'grimfang',
        serverNickname: 'Grimfang',
        spendableBones: 100,
        boneScore: 300,
        weeklyBonesEarned: 25,
        weeklyCapRollover: 0,
        weeklyWindowStart: weekStart
      }
    };

    const docs = installFirestoreFetchMock(baseState);
    const memberCookie = signTestSession({ id: 'm1', username: 'grimfang', isOfficer: false, issuedAt: Date.now() });
    const officerCookie = signTestSession({ id: 'off1', username: 'officer', isOfficer: true, issuedAt: Date.now() });

    // 1. Award +25 Bones (hits 50/50 cap)
    const awardRes = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/award', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ targetId: 'm1', amount: 25, reason: 'Raid boss kill' })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(awardRes.status, 200);
    const stateAfterAward = docs.get('exchange/bse_state');
    assert.equal(stateAfterAward.wallets.m1.spendableBones, 125);
    assert.equal(stateAfterAward.wallets.m1.boneScore, 325);
    assert.equal(stateAfterAward.wallets.m1.weeklyBonesEarned, 50);

    const awardEntry = stateAfterAward.auditLog[stateAfterAward.auditLog.length - 1];
    assert.equal(awardEntry.action, 'AWARD');

    // 2. Non-officer cannot undo
    const forbidden = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/audit/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': memberCookie },
        body: JSON.stringify({ entryId: awardEntry.id })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(forbidden.status, 403);

    // 3. Officer undoes AWARD -> balances + weekly cap restored, AUDIT_UNDO logged
    const undoRes = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/audit/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ entryId: awardEntry.id, reason: 'Wrong player selected' })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(undoRes.status, 200);
    const undoJson = await undoRes.json();
    assert.equal(undoJson.success, true);

    const stateAfterUndo = docs.get('exchange/bse_state');
    assert.equal(stateAfterUndo.wallets.m1.spendableBones, 100);
    assert.equal(stateAfterUndo.wallets.m1.boneScore, 300);
    assert.equal(stateAfterUndo.wallets.m1.weeklyBonesEarned, 25);

    const origEntry = stateAfterUndo.auditLog.find(e => e.id === awardEntry.id);
    assert.ok(origEntry.undoneAt);
    assert.equal(origEntry.undoneById, 'off1');

    const auditUndoEntry = stateAfterUndo.auditLog[stateAfterUndo.auditLog.length - 1];
    assert.equal(auditUndoEntry.action, 'AUDIT_UNDO');
    assert.equal(auditUndoEntry.amount, -25);
    assert.match(auditUndoEntry.reason, /Wrong player selected/);

    // 4. Double-undo rejected cleanly and reversal entry cannot be undone
    const doubleUndo = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/audit/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ entryId: awardEntry.id })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(doubleUndo.status, 400);
    assert.equal(canUndoAuditEntry(auditUndoEntry, stateAfterUndo).allowed, false);
  });

  it('undoes SPENDABLE_BONES_OVERRIDE surgically without reverting subsequent LIFETIME_BONES_ADJUST', async () => {
    const fsClient = new FirestoreClient(TEST_ENV);
    const baseState = fsClient.getDefaultBseState();
    baseState.wallets = {
      m1: {
        discordId: 'm1',
        username: 'grimfang',
        spendableBones: 120,
        boneScore: 450,
        weeklyBonesEarned: 50,
        weeklyWindowStart: getWeeklyWindowStart(2)
      }
    };

    const docs = installFirestoreFetchMock(baseState);
    const officerCookie = signTestSession({ id: 'off1', username: 'officer', isOfficer: true, issuedAt: Date.now() });

    await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/member/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ targetId: 'm1', spendableBones: 275 })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    const spendEntryId = docs.get('exchange/bse_state').auditLog.at(-1).id;

    await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/member/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ targetId: 'm1', boneScore: 600 })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );

    const undoSpend = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/audit/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ entryId: spendEntryId })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(undoSpend.status, 200);

    const finalWallet = docs.get('exchange/bse_state').wallets.m1;
    assert.equal(finalWallet.spendableBones, 120);
    assert.equal(finalWallet.boneScore, 600); // Subsequent Career Score override preserved!
    assert.equal(finalWallet.weeklyBonesEarned, 50); // Weekly cap untouched!
  });

  it('reverts BOUNTY_REWARD (claim + claimant + creator stats) and cancelled BOUNTY_ESCROW_REFUND', async () => {
    const fsClient = new FirestoreClient(TEST_ENV);
    const baseState = fsClient.getDefaultBseState();
    const weekStart = getWeeklyWindowStart(2);

    baseState.wallets = {
      creator1: { discordId: 'creator1', username: 'sponsor', spendableBones: 200, boneScore: 200, postedBountiesCompleted: 0 },
      hunter1: { discordId: 'hunter1', username: 'hunter', spendableBones: 10, boneScore: 50, bountiesCompleted: 0, weeklyBonesEarned: 0, weeklyWindowStart: weekStart }
    };

    const docs = installFirestoreFetchMock(baseState);
    const sponsorCookie = signTestSession({ id: 'creator1', username: 'sponsor', isOfficer: false, issuedAt: Date.now() });
    const officerCookie = signTestSession({ id: 'off1', username: 'officer', isOfficer: true, issuedAt: Date.now() });

    // Sponsor at lowest rank (tier 0) posts bounty request -> 10 Bones placed into escrow
    const reqRes = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/bounty/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': sponsorCookie },
        body: JSON.stringify({ title: 'Help UBRS', contractType: 'help', category: 'PvE' })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(reqRes.status, 200);
    const { bounty, escrowBones } = await reqRes.json();
    assert.equal(escrowBones, 10);
    assert.equal(docs.get('exchange/bse_state').wallets.creator1.spendableBones, 190);

    // Officer approves bounty request (custom 50 base + 10 guild bonus = 60 payout, while escrowBones stays 10)
    await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/bounty/approve-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ bountyId: bounty.id, approvedRewardBones: 50, officerBonusBones: 10 })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    const escrowEntryId = docs.get('exchange/bse_state').auditLog.find(e => e.action === 'BOUNTY_REQUEST_ESCROW').id;

    // Hunter submits and Officer approves claim
    const claimState = docs.get('exchange/bse_state');
    claimState.claims.claim_test_1 = {
      id: 'claim_test_1',
      bountyId: bounty.id,
      bountyTitle: bounty.title,
      discordId: 'hunter1',
      discordUsername: 'hunter',
      rewardBones: 60,
      status: 'pending'
    };

    const approveClaimRes = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/claim/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ claimId: 'claim_test_1' })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(approveClaimRes.status, 200);
    const rewardEntryId = docs.get('exchange/bse_state').auditLog.at(-1).id;

    // Escrow cannot be undone while approved claim exists
    assert.equal(canUndoAuditEntry(docs.get('exchange/bse_state').auditLog.find(e => e.id === escrowEntryId), docs.get('exchange/bse_state')).allowed, false);

    // Undo BOUNTY_REWARD -> hunter + creator + claim revert cleanly
    const undoClaimRes = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/audit/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ entryId: rewardEntryId })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(undoClaimRes.status, 200);
    const afterClaimUndo = docs.get('exchange/bse_state');
    assert.equal(afterClaimUndo.wallets.hunter1.spendableBones, 10);
    assert.equal(afterClaimUndo.wallets.hunter1.bountiesCompleted, 0);
    assert.equal(afterClaimUndo.wallets.creator1.postedBountiesCompleted, 0);
    assert.equal(afterClaimUndo.claims.claim_test_1.status, 'pending');
    assert.equal(afterClaimUndo.claims.claim_test_1.rewardBones, 60);

    // Now remove the approved claim marker & test bounty/delete + Undo BOUNTY_ESCROW_REFUND (refunds exact 10 escrowed Bones)
    delete afterClaimUndo.claims.claim_test_1;
    const delRes = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/bounty/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ bountyId: bounty.id })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(delRes.status, 200);
    assert.equal(docs.get('exchange/bse_state').wallets.creator1.spendableBones, 200);
    const refundEntryId = docs.get('exchange/bse_state').auditLog.at(-1).id;

    const undoDeleteRes = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/audit/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ entryId: refundEntryId })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(undoDeleteRes.status, 200);
    const afterRestoreBounty = docs.get('exchange/bse_state');
    assert.equal(afterRestoreBounty.wallets.creator1.spendableBones, 190);
    assert.ok(afterRestoreBounty.bounties.some(b => b.id === bounty.id && b.title === 'Help UBRS'));
  });

  it('reverts SHOP_PURCHASE, SHOP_REFUND, BATCH_AWARD, MEMBER_DELETE, PRESTIGE_PROMOTION, and legacy fallback entries', async () => {
    const fsClient = new FirestoreClient(TEST_ENV);
    const baseState = fsClient.getDefaultBseState();
    baseState.ranks = [
      { tier: 0, title: 'Initiate', costBones: 0 },
      { tier: 1, title: 'Dune Scavenger', costBones: 50 }
    ];
    baseState.shop = [
      { id: 'item_flask', title: 'Titan Flask', costBones: 30, stock: 5, unlimitedStock: false, enabled: true }
    ];
    baseState.wallets = {
      m1: {
        discordId: 'm1',
        username: 'grimfang',
        serverNickname: 'Grimfang',
        spendableBones: 150,
        boneScore: 400,
        rankTier: 0,
        characters: [{ name: 'Grimfang', surname: 'Black', class: 'Warrior' }]
      },
      m2: {
        discordId: 'm2',
        username: 'kael',
        serverNickname: 'Kael',
        spendableBones: 40,
        boneScore: 90
      }
    };

    const docs = installFirestoreFetchMock(baseState);
    const memberCookie = signTestSession({ id: 'm1', username: 'grimfang', isOfficer: false, issuedAt: Date.now() });
    const officerCookie = signTestSession({ id: 'off1', username: 'officer', isOfficer: true, issuedAt: Date.now() });

    // Promotion (tier 0 -> 1, -50) -> Undo -> restores tier 0 & 150
    await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': memberCookie },
        body: JSON.stringify({})
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    const promoId = docs.get('exchange/bse_state').auditLog.at(-1).id;
    assert.equal(docs.get('exchange/bse_state').wallets.m1.rankTier, 1);

    await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/audit/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ entryId: promoId })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(docs.get('exchange/bse_state').wallets.m1.rankTier, 0);
    assert.equal(docs.get('exchange/bse_state').wallets.m1.spendableBones, 150);

    // Shop purchase -> Refund -> Undo Refund -> Undo Purchase -> restores stock 5 & spendable 150 & removes delivery
    const buyRes = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': memberCookie },
        body: JSON.stringify({ itemId: 'item_flask' })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(buyRes.status, 200);
    const { delivery } = await buyRes.json();
    assert.equal(docs.get('exchange/bse_state').shop[0].stock, 4);
    assert.equal(docs.get('exchange/bse_state').wallets.m1.spendableBones, 120);
    const buyEntryId = docs.get('exchange/bse_state').auditLog.at(-1).id;

    // Refund order -> Undo SHOP_REFUND -> delivery returns to pending, stock 4, spendable 120
    const refundRes = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/deliver/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ orderId: delivery.id, refundReason: 'Accident' })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(refundRes.status, 200);
    assert.equal(docs.get('exchange/bse_state').shop[0].stock, 5);
    assert.equal(docs.get('exchange/bse_state').wallets.m1.spendableBones, 150);
    const shopRefundEntryId = docs.get('exchange/bse_state').auditLog.at(-1).id;

    const undoShopRefundRes = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/audit/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ entryId: shopRefundEntryId })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(undoShopRefundRes.status, 200);
    assert.equal(docs.get('exchange/bse_state').deliveries[delivery.id].status, 'pending');
    assert.equal(docs.get('exchange/bse_state').shop[0].stock, 4);
    assert.equal(docs.get('exchange/bse_state').wallets.m1.spendableBones, 120);

    // Undo original SHOP_PURCHASE -> restores stock 5, spendable 150, removes delivery
    const undoBuyRes = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/audit/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ entryId: buyEntryId })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(undoBuyRes.status, 200);
    assert.equal(docs.get('exchange/bse_state').shop[0].stock, 5);
    assert.equal(docs.get('exchange/bse_state').wallets.m1.spendableBones, 150);
    assert.equal(docs.get('exchange/bse_state').deliveries[delivery.id], undefined);

    // Toggle Hide -> Undo MEMBER_HIDE -> restores visibility
    const hideRes = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/member/toggle-hide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ targetId: 'm2', reason: 'Alt cleanup' })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(hideRes.status, 200);
    assert.equal(docs.get('exchange/bse_state').wallets.m2.officerHidden, true);
    const hideEntryId = docs.get('exchange/bse_state').auditLog.at(-1).id;

    const undoHideRes = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/audit/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ entryId: hideEntryId })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(undoHideRes.status, 200);
    assert.equal(docs.get('exchange/bse_state').wallets.m2.officerHidden, false);

    // Batch Award -> Undo -> reverts m1 and m2
    await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/batch-award', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ targetIds: ['m1', 'm2'], amount: 15, reason: 'MC Clear' })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    const batchId = docs.get('exchange/bse_state').auditLog.at(-1).id;
    assert.equal(docs.get('exchange/bse_state').wallets.m1.spendableBones, 165);
    assert.equal(docs.get('exchange/bse_state').wallets.m2.spendableBones, 55);

    await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/audit/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ entryId: batchId })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(docs.get('exchange/bse_state').wallets.m1.spendableBones, 150);
    assert.equal(docs.get('exchange/bse_state').wallets.m2.spendableBones, 40);

    // Member Delete -> Undo -> restores full wallet & characters
    await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/member/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ targetId: 'm1', reason: 'Mistake' })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    const delMemberId = docs.get('exchange/bse_state').auditLog.at(-1).id;
    assert.equal(docs.get('exchange/bse_state').wallets.m1, undefined);

    await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/audit/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ entryId: delMemberId })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(docs.get('exchange/bse_state').wallets.m1.spendableBones, 150);
    assert.equal(docs.get('exchange/bse_state').wallets.m1.characters[0].surname, 'Black');

    // Legacy SPENDABLE_BONES_OVERRIDE and MEMBER_DELETE without undoMeta still revert cleanly
    const legacyState = {
      wallets: {
        m1: { discordId: 'm1', spendableBones: 275, boneScore: 400 }
      },
      auditLog: [
        {
          id: 'tx_legacy_1',
          timestamp: new Date().toISOString(),
          action: 'SPENDABLE_BONES_OVERRIDE',
          officerName: 'Officer',
          targetId: 'm1',
          targetName: 'Grimfang',
          amount: 155,
          spendableBones: 275,
          boneScore: 400,
          reason: 'Spendable Bones override: 120 -> 275 (separate from weekly cap)'
        },
        {
          id: 'tx_legacy_del',
          timestamp: new Date().toISOString(),
          action: 'MEMBER_DELETE',
          officerName: 'Officer',
          targetId: 'm_old',
          targetName: 'OldRaider',
          amount: -85,
          spendableBones: 0,
          boneScore: 0,
          reason: 'Purged member from ledger (85 Bones, 220 Career Pts)'
        }
      ]
    };
    const legacyRes = revertAuditEntry(legacyState, 'tx_legacy_1', { officerId: 'off1', officerName: 'Officer' });
    assert.equal(legacyRes.ok, true);
    assert.equal(legacyState.wallets.m1.spendableBones, 120);
    assert.equal(legacyState.wallets.m1.boneScore, 400);

    const legacyDelRes = revertAuditEntry(legacyState, 'tx_legacy_del', { officerId: 'off1', officerName: 'Officer' });
    assert.equal(legacyDelRes.ok, true);
    assert.equal(legacyState.wallets.m_old.spendableBones, 85);
    assert.equal(legacyState.wallets.m_old.boneScore, 220);
  });

  it('reverts BOUNTY_REQUEST_APPROVED and ROSTER_DISCORD_SYNC cleanly', () => {
    const state = {
      wallets: {
        c1: { discordId: 'c1', username: 'sponsor', spendableBones: 100, boneScore: 100 },
        new1: { discordId: 'new1', username: 'freshjoin', spendableBones: 0, boneScore: 0, bountiesCompleted: 0 }
      },
      bounties: [
        {
          id: 'b_req_1',
          title: 'Escort Mission',
          creatorId: 'c1',
          baseRewardBones: 25,
          officerBonusBones: 15,
          rewardBones: 40,
          status: 'active',
          approvedBy: 'Officer'
        }
      ],
      claims: {},
      auditLog: [
        {
          id: 'tx_app_1',
          timestamp: new Date().toISOString(),
          action: 'BOUNTY_REQUEST_APPROVED',
          officerName: 'Officer',
          targetId: 'c1',
          targetName: 'sponsor',
          amount: 0,
          reason: 'Approved member bounty "Escort Mission"',
          undoMeta: {
            kind: 'bounty_request_approved',
            bountyId: 'b_req_1',
            targetId: 'c1',
            prevStatus: 'pending_review',
            prevOfficerBonusBones: 0,
            prevRewardBones: 25
          }
        },
        {
          id: 'tx_sync_1',
          timestamp: new Date().toISOString(),
          action: 'ROSTER_DISCORD_SYNC',
          officerName: 'Officer',
          targetId: null,
          targetName: 'Discord Guild',
          amount: 0,
          reason: 'Synced 1 joined, 1 removed',
          undoMeta: {
            kind: 'roster_sync',
            joinedIds: ['new1'],
            removedWallets: [
              { discordId: 'old1', username: 'departed', spendableBones: 45, boneScore: 90 }
            ]
          }
        }
      ]
    };

    const appRes = revertAuditEntry(state, 'tx_app_1', { officerId: 'off1', officerName: 'Officer' });
    assert.equal(appRes.ok, true);
    assert.equal(state.bounties[0].status, 'pending_review');
    assert.equal(state.bounties[0].officerBonusBones, 0);
    assert.equal(state.bounties[0].rewardBones, 25);

    const syncRes = revertAuditEntry(state, 'tx_sync_1', { officerId: 'off1', officerName: 'Officer' });
    assert.equal(syncRes.ok, true);
    assert.equal(state.wallets.new1, undefined);
    assert.equal(state.wallets.old1.spendableBones, 45);
    assert.equal(state.wallets.old1.boneScore, 90);
  });
});
