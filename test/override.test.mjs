import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { toFirestoreFields, fromFirestoreDoc, FirestoreClient } from '../src/firestore.js';
import { getWeeklyWindowStart } from '../src/weeklyCap.js';
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

describe('worker.js — Spendable Bones Override (Separate from Career Score & Weekly Cap)', () => {
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

  it('overrides Spendable Bones cleanly even when Weekly Cap is reached, without altering Career Score or Weekly Cap', async () => {
    const fsClient = new FirestoreClient(TEST_ENV);
    const baseState = fsClient.getDefaultBseState();
    const currentWeekStart = getWeeklyWindowStart(2);

    baseState.config = {
      ...baseState.config,
      weeklyCap: { enabled: true, cap: 50, resetDay: 2 }
    };
    baseState.wallets = {
      m1: {
        discordId: 'm1',
        username: 'grimfang',
        serverNickname: 'Grimfang',
        spendableBones: 50,
        boneScore: 300,
        weeklyBonesEarned: 50,
        weeklyCapRollover: 0,
        weeklyWindowStart: currentWeekStart
      }
    };

    const docs = installFirestoreFetchMock(baseState);
    const officerCookie = signTestSession({ id: 'off1', username: 'officer', isOfficer: true, issuedAt: Date.now() });

    // 1. Confirm normal /award is blocked by 50/50 weekly cap
    const blockedAward = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/award', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ targetId: 'm1', amount: 25, reason: 'Raid' })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(blockedAward.status, 400);
    const blockedJson = await blockedAward.json();
    assert.equal(blockedJson.weeklyCapReached, true);

    // 2. Officer overrides Spendable Bones directly above weekly cap -> 200
    const overrideRes = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/member/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({
          targetId: 'm1',
          spendableBones: 185,
          reason: 'SR compensation outside weekly cap'
        })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(overrideRes.status, 200);
    const overrideJson = await overrideRes.json();
    assert.equal(overrideJson.action, 'SPENDABLE_BONES_OVERRIDE');
    assert.equal(overrideJson.spendableChanged, true);
    assert.equal(overrideJson.scoreChanged, false);

    const saved = docs.get('exchange/bse_state');
    const wallet = saved.wallets.m1;
    assert.equal(wallet.spendableBones, 185);
    assert.equal(wallet.boneScore, 300); // Career Score unchanged
    assert.equal(wallet.weeklyBonesEarned, 50); // Weekly Cap unchanged
    assert.equal(wallet.weeklyCapRollover, 0);

    const logEntry = saved.auditLog[saved.auditLog.length - 1];
    assert.equal(logEntry.action, 'SPENDABLE_BONES_OVERRIDE');
    assert.equal(logEntry.amount, 135);
    assert.equal(logEntry.spendableBones, 185);
    assert.equal(logEntry.boneScore, 300);
    assert.equal(logEntry.reason, 'SR compensation outside weekly cap');

    // 3. Weekly Cap still holds independently for normal awards afterwards
    const stillCapped = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/award', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ targetId: 'm1', amount: 10, reason: 'Normal award' })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(stillCapped.status, 400);
  });

  it('supports zero Spendable Bones override and enforces Officer auth + validation', async () => {
    const fsClient = new FirestoreClient(TEST_ENV);
    const baseState = fsClient.getDefaultBseState();
    baseState.wallets = {
      m1: {
        discordId: 'm1',
        username: 'grimfang',
        spendableBones: 75,
        boneScore: 220,
        weeklyBonesEarned: 25,
        weeklyWindowStart: getWeeklyWindowStart(2)
      }
    };

    const docs = installFirestoreFetchMock(baseState);
    const memberCookie = signTestSession({ id: 'm1', username: 'mem', isOfficer: false, issuedAt: Date.now() });
    const officerCookie = signTestSession({ id: 'off1', username: 'officer', isOfficer: true, issuedAt: Date.now() });

    // Non-officer -> 403
    const forbidden = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/member/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': memberCookie },
        body: JSON.stringify({ targetId: 'm1', spendableBones: 999 })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(forbidden.status, 403);

    // Negative value -> 400
    const badNeg = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/member/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ targetId: 'm1', spendableBones: -5 })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(badNeg.status, 400);

    // Override to 0 -> 200 and leaves Career Score + weeklyBonesEarned untouched
    const zeroRes = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/member/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ targetId: 'm1', spendableBones: 0 })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(zeroRes.status, 200);
    const saved = docs.get('exchange/bse_state');
    assert.equal(saved.wallets.m1.spendableBones, 0);
    assert.equal(saved.wallets.m1.boneScore, 220);
    assert.equal(saved.wallets.m1.weeklyBonesEarned, 25);
    assert.equal(saved.auditLog[saved.auditLog.length - 1].action, 'SPENDABLE_BONES_OVERRIDE');
    assert.equal(saved.auditLog[saved.auditLog.length - 1].amount, -75);

    // Dual edit in Inspector where only spendable changed vs dual where both changed
    const careerRes = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/member/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ targetId: 'm1', boneScore: 500 })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(careerRes.status, 200);
    const careerJson = await careerRes.json();
    assert.equal(careerJson.action, 'LIFETIME_BONES_ADJUST');
    assert.equal(careerJson.wallet.spendableBones, 0);
    assert.equal(careerJson.wallet.boneScore, 500);
  });
});
