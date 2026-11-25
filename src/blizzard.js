/**
 * Battle.net Developer API Client for World of Warcraft: Forever US
 *
 * Handles:
 *  - OAuth 2.0 client_credentials token management
 *  - Dynamic static-* namespace discovery (forever-us build version resolution)
 *  - Realmless {name}-{surname} character profile, equipment, stats, specs,
 *    professions, reputations, and character-media aggregation
 *  - Guild roster & guild-achievement sync
 *  - Item search, item metadata & media icons (with defensive 404 handling)
 *  - Ruleset endpoint resolution
 */

export const BLIZZARD_OAUTH_URL = 'https://oauth.battle.net/token';
export const BLIZZARD_API_BASE = 'https://us.api.blizzard.com';

export const FOREVER_PROFILE_NS = 'profile-forever-us';
export const FOREVER_DYNAMIC_NS = 'dynamic-forever-us';
export const FOREVER_DEFAULT_STATIC_NS = 'static-1.60.1_70399-forever-us';
export const FOREVER_FALLBACK_STATIC_NS = 'static-forever-us';
export const FOREVER_LOCALE = 'en_US';

export const FOREVER_RULESETS = [
  { id: 1, name: 'PvP', slug: 'pvp' },
  { id: 2, name: 'Normal', slug: 'normal' },
  { id: 3, name: 'Roleplay', slug: 'roleplay' },
  { id: 15, name: 'Roleplay PvP', slug: 'roleplay-pvp' }
];

export const CLASSIC_CLASS_MAP = {
  1: 'Warrior',
  2: 'Paladin',
  3: 'Hunter',
  4: 'Rogue',
  5: 'Priest',
  7: 'Shaman',
  8: 'Mage',
  9: 'Warlock',
  11: 'Druid'
};

export const CLASSIC_RACE_MAP = {
  1: 'Human',
  2: 'Orc',
  3: 'Dwarf',
  4: 'Night Elf',
  5: 'Undead',
  6: 'Tauren',
  7: 'Gnome',
  8: 'Troll'
};

export const CLASSIC_SLOT_ORDER = [
  'HEAD',
  'NECK',
  'SHOULDER',
  'BACK',
  'CHEST',
  'SHIRT',
  'TABARD',
  'WRIST',
  'HANDS',
  'WAIST',
  'LEGS',
  'FEET',
  'FINGER_1',
  'FINGER_2',
  'TRINKET_1',
  'TRINKET_2',
  'MAIN_HAND',
  'OFF_HAND',
  'RANGED'
];

// Module-scoped token & static namespace caches per Worker isolate
let cachedTokenState = null; // { token, expiresAt }
let inFlightTokenPromise = null;
let cachedStaticNsState = null; // { ns, discoveredAt }

/**
 * Custom typed error so callers can distinguish missing Battle.net credentials cleanly
 */
export class BlizzardApiError extends Error {
  constructor(message, { status = 500, code = 'BLIZZARD_ERROR', endpoint = '' } = {}) {
    super(message);
    this.name = 'BlizzardApiError';
    this.status = status;
    this.code = code;
    this.endpoint = endpoint;
  }
}

export function isBlizzardConfigured(env) {
  return Boolean(
    env?.BLIZZARD_CLIENT_ID &&
    env?.BLIZZARD_CLIENT_SECRET &&
    !String(env.BLIZZARD_CLIENT_ID).includes('your_') &&
    !String(env.BLIZZARD_CLIENT_SECRET).includes('your_')
  );
}

/**
 * Reset in-memory module caches (primarily for unit tests)
 */
export function resetBlizzardCaches() {
  cachedTokenState = null;
  inFlightTokenPromise = null;
  cachedStaticNsState = null;
}

/**
 * Normalize Forever character first name + surname -> lowercase slug ("name-surname")
 */
export function buildCharacterSlug(name = '', surname = '') {
  const cleanPart = (val) => String(val || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

  const n = cleanPart(name);
  const s = cleanPart(surname);

  if (!n) return '';
  if (n.includes('-')) {
    const pieces = n.split('-').map(p => p.trim()).filter(Boolean);
    if (!s) {
      return pieces.length >= 2 ? `${pieces[0]}-${pieces.slice(1).join('-')}` : n;
    }
    if (pieces.length >= 2 && pieces.slice(1).join('-') === s) {
      return `${pieces[0]}-${s}`;
    }
    if (pieces.length >= 2) {
      return `${pieces[0]}-${s}`;
    }
  }
  return s ? `${n}-${s}` : n;
}

/**
 * Split a slug or name input cleanly into { name, surname, slug }
 */
export function parseCharacterIdentity(nameInput = '', surnameInput = '') {
  const capWord = (str) => {
    const s = String(str || '').trim();
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  let first = String(nameInput || '').trim();
  let last = String(surnameInput || '').trim();

  if (first.includes('-')) {
    const parts = first.split('-').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      first = parts[0];
      if (!last) {
        last = parts.slice(1).join('-');
      }
    }
  } else if (!last && first.includes(' ')) {
    const parts = first.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      first = parts[0];
      last = parts.slice(1).join(' ');
    }
  }

  const slug = buildCharacterSlug(first, last);
  return {
    name: capWord(first),
    surname: capWord(last),
    slug,
    hasSurname: Boolean(last),
    armoryUrl: slug
      ? `https://worldofwarcraft.blizzard.com/en-us/forever/us/armory/character/${encodeURIComponent(slug)}`
      : null
  };
}

