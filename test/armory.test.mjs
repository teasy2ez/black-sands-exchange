import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  FOREVER_PROFILE_NS,
  FOREVER_DYNAMIC_NS,
  FOREVER_DEFAULT_STATIC_NS,
  FOREVER_FALLBACK_STATIC_NS,
  BlizzardApiError,
  resetBlizzardCaches,
  buildCharacterSlug,
  parseCharacterIdentity,
  normalizeGuildSlug,
  extractNamespaceFromHref,
  getBlizzardAccessToken,
  blizzardFetch,
  getActiveStaticNamespace,
  blizzardFetchStatic,
  normalizePreviewItem,
  fetchCharacterArmorySnapshot,
  fetchForeverGuildRoster,
  fetchForeverItemDetails,
  searchForeverItems,
  fetchRulesetsAndHouses
} from '../src/blizzard.js';

import {
  hydrateItemsMediaAndPrices,
  applyCharacterSummaryToWallets,
  mergeCharacterIntoCraftingDirectory,
  expandCraftingDirectory,
  getGuildCraftingDirectory,
  getCharacterArmory,
  matchRosterWithWallets,
  getOrSyncGuildRoster,
  autoMatchGuildRosterToWallets,
  getItemDetail,
  ingestCompactAuctionPrices,
  getAuctionHouseWatchlist,
  runScheduledArmoryTick
} from '../src/armory.js';

import { aggregateAuctionHouseDump } from '../scripts/sync-forever-ah.mjs';
import { handleApplicationCommand } from '../src/commands.js';
import {
  buildArmoryCharacterEmbed,
  buildArmoryItemEmbed,
  formatCopperCoins,
  QualityColors,
  ClassicClassColors
} from '../src/discord.js';
import { toFirestoreFields, fromFirestoreDoc, FirestoreClient } from '../src/firestore.js';
import worker from '../worker.js';

const TEST_ENV = {
  BLIZZARD_CLIENT_ID: 'test-bnet-client-id-1234',
  BLIZZARD_CLIENT_SECRET: 'super-secret-bnet-value-9999',
  ARMORY_INGEST_SECRET: 'ingest-secret-xyz',
  SESSION_SECRET: 'test-session-secret-hmac',
  FIRESTORE_PROJECT_ID: 'bse-test-proj'
};

function createMemoryFirestore(initialState = null) {
  const client = new FirestoreClient({ FIRESTORE_PROJECT_ID: 'bse-test-proj' });
  let stateDoc = initialState ? structuredClone(initialState) : client.getDefaultBseState();
  const collections = new Map();
  const auditLogs = [];

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
      const m = ensureCol(col);
      const hit = m.get(client.sanitizeDocId(docId));
      return hit ? structuredClone(hit) : null;
    },
    async saveCollectionDoc(col, docId, data) {
      ensureCol(col).set(client.sanitizeDocId(docId), structuredClone(data));
      return true;
    },
    async batchGetCollectionDocs(col, docIds = []) {
      const m = ensureCol(col);
      const out = {};
      for (const rawId of docIds) {
        const safeId = client.sanitizeDocId(rawId);
        if (m.has(safeId)) out[safeId] = structuredClone(m.get(safeId));
      }
      return out;
    },
    async batchSaveCollectionDocs(col, entries = []) {
      const m = ensureCol(col);
      const list = Array.isArray(entries) ? entries : Object.entries(entries);
      for (const [docId, val] of list) {
        m.set(client.sanitizeDocId(docId), structuredClone(val));
      }
      return true;
    },
    async logAuditEvent(ev) {
      auditLogs.push(structuredClone(ev));
      return true;
    },
    _collections: collections,
    _auditLogs: auditLogs
  };
}

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

function makeSampleCharacterSnapshot(overrides = {}) {
  return {
    found: true,
    slug: 'grimfang-black',
    name: 'Grimfang',
    surname: 'Black',
    displayName: 'Grimfang Black',
    level: 60,
    race: 'Orc',
    className: 'Warrior',
    activeSpec: 'Fury',
    avgItemLevel: 76.5,
    guild: { name: 'Black Sands', id: 42, slug: 'black-sands' },
    ruleset: { id: 1, name: 'PvP' },
    armoryUrl: 'https://worldofwarcraft.blizzard.com/en-us/forever/us/armory/character/grimfang-black',
    media: { avatar: 'https://render.worldofwarcraft.com/avatar.jpg', inset: null, mainRaw: null },
    equipment: [
      {
        id: 19019,
        slotType: 'MAIN_HAND',
        slotName: 'Main Hand',
        name: 'Thunderfury, Blessed Blade of the Windseeker',
        quality: 'LEGENDARY',
        level: 80,
        enchantments: [{ display: 'Enchant Weapon - Crusader', slotType: 'PERMANENT' }],
        wowheadUrl: 'https://www.wowhead.com/forever/item=19019'
      },
      {
        id: 12640,
        slotType: 'HEAD',
        slotName: 'Head',
        name: 'Lionheart Helm',
        quality: 'EPIC',
        level: 61,
        enchantments: [],
        wowheadUrl: 'https://www.wowhead.com/forever/item=12640'
      }
    ],
    statistics: { health: 5200, power: 100, powerType: 'Rage', strength: 295, armor: 5840 },
    specializations: { groups: [{ isActive: true, trees: [{ name: 'Fury', spentPoints: 34, talents: [] }] }], primaryTree: 'Fury' },
    professions: {
      primaries: [
        {
          id: 164,
          name: 'Blacksmithing',
          tierName: 'Artisan',
          skillPoints: 300,
          maxSkillPoints: 300,
          knownRecipes: [
            { id: 16729, name: 'Lionheart Helm' },
            { id: 16667, name: 'Stronghold Gauntlets' }
          ]
        }
      ],
      secondaries: [
        { id: 185, name: 'Cooking', tierName: 'Artisan', skillPoints: 300, maxSkillPoints: 300, knownRecipes: [] }
      ],
      allSummary: 'Blacksmithing 300'
    },
    reputations: [{ id: 529, name: 'Argent Dawn', standing: 'Exalted', value: 999, max: 1000, tier: 7, raw: 42999 }],
    syncedAt: new Date().toISOString(),
    ...overrides
  };
}

