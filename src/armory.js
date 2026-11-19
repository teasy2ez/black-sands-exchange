/**
 * Black Sands Exchange — Armory & Item Database Orchestration Layer
 *
 * Bridges Battle.net WoW: Forever US endpoints (`src/blizzard.js`) with
 * partitioned Firestore collections (`armory_characters`, `armory_items`,
 * `armory_guild`, `armory_crafting`, `armory_ah_prices`) and Cloudflare
 * Edge Cache (`caches.default`) while keeping `exchange/bse_state` lean.
 */

import {
  BlizzardApiError,
  isBlizzardConfigured,
  buildCharacterSlug,
  parseCharacterIdentity,
  normalizeGuildSlug,
  fetchCharacterArmorySnapshot,
  fetchForeverGuildRoster,
  fetchForeverItemDetails,
  fetchItemMediaIcon,
  searchForeverItems,
  fetchRulesetsAndHouses,
  buildWowheadForeverItemUrl
} from './blizzard.js';

export const DEFAULT_ARMORY_CONFIG = {
  enabled: true,
  region: 'us',
  edition: 'forever',
  guildSlug: 'black-sands',
  guildRulesetId: 1,
  defaultAuctionHouseId: 110,
  autoSyncGuildRoster: true,
  staticNamespaceCache: 'static-1.60.1_70399-forever-us'
};

// Popular Classic / WoW: Forever consumables & trade goods surfaced automatically on AH Watch
export const FOREVER_AH_WATCHLIST_IDS = [
  13510, // Flask of the Titans
  13512, // Flask of Supreme Power
  13511, // Flask of Distilled Wisdom
  13452, // Elixir of the Mongoose
  13454, // Greater Arcane Elixir
  13457, // Greater Fire Protection Potion
  13458, // Greater Nature Protection Potion
  13459, // Greater Shadow Protection Potion
  13444, // Major Mana Potion
  13446, // Major Healing Potion
  13468, // Black Lotus
  13466, // Plaguebloom
  13467, // Icecap
  13465, // Mountain Silversage
  13463, // Dreamfoil
  12363, // Arcane Crystal
  12360, // Arcanite Bar
  12811, // Righteous Orb
  14344, // Large Brilliant Shard
  16203  // Greater Eternal Essence
];

// Curated raid/crafting item presets when opening Database with no query
export const FEATURED_FOREVER_ITEMS = [
  { id: 19019, name: 'Thunderfury, Blessed Blade of the Windseeker', quality: 'LEGENDARY', category: 'Raid Legendaries' },
  { id: 17182, name: 'Sulfuras, Hand of Ragnaros', quality: 'LEGENDARY', category: 'Raid Legendaries' },
  { id: 19364, name: "Ashkandi, Greatsword of the Brotherhood", quality: 'EPIC', category: 'Raid Weapons' },
  { id: 19379, name: "Neltharion's Tear", quality: 'EPIC', category: 'Raid Trinkets' },
  { id: 19406, name: 'Drake Fang Talisman', quality: 'EPIC', category: 'Raid Trinkets' },
  { id: 18820, name: 'Talisman of Ephemeral Power', quality: 'EPIC', category: 'Raid Trinkets' },
  { id: 12640, name: 'Lionheart Helm', quality: 'EPIC', category: 'Crafted BiS' },
  { id: 14555, name: 'Alcor\'s Sunrazor', quality: 'EPIC', category: 'BoE Epics' },
  { id: 13510, name: 'Flask of the Titans', quality: 'COMMON', category: 'Consumables' },
  { id: 13512, name: 'Flask of Supreme Power', quality: 'COMMON', category: 'Consumables' },
  { id: 13452, name: 'Elixir of the Mongoose', quality: 'COMMON', category: 'Consumables' },
  { id: 13468, name: 'Black Lotus', quality: 'COMMON', category: 'Trade Goods' }
];

const CHAR_CACHE_TTL_MS = 6 * 3600 * 1000;      // 6 hours
const CHAR_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;  // 5 min manual refresh guard
const CHAR_NEGATIVE_TTL_MS = 15 * 60 * 1000;     // 15 min negative cache for <Lv10 404s
const ITEM_CACHE_TTL_MS = 7 * 86400 * 1000;      // 7 days for valid items
const ITEM_NEGATIVE_TTL_MS = 24 * 3600 * 1000;   // 24h for 404 legacy items
const ROSTER_CACHE_TTL_MS = 45 * 60 * 1000;      // 45 min guild roster TTL

export function resolveArmoryConfig(stateOrConfig) {
  const raw = stateOrConfig?.config?.armory || stateOrConfig?.armory || stateOrConfig || {};
  return {
    enabled: raw.enabled !== false,
    region: 'us',
    edition: 'forever',
    guildSlug: normalizeGuildSlug(raw.guildSlug || DEFAULT_ARMORY_CONFIG.guildSlug) || DEFAULT_ARMORY_CONFIG.guildSlug,
    guildRulesetId: Number(raw.guildRulesetId) || DEFAULT_ARMORY_CONFIG.guildRulesetId,
    defaultAuctionHouseId: Number(raw.defaultAuctionHouseId) || DEFAULT_ARMORY_CONFIG.defaultAuctionHouseId,
    autoSyncGuildRoster: raw.autoSyncGuildRoster !== false,
    staticNamespaceCache: String(raw.staticNamespaceCache || DEFAULT_ARMORY_CONFIG.staticNamespaceCache)
  };
}