/**
 * Normalize Guild Name or URL -> slug (e.g., "Black Sands" -> "black-sands")
 */
export function normalizeGuildSlug(input = '') {
  let raw = String(input || '').trim();
  if (!raw) return '';
  // Allow pasting full Forever armory guild URL
  const match = raw.match(/\/guild\/([^/?#]+)/i);
  if (match) {
    raw = decodeURIComponent(match[1]);
  }
  return raw
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\p{L}-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Extract static-* namespace from any Blizzard API link href (e.g. playable_class.key.href)
 */
export function extractNamespaceFromHref(href = '') {
  if (!href) return null;
  try {
    const url = new URL(href);
    const ns = url.searchParams.get('namespace');
    if (ns && ns.startsWith('static-') && ns.endsWith('-forever-us')) {
      return ns;
    }
  } catch {
    const m = String(href).match(/[?&]namespace=(static-[a-zA-Z0-9._-]+-forever-us)/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Acquire Battle.net OAuth Client Credentials Access Token
 */
export async function getBlizzardAccessToken(env, fetchImpl = fetch) {
  if (!isBlizzardConfigured(env)) {
    throw new BlizzardApiError(
      'Battle.net API credentials (BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET) are not configured on this worker.',
      { status: 503, code: 'BLIZZARD_NOT_CONFIGURED' }
    );
  }

  const now = Date.now();
  if (cachedTokenState && now < cachedTokenState.expiresAt - 120000) {
    return cachedTokenState.token;
  }

  if (inFlightTokenPromise) {
    return inFlightTokenPromise;
  }

  inFlightTokenPromise = (async () => {
    const creds = Buffer.from(`${env.BLIZZARD_CLIENT_ID}:${env.BLIZZARD_CLIENT_SECRET}`).toString('base64');
    const res = await fetchImpl(BLIZZARD_OAUTH_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new BlizzardApiError(
        `Battle.net OAuth token request failed [${res.status}]: ${errText || res.statusText}`,
        { status: res.status === 401 ? 502 : res.status, code: 'BLIZZARD_OAUTH_FAILED', endpoint: BLIZZARD_OAUTH_URL }
      );
    }

    const data = await res.json();
    const expiresInSec = Math.max(300, Number(data.expires_in) || 86400);
    cachedTokenState = {
      token: data.access_token,
      expiresAt: Date.now() + expiresInSec * 1000
    };
    return cachedTokenState.token;
  })();

  try {
    return await inFlightTokenPromise;
  } finally {
    inFlightTokenPromise = null;
  }
}

/**
 * Core authenticated fetch wrapper against us.api.blizzard.com
 */
export async function blizzardFetch(path, env, { namespace, locale = FOREVER_LOCALE, params = {}, fetchImpl = fetch, allow404 = false } = {}) {
  const token = await getBlizzardAccessToken(env, fetchImpl);
  const url = new URL(path.startsWith('http') ? path : `${BLIZZARD_API_BASE}${path}`);

  if (namespace && !url.searchParams.has('namespace')) {
    url.searchParams.set('namespace', namespace);
  }
  if (locale && !url.searchParams.has('locale')) {
    url.searchParams.set('locale', locale);
  }
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  });

  if (res.status === 401) {
    // Force token refresh once on unexpected 401
    cachedTokenState = null;
    const retryToken = await getBlizzardAccessToken(env, fetchImpl);
    const retryRes = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${retryToken}`,
        'Accept': 'application/json'
      }
    });
    if (allow404 && retryRes.status === 404) return null;
    if (!retryRes.ok) {
      const txt = await retryRes.text().catch(() => '');
      throw new BlizzardApiError(
        `Blizzard API [${retryRes.status}] on ${path}: ${txt}`,
        { status: retryRes.status, code: `BLIZZARD_HTTP_${retryRes.status}`, endpoint: path }
      );
    }
    return retryRes.json();
  }

  if (allow404 && res.status === 404) {
    return null;
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new BlizzardApiError(
      `Blizzard API [${res.status}] on ${path}: ${errText || res.statusText}`,
      { status: res.status, code: `BLIZZARD_HTTP_${res.status}`, endpoint: path }
    );
  }

  return res.json();
}

/**
 * Resolve & cache active static-*-forever-us namespace (WoW: Forever uses build-pinned static namespaces)
 */
export async function getActiveStaticNamespace(env, { stateConfig = null, hintHref = null, fetchImpl = fetch } = {}) {
  const hintNs = extractNamespaceFromHref(hintHref);
  if (hintNs) {
    cachedStaticNsState = { ns: hintNs, discoveredAt: Date.now() };
    return hintNs;
  }

  const now = Date.now();
  if (cachedStaticNsState && (now - cachedStaticNsState.discoveredAt) < 6 * 3600 * 1000) {
    return cachedStaticNsState.ns;
  }

  const stateCachedNs = stateConfig?.staticNamespaceCache;
  if (stateCachedNs && stateCachedNs.startsWith('static-') && stateCachedNs.endsWith('-forever-us')) {
    cachedStaticNsState = { ns: stateCachedNs, discoveredAt: now };
    return stateCachedNs;
  }

  // Probe build-pinned namespace first, fallback to bare static-forever-us
  const candidates = [FOREVER_DEFAULT_STATIC_NS, FOREVER_FALLBACK_STATIC_NS];
  for (const ns of candidates) {
    try {
      const probe = await blizzardFetch('/data/wow/playable-class/index', env, {
        namespace: ns,
        fetchImpl,
        allow404: true
      });
      if (probe && Array.isArray(probe.classes)) {
        const discovered = extractNamespaceFromHref(probe.classes?.[0]?.key?.href) || ns;
        cachedStaticNsState = { ns: discovered, discoveredAt: Date.now() };
        return discovered;
      }
    } catch (err) {
      // Try next candidate when Blizzard rejects bare namespace with 403/404
      if (err?.status !== 403 && err?.status !== 404) {
        throw err;
      }
    }
  }

  cachedStaticNsState = { ns: FOREVER_DEFAULT_STATIC_NS, discoveredAt: Date.now() };
  return FOREVER_DEFAULT_STATIC_NS;
}

/**
 * Helper: call a static-* endpoint with automatic retry on alternate Forever static namespaces
 */
export async function blizzardFetchStatic(path, env, { stateConfig = null, params = {}, fetchImpl = fetch, allow404 = false } = {}) {
  const primaryNs = await getActiveStaticNamespace(env, { stateConfig, fetchImpl });
  const candidates = [primaryNs, FOREVER_DEFAULT_STATIC_NS, FOREVER_FALLBACK_STATIC_NS]
    .filter((ns, idx, arr) => Boolean(ns) && arr.indexOf(ns) === idx);

  let lastErr = null;
  for (const ns of candidates) {
    try {
      const res = await blizzardFetch(path, env, {
        namespace: ns,
        params,
        fetchImpl,
        allow404
      });
      if (res !== null || allow404) {
        cachedStaticNsState = { ns, discoveredAt: Date.now() };
        return res;
      }
    } catch (err) {
      lastErr = err;
      if (err?.status === 403 || err?.status === 404) {
        continue;
      }
      throw err;
    }
  }

  if (allow404) return null;
  throw lastErr || new BlizzardApiError(`Failed static query ${path}`, { status: 404, endpoint: path });
}

/**
 * Normalize Blizzard Classic quality object -> string token ("EPIC", "RARE", etc.)
 */
export function normalizeItemQuality(qualityObj) {
  const type = String(qualityObj?.type || qualityObj || 'COMMON').toUpperCase();
  const valid = ['POOR', 'COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'ARTIFACT', 'HEIRLOOM'];
  if (valid.includes(type)) return type;
  const byName = String(qualityObj?.name || '').toUpperCase();
  return valid.includes(byName) ? byName : 'COMMON';
}

/**
 * Format Warcraft item icon CDN fallback when Blizzard item media isn't hydrated yet
 */
export function buildWowheadForeverItemUrl(itemId) {
  return `https://www.wowhead.com/forever/item=${encodeURIComponent(String(itemId))}`;
}

/**
 * Extract compact UI-friendly item representation from Blizzard preview_item or /data/wow/item
 */
export function normalizePreviewItem(rawItem = {}, { fallbackId = null, slotType = null, slotName = null } = {}) {
  const itemId = Number(rawItem.item?.id || rawItem.id || fallbackId || 0) || 0;
  const quality = normalizeItemQuality(rawItem.quality);
  const name = String(rawItem.name || rawItem.item?.name || `Item #${itemId}`);
  const itemLevel = Number(rawItem.level?.value ?? rawItem.level ?? 0) || 0;
  const requiredLevel = Number(rawItem.requirements?.level?.value ?? rawItem.required_level ?? 0) || 0;
  const binding = rawItem.binding?.name || null;
  const armorVal = rawItem.armor?.value ?? null;
  const armorDisplay = rawItem.armor?.display?.display_string || (armorVal ? `${armorVal} Armor` : null);

  let weaponInfo = null;
  if (rawItem.weapon) {
    weaponInfo = {
      damage: rawItem.weapon.damage?.display_string || null,
      attackSpeed: rawItem.weapon.attack_speed?.display_string || null,
      dps: rawItem.weapon.dps?.display_string || null
    };
  }

  const stats = Array.isArray(rawItem.stats)
    ? rawItem.stats.map(s => ({
        type: s.type?.type || '',
        label: s.display?.display_string || `${s.value >= 0 ? '+' : ''}${s.value} ${s.type?.name || ''}`,
        value: Number(s.value) || 0,
        isNegated: Boolean(s.is_negated),
        isEquipBonus: Boolean(s.is_equip_bonus)
      }))
    : [];

  const spells = Array.isArray(rawItem.spells)
    ? rawItem.spells.map(sp => ({
        spellId: sp.spell?.id || null,
        spellName: sp.spell?.name || null,
        description: sp.description || ''
      })).filter(sp => sp.description || sp.spellName)
    : [];

  const enchantments = Array.isArray(rawItem.enchantments)
    ? rawItem.enchantments.map(enc => ({
        display: enc.display_string || enc.source_item?.name || '',
        slotType: enc.enchantment_slot?.type || 'PERMANENT'
      })).filter(enc => enc.display)
    : [];

  const setInfo = rawItem.set
    ? {
        name: rawItem.set.item_set?.name || null,
        display: rawItem.set.display_string || null,
        effects: Array.isArray(rawItem.set.effects)
          ? rawItem.set.effects.map(ef => ({
              display: ef.display_string || '',
              isActive: Boolean(ef.is_active)
            }))
          : []
      }
    : null;

  return {
    id: itemId,
    slotType: slotType || rawItem.slot?.type || null,
    slotName: slotName || rawItem.slot?.name || null,
    name,
    quality,
    level: itemLevel,
    requiredLevel,
    itemClass: rawItem.item_class?.name || null,
    itemSubclass: rawItem.item_subclass?.name || null,
    inventoryType: rawItem.inventory_type?.type || null,
    inventoryName: rawItem.inventory_type?.name || null,
    binding,
    uniqueEquipped: rawItem.unique_equipped || null,
    armorDisplay,
    weapon: weaponInfo,
    durability: rawItem.durability?.display_string || null,
    stats,
    spells,
    enchantments,
    set: setInfo,
    description: rawItem.description || null,
    sellPrice: Number(rawItem.sell_price?.value ?? rawItem.sell_price ?? 0) || 0,
    wowheadUrl: itemId ? buildWowheadForeverItemUrl(itemId) : null
  };
}

/**
 * Normalize Blizzard Profile /equipment response into ordered UI slots
 */
export function normalizeEquipmentResponse(equipJson) {
  const rawItems = Array.isArray(equipJson?.equipped_items) ? equipJson.equipped_items : [];
  const slotMap = new Map();
  let sumIlvl = 0;
  let countedSlots = 0;

  for (const eq of rawItems) {
    const slotType = String(eq.slot?.type || '').toUpperCase();
    const slotName = eq.slot?.name || slotType;
    const normalized = normalizePreviewItem(eq, {
      fallbackId: eq.item?.id,
      slotType,
      slotName
    });

    if (slotType && !['SHIRT', 'TABARD'].includes(slotType) && normalized.level > 0) {
      sumIlvl += normalized.level;
      countedSlots++;
    }

    if (slotType) {
      slotMap.set(slotType, normalized);
    }
  }

  const ordered = [];
  for (const sType of CLASSIC_SLOT_ORDER) {
    if (slotMap.has(sType)) {
      ordered.push(slotMap.get(sType));
      slotMap.delete(sType);
    }
  }
  for (const extra of slotMap.values()) {
    ordered.push(extra);
  }

  return {
    items: ordered,
    computedAvgItemLevel: countedSlots > 0 ? Math.round((sumIlvl / countedSlots) * 10) / 10 : null
  };
}

/**
 * Normalize Blizzard Classic /statistics response into flat stats object
 */
export function normalizeStatisticsResponse(statsJson) {
  if (!statsJson || typeof statsJson !== 'object') return null;

  const val = (field) => {
    if (field === undefined || field === null) return null;
    if (typeof field === 'number') return field;
    if (typeof field === 'object') {
      return field.effective ?? field.value ?? field.base ?? field.rating_normalized ?? null;
    }
    return null;
  };

  return {
    health: val(statsJson.health),
    power: val(statsJson.power),
    powerType: statsJson.power_type?.name || null,
    strength: val(statsJson.strength),
    agility: val(statsJson.agility),
    stamina: val(statsJson.stamina),
    intellect: val(statsJson.intellect),
    spirit: val(statsJson.spirit),
    armor: val(statsJson.armor),
    attackPower: val(statsJson.attack_power),
    rangedAttackPower: val(statsJson.ranged_attack_power),
    meleeCrit: val(statsJson.melee_crit),
    rangedCrit: val(statsJson.ranged_crit),
    spellPower: val(statsJson.spell_power),
    spellCrit: val(statsJson.spell_crit),
    dodge: val(statsJson.dodge),
    parry: val(statsJson.parry),
    block: val(statsJson.block),
    fireResistance: val(statsJson.fire_resistance),
    frostResistance: val(statsJson.frost_resistance),
    natureResistance: val(statsJson.nature_resistance),
    shadowResistance: val(statsJson.shadow_resistance),
    arcaneResistance: val(statsJson.arcane_resistance)
  };
}

/**
 * Normalize Blizzard Classic /specializations response (supports Classic specialization_groups & direct trees)
 */
export function normalizeSpecializationsResponse(specJson) {
  if (!specJson || typeof specJson !== 'object') return { groups: [], primaryTree: null };

  const rawGroups = Array.isArray(specJson.specialization_groups)
    ? specJson.specialization_groups
    : (Array.isArray(specJson.specializations) ? [{ is_active: true, specializations: specJson.specializations }] : []);

  const groups = rawGroups.map((grp, idx) => {
    const trees = (Array.isArray(grp.specializations) ? grp.specializations : []).map(tree => {
      const talents = (Array.isArray(tree.talents) ? tree.talents : []).map(t => ({
        name: t.talent?.name || t.spell_tooltip?.spell?.name || 'Talent',
        rank: Number(t.talent_rank || 0),
        description: t.spell_tooltip?.description || ''
      }));
      return {
        name: tree.specialization_name || tree.talent_tree?.name || 'Specialization',
        spentPoints: Number(tree.spent_points || 0),
        talents
      };
    });

    return {
      isActive: grp.is_active !== false && idx === 0 ? true : Boolean(grp.is_active),
      trees
    };
  });

  const activeGrp = groups.find(g => g.isActive) || groups[0] || null;
  let primaryTree = null;
  if (activeGrp?.trees?.length) {
    const sorted = [...activeGrp.trees].sort((a, b) => b.spentPoints - a.spentPoints);
    if (sorted[0].spentPoints > 0) {
      primaryTree = sorted[0].name;
    }
  }

  return { groups, primaryTree };
}

/**
 * Normalize Blizzard Classic /professions response
 */
export function normalizeProfessionsResponse(profJson) {
  if (!profJson || typeof profJson !== 'object') {
    return { primaries: [], secondaries: [], allSummary: '' };
  }

  const mapList = (arr) => (Array.isArray(arr) ? arr : []).map(entry => {
    // Classic endpoints vary slightly between tier array vs direct skill_points
    const latestTier = Array.isArray(entry.tiers) && entry.tiers.length
      ? entry.tiers[entry.tiers.length - 1]
      : null;

    const skillPoints = Number(
      latestTier?.skill_points ?? entry.skill_points ?? 0
    ) || 0;
    const maxSkillPoints = Number(
      latestTier?.max_skill_points ?? entry.max_skill_points ?? 300
    ) || 300;

    const rawRecipes = latestTier?.known_recipes || entry.known_recipes || [];
    const knownRecipes = Array.isArray(rawRecipes)
      ? rawRecipes.map(r => ({
          id: Number(r.id || 0),
          name: String(r.name || '').trim()
        })).filter(r => r.id && r.name)
      : [];

    return {
      id: entry.profession?.id || null,
      name: entry.profession?.name || 'Unknown Profession',
      tierName: latestTier?.tier?.name || null,
      skillPoints,
      maxSkillPoints,
      knownRecipes
    };
  });

  const primaries = mapList(profJson.primaries);
  const secondaries = mapList(profJson.secondaries);

  return {
    primaries,
    secondaries,
    allSummary: primaries.map(p => `${p.name} ${p.skillPoints}`).join(' / ')
  };
}

/**
 * Normalize Blizzard /reputations response
 */
export function normalizeReputationsResponse(repJson) {
  const list = Array.isArray(repJson?.reputations) ? repJson.reputations : [];
  return list.map(rep => ({
    id: rep.faction?.id || null,
    name: rep.faction?.name || 'Unknown Faction',
    standing: rep.standing?.name || 'Neutral',
    value: Number(rep.standing?.value ?? 0),
    max: Number(rep.standing?.max ?? 3000),
    tier: Number(rep.standing?.tier ?? 3),
    raw: Number(rep.standing?.raw ?? 0)
  }));
}

/**
 * Normalize Blizzard /character-media response (gracefully handles missing assets on Forever launch)
 */
export function normalizeCharacterMediaResponse(mediaJson) {
  if (!mediaJson || !Array.isArray(mediaJson.assets)) {
    return { avatar: null, inset: null, mainRaw: null };
  }
  const byKey = new Map(mediaJson.assets.map(a => [a.key, a.value]));
  return {
    avatar: byKey.get('avatar') || null,
    inset: byKey.get('inset') || null,
    mainRaw: byKey.get('main-raw') || byKey.get('main') || null
  };
}

/**
 * Fetch complete normalized WoW: Forever US Character Armory Snapshot
 */
export async function fetchCharacterArmorySnapshot(nameOrSlug, env, { surname = '', fetchImpl = fetch } = {}) {
  const identity = parseCharacterIdentity(nameOrSlug, surname);
  if (!identity.slug) {
    throw new BlizzardApiError('Character name is required.', { status: 400, code: 'INVALID_CHARACTER_SLUG' });
  }

  const encSlug = encodeURIComponent(identity.slug);
  const basePath = `/profile/wow/character/${encSlug}`;

  const summary = await blizzardFetch(basePath, env, {
    namespace: FOREVER_PROFILE_NS,
    fetchImpl,
    allow404: true
  });

  if (!summary) {
    return {
      found: false,
      slug: identity.slug,
      name: identity.name,
      surname: identity.surname,
      reason: 'NOT_FOUND_OR_UNDER_10',
      message: `Character "${identity.slug}" was not found on WoW: Forever US Armory. Characters appear once they reach Level 10+ and log out once.`,
      armoryUrl: identity.armoryUrl,
      syncedAt: new Date().toISOString()
    };
  }

  // Extract static namespace hint if present in summary links
  const staticHintHref = summary.character_class?.key?.href || summary.race?.key?.href || null;
  const discoveredStaticNs = extractNamespaceFromHref(staticHintHref);
  if (discoveredStaticNs) {
    cachedStaticNsState = { ns: discoveredStaticNs, discoveredAt: Date.now() };
  }

  // Fetch all sub-endpoints concurrently; tolerate partial 404s (e.g. 12h+ delayed character-media)
  const [
    equipRes,
    statsRes,
    specsRes,
    profsRes,
    repsRes,
    mediaRes
  ] = await Promise.allSettled([
    blizzardFetch(`${basePath}/equipment`, env, { namespace: FOREVER_PROFILE_NS, fetchImpl, allow404: true }),
    blizzardFetch(`${basePath}/statistics`, env, { namespace: FOREVER_PROFILE_NS, fetchImpl, allow404: true }),
    blizzardFetch(`${basePath}/specializations`, env, { namespace: FOREVER_PROFILE_NS, fetchImpl, allow404: true }),
    blizzardFetch(`${basePath}/professions`, env, { namespace: FOREVER_PROFILE_NS, fetchImpl, allow404: true }),
    blizzardFetch(`${basePath}/reputations`, env, { namespace: FOREVER_PROFILE_NS, fetchImpl, allow404: true }),
    blizzardFetch(`${basePath}/character-media`, env, { namespace: FOREVER_PROFILE_NS, fetchImpl, allow404: true })
  ]);

  const valOf = (settled) => (settled.status === 'fulfilled' ? settled.value : null);

  const equipment = normalizeEquipmentResponse(valOf(equipRes));
  const statistics = normalizeStatisticsResponse(valOf(statsRes));
  const specializations = normalizeSpecializationsResponse(valOf(specsRes));
  const professions = normalizeProfessionsResponse(valOf(profsRes));
  const reputations = normalizeReputationsResponse(valOf(repsRes));
  const media = normalizeCharacterMediaResponse(valOf(mediaRes));

  const className = summary.character_class?.name
    || CLASSIC_CLASS_MAP[summary.character_class?.id]
    || 'Warrior';
  const raceName = summary.race?.name
    || CLASSIC_RACE_MAP[summary.race?.id]
    || 'Adventurer';

  const charDisplayName = summary.name || identity.name;
  const charSurname = summary.surname || identity.surname;
  const resolvedSlug = buildCharacterSlug(charDisplayName, charSurname) || identity.slug;
  const avgIlvl = Number(summary.equipped_item_level ?? summary.average_item_level ?? equipment.computedAvgItemLevel ?? 0) || null;

  return {
    found: true,
    slug: resolvedSlug,
    name: charDisplayName,
    surname: charSurname,
    displayName: charSurname ? `${charDisplayName} ${charSurname}` : charDisplayName,
    level: Number(summary.level || 0),
    race: raceName,
    className,
    gender: summary.gender?.name || null,
    faction: summary.faction?.name || null,
    ruleset: summary.ruleset ? {
      id: summary.ruleset.id || null,
      name: summary.ruleset.name || null
    } : null,
    guild: summary.guild ? {
      name: summary.guild.name || null,
      id: summary.guild.id || null,
      slug: summary.guild.name ? normalizeGuildSlug(summary.guild.name) : null
    } : null,
    title: summary.active_title?.name || null,
    activeSpec: summary.active_spec?.name || specializations.primaryTree || null,
    avgItemLevel: avgIlvl,
    lastLoginTimestamp: summary.last_login_timestamp || null,
    armoryUrl: `https://worldofwarcraft.blizzard.com/en-us/forever/us/armory/character/${encodeURIComponent(resolvedSlug)}`,
    discoveredStaticNamespace: discoveredStaticNs || null,
    media,
    equipment: equipment.items,
    statistics,
    specializations,
    professions,
    reputations,
    syncedAt: new Date().toISOString()
  };
}

/**
 * Fetch WoW: Forever US Guild Roster (/data/wow/guild/{guild-slug}/roster)
 */
export async function fetchForeverGuildRoster(guildSlugInput, env, { fetchImpl = fetch } = {}) {
  const guildSlug = normalizeGuildSlug(guildSlugInput);
  if (!guildSlug) {
    throw new BlizzardApiError('Guild slug is required.', { status: 400, code: 'INVALID_GUILD_SLUG' });
  }

  const roster = await blizzardFetch(`/data/wow/guild/${encodeURIComponent(guildSlug)}/roster`, env, {
    namespace: FOREVER_PROFILE_NS,
    fetchImpl,
    allow404: true
  });

  if (!roster) {
    return {
      found: false,
      guildSlug,
      message: `Guild "${guildSlug}" was not found on WoW: Forever US.`,
      members: [],
      syncedAt: new Date().toISOString()
    };
  }

  const rawMembers = Array.isArray(roster.members) ? roster.members : [];
  const members = rawMembers.map(entry => {
    const ch = entry.character || {};
    const first = String(ch.name || '').trim();
    const last = String(ch.surname || '').trim();
    const slug = buildCharacterSlug(first, last);
    const classId = Number(ch.playable_class?.id || 0);
    const raceId = Number(ch.playable_race?.id || 0);
    return {
      id: ch.id || null,
      name: first,
      surname: last,
      displayName: last ? `${first} ${last}` : first,
      slug,
      level: Number(ch.level || 0),
      rank: Number(entry.rank ?? 99),
      classId,
      className: ch.playable_class?.name || CLASSIC_CLASS_MAP[classId] || 'Adventurer',
      raceId,
      raceName: ch.playable_race?.name || CLASSIC_RACE_MAP[raceId] || 'Unknown',
      rulesetId: ch.ruleset?.id || roster.guild?.ruleset?.id || null
    };
  }).filter(m => m.name);

  members.sort((a, b) => (a.rank - b.rank) || (b.level - a.level) || a.displayName.localeCompare(b.displayName));

  return {
    found: true,
    guildSlug,
    guildId: roster.guild?.id || null,
    guildName: roster.guild?.name || guildSlug,
    faction: roster.guild?.faction?.name || null,
    ruleset: roster.guild?.ruleset ? {
      id: roster.guild.ruleset.id || null,
      name: roster.guild.ruleset.name || null
    } : null,
    memberCount: members.length,
    members,
    syncedAt: new Date().toISOString()
  };
}

/**
 * Fetch single item icon URL from Blizzard Item Media API
 */
export async function fetchItemMediaIcon(itemId, env, { stateConfig = null, fetchImpl = fetch } = {}) {
  const numId = Number(itemId);
  if (!numId || numId < 1) return null;

  const mediaJson = await blizzardFetchStatic(`/data/wow/media/item/${numId}`, env, {
    stateConfig,
    fetchImpl,
    allow404: true
  });
  const assets = Array.isArray(mediaJson?.assets) ? mediaJson.assets : [];
  const iconAsset = assets.find(a => a.key === 'icon') || assets[0];
  return iconAsset?.value || null;
}

/**
 * Fetch detailed item definition + icon from WoW: Forever static namespace
 * Note: ~43% of legacy Classic IDs return 404 from static-forever-us; returns { found: false } cleanly.
 */
export async function fetchForeverItemDetails(itemId, env, { stateConfig = null, fetchImpl = fetch } = {}) {
  const numId = Number(itemId);
  if (!numId || numId < 1) {
    throw new BlizzardApiError('Invalid numeric Item ID', { status: 400, code: 'INVALID_ITEM_ID' });
  }

  const [itemSettled, mediaSettled] = await Promise.allSettled([
    blizzardFetchStatic(`/data/wow/item/${numId}`, env, { stateConfig, fetchImpl, allow404: true }),
    blizzardFetchStatic(`/data/wow/media/item/${numId}`, env, { stateConfig, fetchImpl, allow404: true })
  ]);

  const itemJson = itemSettled.status === 'fulfilled' ? itemSettled.value : null;
  const mediaJson = mediaSettled.status === 'fulfilled' ? mediaSettled.value : null;

  const iconUrl = Array.isArray(mediaJson?.assets)
    ? (mediaJson.assets.find(a => a.key === 'icon')?.value || mediaJson.assets[0]?.value || null)
    : null;

  if (!itemJson) {
    return {
      found: false,
      id: numId,
      iconUrl,
      wowheadUrl: buildWowheadForeverItemUrl(numId),
      notFoundInStatic: true,
      syncedAt: new Date().toISOString()
    };
  }

  // Merge preview_item fields cleanly over top-level metadata
  const previewSource = itemJson.preview_item && typeof itemJson.preview_item === 'object'
    ? {
        ...itemJson.preview_item,
        id: itemJson.id,
        name: itemJson.name || itemJson.preview_item.name,
        quality: itemJson.quality || itemJson.preview_item.quality,
        level: itemJson.level || itemJson.preview_item.level,
        required_level: itemJson.required_level,
        item_class: itemJson.item_class || itemJson.preview_item.item_class,
        item_subclass: itemJson.item_subclass || itemJson.preview_item.item_subclass,
        inventory_type: itemJson.inventory_type || itemJson.preview_item.inventory_type,
        sell_price: itemJson.sell_price ?? itemJson.preview_item.sell_price
      }
    : itemJson;

  const normalized = normalizePreviewItem(previewSource, { fallbackId: numId });
  return {
    found: true,
    ...normalized,
    iconUrl,
    purchasePrice: Number(itemJson.purchase_price || 0),
    maxCount: Number(itemJson.max_count || 0),
    isStackable: Boolean(itemJson.is_stackable),
    isEquippable: Boolean(itemJson.is_equippable),
    notFoundInStatic: false,
    syncedAt: new Date().toISOString()
  };
}

/**
 * Search WoW: Forever items via Blizzard Item Search API
 */
export async function searchForeverItems(query, env, { stateConfig = null, page = 1, pageSize = 24, fetchImpl = fetch } = {}) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return { results: [], page: 1, pageCount: 0, totalCount: 0 };

  // Support direct numeric Item ID search (e.g. "19019")
  if (/^\d+$/.test(cleanQuery)) {
    const single = await fetchForeverItemDetails(Number(cleanQuery), env, { stateConfig, fetchImpl });
    return {
      results: [single],
      page: 1,
      pageCount: 1,
      totalCount: single.found ? 1 : 0,
      exactIdLookup: true
    };
  }

  const searchRes = await blizzardFetchStatic('/data/wow/search/item', env, {
    stateConfig,
    fetchImpl,
    params: {
      'name.en_US': cleanQuery,
      orderby: 'id',
      _page: page,
      _pageSize: Math.min(30, Math.max(1, pageSize))
    },
    allow404: true
  });

  const rawResults = Array.isArray(searchRes?.results) ? searchRes.results : [];
  const results = rawResults.map(entry => {
    const d = entry?.data || {};
    const nameLocalized = (typeof d.name === 'object' ? (d.name.en_US || Object.values(d.name)[0]) : d.name) || `Item #${d.id}`;
    const className = typeof d.item_class?.name === 'object' ? d.item_class.name.en_US : d.item_class?.name;
    const subclassName = typeof d.item_subclass?.name === 'object' ? d.item_subclass.name.en_US : d.item_subclass?.name;
    const invName = typeof d.inventory_type?.name === 'object' ? d.inventory_type.name.en_US : d.inventory_type?.name;
    const qualType = normalizeItemQuality(d.quality);

    return {
      found: true,
      id: Number(d.id || 0),
      name: String(nameLocalized),
      quality: qualType,
      level: Number(d.level || 0),
      requiredLevel: Number(d.required_level || 0),
      itemClass: className || null,
      itemSubclass: subclassName || null,
      inventoryType: d.inventory_type?.type || null,
      inventoryName: invName || null,
      isEquippable: Boolean(d.is_equippable),
      isStackable: Boolean(d.is_stackable),
      sellPrice: Number(d.sell_price || 0),
      iconUrl: null,
      wowheadUrl: buildWowheadForeverItemUrl(d.id)
    };
  }).filter(item => item.id > 0);

  return {
    results,
    page: Number(searchRes?.page || page),
    pageCount: Number(searchRes?.pageCount || 1),
    totalCount: Number(searchRes?.results?.length || results.length)
  };
}

/**
 * Fetch available WoW: Forever Rulesets
 */
export async function fetchForeverRulesets(env, { fetchImpl = fetch } = {}) {
  const indexJson = await blizzardFetch('/data/wow/ruleset/index', env, {
    namespace: FOREVER_DYNAMIC_NS,
    fetchImpl,
    allow404: true
  });

  const rulesets = Array.isArray(indexJson?.rulesets) && indexJson.rulesets.length
    ? indexJson.rulesets.map(r => ({ id: r.id, name: r.name }))
    : FOREVER_RULESETS;

  return { rulesets };
}