// ============================================================================
// 1. src/blizzard.js TESTS
// ============================================================================
describe('src/blizzard.js — WoW: Forever US Client', () => {
  beforeEach(() => {
    resetBlizzardCaches();
  });

  it('parses realmless Forever Name-Surname identities & guild URLs', () => {
    assert.equal(buildCharacterSlug('Grimfang', 'Black'), 'grimfang-black');
    assert.equal(buildCharacterSlug('grimfang-black', 'Black'), 'grimfang-black');
    assert.equal(buildCharacterSlug('Sirius-Vane'), 'sirius-vane');
    assert.equal(buildCharacterSlug('  Kael  ', '  Sun Strider '), 'kael-sunstrider');

    const p1 = parseCharacterIdentity('grimfang-black');
    assert.equal(p1.name, 'Grimfang');
    assert.equal(p1.surname, 'Black');
    assert.equal(p1.slug, 'grimfang-black');
    assert.equal(p1.hasSurname, true);
    assert.equal(p1.armoryUrl, 'https://worldofwarcraft.blizzard.com/en-us/forever/us/armory/character/grimfang-black');

    const pDup = parseCharacterIdentity('grimfang-black', 'Black');
    assert.equal(pDup.name, 'Grimfang');
    assert.equal(pDup.surname, 'Black');
    assert.equal(pDup.slug, 'grimfang-black');

    const p2 = parseCharacterIdentity('lyra dawn');
    assert.equal(p2.slug, 'lyra-dawn');
    assert.equal(p2.hasSurname, true);

    const p3 = parseCharacterIdentity('Orgrim');
    assert.equal(p3.slug, 'orgrim');
    assert.equal(p3.hasSurname, false);

    assert.equal(normalizeGuildSlug('Black Sands'), 'black-sands');
    assert.equal(normalizeGuildSlug("Gurubashi's Finest"), 'gurubashis-finest');
    assert.equal(
      normalizeGuildSlug('https://worldofwarcraft.blizzard.com/en-us/forever/us/armory/guild/Black%20Sands?foo=1'),
      'black-sands'
    );

    assert.equal(
      extractNamespaceFromHref('https://us.api.blizzard.com/data/wow/playable-class/1?namespace=static-1.60.9_77777-forever-us'),
      'static-1.60.9_77777-forever-us'
    );
  });

  it('caches OAuth access token and automatically refreshes once on 401', async () => {
    let tokenCalls = 0;
    let endpointCalls = 0;
    const mockFetch = async (url, init) => {
      if (url === 'https://oauth.battle.net/token') {
        tokenCalls++;
        return makeJsonResponse({ access_token: `tok_${tokenCalls}`, expires_in: 3600 });
      }
      endpointCalls++;
      const auth = init?.headers?.Authorization;
      if (endpointCalls === 2) {
        // Simulate unexpected expiry on second API call
        return makeJsonResponse({ detail: 'Unauthorized' }, 401);
      }
      return makeJsonResponse({ ok: true, usedAuth: auth });
    };

    const t1 = await getBlizzardAccessToken(TEST_ENV, mockFetch);
    const t2 = await getBlizzardAccessToken(TEST_ENV, mockFetch);
    assert.equal(t1, 'tok_1');
    assert.equal(t2, 'tok_1');
    assert.equal(tokenCalls, 1);

    const res1 = await blizzardFetch('/profile/wow/character/grimfang-black', TEST_ENV, {
      namespace: FOREVER_PROFILE_NS,
      fetchImpl: mockFetch
    });
    assert.equal(res1.usedAuth, 'Bearer tok_1');
    assert.equal(tokenCalls, 1);

    // 2nd call hits 401 -> refreshes token -> retries once with tok_2
    const res2 = await blizzardFetch('/profile/wow/character/grimfang-black', TEST_ENV, {
      namespace: FOREVER_PROFILE_NS,
      fetchImpl: mockFetch
    });
    assert.equal(res2.usedAuth, 'Bearer tok_2');
    assert.equal(tokenCalls, 2);
    assert.equal(endpointCalls, 3);
  });

  it('discovers dynamic static-*-forever-us namespace and falls back cleanly on 403/404', async () => {
    const probedNamespaces = [];
    const mockFetch = async (url) => {
      if (url === 'https://oauth.battle.net/token') {
        return makeJsonResponse({ access_token: 'tok_static', expires_in: 3600 });
      }
      const u = new URL(url);
      const ns = u.searchParams.get('namespace');
      probedNamespaces.push(`${u.pathname}:${ns}`);

      if (u.pathname === '/data/wow/playable-class/index') {
        if (ns === FOREVER_DEFAULT_STATIC_NS) {
          return makeJsonResponse({ error: 'Not Found' }, 404);
        }
        return makeJsonResponse({
          classes: [{ id: 1, key: { href: 'https://us.api.blizzard.com/data/wow/playable-class/1?namespace=static-1.60.5_81234-forever-us' } }]
        });
      }

      if (u.pathname === '/data/wow/item/19019') {
        if (ns === 'static-1.60.5_81234-forever-us') {
          return makeJsonResponse({ id: 19019, name: 'Thunderfury' });
        }
        return makeJsonResponse({ error: 'Forbidden' }, 403);
      }

      return makeJsonResponse({}, 404);
    };

    const discovered = await getActiveStaticNamespace(TEST_ENV, { fetchImpl: mockFetch });
    assert.equal(discovered, 'static-1.60.5_81234-forever-us');
    assert.ok(probedNamespaces.includes(`/data/wow/playable-class/index:${FOREVER_DEFAULT_STATIC_NS}`));
    assert.ok(probedNamespaces.includes(`/data/wow/playable-class/index:${FOREVER_FALLBACK_STATIC_NS}`));

    const item = await blizzardFetchStatic('/data/wow/item/19019', TEST_ENV, { fetchImpl: mockFetch });
    assert.equal(item.name, 'Thunderfury');
  });

  it('returns clean NOT_FOUND_OR_UNDER_10 stub when character profile returns 404', async () => {
    const mockFetch = async (url) => {
      if (url === 'https://oauth.battle.net/token') return makeJsonResponse({ access_token: 'tok', expires_in: 3600 });
      return makeJsonResponse({ code: 404, detail: 'Not found' }, 404);
    };

    const res = await fetchCharacterArmorySnapshot('tinypeon-pebble', TEST_ENV, { fetchImpl: mockFetch });
    assert.equal(res.found, false);
    assert.equal(res.reason, 'NOT_FOUND_OR_UNDER_10');
    assert.equal(res.slug, 'tinypeon-pebble');
    assert.match(res.message, /Level 10\+/);
  });

  it('tolerates 404 on delayed /character-media while preserving equipment stats, enchants, set bonuses, specs, professions, and reps', async () => {
    const mockFetch = async (url) => {
      if (url === 'https://oauth.battle.net/token') return makeJsonResponse({ access_token: 'tok', expires_in: 3600 });
      const u = new URL(url);
      if (u.pathname === '/profile/wow/character/grimfang-black') {
        return makeJsonResponse({
          id: 9001,
          name: 'Grimfang',
          surname: 'Black',
          level: 60,
          race: { id: 2, name: 'Orc' },
          character_class: { id: 1, name: 'Warrior', key: { href: 'https://us.api.blizzard.com/data/wow/playable-class/1?namespace=static-1.60.1_70399-forever-us' } },
          guild: { id: 7, name: 'Black Sands' },
          ruleset: { id: 1, name: 'PvP' },
          active_spec: { name: 'Protection' },
          equipped_item_level: 78
        });
      }
      if (u.pathname.endsWith('/character-media')) {
        return makeJsonResponse({ code: 404 }, 404);
      }
      if (u.pathname.endsWith('/equipment')) {
        return makeJsonResponse({
          equipped_items: [
            {
              slot: { type: 'MAIN_HAND', name: 'Main Hand' },
              item: { id: 19019 },
              name: 'Thunderfury, Blessed Blade of the Windseeker',
              quality: { type: 'LEGENDARY', name: 'Legendary' },
              level: { value: 80 },
              weapon: {
                damage: { display_string: '60 - 145 Damage' },
                attack_speed: { display_string: 'Speed 1.90' },
                dps: { display_string: '(53.9 damage per second)' }
              },
              stats: [{ type: { type: 'AGILITY', name: 'Agility' }, value: 5, display: { display_string: '+5 Agility' } }],
              enchantments: [{ display_string: 'Enchant Weapon - Crusader', enchantment_slot: { type: 'PERMANENT' } }],
              set: {
                item_set: { name: 'Battlegear of Might' },
                display_string: 'Battlegear of Might (1/8)',
                effects: [{ display_string: '(3) Set: Increases the block value of your shield by 30.', is_active: false }]
              }
            }
          ]
        });
      }
      if (u.pathname.endsWith('/statistics')) {
        return makeJsonResponse({ health: 6150, power: 100, power_type: { name: 'Rage' }, strength: { effective: 310 }, armor: { effective: 7400 }, spell_crit: { value: 3.5 } });
      }
      if (u.pathname.endsWith('/specializations')) {
        return makeJsonResponse({
          specialization_groups: [{
            is_active: true,
            specializations: [{
              specialization_name: 'Protection',
              spent_points: 31,
              talents: [{ talent: { name: 'Shield Slam' }, talent_rank: 1, spell_tooltip: { description: 'Slam the target' } }]
            }]
          }]
        });
      }
      if (u.pathname.endsWith('/professions')) {
        return makeJsonResponse({
          primaries: [{
            profession: { id: 164, name: 'Blacksmithing' },
            tiers: [{ tier: { name: 'Artisan Blacksmithing' }, skill_points: 300, max_skill_points: 300, known_recipes: [{ id: 16729, name: 'Lionheart Helm' }] }]
          }],
          secondaries: []
        });
      }
      if (u.pathname.endsWith('/reputations')) {
        return makeJsonResponse({
          reputations: [{ faction: { id: 529, name: 'Argent Dawn' }, standing: { name: 'Revered', value: 14000, max: 21000, tier: 6, raw: 35000 } }]
        });
      }
      return makeJsonResponse({}, 404);
    };

    const snap = await fetchCharacterArmorySnapshot('grimfang-black', TEST_ENV, { fetchImpl: mockFetch });
    assert.equal(snap.found, true);
    assert.equal(snap.media.avatar, null);
    assert.equal(snap.media.mainRaw, null);
    assert.equal(snap.discoveredStaticNamespace, 'static-1.60.1_70399-forever-us');
    assert.equal(snap.equipment.length, 1);
    assert.equal(snap.equipment[0].enchantments[0].display, 'Enchant Weapon - Crusader');
    assert.equal(snap.equipment[0].weapon.dps, '(53.9 damage per second)');
    assert.equal(snap.equipment[0].set.name, 'Battlegear of Might');
    assert.equal(snap.statistics.health, 6150);
    assert.equal(snap.specializations.primaryTree, 'Protection');
    assert.equal(snap.professions.primaries[0].knownRecipes[0].name, 'Lionheart Helm');
    assert.equal(snap.reputations[0].standing, 'Revered');
  });

  it('handles legacy static item 404 (~43% missing items) cleanly while preserving Wowhead link & icon', async () => {
    const mockFetch = async (url) => {
      if (url === 'https://oauth.battle.net/token') return makeJsonResponse({ access_token: 'tok', expires_in: 3600 });
      const u = new URL(url);
      if (u.pathname === '/data/wow/item/99999') return makeJsonResponse({ detail: 'Not found' }, 404);
      if (u.pathname === '/data/wow/media/item/99999') {
        return makeJsonResponse({ assets: [{ key: 'icon', value: 'https://render.worldofwarcraft.com/icons/56/inv_sword_04.jpg' }] });
      }
      if (u.pathname === '/data/wow/item/12640') {
        return makeJsonResponse({
          id: 12640,
          name: 'Lionheart Helm',
          quality: { type: 'EPIC', name: 'Epic' },
          level: 61,
          required_level: 56,
          item_class: { name: 'Armor' },
          item_subclass: { name: 'Plate' },
          preview_item: {
            armor: { value: 565, display: { display_string: '565 Armor' } },
            stats: [{ type: { type: 'STRENGTH' }, value: 18, display: { display_string: '+18 Strength' } }]
          }
        });
      }
      if (u.pathname === '/data/wow/media/item/12640') {
        return makeJsonResponse({ assets: [{ key: 'icon', value: 'https://render.worldofwarcraft.com/icons/56/inv_helmet_36.jpg' }] });
      }
      return makeJsonResponse({}, 404);
    };

    const legacy = await fetchForeverItemDetails(99999, TEST_ENV, {
      stateConfig: { staticNamespaceCache: FOREVER_DEFAULT_STATIC_NS },
      fetchImpl: mockFetch
    });
    assert.equal(legacy.found, false);
    assert.equal(legacy.notFoundInStatic, true);
    assert.equal(legacy.wowheadUrl, 'https://www.wowhead.com/forever/item=99999');
    assert.equal(legacy.iconUrl, 'https://render.worldofwarcraft.com/icons/56/inv_sword_04.jpg');

    const full = await fetchForeverItemDetails(12640, TEST_ENV, {
      stateConfig: { staticNamespaceCache: FOREVER_DEFAULT_STATIC_NS },
      fetchImpl: mockFetch
    });
    assert.equal(full.found, true);
    assert.equal(full.name, 'Lionheart Helm');
    assert.equal(full.quality, 'EPIC');
    assert.equal(full.armorDisplay, '565 Armor');
    assert.equal(full.stats[0].label, '+18 Strength');
  });
});