/**
 * Cloudflare Cache API wrapper (gracefully no-ops in Node / non-CF environments)
 */
async function readEdgeCache(cacheKey) {
  try {
    if (typeof caches === 'undefined' || !caches?.default) return null;
    const req = new Request(`https://bse-armory-cache.internal/${cacheKey}`);
    const hit = await caches.default.match(req);
    if (!hit) return null;
    return await hit.json();
  } catch {
    return null;
  }
}

async function writeEdgeCache(cacheKey, data, maxAgeSec = 1800) {
  try {
    if (typeof caches === 'undefined' || !caches?.default) return;
    const req = new Request(`https://bse-armory-cache.internal/${cacheKey}`);
    const res = new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${maxAgeSec}`
      }
    });
    await caches.default.put(req, res);
  } catch {
    // Non-fatal in tests / environments without Cache API
  }
}

async function deleteEdgeCache(cacheKey) {
  try {
    if (typeof caches === 'undefined' || !caches?.default) return;
    const req = new Request(`https://bse-armory-cache.internal/${cacheKey}`);
    await caches.default.delete(req);
  } catch {
    // Ignore
  }
}

/**
 * Hydrate missing item icons for character equipment or search items using
 * 1 batch Firestore read + bounded Blizzard /media/item fetches + 1 batch Firestore commit.
 */
export async function hydrateItemsMediaAndPrices(items = [], { env, firestore, stateConfig = null, houseId = 110, maxLiveFetches = 12, fetchImpl = fetch } = {}) {
  if (!Array.isArray(items) || !items.length) return items;

  const ids = [...new Set(items.map(it => Number(it.id)).filter(id => id > 0))];
  if (!ids.length) return items;

  const docIds = ids.map(id => String(id));
  const [cachedDocs, ahDoc] = await Promise.all([
    firestore ? firestore.batchGetCollectionDocs('armory_items', docIds) : Promise.resolve({}),
    getCachedAhPricesDoc(houseId, { firestore }).catch(() => null)
  ]);

  const missingMediaIds = [];
  for (const item of items) {
    const idStr = String(item.id);
    const cached = cachedDocs?.[idStr];
    if (cached?.iconUrl) {
      item.iconUrl = cached.iconUrl;
    } else if (!item.iconUrl && !(cached?.notFoundInStatic && cached?.mediaChecked)) {
      missingMediaIds.push(Number(item.id));
    }

    const priceTuple = ahDoc?.prices?.[idStr];
    if (Array.isArray(priceTuple) && priceTuple.length >= 3) {
      item.ahPrice = {
        min: Number(priceTuple[0]) || 0,
        median: Number(priceTuple[1]) || 0,
        qty: Number(priceTuple[2]) || 0,
        houseId: ahDoc.houseId || houseId,
        updatedAt: ahDoc.updatedAt || null
      };
    }
  }

  // Fetch limited missing icons from Blizzard Item Media API cleanly within subrequest budgets
  const toFetch = [...new Set(missingMediaIds)].slice(0, maxLiveFetches);
  if (toFetch.length > 0 && isBlizzardConfigured(env)) {
    const settled = await Promise.allSettled(
      toFetch.map(id => fetchItemMediaIcon(id, env, { stateConfig, fetchImpl }).then(url => ({ id, url })))
    );

    const newItemDocs = [];
    const nowIso = new Date().toISOString();
    for (let i = 0; i < settled.length; i++) {
      if (settled[i].status !== 'fulfilled') continue;
      const { id, url } = settled[i].value;
      const matching = items.filter(it => Number(it.id) === id);
      const sample = matching[0] || {};
      matching.forEach(it => {
        if (url) it.iconUrl = url;
      });

      const existing = cachedDocs?.[String(id)] || {};
      newItemDocs.push([
        String(id),
        {
          ...existing,
          id,
          name: existing.name || sample.name || `Item #${id}`,
          quality: existing.quality || sample.quality || 'COMMON',
          level: existing.level || sample.level || 0,
          iconUrl: url || existing.iconUrl || null,
          mediaChecked: true,
          wowheadUrl: buildWowheadForeverItemUrl(id),
          syncedAt: nowIso
        }
      ]);
    }

    if (newItemDocs.length > 0 && firestore) {
      await firestore.batchSaveCollectionDocs('armory_items', newItemDocs).catch(err => {
        console.warn('Non-fatal batchSave armory_items icons warning:', err.message);
      });
    }
  }

  return items;
}

/**
 * Sync lightweight character verification metadata onto any matching wallet inside bse_state
 * without ever saving bloated gear/recipe blobs inside bse_state.
 */
export function applyCharacterSummaryToWallets(state, snapshot) {
  if (!state?.wallets || !snapshot?.found || !snapshot.slug) return false;

  let changed = false;
  const targetSlug = snapshot.slug.toLowerCase();
  const targetFirst = String(snapshot.name || '').trim().toLowerCase();

  for (const wallet of Object.values(state.wallets)) {
    if (!Array.isArray(wallet.characters)) continue;
    for (const ch of wallet.characters) {
      const chSlug = buildCharacterSlug(ch.name, ch.surname || '');
      const exactSlug = chSlug && chSlug === targetSlug;
      const legacyFirstMatch = !ch.surname && String(ch.name || '').trim().toLowerCase() === targetFirst;
      if (!exactSlug && !legacyFirstMatch) continue;

      ch.name = snapshot.name || ch.name;
      ch.surname = snapshot.surname || ch.surname || '';
      ch.slug = snapshot.slug;
      ch.class = snapshot.className || ch.class;
      ch.race = snapshot.race || ch.race || '';
      ch.level = snapshot.level || ch.level || null;
      ch.avgItemLevel = snapshot.avgItemLevel || ch.avgItemLevel || null;
      ch.guildName = snapshot.guild?.name || ch.guildName || '';
      ch.armoryVerified = true;
      ch.lastArmorySyncAt = snapshot.syncedAt || new Date().toISOString();
      if (snapshot.media?.avatar) {
        ch.avatarThumbUrl = snapshot.media.avatar;
      }
      if (snapshot.professions?.allSummary) {
        ch.professions = snapshot.professions.allSummary;
      }
      if (ch.isPrimary) {
        wallet.primaryCharacter = snapshot.name;
      }
      changed = true;
    }
  }
  return changed;
}

