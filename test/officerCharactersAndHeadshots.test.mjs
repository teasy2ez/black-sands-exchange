import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  resetBlizzardCaches,
  fetchCharacterArmorySnapshot
} from '../src/blizzard.js';
import {
  applyCharacterSummaryToWallets,
  mergeCharacterIntoCraftingState,
  getCharacterArmory,
  runScheduledArmoryTick
} from '../src/armory.js';
import { toFirestoreFields, fromFirestoreDoc, FirestoreClient } from '../src/firestore.js';
import worker from '../worker.js';

const TEST_ENV = {
  BLIZZARD_CLIENT_ID: 'test-bnet-client-id-1234',
  BLIZZARD_CLIENT_SECRET: 'super-secret-bnet-value-9999',
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

function createMemoryFirestore(initialState = null) {
  const client = new FirestoreClient(TEST_ENV);
  let stateDoc = initialState ? structuredClone(initialState) : client.getDefaultBseState();
  const collections = new Map();
  const ensureCol = (name) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  };

  return {
    sanitizeDocId: (id) => client.sanitizeDocId(id),
    async getBseState() {
      return structuredClone(stateDoc);
    },
    async saveBseState(next) {
      stateDoc = structuredClone(next);
      return true;
    },
    async getCollectionDoc(col, docId) {
      const hit = ensureCol(col).get(client.sanitizeDocId(docId));
      return hit ? structuredClone(hit) : null;
    },
    async saveCollectionDoc(col, docId, data) {
      ensureCol(col).set(client.sanitizeDocId(docId), structuredClone(data));
      return true;
    },
    async batchGetCollectionDocs(col, docIds = []) {
      const m = ensureCol(col);
      const out = {};
      for (const id of docIds) {
        const safe = client.sanitizeDocId(id);
        if (m.has(safe)) out[safe] = structuredClone(m.get(safe));
      }
      return out;
    },
    async batchSaveCollectionDocs(col, entries = []) {
      const m = ensureCol(col);
      const list = Array.isArray(entries) ? entries : Object.entries(entries);
      for (const [id, val] of list) {
        m.set(client.sanitizeDocId(id), structuredClone(val));
      }
      return true;
    },
    async logAuditEvent() {
      return true;
    }
  };
}