// ============================================================================
// 2. src/armory.js TESTS
// ============================================================================
describe('src/armory.js — Orchestration, Crafting Directory, Roster & AH Hydration', () => {
  beforeEach(() => {
    resetBlizzardCaches();
  });

  it('syncs character metadata onto wallets cleanly without storing gear blobs', () => {
    const state = {
      wallets: {
        u1: {
          discordId: 'u1',
          primaryCharacter: 'Grimfang',
          characters: [{ name: 'Grimfang', surname: '', class: 'Warrior', isPrimary: true }]
        },
        u2: {
          discordId: 'u2',
          primaryCharacter: 'Lyra',
          characters: [{ name: 'Lyra', surname: 'Ash', slug: 'lyra-ash', class: 'Priest', isPrimary: true }]
        }
      }
    };

    const snap = makeSampleCharacterSnapshot();
    const changed = applyCharacterSummaryToWallets(state, snap);
    assert.equal(changed, true);

    const ch = state.wallets.u1.characters[0];
    assert.equal(ch.surname, 'Black');
    assert.equal(ch.slug, 'grimfang-black');
    assert.equal(ch.armoryVerified, true);
    assert.equal(ch.level, 60);
    assert.equal(ch.avgItemLevel, 76.5);
    assert.equal(ch.professions, 'Blacksmithing 300');
    assert.equal('equipment' in ch, false);
    // Unmatched user untouched
    assert.equal(state.wallets.u2.characters[0].armoryVerified, undefined);
  });

  it('merges crafting directory and removes stale recipes & prunes empty keys on re-sync', async () => {
    const firestore = createMemoryFirestore();
    const state = {
      wallets: {
        u1: { discordId: 'u1', serverNickname: 'Grimfang', characters: [{ name: 'Grimfang', surname: 'Black', slug: 'grimfang-black' }] },
        u2: { discordId: 'u2', serverNickname: 'Lyra', characters: [{ name: 'Lyra', surname: 'Ash', slug: 'lyra-ash' }] }
      }
    };

    const grimSnap1 = makeSampleCharacterSnapshot();
    await mergeCharacterIntoCraftingDirectory(grimSnap1, state, firestore);

    const lyraSnap = makeSampleCharacterSnapshot({
      slug: 'lyra-ash',
      name: 'Lyra',
      surname: 'Ash',
      displayName: 'Lyra Ash',
      className: 'Priest',
      professions: {
        primaries: [{
          id: 164,
          name: 'Blacksmithing',
          skillPoints: 300,
          maxSkillPoints: 300,
          knownRecipes: [{ id: 16667, name: 'Stronghold Gauntlets' }]
        }],
        secondaries: []
      }
    });
    await mergeCharacterIntoCraftingDirectory(lyraSnap, state, firestore);

    // Re-sync Grimfang WITHOUT Lionheart Helm (16729) OR Stronghold Gauntlets (16667), keeping only Titanic Leggings (22388)
    const grimSnap2 = makeSampleCharacterSnapshot({
      professions: {
        primaries: [{
          id: 164,
          name: 'Blacksmithing',
          skillPoints: 300,
          maxSkillPoints: 300,
          knownRecipes: [{ id: 22388, name: 'Titanic Leggings' }]
        }],
        secondaries: []
      }
    });
    const nextDoc = await mergeCharacterIntoCraftingDirectory(grimSnap2, state, firestore);

    // Lionheart Helm (16729) had no remaining crafters -> pruned completely
    assert.equal(nextDoc.recipes['16729'], undefined);
    // Stronghold Gauntlets (16667) still has Lyra Ash, but NOT Grimfang Black
    assert.deepEqual(nextDoc.recipes['16667'].cs, ['lyra-ash']);
    // Titanic Leggings (22388) belongs to Grimfang Black
    assert.deepEqual(nextDoc.recipes['22388'].cs, ['grimfang-black']);

    const expanded = expandCraftingDirectory(nextDoc);
    assert.equal(expanded.crafters.length, 2);
    assert.equal(expanded.recipes.length, 2);

    const filteredByQuery = await getGuildCraftingDirectory({ firestore, query: 'Stronghold' });
    assert.equal(filteredByQuery.recipes.length, 1);
    assert.equal(filteredByQuery.recipes[0].crafters[0].displayName, 'Lyra Ash');

    const filteredByProf = await getGuildCraftingDirectory({ firestore, profession: 'Alchemy' });
    assert.equal(filteredByProf.recipes.length, 0);
  });

  it('distinguishes exact, unique-first-name, and unlinked (ambiguous) guild roster matches', () => {
    const wallets = {
      u1: { discordId: 'u1', serverNickname: 'TankGrim', characters: [{ name: 'Grimfang', surname: 'Black', slug: 'grimfang-black' }] },
      u2: { discordId: 'u2', serverNickname: 'LegacyKael', characters: [{ name: 'Kael', surname: '' }] },
      u3: { discordId: 'u3', serverNickname: 'DuplicateZul', characters: [{ name: 'Zul', surname: '' }] },
      u4: { discordId: 'u4', serverNickname: 'AmbiguousBob', characters: [{ name: 'Bob', surname: '' }] },
      u5: { discordId: 'u5', serverNickname: 'AmbiguousBob2', characters: [{ name: 'Bob', surname: '' }] }
    };

    const rosterMembers = [
      { name: 'Grimfang', surname: 'Black', slug: 'grimfang-black', displayName: 'Grimfang Black', level: 60 },
      { name: 'Kael', surname: 'Dawn', slug: 'kael-dawn', displayName: 'Kael Dawn', level: 60 },
      // Two "Zul" entries in roster -> ambiguous, must stay unlinked
      { name: 'Zul', surname: 'One', slug: 'zul-one', displayName: 'Zul One', level: 45 },
      { name: 'Zul', surname: 'Two', slug: 'zul-two', displayName: 'Zul Two', level: 22 },
      // Two Discord wallets share first name "Bob" -> ambiguous, must stay unlinked
      { name: 'Bob', surname: 'Builder', slug: 'bob-builder', displayName: 'Bob Builder', level: 60 }
    ];

    const matched = matchRosterWithWallets(rosterMembers, wallets);
    assert.equal(matched.find(m => m.slug === 'grimfang-black').matchType, 'exact');
    assert.equal(matched.find(m => m.slug === 'kael-dawn').matchType, 'unique-first-name');
    assert.equal(matched.find(m => m.slug === 'kael-dawn').matchedDiscordId, 'u2');
    assert.equal(matched.find(m => m.slug === 'zul-one').matchType, 'unlinked');
    assert.equal(matched.find(m => m.slug === 'zul-two').matchType, 'unlinked');
    assert.equal(matched.find(m => m.slug === 'bob-builder').matchType, 'unlinked');
  });

  it('validates compact AH price tuples and hydrates item icons + AH pricing', async () => {
    const firestore = createMemoryFirestore();
    const ingestRes = await ingestCompactAuctionPrices({
      houseId: 110,
      rulesetId: 1,
      auctionCount: 412,
      prices: {
        '13510': [450000, 500000, 18],
        '13468': [900000, 0, 4],     // 0 median defaults to min
        'badKey': [100, 100, 1],     // non-numeric key rejected
        '19019': [0, 100, 1],        // min <= 0 rejected
        '12640': [5000, 5000, 0],    // qty <= 0 rejected
        '14555': [123]               // short tuple rejected
      }
    }, { firestore });

    assert.equal(ingestRes.success, true);
    assert.equal(ingestRes.distinctItemCount, 2);

    // Pre-cache item 13510 icon in Firestore; let item 13468 fetch live from Blizzard
    await firestore.saveCollectionDoc('armory_items', '13510', {
      id: 13510,
      name: 'Flask of the Titans',
      iconUrl: 'https://render.worldofwarcraft.com/icons/56/inv_potion_62.jpg'
    });

    const mockFetch = async (url) => {
      if (url === 'https://oauth.battle.net/token') return makeJsonResponse({ access_token: 'tok', expires_in: 3600 });
      if (url.includes('/data/wow/media/item/13468')) {
        return makeJsonResponse({ assets: [{ key: 'icon', value: 'https://render.worldofwarcraft.com/icons/56/inv_misc_herb_blacklotus.jpg' }] });
      }
      return makeJsonResponse({}, 404);
    };

    const items = [
      { id: 13510, name: 'Flask of the Titans', quality: 'COMMON', level: 55 },
      { id: 13468, name: 'Black Lotus', quality: 'UNCOMMON', level: 50 }
    ];

    await hydrateItemsMediaAndPrices(items, {
      env: TEST_ENV,
      firestore,
      stateConfig: { staticNamespaceCache: FOREVER_DEFAULT_STATIC_NS },
      houseId: 110,
      fetchImpl: mockFetch
    });

    assert.equal(items[0].iconUrl, 'https://render.worldofwarcraft.com/icons/56/inv_potion_62.jpg');
    assert.deepEqual(items[0].ahPrice, {
      min: 450000,
      median: 500000,
      qty: 18,
      houseId: 110,
      updatedAt: ingestRes.updatedAt
    });
    assert.equal(items[1].iconUrl, 'https://render.worldofwarcraft.com/icons/56/inv_misc_herb_blacklotus.jpg');
    assert.equal(items[1].ahPrice.median, 900000);

    // Verify batchSave saved item 13468 icon to Firestore
    const savedLotus = await firestore.getCollectionDoc('armory_items', '13468');
    assert.equal(savedLotus.iconUrl, 'https://render.worldofwarcraft.com/icons/56/inv_misc_herb_blacklotus.jpg');
  });

  it('autoMatchGuildRosterToWallets upgrades unique single-name legacy characters onto wallets', async () => {
    const firestore = createMemoryFirestore();
    const state = firestore.getDefaultBseState ? await firestore.getBseState() : { wallets: {} };
    state.wallets = {
      u1: { discordId: 'u1', serverNickname: 'Kael', characters: [{ name: 'Kael', surname: '', class: 'Mage', isPrimary: true }] }
    };

    const mockFetch = async (url) => {
      if (url === 'https://oauth.battle.net/token') return makeJsonResponse({ access_token: 'tok', expires_in: 3600 });
      if (url.includes('/data/wow/guild/black-sands/roster')) {
        return makeJsonResponse({
          guild: { id: 10, name: 'Black Sands', ruleset: { id: 1, name: 'PvP' } },
          members: [{
            rank: 1,
            character: { id: 77, name: 'Kael', surname: 'Sunfire', level: 60, playable_class: { id: 8, name: 'Mage' }, playable_race: { id: 1, name: 'Human' } }
          }]
        });
      }
      return makeJsonResponse({}, 404);
    };

    const res = await autoMatchGuildRosterToWallets({
      guildSlug: 'black-sands',
      env: TEST_ENV,
      firestore,
      state,
      fetchImpl: mockFetch
    });

    assert.equal(res.success, true);
    assert.equal(res.matchedCount, 1);
    assert.equal(state.wallets.u1.characters[0].surname, 'Sunfire');
    assert.equal(state.wallets.u1.characters[0].slug, 'kael-sunfire');
  });
});