/**
 * Incrementally merge a character's synced professions & known recipes into `armory_crafting/directory`.
 * Uses ultra-compact storage schema so all guild recipes comfortably stay < 350 KB inside one Firestore doc.
 */
export async function mergeCharacterIntoCraftingDirectory(snapshot, state, firestore) {
  if (!snapshot?.found || !snapshot.slug || !firestore) return null;

  const primaries = snapshot.professions?.primaries || [];
  const secondaries = snapshot.professions?.secondaries || [];
  const allProfs = [...primaries, ...secondaries];
  if (!allProfs.length) return null;

  // Find matching Discord owner if linked
  let ownerDiscordId = null;
  let ownerDiscordName = null;
  for (const w of Object.values(state?.wallets || {})) {
    const hasMatch = (w.characters || []).some(c => {
      const cSlug = c.slug || buildCharacterSlug(c.name, c.surname || '');
      return cSlug === snapshot.slug || (!c.surname && String(c.name || '').toLowerCase() === String(snapshot.name || '').toLowerCase());
    });
    if (hasMatch) {
      ownerDiscordId = w.discordId;
      ownerDiscordName = w.serverNickname || w.globalName || w.username || 'Guild Member';
      break;
    }
  }

  const existingDoc = (await firestore.getCollectionDoc('armory_crafting', 'directory')) || {
    updatedAt: new Date().toISOString(),
    crafters: {},
    recipes: {}
  };

  const crafters = existingDoc.crafters && typeof existingDoc.crafters === 'object' ? { ...existingDoc.crafters } : {};
  const recipes = existingDoc.recipes && typeof existingDoc.recipes === 'object' ? { ...existingDoc.recipes } : {};

  // Update crafter entry
  crafters[snapshot.slug] = {
    s: snapshot.slug,
    dn: snapshot.displayName || snapshot.name,
    cl: snapshot.className || 'Warrior',
    lv: snapshot.level || 0,
    did: ownerDiscordId || '',
    dnm: ownerDiscordName || '',
    p: allProfs.map(pr => ({
      n: pr.name,
      sk: pr.skillPoints || 0,
      mx: pr.maxSkillPoints || 300,
      pri: primaries.some(x => x.name === pr.name),
      rc: (pr.knownRecipes || []).length
    })),
    at: snapshot.syncedAt || new Date().toISOString()
  };

  // Remove stale recipe memberships for this character first
  for (const [rKey, rObj] of Object.entries(recipes)) {
    if (!Array.isArray(rObj?.cs)) continue;
    rObj.cs = rObj.cs.filter(slug => slug !== snapshot.slug);
    if (rObj.cs.length === 0) {
      delete recipes[rKey];
    }
  }

  // Insert current known recipes
  for (const prof of allProfs) {
    if (!Array.isArray(prof.knownRecipes)) continue;
    for (const rec of prof.knownRecipes) {
      const key = String(rec.id);
      if (!recipes[key]) {
        recipes[key] = {
          id: rec.id,
          n: rec.name,
          p: prof.name,
          cs: [snapshot.slug]
        };
      } else {
        if (!Array.isArray(recipes[key].cs)) recipes[key].cs = [];
        if (!recipes[key].cs.includes(snapshot.slug)) {
          recipes[key].cs.push(snapshot.slug);
        }
      }
    }
  }

  const nextDoc = {
    updatedAt: new Date().toISOString(),
    crafters,
    recipes
  };

  await firestore.saveCollectionDoc('armory_crafting', 'directory', nextDoc);
  await deleteEdgeCache('crafting_directory');
  return nextDoc;
}

/**
 * Expand compact `armory_crafting/directory` document into frontend-ready JSON
 */
export function expandCraftingDirectory(doc) {
  if (!doc) {
    return { updatedAt: null, crafters: [], recipes: [], professions: [] };
  }

  const craftersMap = doc.crafters || {};
  const recipesMap = doc.recipes || {};

  const crafters = Object.values(craftersMap).map(c => ({
    slug: c.s,
    displayName: c.dn,
    className: c.cl || 'Warrior',
    level: c.lv || 0,
    discordId: c.did || null,
    discordName: c.dnm || null,
    professions: (c.p || []).map(pr => ({
      name: pr.n,
      skill: pr.sk || 0,
      maxSkill: pr.mx || 300,
      isPrimary: Boolean(pr.pri),
      recipeCount: pr.rc || 0
    })),
    syncedAt: c.at || null
  }));

  const profSet = new Set();
  const recipes = Object.values(recipesMap).map(r => {
    if (r.p) profSet.add(r.p);
    const matchingCrafters = (r.cs || []).map(slug => {
      const cr = craftersMap[slug];
      if (!cr) return { slug, displayName: slug, className: 'Warrior', skill: 0 };
      const profInfo = (cr.p || []).find(pr => pr.n === r.p);
      return {
        slug,
        displayName: cr.dn,
        className: cr.cl || 'Warrior',
        discordId: cr.did || null,
        discordName: cr.dnm || null,
        skill: profInfo?.sk || 0,
        maxSkill: profInfo?.mx || 300
      };
    });
    return {
      id: r.id,
      name: r.n,
      profession: r.p,
      crafters: matchingCrafters
    };
  });

  recipes.sort((a, b) => a.name.localeCompare(b.name));
  crafters.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    updatedAt: doc.updatedAt || null,
    crafters,
    recipes,
    professions: Array.from(profSet).sort()
  };
}