describe('Character Headshot Sync & Backfill (src/blizzard.js & src/armory.js)', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    resetBlizzardCaches();
  });

  it('normalizes Classic/Forever character-media fallback keys (avatar_url, bust_url, render_url)', async () => {
    const snapshot = await fetchCharacterArmorySnapshot('lyra-dawn', TEST_ENV, {
      fetchImpl: async (url) => {
        if (url === 'https://oauth.battle.net/token') {
          return makeJsonResponse({ access_token: 'tok-media', expires_in: 3600 });
        }
        const u = new URL(url);
        if (u.pathname === '/profile/wow/character/lyra-dawn') {
          return makeJsonResponse({
            name: 'Lyra',
            surname: 'Dawn',
            level: 60,
            race: { name: 'Human' },
            character_class: { name: 'Priest' },
            active_spec: { name: 'Holy' }
          });
        }
        if (u.pathname === '/profile/wow/character/lyra-dawn/character-media') {
          return makeJsonResponse({
            avatar_url: 'https://render.worldofwarcraft.com/classic1x-us/character/forever/12/lyra-avatar.jpg',
            bust_url: 'https://render.worldofwarcraft.com/classic1x-us/character/forever/12/lyra-inset.jpg',
            render_url: 'https://render.worldofwarcraft.com/classic1x-us/character/forever/12/lyra-main.png'
          });
        }
        return makeJsonResponse({}, 404);
      }
    });

    assert.equal(snapshot.found, true);
    assert.equal(snapshot.media.avatar, 'https://render.worldofwarcraft.com/classic1x-us/character/forever/12/lyra-avatar.jpg');
    assert.equal(snapshot.media.inset, 'https://render.worldofwarcraft.com/classic1x-us/character/forever/12/lyra-inset.jpg');
    assert.equal(snapshot.media.mainRaw, 'https://render.worldofwarcraft.com/classic1x-us/character/forever/12/lyra-main.png');
  });

  it('backfills missing avatarThumbUrl on cached getCharacterArmory hits even when craftingIndex is already fresh', async () => {
    const firestore = createMemoryFirestore();
    const state = await firestore.getBseState();

    const cachedSnapshot = {
      found: true,
      slug: 'kael-sunfury',
      name: 'Kael',
      surname: 'Sunfury',
      displayName: 'Kael Sunfury',
      level: 60,
      race: 'High Elf',
      className: 'Mage',
      activeSpec: 'Fire',
      avgItemLevel: 72,
      media: { avatar: 'https://render.worldofwarcraft.com/kael-headshot-v2.jpg', inset: null, mainRaw: null },
      professions: {
        primaries: [{ name: 'Tailoring', skillPoints: 300, maxSkillPoints: 300, knownRecipes: [{ id: 18401, name: 'Robe of the Archmage' }] }],
        secondaries: [],
        allSummary: 'Tailoring (300/300)'
      },
      syncedAt: new Date().toISOString()
    };

    // Seed wallet first so mergeCharacterIntoCraftingState indexes kael-sunfury cleanly
    state.wallets = {
      mem1: {
        discordId: 'mem1',
        username: 'kaelplayer',
        primaryCharacter: 'Kael',
        characters: [
          {
            name: 'Kael',
            surname: 'Sunfury',
            slug: 'kael-sunfury',
            class: 'Mage',
            role: 'DPS',
            level: 60,
            professions: 'Tailoring (300/300)',
            armoryVerified: true,
            isPrimary: true
            // Note: avatarThumbUrl is missing!
          }
        ]
      }
    };
    await firestore.saveCollectionDoc('armory_characters', 'kael-sunfury', cachedSnapshot);
    mergeCharacterIntoCraftingState(state, cachedSnapshot);
    await firestore.saveBseState(state);

    const res = await getCharacterArmory({
      slug: 'kael-sunfury',
      forceRefresh: false,
      env: TEST_ENV,
      firestore,
      state
    });

    assert.equal(res.found, true);
    const updatedState = await firestore.getBseState();
    assert.equal(
      updatedState.wallets.mem1.characters[0].avatarThumbUrl,
      'https://render.worldofwarcraft.com/kael-headshot-v2.jpg'
    );

    // Calling applyCharacterSummaryToWallets again with identical data returns false (no redundant write)
    const changedAgain = applyCharacterSummaryToWallets(updatedState, cachedSnapshot);
    assert.equal(changedAgain, false);

    // Updating portrait URL on Blizzard updates avatarThumbUrl cleanly
    const refreshedPortrait = {
      ...cachedSnapshot,
      media: { avatar: 'https://render.worldofwarcraft.com/kael-headshot-v3.jpg', inset: null, mainRaw: null }
    };
    const changedOnNewPortrait = applyCharacterSummaryToWallets(updatedState, refreshedPortrait);
    assert.equal(changedOnNewPortrait, true);
    assert.equal(
      updatedState.wallets.mem1.characters[0].avatarThumbUrl,
      'https://render.worldofwarcraft.com/kael-headshot-v3.jpg'
    );
  });

  it('prioritizes linked characters missing avatarThumbUrl in runScheduledArmoryTick', async () => {
    const firestore = createMemoryFirestore();
    const state = await firestore.getBseState();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    state.config = { armory: { enabled: true, autoSyncGuildRoster: false, guildSlug: 'black-sands' } };
    state.wallets = {
      hasPortrait: {
        discordId: 'hasPortrait',
        characters: [{
          name: 'Old',
          surname: 'Portrait',
          slug: 'old-portrait',
          avatarThumbUrl: 'https://render.worldofwarcraft.com/old.jpg',
          lastArmorySyncAt: oneHourAgo,
          isPrimary: true
        }]
      },
      missingPortrait: {
        discordId: 'missingPortrait',
        characters: [{
          name: 'Fresh',
          surname: 'Face',
          slug: 'fresh-face',
          // Missing avatarThumbUrl, synced 1h ago (< 6h stale cutoff, > 30m retry floor)
          lastArmorySyncAt: oneHourAgo,
          isPrimary: true
        }]
      }
    };
    // Mark both as already indexed in craftingIndex so only missingHeadshot triggers a sync
    mergeCharacterIntoCraftingState(state, {
      found: true,
      slug: 'old-portrait',
      name: 'Old',
      surname: 'Portrait',
      className: 'Warrior',
      syncedAt: oneHourAgo,
      professions: { primaries: [{ name: 'Mining', skillPoints: 300, maxSkillPoints: 300, knownRecipes: [] }], secondaries: [] }
    });
    mergeCharacterIntoCraftingState(state, {
      found: true,
      slug: 'fresh-face',
      name: 'Fresh',
      surname: 'Face',
      className: 'Shaman',
      syncedAt: oneHourAgo,
      professions: { primaries: [{ name: 'Alchemy', skillPoints: 300, maxSkillPoints: 300, knownRecipes: [] }], secondaries: [] }
    });
    await firestore.saveBseState(state);

    const syncedSlugs = [];
    await runScheduledArmoryTick(TEST_ENV, firestore, {
      fetchImpl: async (url) => {
        if (url === 'https://oauth.battle.net/token') {
          return makeJsonResponse({ access_token: 'tok-cron', expires_in: 3600 });
        }
        const u = new URL(url);
        const m = u.pathname.match(/^\/profile\/wow\/character\/([^/]+)$/);
        if (m) {
          syncedSlugs.push(m[1]);
          return makeJsonResponse({
            name: 'Fresh',
            surname: 'Face',
            level: 60,
            race: { name: 'Orc' },
            character_class: { name: 'Shaman' },
            active_spec: { name: 'Restoration' }
          });
        }
        if (u.pathname.endsWith('/character-media')) {
          return makeJsonResponse({
            assets: [{ key: 'avatar', value: 'https://render.worldofwarcraft.com/fresh-face.jpg' }]
          });
        }
        return makeJsonResponse({}, 404);
      }
    });

    assert.deepEqual(syncedSlugs, ['fresh-face']);
    const afterState = await firestore.getBseState();
    assert.equal(
      afterState.wallets.missingPortrait.characters[0].avatarThumbUrl,
      'https://render.worldofwarcraft.com/fresh-face.jpg'
    );
  });
});