// ============================================================================
// 3. scripts/sync-forever-ah.mjs TESTS
// ============================================================================
describe('scripts/sync-forever-ah.mjs — AH Dump Aggregation & Size Bound', () => {
  it('trims top 5% outliers when >= 10 lots, computes qty-weighted median, and skips bid-only auctions', () => {
    // Construct 20 lots for item 13510:
    // 15 lots of qty 1 @ 10,000c
    // 4 lots of qty 1 @ 15,000c
    // 1 extreme outlier lot of qty 500 @ 999,990,000c (Top 5% = 1 lot trimmed!)
    const lots = [];
    for (let i = 0; i < 15; i++) lots.push({ item: { id: 13510 }, buyout: 10000, quantity: 1 });
    for (let i = 0; i < 4; i++) lots.push({ item: { id: 13510 }, buyout: 15000, quantity: 1 });
    lots.push({ item: { id: 13510 }, unit_price: 999990000, quantity: 500 });

    // Quantity-weighted median verification item 20001 (10 lots: 9 lots of qty 1 @ 100c, 1 lot of qty 100 @ 500c -> no outlier needed: add 1 @ 600c)
    // Total 11 lots -> trims 1 lot (floor(11*0.05)=max(1,0)=1) -> drops 600c, leaving 9x qty1@100 + 1x qty100@500 -> weighted median = 500c (vs naive unweighted = 100c!)
    for (let i = 0; i < 9; i++) lots.push({ item: { id: 20001 }, unit_price: 100, quantity: 1 });
    lots.push({ item: { id: 20001 }, unit_price: 500, quantity: 100 });
    lots.push({ item: { id: 20001 }, unit_price: 600, quantity: 1 });

    // Bid-only item 20002 (no buyout / unit_price)
    lots.push({ item: { id: 20002 }, bid: 5000, buyout: 0, quantity: 1 });

    const { payload, stats } = aggregateAuctionHouseDump(
      { auctions: lots },
      { auctions: [{ item: { id: 13468 }, unit_price: 85000, quantity: 2 }] },
      { houseId: 110, rulesetId: 1 }
    );

    assert.equal(stats.auctionCount, lots.length + 1);
    assert.deepEqual(payload.prices['13510'], [10000, 10000, 519]);
    // Unweighted median would be 100, qty-weighted median is 500
    assert.deepEqual(payload.prices['20001'], [100, 500, 110]);
    // Bid-only omitted from price map
    assert.equal(payload.prices['20002'], undefined);
    // Commodity included
    assert.deepEqual(payload.prices['13468'], [85000, 85000, 2]);
  });

  it('truncates cleanly below maxPayloadBytes prioritizing priorityIds first then highest totalQty', () => {
    const auctions = [];
    // Add 30 non-priority items with varying quantities
    for (let i = 0; i < 30; i++) {
      auctions.push({ item: { id: 50000 + i }, unit_price: 1000 + i, quantity: 10 + i });
    }
    // High-volume non-priority item (qty 9999)
    auctions.push({ item: { id: 60000 }, unit_price: 2000, quantity: 9999 });
    // Watchlist priority item even with qty 1
    auctions.push({ item: { id: 13510 }, unit_price: 450000, quantity: 1 });

    const { payload, stats } = aggregateAuctionHouseDump(
      { auctions },
      null,
      { maxPayloadBytes: 240 }
    );

    assert.equal(stats.trimmedToFit, true);
    assert.ok(stats.payloadBytes <= 240);
    // Priority watchlist item #13510 must survive binary-search truncation
    assert.ok(payload.prices['13510']);
    // Highest-volume non-priority #60000 should rank ahead of small-volume filler items
    assert.ok(payload.prices['60000']);
    assert.ok(stats.distinctIncluded < stats.distinctBeforeTrim);
  });
});