export async function getGuildCraftingDirectory({ firestore, query = '', profession = '' } = {}) {
  let doc = await readEdgeCache('crafting_directory');
  if (!doc && firestore) {
    doc = await firestore.getCollectionDoc('armory_crafting', 'directory');
    if (doc) {
      await writeEdgeCache('crafting_directory', doc, 600);
    }
  }

  const expanded = expandCraftingDirectory(doc);
  const q = String(query || '').trim().toLowerCase();
  const profFilter = String(profession || '').trim().toLowerCase();

  let filteredRecipes = expanded.recipes;
  if (profFilter && profFilter !== 'all') {
    filteredRecipes = filteredRecipes.filter(r => String(r.profession || '').toLowerCase() === profFilter);
  }
  if (q) {
    filteredRecipes = filteredRecipes.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.profession.toLowerCase().includes(q) ||
      r.crafters.some(c => c.displayName.toLowerCase().includes(q) || String(c.discordName || '').toLowerCase().includes(q))
    );
  }

  let filteredCrafters = expanded.crafters;
  if (profFilter && profFilter !== 'all') {
    filteredCrafters = filteredCrafters.filter(c => c.professions.some(p => p.name.toLowerCase() === profFilter));
  }
  if (q) {
    filteredCrafters = filteredCrafters.filter(c =>
      c.displayName.toLowerCase().includes(q) ||
      String(c.discordName || '').toLowerCase().includes(q) ||
      c.professions.some(p => p.name.toLowerCase().includes(q))
    );
  }

  return {
    updatedAt: expanded.updatedAt,
    professions: expanded.professions,
    totalRecipes: expanded.recipes.length,
    totalCrafters: expanded.crafters.length,
    recipes: filteredRecipes.slice(0, 120),
    crafters: filteredCrafters
  };
}

/**
 * Retrieve cached or fresh WoW: Forever US Character Armory Snapshot
 */
export async function getCharacterArmory({ name, surname = '', slug = '', forceRefresh = false, env, firestore, state = null, fetchImpl = fetch } = {}) {
  const identity = parseCharacterIdentity(slug || name, surname);
  if (!identity.slug) {
    throw new BlizzardApiError('Character name (and surname for Forever) is required.', { status: 400, code: 'INVALID_CHARACTER_SLUG' });
  }

  const cacheKey = `char_${identity.slug}`;
  const docId = firestore ? firestore.sanitizeDocId(identity.slug) : identity.slug;
  const armoryCfg = resolveArmoryConfig(state);
  const now = Date.now();

  if (!forceRefresh) {
    const edgeHit = await readEdgeCache(cacheKey);
    if (edgeHit) {
      return { ...edgeHit, source: 'edge-cache' };
    }
  }

  const fsDoc = firestore ? await firestore.getCollectionDoc('armory_characters', docId) : null;
  if (fsDoc) {
    const syncedAtMs = fsDoc.syncedAt ? Date.parse(fsDoc.syncedAt) : 0;
    const ageMs = syncedAtMs ? (now - syncedAtMs) : Number.MAX_SAFE_INTEGER;

    // Protect Battle.net quota against spam refreshes
    if (forceRefresh && syncedAtMs && ageMs < CHAR_REFRESH_COOLDOWN_MS) {
      await hydrateItemsMediaAndPrices(fsDoc.equipment || [], {
        env,
        firestore,
        stateConfig: armoryCfg,
        houseId: armoryCfg.defaultAuctionHouseId,
        maxLiveFetches: 6,
        fetchImpl
      });
      return { ...fsDoc, source: 'firestore-cooldown' };
    }

    if (!forceRefresh) {
      if (fsDoc.found === false && fsDoc.negativeUntil && now < Number(fsDoc.negativeUntil)) {
        return { ...fsDoc, source: 'firestore-negative-cache' };
      }
      if (fsDoc.found === true && ageMs < CHAR_CACHE_TTL_MS) {
        await hydrateItemsMediaAndPrices(fsDoc.equipment || [], {
          env,
          firestore,
          stateConfig: armoryCfg,
          houseId: armoryCfg.defaultAuctionHouseId,
          maxLiveFetches: 8,
          fetchImpl
        });
        await writeEdgeCache(cacheKey, fsDoc, 1800);
        return { ...fsDoc, source: 'firestore-cache' };
      }
    }
  }

  if (!isBlizzardConfigured(env)) {
    if (fsDoc) return { ...fsDoc, source: 'firestore-stale' };
    return {
      found: false,
      configured: false,
      slug: identity.slug,
      name: identity.name,
      surname: identity.surname,
      reason: 'BLIZZARD_NOT_CONFIGURED',
      message: 'Battle.net API credentials are not configured yet on the Worker.',
      armoryUrl: identity.armoryUrl
    };
  }

  // Live fetch from Blizzard WoW: Forever US
  const snapshot = await fetchCharacterArmorySnapshot(identity.slug, env, {
    surname: identity.surname,
    fetchImpl
  });

  if (!snapshot.found) {
    const negStub = {
      ...snapshot,
      configured: true,
      negativeUntil: Date.now() + CHAR_NEGATIVE_TTL_MS
    };
    if (firestore) {
      await firestore.saveCollectionDoc('armory_characters', docId, negStub).catch(() => {});
    }
    await writeEdgeCache(cacheKey, negStub, 300);
    return { ...negStub, source: 'blizzard-404' };
  }

  snapshot.configured = true;

  // Hydrate item icons & AH pricing cleanly
  await hydrateItemsMediaAndPrices(snapshot.equipment || [], {
    env,
    firestore,
    stateConfig: armoryCfg,
    houseId: armoryCfg.defaultAuctionHouseId,
    maxLiveFetches: 12,
    fetchImpl
  });

  if (firestore) {
    await firestore.saveCollectionDoc('armory_characters', firestore.sanitizeDocId(snapshot.slug), snapshot);
  }
  await writeEdgeCache(cacheKey, snapshot, 1800);

  // Synchronize light summary + crafting recipes into BSE state if wallet exists
  if (state && firestore) {
    let stateDirty = applyCharacterSummaryToWallets(state, snapshot);
    if (snapshot.discoveredStaticNamespace && state.config?.armory?.staticNamespaceCache !== snapshot.discoveredStaticNamespace) {
      state.config = state.config || {};
      state.config.armory = state.config.armory || { ...DEFAULT_ARMORY_CONFIG };
      state.config.armory.staticNamespaceCache = snapshot.discoveredStaticNamespace;
      stateDirty = true;
    }
    if (stateDirty) {
      state.updatedAt = new Date().toISOString();
      await firestore.saveBseState(state).catch(err => {
        console.warn('Non-fatal slim character metadata sync warning:', err.message);
      });
    }
    await mergeCharacterIntoCraftingDirectory(snapshot, state, firestore).catch(err => {
      console.warn('Non-fatal crafting directory merge warning:', err.message);
    });
  }

  return { ...snapshot, source: 'blizzard-live' };
}