describe('POST /api/exchange/member/characters & Audit Undo (worker.js)', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    resetBlizzardCaches();
  });

  function installWorkerMocks(initialState = null) {
    const fsClient = new FirestoreClient(TEST_ENV);
    const docs = new Map();
    const baseState = initialState || fsClient.getDefaultBseState();
    docs.set('exchange/bse_state', baseState);

    // Seed guild roster with two "Vael" characters (for ambiguity test) and one "grimfang-black"
    docs.set('armory_guild/black-sands', {
      guildName: 'Black Sands',
      slug: 'black-sands',
      memberCount: 3,
      syncedAt: new Date().toISOString(),
      members: [
        { name: 'Grimfang', surname: 'Black', displayName: 'Grimfang Black', slug: 'grimfang-black', level: 60, className: 'Warrior', raceName: 'Orc' },
        { name: 'Vael', surname: 'Ash', displayName: 'Vael Ash', slug: 'vael-ash', level: 60, className: 'Rogue', raceName: 'Undead' },
        { name: 'Vael', surname: 'Storm', displayName: 'Vael Storm', slug: 'vael-storm', level: 58, className: 'Mage', raceName: 'Human' }
      ]
    });

    globalThis.fetch = async (url, init = {}) => {
      const urlStr = String(url);
      if (urlStr === 'https://oauth.battle.net/token') {
        return makeJsonResponse({ access_token: 'tok-worker', expires_in: 3600 });
      }
      if (urlStr.startsWith('https://us.api.blizzard.com/')) {
        const u = new URL(urlStr);
        if (u.pathname === '/profile/wow/character/grimfang-black') {
          return makeJsonResponse({
            name: 'Grimfang',
            surname: 'Black',
            level: 60,
            race: { name: 'Orc' },
            character_class: { name: 'Warrior' },
            active_spec: { name: 'Protection' },
            average_item_level: 75,
            guild: { name: 'Black Sands', id: 1 }
          });
        }
        if (u.pathname === '/profile/wow/character/grimfang-black/character-media') {
          return makeJsonResponse({
            assets: [{ key: 'avatar', value: 'https://render.worldofwarcraft.com/grimfang-headshot.jpg' }]
          });
        }
        if (u.pathname === '/profile/wow/character/grimfang-black/professions') {
          return makeJsonResponse({
            primaries: [
              {
                profession: { name: 'Blacksmithing' },
                tiers: [
                  {
                    skill_points: 300,
                    max_skill_points: 300,
                    known_recipes: [{ id: 12640, name: 'Lionheart Helm' }]
                  }
                ]
              }
            ]
          });
        }
        return makeJsonResponse({}, 404);
      }

      if (urlStr.startsWith('https://firestore.googleapis.com/v1/')) {
        const prefix = `https://firestore.googleapis.com/v1/${fsClient.docPathPrefix}/`;
        const rel = urlStr.slice(prefix.length);

        if (rel === ':batchGet' && init.method === 'POST') {
          const body = JSON.parse(init.body || '{}');
          const out = (body.documents || []).map(fullPath => {
            const key = fullPath.slice(fsClient.docPathPrefix.length + 1);
            if (!docs.has(key)) return { missing: fullPath };
            return { found: { name: fullPath, ...toFirestoreFields(docs.get(key)) } };
          });
          return makeJsonResponse(out);
        }
        if (rel === ':commit' && init.method === 'POST') {
          const body = JSON.parse(init.body || '{}');
          for (const w of body.writes || []) {
            if (w.update?.name) {
              const key = w.update.name.slice(fsClient.docPathPrefix.length + 1);
              const parsed = fromFirestoreDoc({ name: w.update.name, fields: w.update.fields });
              delete parsed._documentPath;
              delete parsed._id;
              docs.set(key, parsed);
            }
          }
          return makeJsonResponse({ writeResults: [] });
        }
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

  it('enforces Officer auth, links Armory-verified main with headshot & recipes, handles ambiguity/unverified, and supports Audit Undo', async () => {
    const fsClient = new FirestoreClient(TEST_ENV);
    const seed = fsClient.getDefaultBseState();
    seed.wallets = {
      member42: {
        discordId: 'member42',
        username: 'thrallfan',
        serverNickname: 'ThrallFan',
        spendableBones: 25,
        boneScore: 40,
        primaryCharacter: 'Oldalt',
        characters: [
          { name: 'Oldalt', slug: 'oldalt-bones', surname: 'Bones', class: 'Hunter', role: 'DPS', isPrimary: true }
        ]
      }
    };
    const docs = installWorkerMocks(seed);

    const memberCookie = signTestSession({ id: 'member42', username: 'thrallfan', isOfficer: false, issuedAt: Date.now() });
    const officerCookie = signTestSession({ id: 'off1', username: 'highlord', isOfficer: true, issuedAt: Date.now() });

    // 1. Non-officer rejected with 403
    const rForbidden = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/member/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': memberCookie },
        body: JSON.stringify({ action: 'link_main', targetId: 'member42', characterName: 'Grimfang Black' })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(rForbidden.status, 403);

    // 2. Ambiguous single first-name returns 409 AMBIGUOUS_CHARACTER with matching roster choices
    const rAmbig = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/member/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ action: 'link_main', targetId: 'member42', characterName: 'Vael' })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(rAmbig.status, 409);
    const ambigJson = await rAmbig.json();
    assert.equal(ambigJson.code, 'AMBIGUOUS_CHARACTER');
    assert.equal(ambigJson.matches.length, 2);

    // 3. Unknown character returns 404 CHARACTER_NOT_FOUND with canForceUnverified: true
    const rNotFound = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/member/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ action: 'link_main', targetId: 'member42', characterName: 'Ghostly Nobody' })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(rNotFound.status, 404);
    const nfJson = await rNotFound.json();
    assert.equal(nfJson.code, 'CHARACTER_NOT_FOUND');
    assert.equal(nfJson.canForceUnverified, true);

    // 4. Officer links Armory-verified main character "Grimfang" (auto-resolved to grimfang-black via guild roster)
    const rLink = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/member/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ action: 'link_main', targetId: 'member42', characterName: 'Grimfang' })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(rLink.status, 200);
    const linkJson = await rLink.json();
    assert.equal(linkJson.primaryCharacter, 'Grimfang');
    assert.equal(linkJson.characters.length, 2);
    assert.equal(linkJson.characters[0].slug, 'grimfang-black');
    assert.equal(linkJson.characters[0].isPrimary, true);
    assert.equal(linkJson.characters[0].role, 'Tank'); // Inferred from Protection active_spec
    assert.equal(linkJson.characters[0].avatarThumbUrl, 'https://render.worldofwarcraft.com/grimfang-headshot.jpg');
    assert.equal(linkJson.characters[0].armoryVerified, true);
    // Existing character preserved as alt
    assert.equal(linkJson.characters[1].name, 'Oldalt');
    assert.equal(linkJson.characters[1].isPrimary, false);

    // Learned Blacksmithing recipe indexed into state.craftingIndex
    const stateAfterLink = docs.get('exchange/bse_state');
    assert.ok(stateAfterLink.craftingIndex?.byProf?.Blacksmithing);
    const linkAuditEntry = stateAfterLink.auditLog.at(-1);
    assert.equal(linkAuditEntry.action, 'OFFICER_CHARACTER_LINK');

    // 5. Officer can promote alt back to primary and unlink a character, or Undo via /api/exchange/audit/undo!
    const rUndo = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/audit/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ entryId: linkAuditEntry.id, reason: 'Linked wrong member' })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(rUndo.status, 200);

    const stateAfterUndo = docs.get('exchange/bse_state');
    assert.equal(stateAfterUndo.wallets.member42.primaryCharacter, 'Oldalt');
    assert.equal(stateAfterUndo.wallets.member42.characters.length, 1);
    assert.equal(stateAfterUndo.wallets.member42.characters[0].name, 'Oldalt');
    // Unlinked crafter pruned from craftingIndex
    assert.equal(stateAfterUndo.craftingIndex?.byProf?.Blacksmithing, undefined);

    // 6. Test allowUnverified override + set_primary + remove_character
    const rForce = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/member/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({
          action: 'link_main',
          targetId: 'member42',
          characterName: 'Freshbie Newcomer',
          className: 'Druid',
          role: 'Healer',
          level: 12,
          allowUnverified: true
        })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(rForce.status, 200);
    const forceJson = await rForce.json();
    assert.equal(forceJson.primaryCharacter, 'Freshbie');
    assert.equal(forceJson.characters[0].slug, 'freshbie-newcomer');
    assert.equal(forceJson.characters[0].class, 'Druid');
    assert.equal(forceJson.characters[0].role, 'Healer');

    // Promote Oldalt back to primary
    const rSetPrim = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/member/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ action: 'set_primary', targetId: 'member42', slugOrName: 'oldalt-bones' })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(rSetPrim.status, 200);
    assert.equal((await rSetPrim.json()).primaryCharacter, 'Oldalt');

    // Remove Freshbie
    const rRemove = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/member/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify({ action: 'remove_character', targetId: 'member42', slugOrName: 'freshbie-newcomer' })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(rRemove.status, 200);
    const remJson = await rRemove.json();
    assert.equal(remJson.characters.length, 1);
    assert.equal(remJson.primaryCharacter, 'Oldalt');
  });
});