// ============================================================================
// 4. src/commands.js & src/discord.js TESTS
// ============================================================================
describe('src/commands.js & src/discord.js — /armory, /item & Embeds', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    resetBlizzardCaches();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('handles /armory Name-Surname, wallet surname fallback, and missing-surname guidance', async () => {
    const snap = makeSampleCharacterSnapshot();
    const firestore = createMemoryFirestore();
    await firestore.saveCollectionDoc('armory_characters', 'grimfang-black', snap);
    // Pre-cache equipped item icons cleanly so cached character lookup avoids Blizzard OAuth calls
    await firestore.batchSaveCollectionDocs('armory_items', [
      ['19019', { id: 19019, name: 'Thunderfury, Blessed Blade of the Windseeker', iconUrl: 'https://render.worldofwarcraft.com/icons/56/inv_sword_39.jpg' }],
      ['12640', { id: 12640, name: 'Lionheart Helm', iconUrl: 'https://render.worldofwarcraft.com/icons/56/inv_helmet_36.jpg' }]
    ]);

    const state = await firestore.getBseState();
    state.wallets = {
      user_grim: {
        discordId: 'user_grim',
        username: 'grim',
        primaryCharacter: 'Grimfang',
        characters: [{ name: 'Grimfang', surname: 'Black', slug: 'grimfang-black', isPrimary: true }]
      },
      user_nosur: {
        discordId: 'user_nosur',
        username: 'nosur',
        primaryCharacter: 'Legacyorc',
        characters: [{ name: 'Legacyorc', surname: '', isPrimary: true }]
      }
    };
    await firestore.saveBseState(state);

    // 1. Explicit Name-Surname
    const res1 = await handleApplicationCommand({
      data: { name: 'armory', options: [{ name: 'character', value: 'Grimfang-Black' }] },
      member: { user: { id: 'viewer1', username: 'viewer1' } }
    }, TEST_ENV, firestore);
    assert.equal(res1.data.embeds.length, 1);
    assert.equal(res1.data.embeds[0].color, ClassicClassColors.Warrior);
    assert.match(res1.data.embeds[0].title, /Grimfang Black/);
    assert.match(res1.data.embeds[0].description, /<@user_grim>/);

    // 2. Single name matching wallet character surname
    const res2 = await handleApplicationCommand({
      data: { name: 'armory', options: [{ name: 'character', value: 'Grimfang' }] },
      member: { user: { id: 'viewer1', username: 'viewer1' } }
    }, TEST_ENV, firestore);
    assert.match(res2.data.embeds[0].title, /Grimfang Black/);

    // 3. /armory user:<id> lacking surname -> helpful ephemeral prompt
    const res3 = await handleApplicationCommand({
      data: { name: 'armory', options: [{ name: 'user', value: 'user_nosur' }] },
      member: { user: { id: 'viewer1', username: 'viewer1' } }
    }, TEST_ENV, firestore);
    assert.equal(res3.data.flags, 64);
    assert.match(res3.data.content, /without a \*\*Surname\*\*/);
  });

  it('handles /item numeric ID, live search + AH/Crafter embed, and crafting directory fallback on 0 Blizzard hits', async () => {
    const firestore = createMemoryFirestore();
    await ingestCompactAuctionPrices({
      houseId: 110,
      rulesetId: 1,
      auctionCount: 50,
      prices: { '13510': [420509, 480000, 14] }
    }, { firestore });

    // Seed Lionheart Helm into Guild Crafting Directory so fallback triggers cleanly
    const state = await firestore.getBseState();
    state.wallets = { u1: { discordId: 'u1', serverNickname: 'Grim', characters: [{ name: 'Grimfang', surname: 'Black', slug: 'grimfang-black' }] } };
    await firestore.saveBseState(state);
    await mergeCharacterIntoCraftingDirectory(makeSampleCharacterSnapshot(), state, firestore);

    globalThis.fetch = async (url) => {
      if (url === 'https://oauth.battle.net/token') return makeJsonResponse({ access_token: 'tok', expires_in: 3600 });
      const u = new URL(url);
      if (u.pathname === '/data/wow/item/13510') {
        return makeJsonResponse({
          id: 13510,
          name: 'Flask of the Titans',
          quality: { type: 'COMMON', name: 'Common' },
          level: 55,
          required_level: 50,
          sell_price: 2500,
          preview_item: {
            spells: [{ description: 'Use: Increases maximum health by 1200 for 2 hrs.' }]
          }
        });
      }
      if (u.pathname === '/data/wow/media/item/13510') {
        return makeJsonResponse({ assets: [{ key: 'icon', value: 'https://render.worldofwarcraft.com/icons/56/inv_potion_62.jpg' }] });
      }
      if (u.pathname === '/data/wow/search/item') {
        // Return 0 results for everything in search to test Crafter fallback
        return makeJsonResponse({ results: [] });
      }
      return makeJsonResponse({}, 404);
    };

    // 1. Numeric ID query -> full Item embed with AH coins + sell value
    const resNum = await handleApplicationCommand({
      data: { name: 'item', options: [{ name: 'query', value: '13510' }] },
      member: { user: { id: 'viewer1', username: 'viewer1' } }
    }, TEST_ENV, firestore);
    const emb = resNum.data.embeds[0];
    assert.match(emb.title, /Flask of the Titans/);
    assert.equal(emb.color, QualityColors.COMMON);
    const ahField = emb.fields.find(f => f.name.includes('Auction House'));
    assert.ok(ahField);
    assert.match(ahField.value, /42g 5s 9c/);

    // 2. Text query returning 0 Blizzard hits -> falls back to Guild Crafting Directory!
    const resCraftFallback = await handleApplicationCommand({
      data: { name: 'item', options: [{ name: 'query', value: 'Lionheart' }] },
      member: { user: { id: 'viewer1', username: 'viewer1' } }
    }, TEST_ENV, firestore);
    assert.equal(resCraftFallback.data.embeds.length, 1);
    assert.match(resCraftFallback.data.embeds[0].title, /Guild Crafter Matches/);
    assert.match(resCraftFallback.data.embeds[0].description, /Lionheart Helm/);
    assert.match(resCraftFallback.data.embeds[0].description, /Grimfang Black/);
  });

  it('formats copper coins and character/item embeds cleanly', () => {
    assert.equal(formatCopperCoins(0), '0c');
    assert.equal(formatCopperCoins(45), '45c');
    assert.equal(formatCopperCoins(1234), '12s 34c');
    assert.equal(formatCopperCoins(123456), '12g 34s 56c');

    const missChar = buildArmoryCharacterEmbed({ found: false, slug: 'lowbie-alt' });
    assert.match(missChar.description, /Level 10\+/);

    const itemEmb = buildArmoryItemEmbed(
      { id: 19019, name: 'Thunderfury', quality: 'LEGENDARY', notFoundInStatic: true, wowheadUrl: 'https://www.wowhead.com/forever/item=19019' },
      [],
      []
    );
    assert.equal(itemEmb.color, QualityColors.LEGENDARY);
    assert.match(itemEmb.description, /Wowhead Forever/);
  });
});