/**
 * Match in-game Forever guild roster members against Discord wallets inside bse_state
 */
export function matchRosterWithWallets(rosterMembers = [], wallets = {}) {
  const slugToWallet = new Map();
  const firstToWallets = new Map();

  for (const w of Object.values(wallets || {})) {
    const display = w.serverNickname || w.globalName || w.username || w.discordId;
    for (const ch of w.characters || []) {
      const s = ch.slug || buildCharacterSlug(ch.name, ch.surname || '');
      if (s) slugToWallet.set(s.toLowerCase(), { wallet: w, char: ch, display });
      const first = String(ch.name || '').trim().toLowerCase();
      if (first) {
        if (!firstToWallets.has(first)) firstToWallets.set(first, []);
        firstToWallets.get(first).push({ wallet: w, char: ch, display });
      }
    }
  }

  // Count how many roster entries share a given first name
  const firstCounts = new Map();
  for (const m of rosterMembers) {
    const f = String(m.name || '').toLowerCase();
    firstCounts.set(f, (firstCounts.get(f) || 0) + 1);
  }

  return rosterMembers.map(member => {
    const mSlug = String(member.slug || '').toLowerCase();
    const mFirst = String(member.name || '').toLowerCase();

    const exact = slugToWallet.get(mSlug);
    if (exact) {
      return {
        ...member,
        matchedDiscordId: exact.wallet.discordId,
        matchedDiscordName: exact.display,
        matchType: 'exact'
      };
    }

    const candidates = firstToWallets.get(mFirst) || [];
    if (candidates.length === 1 && firstCounts.get(mFirst) === 1 && !candidates[0].char.surname) {
      return {
        ...member,
        matchedDiscordId: candidates[0].wallet.discordId,
        matchedDiscordName: candidates[0].display,
        matchType: 'unique-first-name'
      };
    }

    return {
      ...member,
      matchedDiscordId: null,
      matchedDiscordName: null,
      matchType: 'unlinked'
    };
  });
}

/**
 * Fetch / Refresh WoW: Forever US Guild Roster snapshot
 */