// ============================================================================
// 5. worker.js HTTP ROUTE & SECURITY INTEGRATION TESTS
// ============================================================================
describe('worker.js — Armory API Routes, Auth & Zero Secret Exposure', () => {
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

        // Default GET
        if (!docs.has(rel)) return makeJsonResponse({ error: { code: 404 } }, 404);
        return makeJsonResponse({ name: `${fsClient.docPathPrefix}/${rel}`, ...toFirestoreFields(docs.get(rel)) });
      }
      return makeJsonResponse({}, 404);
    };

    return docs;
  }

  it('POST /api/exchange/armory/ah-ingest requires ingest secret or Officer cookie and validates payload', async () => {
    const docs = installFirestoreFetchMock();
    const payload = {
      houseId: 110,
      rulesetId: 1,
      auctionCount: 95,
      prices: { '13510': [400000, 450000, 12] }
    };

    // 1. Unauthenticated -> 401
    const unauth = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/armory/ah-ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(unauth.status, 401);

    // 2. Invalid secret -> 401
    const badSecret = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/armory/ah-ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Armory-Ingest-Secret': 'wrong' },
        body: JSON.stringify(payload)
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(badSecret.status, 401);

    // 3. Valid X-Armory-Ingest-Secret -> 200 & persisted to Firestore
    const okSecret = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/armory/ah-ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Armory-Ingest-Secret': TEST_ENV.ARMORY_INGEST_SECRET },
        body: JSON.stringify(payload)
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(okSecret.status, 200);
    const json1 = await okSecret.json();
    assert.equal(json1.distinctItemCount, 1);
    assert.deepEqual(docs.get('armory_ah_prices/house_110').prices['13510'], [400000, 450000, 12]);

    // 4. Valid Authorization: Bearer <secret> -> 200
    const okBearer = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/armory/ah-ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TEST_ENV.ARMORY_INGEST_SECRET}` },
        body: JSON.stringify(payload)
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(okBearer.status, 200);

    // 5. Valid Officer session cookie -> 200
    const officerCookie = signTestSession({ id: 'off1', username: 'officer', isOfficer: true, issuedAt: Date.now() });
    const okOfficer = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/armory/ah-ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: JSON.stringify(payload)
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(okOfficer.status, 200);
  });

  it('POST /api/exchange/armory/config enforces Officer session (403 non-officer, 200 officer)', async () => {
    const docs = installFirestoreFetchMock();
    const memberCookie = signTestSession({ id: 'm1', username: 'mem', isOfficer: false, issuedAt: Date.now() });
    const officerCookie = signTestSession({ id: 'o1', username: 'off', isOfficer: true, issuedAt: Date.now() });

    const reqBody = JSON.stringify({
      guildSlug: 'https://worldofwarcraft.blizzard.com/en-us/forever/us/armory/guild/Desert%20Raiders',
      guildRulesetId: 15,
      defaultAuctionHouseId: 119,
      autoSyncGuildRoster: false
    });

    // Unauthenticated -> 403
    const rUnauth = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/armory/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: reqBody
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(rUnauth.status, 403);

    // Non-officer member -> 403
    const rMember = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/armory/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': memberCookie },
        body: reqBody
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(rMember.status, 403);

    // Officer -> 200 and normalized guildSlug saved in bse_state
    const rOfficer = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/armory/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': officerCookie },
        body: reqBody
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(rOfficer.status, 200);
    const out = await rOfficer.json();
    assert.equal(out.armory.guildSlug, 'desert-raiders');
    assert.equal(out.armory.guildRulesetId, 15);
    assert.equal(out.armory.defaultAuctionHouseId, 119);
    assert.equal(out.armory.autoSyncGuildRoster, false);
    assert.equal(docs.get('exchange/bse_state').config.armory.guildSlug, 'desert-raiders');
  });

  it('GET /api/exchange/armory/status returns booleans only and never exposes Worker secrets', async () => {
    installFirestoreFetchMock();

    const res = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/armory/status'),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(res.status, 200);
    const rawText = await res.text();
    const parsed = JSON.parse(rawText);

    assert.equal(parsed.configured, true);
    assert.equal(parsed.ingestConfigured, true);
    assert.equal(typeof parsed.armory.guildSlug, 'string');

    assert.equal(rawText.includes(TEST_ENV.BLIZZARD_CLIENT_ID), false);
    assert.equal(rawText.includes(TEST_ENV.BLIZZARD_CLIENT_SECRET), false);
    assert.equal(rawText.includes(TEST_ENV.ARMORY_INGEST_SECRET), false);
    assert.equal(rawText.includes(TEST_ENV.SESSION_SECRET), false);
  });

  it('POST /api/exchange/characters preserves surname, slug, and verified metadata on member wallet', async () => {
    const docs = installFirestoreFetchMock();
    const memberCookie = signTestSession({ id: 'm1', username: 'mem', isOfficer: false, issuedAt: Date.now() });

    // Unauthenticated -> 401
    const unauth = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characters: [] })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );
    assert.equal(unauth.status, 401);

    const saveRes = await worker.fetch(
      new Request('https://bse.teasy2ez.win/api/exchange/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': memberCookie },
        body: JSON.stringify({
          characters: [
            {
              name: 'Grimfang',
              surname: 'Black',
              class: 'Warrior',
              role: 'Tank',
              ruleset: 'PvP',
              race: 'Orc',
              level: 60,
              avgItemLevel: 76.5,
              armoryVerified: true,
              lastArmorySyncAt: '2026-11-18T12:00:00.000Z',
              isPrimary: true
            },
            {
              name: 'Lyra-Dawn',
              class: 'Priest',
              role: 'Healer',
              isPrimary: false
            }
          ],
          guildNote: 'Main Tank & BS 300'
        })
      }),
      TEST_ENV,
      { waitUntil: () => {} }
    );

    assert.equal(saveRes.status, 200);
    const body = await saveRes.json();
    assert.equal(body.characters.length, 2);
    assert.equal(body.characters[0].slug, 'grimfang-black');
    assert.equal(body.characters[0].surname, 'Black');
    assert.equal(body.characters[0].armoryVerified, true);
    assert.equal(body.characters[1].name, 'Lyra');
    assert.equal(body.characters[1].surname, 'Dawn');
    assert.equal(body.characters[1].slug, 'lyra-dawn');
    assert.equal(docs.get('exchange/bse_state').wallets.m1.guildNote, 'Main Tank & BS 300');
  });

  it('enforces 5-min forceRefresh cooldown, negative caching, and cron 2-char cap per tick', async () => {
    const firestore = createMemoryFirestore();
    const state = await firestore.getBseState();
    const oldTs = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    state.wallets = {
      u1: {
        discordId: 'u1',
        characters: [
          { name: 'Charone', surname: 'Alpha', slug: 'charone-alpha', lastArmorySyncAt: oldTs },
          { name: 'Chartwo', surname: 'Beta', slug: 'chartwo-beta', lastArmorySyncAt: oldTs },
          { name: 'Charthree', surname: 'Gamma', slug: 'charthree-gamma', lastArmorySyncAt: oldTs }
        ]
      }
    };
    await firestore.saveBseState(state);

    // Seed recent doc (10 seconds ago) for cooldown check + negative stub
    await firestore.saveCollectionDoc('armory_characters', 'recent-guy', makeSampleCharacterSnapshot({
      slug: 'recent-guy',
      name: 'Recent',
      surname: 'Guy',
      equipment: [],
      syncedAt: new Date(Date.now() - 10_000).toISOString()
    }));
    await firestore.saveCollectionDoc('armory_characters', 'under-ten', {
      found: false,
      slug: 'under-ten',
      reason: 'NOT_FOUND_OR_UNDER_10',
      negativeUntil: Date.now() + 600_000
    });

    let liveCharFetches = 0;
    const mockFetch = async (url) => {
      if (url === 'https://oauth.battle.net/token') return makeJsonResponse({ access_token: 'tok', expires_in: 3600 });
      const u = new URL(url);
      if (u.pathname.startsWith('/data/wow/guild/')) {
        return makeJsonResponse({ guild: { id: 1, name: 'Black Sands' }, members: [] });
      }
      if (/^\/profile\/wow\/character\/[^/]+$/.test(u.pathname)) {
        liveCharFetches++;
        const slug = u.pathname.split('/').pop();
        return makeJsonResponse({
          name: slug.split('-')[0],
          surname: slug.split('-')[1],
          level: 60,
          race: { id: 1, name: 'Human' },
          character_class: { id: 1, name: 'Warrior' }
        });
      }
      return makeJsonResponse({}, 404);
    };

    const cdRes = await getCharacterArmory({ slug: 'recent-guy', forceRefresh: true, env: TEST_ENV, firestore, state, fetchImpl: mockFetch });
    assert.equal(cdRes.source, 'firestore-cooldown');
    assert.equal(liveCharFetches, 0);

    const negRes = await getCharacterArmory({ slug: 'under-ten', forceRefresh: false, env: TEST_ENV, firestore, state, fetchImpl: mockFetch });
    assert.equal(negRes.source, 'firestore-negative-cache');
    assert.equal(negRes.found, false);
    assert.equal(liveCharFetches, 0);

    const tick = await runScheduledArmoryTick(TEST_ENV, firestore, { state, fetchImpl: mockFetch });
    assert.equal(tick.rosterRefreshed, true);
    assert.equal(tick.charactersRefreshed, 2);
    assert.equal(liveCharFetches, 2);
  });
});