export async function getOrSyncGuildRoster({ guildSlug = '', forceRefresh = false, env, firestore, state = null, fetchImpl = fetch } = {}) {
  const cfg = resolveArmoryConfig(state);
  const slug = normalizeGuildSlug(guildSlug || cfg.guildSlug);
  const cacheKey = `guild_${slug}`;

  if (!forceRefresh) {
    const edgeHit = await readEdgeCache(cacheKey);
    if (edgeHit) {
      return {
        ...edgeHit,
        members: state?.wallets ? matchRosterWithWallets(edgeHit.members || [], state.wallets) : (edgeHit.members || []),
        source: 'edge-cache'
      };
    }
  }

  const docId = firestore ? firestore.sanitizeDocId(slug) : slug;
  const fsDoc = firestore ? await firestore.getCollectionDoc('armory_guild', docId) : null;
  const now = Date.now();
  const ageMs = fsDoc?.syncedAt ? (now - Date.parse(fsDoc.syncedAt)) : Number.MAX_SAFE_INTEGER;

  if (!forceRefresh && fsDoc && ageMs < ROSTER_CACHE_TTL_MS) {
    await writeEdgeCache(cacheKey, fsDoc, 900);
    return {
      ...fsDoc,
      members: state?.wallets ? matchRosterWithWallets(fsDoc.members || [], state.wallets) : (fsDoc.members || []),
      source: 'firestore-cache'
    };
  }

  if (!isBlizzardConfigured(env)) {
    if (fsDoc) {
      return {
        ...fsDoc,
        members: state?.wallets ? matchRosterWithWallets(fsDoc.members || [], state.wallets) : (fsDoc.members || []),
        source: 'firestore-stale',
        configured: false
      };
    }
    return {
      found: false,
      configured: false,
      guildSlug: slug,
      guildName: slug,
      members: [],
      message: 'Battle.net API credentials are not configured yet on the Worker.'
    };
  }

  const fetched = await fetchForeverGuildRoster(slug, env, { fetchImpl });
  fetched.configured = true;
  if (firestore && fetched.found) {
    await firestore.saveCollectionDoc('armory_guild', docId, fetched);
  }
  await writeEdgeCache(cacheKey, fetched, 900);

  return {
    ...fetched,
    members: state?.wallets ? matchRosterWithWallets(fetched.members || [], state.wallets) : (fetched.members || []),
    source: 'blizzard-live'
  };
}

/**
 * Officer Helper: Auto-upgrade legacy single-name characters on Discord wallets when
 * an unambiguous match exists in the synced Forever guild roster.
 */
export async function autoMatchGuildRosterToWallets({ guildSlug = '', env, firestore, state, fetchImpl = fetch } = {}) {
  const roster = await getOrSyncGuildRoster({ guildSlug, forceRefresh: true, env, firestore, state, fetchImpl });
  if (!roster?.found) {
    return { success: false, message: roster?.message || 'Guild roster not found on Forever Armory.', matchedCount: 0, updates: [] };
  }

  const updates = [];
  for (const m of roster.members || []) {
    if (m.matchType === 'unique-first-name' && m.matchedDiscordId && state.wallets?.[m.matchedDiscordId]) {
      const w = state.wallets[m.matchedDiscordId];
      const ch = (w.characters || []).find(c => !c.surname && String(c.name || '').toLowerCase() === String(m.name || '').toLowerCase());
      if (ch) {
        ch.name = m.name;
        ch.surname = m.surname;
        ch.slug = m.slug;
        ch.class = m.className || ch.class;
        ch.race = m.raceName || ch.race || '';
        ch.level = m.level || ch.level || null;
        ch.guildName = roster.guildName;
        updates.push({
          discordId: m.matchedDiscordId,
          discordName: m.matchedDiscordName,
          character: m.displayName,
          slug: m.slug
        });
      }
    }
  }

  if (updates.length > 0 && firestore) {
    state.updatedAt = new Date().toISOString();
    await firestore.saveBseState(state);
  }

  return {
    success: true,
    guildName: roster.guildName,
    totalRosterMembers: (roster.members || []).length,
    matchedCount: updates.length,
    alreadyLinkedCount: (roster.members || []).filter(m => m.matchType === 'exact').length,
    updates,
    roster
  };
}

/**
 * Retrieve cached Item Detail from Edge Cache / Firestore / Blizzard Static API + AH Price + Guild Crafters
 */
export async function getItemDetail({ itemId, env, firestore, state = null, fetchImpl = fetch } = {}) {
  const numId = Number(itemId);
  if (!numId || numId < 1) {
    throw new BlizzardApiError('Invalid numeric Item ID', { status: 400, code: 'INVALID_ITEM_ID' });
  }

  const cfg = resolveArmoryConfig(state);
  const cacheKey = `item_${numId}`;
  let itemDoc = await readEdgeCache(cacheKey);
  const now = Date.now();

  if (!itemDoc && firestore) {
    itemDoc = await firestore.getCollectionDoc('armory_items', String(numId));
  }

  const isFresh = itemDoc?.syncedAt && (
    itemDoc.notFoundInStatic
      ? (now - Date.parse(itemDoc.syncedAt)) < ITEM_NEGATIVE_TTL_MS
      : (now - Date.parse(itemDoc.syncedAt)) < ITEM_CACHE_TTL_MS
  );

  // Note: media-only stubs shouldn't satisfy full item detail queries (`itemClass` / `previewChecked`)
  const hasFullDetail = Boolean(itemDoc && (itemDoc.detailChecked || itemDoc.notFoundInStatic));

  if ((!itemDoc || !isFresh || !hasFullDetail) && isBlizzardConfigured(env)) {
    const liveItem = await fetchForeverItemDetails(numId, env, { stateConfig: cfg, fetchImpl });
    liveItem.detailChecked = true;
    liveItem.mediaChecked = true;
    itemDoc = liveItem;
    if (firestore) {
      await firestore.saveCollectionDoc('armory_items', String(numId), itemDoc).catch(() => {});
    }
    await writeEdgeCache(cacheKey, itemDoc, 3600);
  } else if (!itemDoc) {
    itemDoc = {
      found: false,
      id: numId,
      name: `Item #${numId}`,
      quality: 'COMMON',
      wowheadUrl: buildWowheadForeverItemUrl(numId),
      configured: isBlizzardConfigured(env)
    };
  }

  // Attach AH price snapshot if present
  const ahDoc = await getCachedAhPricesDoc(cfg.defaultAuctionHouseId, { firestore }).catch(() => null);
  const priceTuple = ahDoc?.prices?.[String(numId)];
  if (Array.isArray(priceTuple) && priceTuple.length >= 3) {
    itemDoc.ahPrice = {
      min: Number(priceTuple[0]) || 0,
      median: Number(priceTuple[1]) || 0,
      qty: Number(priceTuple[2]) || 0,
      houseId: ahDoc.houseId || cfg.defaultAuctionHouseId,
      updatedAt: ahDoc.updatedAt || null
    };
  }

  return itemDoc;
}

/**
 * Search WoW: Forever US Items and enrich icons + AH prices + curated empty-query spotlight
 */
export async function searchAndHydrateDatabaseItems({ query = '', page = 1, pageSize = 24, env, firestore, state = null, fetchImpl = fetch } = {}) {
  const cfg = resolveArmoryConfig(state);
  const configured = isBlizzardConfigured(env);
  const cleanQ = String(query || '').trim();

  if (!cleanQ) {
    // Return hydrated curated spotlight items from cache/Firestore cleanly
    const featured = FEATURED_FOREVER_ITEMS.map(it => ({
      ...it,
      found: true,
      wowheadUrl: buildWowheadForeverItemUrl(it.id)
    }));
    await hydrateItemsMediaAndPrices(featured, {
      env,
      firestore,
      stateConfig: cfg,
      houseId: cfg.defaultAuctionHouseId,
      maxLiveFetches: 12,
      fetchImpl
    });
    return {
      configured,
      featured: true,
      query: '',
      page: 1,
      pageCount: 1,
      results: featured
    };
  }

  if (!configured) {
    return {
      configured: false,
      query: cleanQ,
      results: [],
      message: 'Battle.net API credentials are not configured yet on the Worker.'
    };
  }

  const searchRes = await searchForeverItems(cleanQ, env, {
    stateConfig: cfg,
    page,
    pageSize,
    fetchImpl
  });

  await hydrateItemsMediaAndPrices(searchRes.results || [], {
    env,
    firestore,
    stateConfig: cfg,
    houseId: cfg.defaultAuctionHouseId,
    maxLiveFetches: 10,
    fetchImpl
  });

  return {
    configured: true,
    featured: false,
    query: cleanQ,
    ...searchRes
  };
}

/**
 * Auction House compact snapshot read/write helpers
 */
export async function getCachedAhPricesDoc(houseId = 110, { firestore } = {}) {
  const docKey = `house_${Number(houseId) || 110}`;
  const edge = await readEdgeCache(`ah_${docKey}`);
  if (edge) return edge;
  if (!firestore) return null;
  const doc = await firestore.getCollectionDoc('armory_ah_prices', docKey);
  if (doc) {
    await writeEdgeCache(`ah_${docKey}`, doc, 600);
  }
  return doc;
}

export async function ingestCompactAuctionPrices(payload = {}, { firestore } = {}) {
  const houseId = Number(payload.houseId) || 110;
  const rulesetId = Number(payload.rulesetId) || 1;
  const rawPrices = payload.prices && typeof payload.prices === 'object' ? payload.prices : {};

  // Validate & sanitize tuple entries: itemId -> [minCopper, medianCopper, totalQty]
  const sanitized = {};
  let itemCount = 0;
  for (const [idKey, tuple] of Object.entries(rawPrices)) {
    if (!/^\d+$/.test(idKey)) continue;
    if (!Array.isArray(tuple) || tuple.length < 3) continue;
    const min = Math.max(0, Math.round(Number(tuple[0]) || 0));
    const med = Math.max(0, Math.round(Number(tuple[1]) || 0));
    const qty = Math.max(0, Math.round(Number(tuple[2]) || 0));
    if (min > 0 && qty > 0) {
      sanitized[idKey] = [min, med || min, qty];
      itemCount++;
    }
  }

  const doc = {
    houseId,
    rulesetId,
    auctionCount: Number(payload.auctionCount || 0),
    distinctItemCount: itemCount,
    updatedAt: payload.updatedAt || new Date().toISOString(),
    prices: sanitized
  };

  const docKey = `house_${houseId}`;
  await firestore.saveCollectionDoc('armory_ah_prices', docKey, doc);
  await deleteEdgeCache(`ah_${docKey}`);

  return {
    success: true,
    houseId,
    rulesetId,
    distinctItemCount: itemCount,
    auctionCount: doc.auctionCount,
    updatedAt: doc.updatedAt
  };
}

export async function getAuctionHouseWatchlist({ houseId = 110, extraItemIds = [], env, firestore, state = null, fetchImpl = fetch } = {}) {
  const cfg = resolveArmoryConfig(state);
  const resolvedHouse = Number(houseId) || cfg.defaultAuctionHouseId;
  const ahDoc = await getCachedAhPricesDoc(resolvedHouse, { firestore });

  const requestedIds = [...new Set([
    ...FOREVER_AH_WATCHLIST_IDS,
    ...extraItemIds.map(n => Number(n)).filter(n => n > 0)
  ])];

  // Hydrate item metadata from armory_items cleanly in 1 batchGet
  const cachedItems = firestore
    ? await firestore.batchGetCollectionDocs('armory_items', requestedIds.map(id => String(id)))
    : {};

  // Populate base names for core watchlist entries even if not yet cached in armory_items
  const BASE_WATCHLIST_NAMES = {
    13510: ['Flask of the Titans', 'COMMON'],
    13512: ['Flask of Supreme Power', 'COMMON'],
    13511: ['Flask of Distilled Wisdom', 'COMMON'],
    13452: ['Elixir of the Mongoose', 'COMMON'],
    13454: ['Greater Arcane Elixir', 'COMMON'],
    13457: ['Greater Fire Protection Potion', 'COMMON'],
    13458: ['Greater Nature Protection Potion', 'COMMON'],
    13459: ['Greater Shadow Protection Potion', 'COMMON'],
    13444: ['Major Mana Potion', 'COMMON'],
    13446: ['Major Healing Potion', 'COMMON'],
    13468: ['Black Lotus', 'UNCOMMON'],
    13466: ['Plaguebloom', 'COMMON'],
    13467: ['Icecap', 'COMMON'],
    13465: ['Mountain Silversage', 'COMMON'],
    13463: ['Dreamfoil', 'COMMON'],
    12363: ['Arcane Crystal', 'UNCOMMON'],
    12360: ['Arcanite Bar', 'UNCOMMON'],
    12811: ['Righteous Orb', 'UNCOMMON'],
    14344: ['Large Brilliant Shard', 'RARE'],
    16203: ['Greater Eternal Essence', 'UNCOMMON']
  };

  const rows = requestedIds.map(id => {
    const idStr = String(id);
    const meta = cachedItems?.[idStr];
    const fallback = BASE_WATCHLIST_NAMES[id] || [`Item #${id}`, 'COMMON'];
    const tuple = ahDoc?.prices?.[idStr] || null;
    return {
      id,
      name: meta?.name || fallback[0],
      quality: meta?.quality || fallback[1],
      iconUrl: meta?.iconUrl || null,
      wowheadUrl: buildWowheadForeverItemUrl(id),
      minBuyout: tuple ? Number(tuple[0]) : null,
      medianPrice: tuple ? Number(tuple[1]) : null,
      qty: tuple ? Number(tuple[2]) : 0
    };
  });

  // Top up missing icons gently if Blizzard is configured (max 6 per load)
  const missingMeta = rows.filter(r => !r.iconUrl);
  if (missingMeta.length > 0 && isBlizzardConfigured(env)) {
    await hydrateItemsMediaAndPrices(missingMeta, {
      env,
      firestore,
      stateConfig: cfg,
      houseId: resolvedHouse,
      maxLiveFetches: 6,
      fetchImpl
    });
  }

  return {
    houseId: resolvedHouse,
    rulesetId: ahDoc?.rulesetId || cfg.guildRulesetId,
    hasSnapshot: Boolean(ahDoc?.prices),
    updatedAt: ahDoc?.updatedAt || null,
    auctionCount: ahDoc?.auctionCount || 0,
    distinctItemCount: ahDoc?.distinctItemCount || 0,
    items: rows
  };
}

/**
 * Staggered Cloudflare Cron Tick: keeps Guild Roster & oldest linked characters
 * synced quietly within Worker Free subrequest budgets (~15-20 subrequests max).
 */
export async function runScheduledArmoryTick(env, firestore, { state = null, fetchImpl = fetch } = {}) {
  if (!isBlizzardConfigured(env)) {
    return { skipped: true, reason: 'BLIZZARD_NOT_CONFIGURED' };
  }

  const activeState = state || await firestore.getBseState();
  const cfg = resolveArmoryConfig(activeState);
  if (!cfg.enabled) {
    return { skipped: true, reason: 'ARMORY_DISABLED' };
  }

  const report = {
    rosterRefreshed: false,
    charactersRefreshed: 0
  };

  // 1. Refresh guild roster if configured & stale (> 45 min)
  if (cfg.autoSyncGuildRoster && cfg.guildSlug) {
    try {
      const rosterRes = await getOrSyncGuildRoster({
        guildSlug: cfg.guildSlug,
        forceRefresh: false,
        env,
        firestore,
        state: activeState,
        fetchImpl
      });
      report.rosterRefreshed = rosterRes?.source === 'blizzard-live';
    } catch (err) {
      console.warn('Scheduled Forever guild roster tick warning:', err.message);
    }
  }

  // 2. Refresh up to 2 stalest linked characters with a valid slug (> 12h old)
  const candidates = [];
  const staleCutoffMs = 12 * 3600 * 1000;
  const now = Date.now();

  for (const w of Object.values(activeState.wallets || {})) {
    for (const ch of w.characters || []) {
      const slug = ch.slug || (ch.surname ? buildCharacterSlug(ch.name, ch.surname) : '');
      if (!slug) continue;
      const lastSyncMs = ch.lastArmorySyncAt ? Date.parse(ch.lastArmorySyncAt) : 0;
      if (!lastSyncMs || (now - lastSyncMs) > staleCutoffMs) {
        candidates.push({ slug, lastSyncMs });
      }
    }
  }

  candidates.sort((a, b) => a.lastSyncMs - b.lastSyncMs);
  for (const c of candidates.slice(0, 2)) {
    try {
      await getCharacterArmory({
        slug: c.slug,
        forceRefresh: true,
        env,
        firestore,
        state: activeState,
        fetchImpl
      });
      report.charactersRefreshed++;
    } catch (err) {
      console.warn(`Scheduled Armory char sync (${c.slug}) warning:`, err.message);
    }
  }

  return report;
}

export {
  BlizzardApiError,
  isBlizzardConfigured,
  buildCharacterSlug,
  parseCharacterIdentity,
  normalizeGuildSlug,
  fetchRulesetsAndHouses
};
