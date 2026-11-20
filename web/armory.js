/**
 * Black Sands Exchange — WoW: Forever US Character Armory & Paperdoll Client
 *
 * Self-contained frontend module exposed on `window.BSEArmory` and initialized
 * by `web/app.js` on DOMContentLoaded.
 */
(function () {
  'use strict';

  const QUALITY_META = {
    POOR: { label: 'Poor', color: '#9d9d9d', cls: 'q-poor' },
    COMMON: { label: 'Common', color: '#ffffff', cls: 'q-common' },
    UNCOMMON: { label: 'Uncommon', color: '#1eff00', cls: 'q-uncommon' },
    RARE: { label: 'Rare', color: '#0070dd', cls: 'q-rare' },
    EPIC: { label: 'Epic', color: '#a335ee', cls: 'q-epic' },
    LEGENDARY: { label: 'Legendary', color: '#ff8000', cls: 'q-legendary' },
    ARTIFACT: { label: 'Artifact', color: '#e6cc80', cls: 'q-legendary' },
    HEIRLOOM: { label: 'Heirloom', color: '#00ccff', cls: 'q-rare' }
  };

  const CLASS_COLORS = {
    Warrior: '#C79C6E',
    Paladin: '#F58CBA',
    Hunter: '#ABD473',
    Rogue: '#FFF569',
    Priest: '#FFFFFF',
    Shaman: '#0070DE',
    Mage: '#69CCF0',
    Warlock: '#9482C9',
    Druid: '#FF7D0A'
  };

  const SLOT_LEFT = [
    { key: 'HEAD', label: 'Head', glyph: 'H' },
    { key: 'NECK', label: 'Neck', glyph: 'N' },
    { key: 'SHOULDER', label: 'Shoulders', glyph: 'S' },
    { key: 'BACK', label: 'Back', glyph: 'B' },
    { key: 'CHEST', label: 'Chest', glyph: 'C' },
    { key: 'SHIRT', label: 'Shirt', glyph: 'Sh' },
    { key: 'TABARD', label: 'Tabard', glyph: 'Tb' },
    { key: 'WRIST', label: 'Wrist', glyph: 'Wr' }
  ];

  const SLOT_RIGHT = [
    { key: 'HANDS', label: 'Hands', glyph: 'Ha' },
    { key: 'WAIST', label: 'Waist', glyph: 'Wa' },
    { key: 'LEGS', label: 'Legs', glyph: 'Le' },
    { key: 'FEET', label: 'Feet', glyph: 'Fe' },
    { key: 'FINGER_1', label: 'Finger 1', glyph: 'F1' },
    { key: 'FINGER_2', label: 'Finger 2', glyph: 'F2' },
    { key: 'TRINKET_1', label: 'Trinket 1', glyph: 'T1' },
    { key: 'TRINKET_2', label: 'Trinket 2', glyph: 'T2' }
  ];

  const SLOT_WEAPONS = [
    { key: 'MAIN_HAND', label: 'Main Hand', glyph: 'MH' },
    { key: 'OFF_HAND', label: 'Off Hand', glyph: 'OH' },
    { key: 'RANGED', label: 'Ranged / Relic', glyph: 'Rg' }
  ];

  let hostCtx = {
    getState: () => ({}),
    showToast: () => {},
    refreshBseState: async () => {},
    getDiscordAvatarUrl: () => 'assets/favicon.svg',
    resolveRankTitle: () => 'Initiate',
    openCharacterModal: () => {}
  };

  // Module UI state
  const uiState = {
    initialized: false,
    modalMemberId: null,
    modalSelectedCharSlug: null,
    modalActiveInnerTab: 'paperdoll',
    pendingVerifiedChar: null,
    recipeFilter: {
      charSlug: null,
      query: '',
      profession: 'all',
      category: 'all',
      sort: 'category'
    }
  };

  const RECIPE_CATEGORY_ORDER = [
    'Gear & Weapons',
    'Bombs & Gadgets',
    'Enchants & Enhancements',
    'Consumables & Potions',
    'Materials & Parts',
    'Tools & Utility'
  ];

  function getRecipeCharKey(snapshot, memberCharMeta) {
    return String(snapshot?.slug || memberCharMeta?.name || 'character').toLowerCase();
  }

  function syncRecipeFilterChar(snapshot, memberCharMeta) {
    const key = getRecipeCharKey(snapshot, memberCharMeta);
    if (uiState.recipeFilter.charSlug !== key) {
      uiState.recipeFilter = {
        charSlug: key,
        query: '',
        profession: 'all',
        category: 'all',
        sort: uiState.recipeFilter.sort || 'category'
      };
    }
  }

  function inferRecipeCategory(recipeName, profName) {
    const name = String(recipeName || '').trim().toLowerCase();
    const prof = String(profName || '').trim().toLowerCase();

    if (!name) return 'Tools & Utility';

    // Exact profession/base ability entries & crafting tools
    if (
      name === prof ||
      /^(find minerals|find herbs|basic campfire|fishing|cooking|first aid|mining|herbalism|skinning|poisons)$/i.test(name) ||
      /\b(runed .* rod|arclight spanner|gyromatic micro-adjustor|salt shaker|philosopher'?s stone|aquadynamic fish attractor|bright baubles|nightcrawlers|shiny bauble|flesh eating worm)\b/.test(name)
    ) {
      return 'Tools & Utility';
    }

    // Weapon/Armor Enchants, Scopes, Oils, Stones, Armor Kits, Spurs, Spikes
    if (
      /^enchant\b/.test(name) ||
      /\b(sharpening stone|weightstone|armor kit|weapon chain|shield spike|mithril spurs|wizard oil|mana oil|frost oil|shadow oil|scope|accurascope)\b/.test(name)
    ) {
      return 'Enchants & Enhancements';
    }

    // Bombs, Explosives, Gadgets, Dummies, Dragonlings, Reflectors & Crafted Ammo
    if (
      /\b(bomb|dynamite|grenade|sapper|mortar|seaforium|target dummy|dummy|dragonling|alarm-o-bot|repair bot|teleporter|transporter|defibrillator|reflector|deflector|death ray|shrink ray|net-o-matic|discombobulator|explosive sheep|jumper cables|firework|flare|recombobulator|battle chicken|mechanical squirrel|snowmaster|world enlarger|voice amplification|ultrasonic|paralyzing|mithril gyro-shot|thorium shells|hi-impact mithril slugs|crafted .* shot|solid shot|heavy shot|light shot)\b/.test(name)
    ) {
      return 'Bombs & Gadgets';
    }

    // Equippable Gear, Weapons, Cloaks, Jewelry & Bags (check before Materials so Mooncloth Bag -> Gear)
    if (
      /\b(helm|helmet|goggles|visor|monocle|headpiece|crown|circlet|hood|mask|cowl|cap|pauldrons|shoulders|mantle|spaulders|epaulets|cloak|cape|shroud|drape|chestplate|breastplate|cuirass|hauberk|tunic|vest|robe|shirt|tuxedo|dress|jacket|bracers|vambraces|wristguards|bindings|gauntlets|gloves|handwraps|belt|girdle|sash|waistband|leggings|legplates|legguards|pants|kilt|trousers|greaves|boots|sabatons|slippers|shoes|footpads|ring|band|amulet|necklace|pendant|talisman|shield|buckler|aegis|bulwark|axe|cleaver|hatchet|blade|sword|claymore|sabre|scimitar|rapier|mace|hammer|maul|warhammer|dagger|dirk|shiv|knife|spear|lance|halberd|polearm|staff|wand|bow|crossbow|gun|rifle|shotgun|blunderbuss|boomstick|musket|bag|pack|pouch|satchel|knapsack|quiver|ammo pouch|harness)\b/.test(name)
    ) {
      return 'Gear & Weapons';
    }

    // Consumables, Potions, Elixirs, Flasks, Food & First Aid (checked before Materials so Oil of Immolation/etc. work cleanly)
    if (
      /\b(elixir|potion|flask|brew|restorative|free action|swiftness|living action|mighty rage|limited invulnerability|oil of immolation|stoneshield|bandage|anti-venom|tea|steak|chops|trout|sagefish|wolf|boar|bear|raptor|kodo|buzzard|hyena|crocolisk|turtle|crab|clam|murloc|snapjaw|soup|stew|feast|bisque|chili|chowder|delight|surprise|kabob|omelet|roast|fillet|cod|catfish|snapper|mackerel|smallfish|squid|salmon|yellowtail|sunscale|halibut|lobster|sausage|bat wing|gizzard|liver pie|beer basted|spiced|cured ham|herb baked egg|gingerbread|eggnog|gumbo|dragonbreath|nightfin|poached|smoked|grilled|charred|cooked|roasted|boiled|baked|crispy|crunchy|savory|seasoned|venison|mutton|pork|ribs)\b/.test(name)
    ) {
      return 'Consumables & Potions';
    }

    // Materials, Smelting, Transmutes, Cloth Bolts, Cured Hides & Engineering Parts
    if (
      /^smelt\b/.test(name) ||
      /^transmute\b/.test(name) ||
      /^bolt of\b/.test(name) ||
      /\b(blasting powder|bolts|copper tube|bronze tube|mithril tube|thorium tube|framework|strut|contact|trigger|casing|widget|converter|power core|gyrochronatom|gizmo|modulator|wiring|grinding stone|flux|salt|thread|cured|enchanted leather|enchanted thorium|mooncloth|arcanite bar|lodestone|pearl|essence|refined|elemental earth|elemental fire|elemental water|elemental air)\b/.test(name) ||
      prof === 'mining' ||
      prof === 'herbalism' ||
      prof === 'skinning'
    ) {
      return 'Materials & Parts';
    }

    // Profession-level fallbacks for remaining specialized names
    if (prof === 'cooking' || prof === 'first aid' || prof === 'alchemy') {
      return 'Consumables & Potions';
    }
    if (prof === 'blacksmithing' || prof === 'tailoring' || prof === 'leatherworking') {
      return 'Gear & Weapons';
    }
    if (prof === 'engineering') {
      return 'Bombs & Gadgets';
    }

    return 'Tools & Utility';
  }

  function dedupeProfRecipes(recipes) {
    const seen = new Set();
    const result = [];
    for (const r of Array.isArray(recipes) ? recipes : []) {
      const name = String(r?.name || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ id: r.id ?? null, name });
    }
    return result;
  }

  function buildFlatLearnedRecipes(snapshot) {
    const profs = [
      ...(snapshot?.professions?.primaries || []).map(p => ({ ...p, kind: 'Primary' })),
      ...(snapshot?.professions?.secondaries || []).map(p => ({ ...p, kind: 'Secondary' }))
    ];
    const seenGlobal = new Set();
    const list = [];
    let index = 0;

    for (const p of profs) {
      const profName = String(p?.name || '').trim();
      const deduped = dedupeProfRecipes(p?.knownRecipes);
      for (const r of deduped) {
        const globalKey = `${profName.toLowerCase()}::${r.name.toLowerCase()}`;
        if (seenGlobal.has(globalKey)) continue;
        seenGlobal.add(globalKey);
        list.push({
          id: r.id,
          name: r.name,
          profession: profName,
          profKind: p.kind,
          category: inferRecipeCategory(r.name, profName),
          orderIndex: index++
        });
      }
    }
    return list;
  }

  function filterAndSortRecipes(allRecipes, filterState) {
    const query = String(filterState?.query || '').trim().toLowerCase();
    const prof = filterState?.profession || 'all';
    const cat = filterState?.category || 'all';
    const sort = filterState?.sort || 'category';

    // Base matches after profession + search query (used for dynamic category pill counts)
    const afterProfAndQuery = allRecipes.filter(r => {
      if (prof !== 'all' && r.profession.toLowerCase() !== prof.toLowerCase()) return false;
      if (query) {
        const hay = `${r.name} ${r.profession}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    const filtered = cat === 'all'
      ? afterProfAndQuery.slice()
      : afterProfAndQuery.filter(r => r.category === cat);

    if (sort === 'name-asc') {
      filtered.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'name-desc') {
      filtered.sort((a, b) => b.name.localeCompare(a.name));
    } else if (sort === 'profession') {
      filtered.sort((a, b) => {
        const pc = a.profession.localeCompare(b.profession);
        if (pc !== 0) return pc;
        return a.name.localeCompare(b.name);
      });
    } else if (sort === 'learned') {
      filtered.sort((a, b) => a.orderIndex - b.orderIndex);
    } else {
      // 'category'
      filtered.sort((a, b) => {
        const ia = RECIPE_CATEGORY_ORDER.indexOf(a.category);
        const ib = RECIPE_CATEGORY_ORDER.indexOf(b.category);
        if (ia !== ib) return ia - ib;
        return a.name.localeCompare(b.name);
      });
    }

    return { afterProfAndQuery, filtered };
  }

  function renderRecipeChipHtml(r, showCategoryTag = false) {
    const metaLabel = showCategoryTag ? `${r.profession} • ${r.category}` : r.profession;
    return `
      <button type="button" class="armory-recipe-chip" data-copy-recipe="${escAttr(r.name)}" title="${escAttr(`${r.name} — ${r.profession} (${r.category}). Click to copy recipe name.`)}">
        <span class="armory-recipe-chip-name">${escHtml(r.name)}</span>
        <span class="armory-recipe-chip-meta">${escHtml(metaLabel)}</span>
      </button>
    `;
  }

  function renderRecipeCategoryPillsHtml(afterProfAndQuery, activeCategory) {
    const counts = new Map();
    for (const r of afterProfAndQuery) {
      counts.set(r.category, (counts.get(r.category) || 0) + 1);
    }
    const pills = [
      `<button type="button" class="armory-recipe-cat-pill ${activeCategory === 'all' ? 'active' : ''}" data-recipe-cat="all">All <span class="armory-recipe-cat-count">${afterProfAndQuery.length}</span></button>`
    ];
    for (const cat of RECIPE_CATEGORY_ORDER) {
      const count = counts.get(cat) || 0;
      if (count === 0 && activeCategory !== cat) continue;
      pills.push(
        `<button type="button" class="armory-recipe-cat-pill ${activeCategory === cat ? 'active' : ''}" data-recipe-cat="${escAttr(cat)}">${escHtml(cat)} <span class="armory-recipe-cat-count">${count}</span></button>`
      );
    }
    return pills.join('');
  }

  function renderRecipeResultsHtml(filtered, sortMode) {
    if (!filtered.length) {
      return `
        <div class="armory-recipe-empty">
          <p>No learned recipes match your current search or filters.</p>
          <button type="button" class="btn btn-secondary btn-sm" data-reset-recipe-filters>Reset Filters</button>
        </div>
      `;
    }

    if (sortMode === 'category' || sortMode === 'profession') {
      const groups = new Map();
      const groupOrder = sortMode === 'category' ? RECIPE_CATEGORY_ORDER : [];
      for (const r of filtered) {
        const key = sortMode === 'category' ? r.category : r.profession;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      }

      const orderedKeys = sortMode === 'category'
        ? groupOrder.filter(k => groups.has(k))
        : Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));

      return orderedKeys.map(groupName => {
        const items = groups.get(groupName) || [];
        return `
          <div class="armory-recipe-group">
            <div class="armory-recipe-group-header">
              <span class="armory-recipe-group-title">${escHtml(groupName)}</span>
              <span class="armory-recipe-group-count">${items.length}</span>
            </div>
            <div class="armory-recipe-chips">
              ${items.map(r => renderRecipeChipHtml(r, sortMode === 'profession')).join('')}
            </div>
          </div>
        `;
      }).join('');
    }

    return `
      <div class="armory-recipe-chips">
        ${filtered.map(r => renderRecipeChipHtml(r, true)).join('')}
      </div>
    `;
  }

  function updateRecipeExplorerUI(containerEl, allRecipes) {
    const resultsEl = containerEl.querySelector('#armoryRecipeResults');
    if (!resultsEl) return;

    const { afterProfAndQuery, filtered } = filterAndSortRecipes(allRecipes, uiState.recipeFilter);

    const pillsEl = containerEl.querySelector('#armoryRecipeCategoryPills');
    if (pillsEl) {
      pillsEl.innerHTML = renderRecipeCategoryPillsHtml(afterProfAndQuery, uiState.recipeFilter.category);
    }

    const countEl = containerEl.querySelector('#armoryRecipeCountLabel');
    if (countEl) {
      countEl.textContent = filtered.length === allRecipes.length
        ? `${allRecipes.length} learned`
        : `${filtered.length} of ${allRecipes.length}`;
    }

    const activeProfWrap = containerEl.querySelector('#armoryRecipeActiveProfWrap');
    if (activeProfWrap) {
      const prof = uiState.recipeFilter.profession;
      activeProfWrap.innerHTML = prof && prof !== 'all'
        ? `<button type="button" class="armory-active-prof-tag" data-clear-prof-filter title="Clear profession filter">${escHtml(prof)} &times;</button>`
        : '';
    }

    const clearBtn = containerEl.querySelector('#btnClearArmoryRecipeSearch');
    if (clearBtn) {
      clearBtn.classList.toggle('hidden', !String(uiState.recipeFilter.query || '').trim());
    }

    containerEl.querySelectorAll('.armory-prof-card[data-filter-prof]').forEach(card => {
      const cardProf = card.getAttribute('data-filter-prof') || '';
      const isSelected = uiState.recipeFilter.profession !== 'all' &&
        uiState.recipeFilter.profession.toLowerCase() === cardProf.toLowerCase();
      card.classList.toggle('active', isSelected);
      card.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    });

    resultsEl.innerHTML = renderRecipeResultsHtml(filtered, uiState.recipeFilter.sort);
  }

  // Client-side memory cache & tooltip registry
  const characterCache = new Map();
  const tooltipItemRegistry = new Map();
  let tooltipSeq = 0;
  let tooltipPinned = false;
  let tooltipPinnedId = null;

  function escHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escAttr(str) {
    return escHtml(str);
  }

  function sanitizeUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (raw.startsWith('https://') || raw.startsWith('http://') || raw.startsWith('/')) {
      return raw;
    }
    return '';
  }

  function classBadgeCss(className) {
    return 'class-' + String(className || 'Warrior').trim().toLowerCase().replace(/\s+/g, '-');
  }

  function qualityInfo(quality) {
    const key = String(quality || 'COMMON').toUpperCase();
    return QUALITY_META[key] || QUALITY_META.COMMON;
  }

  function buildCharSlugClient(name = '', surname = '') {
    const clean = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, '');
    const n = clean(name);
    const s = clean(surname);
    if (!n) return '';
    if (n.includes('-') && !s) return n;
    return s ? `${n}-${s}` : n;
  }

  function formatRelativeTime(iso) {
    if (!iso) return 'Never';
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return 'Recently';
    const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (diffSec < 60) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return `${Math.floor(diffSec / 86400)}d ago`;
  }

  function formatWowCoinsHtml(copperInput) {
    const copper = Number(copperInput);
    if (!Number.isFinite(copper) || copper <= 0) {
      return '<span class="coin-na">&mdash;</span>';
    }
    const total = Math.round(copper);
    const g = Math.floor(total / 10000);
    const s = Math.floor((total % 10000) / 100);
    const c = total % 100;
    const parts = [];
    if (g > 0) parts.push(`<span class="wow-coin coin-g">${g.toLocaleString()}<i class="coin-dot g" aria-hidden="true"></i></span>`);
    if (s > 0 || g > 0) parts.push(`<span class="wow-coin coin-s">${s}<i class="coin-dot s" aria-hidden="true"></i></span>`);
    parts.push(`<span class="wow-coin coin-c">${c}<i class="coin-dot c" aria-hidden="true"></i></span>`);
    return `<span class="wow-coins-wrap">${parts.join('')}</span>`;
  }

  function buildClassCrestSvg(className = 'Warrior') {
    const color = CLASS_COLORS[className] || '#ffd100';
    const glyph = String(className || 'W').slice(0, 2).toUpperCase();
    return `
      <svg class="armory-class-crest-svg" viewBox="0 0 120 140" role="img" aria-label="${escAttr(className)} Crest">
        <defs>
          <radialGradient id="crestGlow_${escAttr(glyph)}" cx="50%" cy="42%" r="54%">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.34"/>
            <stop offset="70%" stop-color="${color}" stop-opacity="0.08"/>
            <stop offset="100%" stop-color="#090b0f" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <circle cx="60" cy="64" r="54" fill="url(#crestGlow_${escAttr(glyph)})"/>
        <path d="M60 12 L102 28 V66 C102 95 82 117 60 128 C38 117 18 95 18 66 V28 Z"
          fill="#10141f" stroke="${color}" stroke-width="2.5" stroke-opacity="0.72"/>
        <path d="M60 22 L93 34 V64 C93 88 77 106 60 116 C43 106 27 88 27 64 V34 Z"
          fill="none" stroke="#ffd100" stroke-width="1" stroke-opacity="0.28"/>
        <text x="60" y="75" text-anchor="middle" fill="${color}" font-family="Cinzel, Georgia, serif"
          font-size="28" font-weight="800" letter-spacing="2">${escHtml(glyph)}</text>
      </svg>
    `;
  }

  // =========================================================================
  // WOW ITEM TOOLTIP ENGINE (#wowTooltipPortal)
  // =========================================================================

  function registerTooltipItem(item) {
    if (!item || typeof item !== 'object') return null;
    const key = `tip_${++tooltipSeq}`;
    tooltipItemRegistry.set(key, item);
    if (tooltipItemRegistry.size > 400) {
      const oldest = tooltipItemRegistry.keys().next().value;
      tooltipItemRegistry.delete(oldest);
    }
    return key;
  }

  function buildTooltipInnerHtml(item, { includeActions = false } = {}) {
    const q = qualityInfo(item.quality);
    const wowheadHref = sanitizeUrl(item.wowheadUrl || (item.id ? `https://www.wowhead.com/forever/item=${item.id}` : ''));

    const subTypeRow = (item.inventoryName || item.itemSubclass || item.itemClass)
      ? `<div class="wt-row-split">
           <span>${escHtml(item.inventoryName || item.slotName || item.itemClass || '')}</span>
           <span>${escHtml(item.itemSubclass && item.itemSubclass !== item.inventoryName ? item.itemSubclass : '')}</span>
         </div>`
      : '';

    const weaponHtml = item.weapon && (item.weapon.damage || item.weapon.dps || item.weapon.attackSpeed)
      ? `<div class="wt-row-split">
           <span>${escHtml(item.weapon.damage || '')}</span>
           <span>${escHtml(item.weapon.attackSpeed || '')}</span>
         </div>
         ${item.weapon.dps ? `<div class="wt-line">${escHtml(item.weapon.dps)}</div>` : ''}`
      : '';

    const statsHtml = Array.isArray(item.stats) && item.stats.length
      ? item.stats.map(st => {
          const cls = st.isEquipBonus ? 'wt-green' : (st.isNegated ? 'wt-red' : 'wt-white');
          return `<div class="${cls}">${escHtml(st.label)}</div>`;
        }).join('')
      : '';

    const enchantsHtml = Array.isArray(item.enchantments) && item.enchantments.length
      ? item.enchantments.map(enc => `<div class="wt-green">${escHtml(enc.display)}</div>`).join('')
      : '';

    const spellsHtml = Array.isArray(item.spells) && item.spells.length
      ? item.spells.map(sp => `<div class="wt-green">${escHtml(sp.description || sp.spellName)}</div>`).join('')
      : '';

    const setHtml = item.set && item.set.name
      ? `<div class="wt-set-block">
           <div class="wt-gold">${escHtml(item.set.display || item.set.name)}</div>
           ${(item.set.effects || []).map(ef =>
             `<div class="${ef.isActive ? 'wt-green' : 'wt-dim'}">${escHtml(ef.display)}</div>`
           ).join('')}
         </div>`
      : '';

    const ahHtml = item.ahPrice && item.ahPrice.min > 0
      ? `<div class="wt-ah-block">
           <div><span>AH Min:</span> ${formatWowCoinsHtml(item.ahPrice.min)}</div>
           <div><span>Median:</span> ${formatWowCoinsHtml(item.ahPrice.median)} <span class="wt-dim">(${item.ahPrice.qty} listed)</span></div>
         </div>`
      : '';

    const actionsHtml = includeActions
      ? `<div class="wt-actions-bar">
           ${wowheadHref ? `<a href="${escAttr(wowheadHref)}" target="_blank" rel="noopener noreferrer" class="wt-link-btn">Wowhead Forever &nearr;</a>` : ''}
           ${item.id ? `<button type="button" class="wt-copy-btn" data-copy-item-id="${escAttr(String(item.id))}">Copy ID #${escHtml(String(item.id))}</button>` : ''}
           <button type="button" class="wt-close-btn" data-close-wow-tooltip="1">Close</button>
         </div>`
      : '';

    return `
      <div class="wt-title" style="color:${q.color};">${escHtml(item.name || `Item #${item.id || ''}`)}</div>
      ${item.level ? `<div class="wt-gold">Item Level ${escHtml(String(item.level))}</div>` : ''}
      ${item.binding ? `<div class="wt-white">${escHtml(item.binding)}</div>` : ''}
      ${item.uniqueEquipped ? `<div class="wt-white">${escHtml(item.uniqueEquipped)}</div>` : ''}
      ${subTypeRow}
      ${weaponHtml}
      ${item.armorDisplay ? `<div class="wt-white">${escHtml(item.armorDisplay)}</div>` : ''}
      ${statsHtml}
      ${enchantsHtml}
      ${item.durability ? `<div class="wt-white">${escHtml(item.durability)}</div>` : ''}
      ${item.requiredLevel > 0 ? `<div class="wt-white">Requires Level ${escHtml(String(item.requiredLevel))}</div>` : ''}
      ${spellsHtml}
      ${setHtml}
      ${item.description ? `<div class="wt-gold wt-flavor">"${escHtml(item.description)}"</div>` : ''}
      ${item.sellPrice > 0 ? `<div class="wt-sell-row">Sell Price: ${formatWowCoinsHtml(item.sellPrice)}</div>` : ''}
      ${ahHtml}
      ${item.notFoundInStatic && !statsHtml && !spellsHtml ? `<div class="wt-dim">Legacy item stub &mdash; view full stats on Wowhead Forever.</div>` : ''}
      ${actionsHtml}
    `;
  }

  function positionTooltipNear(portal, anchorRect, clientX, clientY) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 12;

    portal.style.visibility = 'hidden';
    portal.style.display = 'block';
    const rect = portal.getBoundingClientRect();

    let left;
    let top;

    if (vw < 540 || !Number.isFinite(clientX) || clientX <= 0) {
      // Anchor cleanly centered relative to target or bottom edge on narrow phones
      left = Math.round((vw - rect.width) / 2);
      if (anchorRect) {
        const spaceBelow = vh - anchorRect.bottom - margin;
        if (spaceBelow >= rect.height + 10) {
          top = anchorRect.bottom + 8;
        } else {
          top = Math.max(margin, anchorRect.top - rect.height - 8);
        }
      } else {
        top = Math.round((vh - rect.height) / 2);
      }
    } else {
      left = clientX + 16;
      top = clientY + 14;
      if (left + rect.width + margin > vw) {
        left = clientX - rect.width - 16;
      }
      if (top + rect.height + margin > vh) {
        top = vh - rect.height - margin;
      }
    }

    left = Math.max(margin, Math.min(vw - rect.width - margin, left));
    top = Math.max(margin, Math.min(vh - rect.height - margin, top));

    portal.style.left = `${left}px`;
    portal.style.top = `${top}px`;
    portal.style.visibility = 'visible';
    portal.setAttribute('aria-hidden', 'false');
  }

  function showTooltipForElement(el, ev, { pinned = false } = {}) {
    const tipId = el.getAttribute('data-wow-tip');
    if (!tipId) return;
    const item = tooltipItemRegistry.get(tipId);
    const portal = document.getElementById('wowTooltipPortal');
    if (!item || !portal) return;

    tooltipPinned = pinned;
    tooltipPinnedId = pinned ? tipId : null;
    portal.classList.toggle('is-pinned', pinned);
    portal.innerHTML = buildTooltipInnerHtml(item, { includeActions: pinned });

    const anchorRect = el.getBoundingClientRect();
    const cx = ev && typeof ev.clientX === 'number' && ev.clientX > 0 ? ev.clientX : anchorRect.left + anchorRect.width / 2;
    const cy = ev && typeof ev.clientY === 'number' && ev.clientY > 0 ? ev.clientY : anchorRect.top + anchorRect.height / 2;
    positionTooltipNear(portal, anchorRect, cx, cy);
  }

  function hideTooltip(force = false) {
    if (tooltipPinned && !force) return;
    tooltipPinned = false;
    tooltipPinnedId = null;
    const portal = document.getElementById('wowTooltipPortal');
    if (!portal) return;
    portal.style.display = 'none';
    portal.classList.remove('is-pinned');
    portal.setAttribute('aria-hidden', 'true');
  }

  function bindGlobalTooltipHandlers() {
    document.addEventListener('mouseover', (e) => {
      if (tooltipPinned) return;
      const target = e.target.closest?.('[data-wow-tip]');
      if (!target) return;
      showTooltipForElement(target, e, { pinned: false });
    });

    document.addEventListener('mousemove', (e) => {
      if (tooltipPinned) return;
      const portal = document.getElementById('wowTooltipPortal');
      if (!portal || portal.style.display === 'none') return;
      const target = e.target.closest?.('[data-wow-tip]');
      if (!target) {
        hideTooltip(false);
        return;
      }
      positionTooltipNear(portal, target.getBoundingClientRect(), e.clientX, e.clientY);
    });

    document.addEventListener('mouseout', (e) => {
      if (tooltipPinned) return;
      const target = e.target.closest?.('[data-wow-tip]');
      if (!target) return;
      const related = e.relatedTarget?.closest?.('[data-wow-tip]');
      if (related !== target) {
        hideTooltip(false);
      }
    });

    document.addEventListener('click', (e) => {
      const closeBtn = e.target.closest?.('[data-close-wow-tooltip]');
      if (closeBtn) {
        hideTooltip(true);
        return;
      }

      const copyBtn = e.target.closest?.('[data-copy-item-id]');
      if (copyBtn) {
        const id = copyBtn.getAttribute('data-copy-item-id');
        copyToClipboard(id, `Copied Item ID #${id}`);
        return;
      }

      const portalClick = e.target.closest?.('#wowTooltipPortal');
      if (portalClick) return;

      const tipTarget = e.target.closest?.('[data-wow-tip]');
      if (tipTarget) {
        const id = tipTarget.getAttribute('data-wow-tip');
        if (tooltipPinned && tooltipPinnedId === id) {
          hideTooltip(true);
        } else {
          showTooltipForElement(tipTarget, e, { pinned: true });
        }
        return;
      }

      if (tooltipPinned) {
        hideTooltip(true);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideTooltip(true);
      }
    });
  }

  function copyToClipboard(text, message = 'Copied to clipboard') {
    const val = String(text || '');
    if (!val) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(val).then(() => hostCtx.showToast(message)).catch(() => hostCtx.showToast(message));
    } else {
      hostCtx.showToast(`${message}: ${val}`);
    }
  }

  // =========================================================================
  // PAPERDOLL & CHARACTER ARMORY RENDERER (SHARED BY MODAL & AD-HOC LOOKUP)
  // =========================================================================

  function renderSlotBox(slotDef, equippedItem, alignRight = false) {
    if (!equippedItem) {
      return `
        <div class="armory-slot-row empty ${alignRight ? 'align-right' : ''}">
          <div class="armory-slot-icon-frame is-empty" title="${escAttr(slotDef.label)} (Empty)">
            <span class="armory-slot-glyph">${escHtml(slotDef.glyph)}</span>
          </div>
          <div class="armory-slot-text">
            <span class="armory-slot-empty-label">${escHtml(slotDef.label)}</span>
          </div>
        </div>
      `;
    }

    const q = qualityInfo(equippedItem.quality);
    const tipKey = registerTooltipItem(equippedItem);
    const iconUrl = sanitizeUrl(equippedItem.iconUrl);
    const enchantText = equippedItem.enchantments?.[0]?.display || '';

    return `
      <button type="button" class="armory-slot-row equipped ${q.cls} ${alignRight ? 'align-right' : ''}"
        data-wow-tip="${escAttr(tipKey)}" aria-label="${escAttr(`${slotDef.label}: ${equippedItem.name}`)}">
        <div class="armory-slot-icon-frame" style="border-color: ${q.color};">
          ${iconUrl
            ? `<img src="${escAttr(iconUrl)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
               <span class="armory-slot-glyph" style="display:none;">${escHtml(slotDef.glyph)}</span>`
            : `<span class="armory-slot-glyph">${escHtml(slotDef.glyph)}</span>`
          }
          ${equippedItem.level ? `<span class="armory-slot-ilvl">${escHtml(String(equippedItem.level))}</span>` : ''}
        </div>
        <div class="armory-slot-text">
          <span class="armory-slot-name" style="color:${q.color};">${escHtml(equippedItem.name)}</span>
          ${enchantText
            ? `<span class="armory-slot-sub wt-green">${escHtml(enchantText)}</span>`
            : `<span class="armory-slot-sub">${escHtml(slotDef.label)}</span>`
          }
        </div>
      </button>
    `;
  }

  function parseStoredProfessions(rawStr) {
    return String(rawStr || '')
      .split(/[,;|\n•]+|\s+\/\s+|(?<=[a-zA-Z])\s*\/\s*(?=[a-zA-Z])/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function renderInlineProfessionsStrip(snapshot, memberCharMeta = null, { hasViewAllHandler = false } = {}) {
    const primaries = (snapshot?.professions?.primaries || []).map(p => ({ ...p, kind: 'Primary' }));
    const secondaries = (snapshot?.professions?.secondaries || []).map(p => ({ ...p, kind: 'Secondary' }));
    const profs = [...primaries, ...secondaries];
    const storedTags = parseStoredProfessions(memberCharMeta?.professions);

    let bodyHtml = '';
    if (profs.length) {
      const totalRecipes = buildFlatLearnedRecipes(snapshot).length;
      const totalExtraRecipes = profs.reduce((sum, p) => {
        const recLen = dedupeProfRecipes(p.knownRecipes).length;
        return sum + Math.max(0, recLen - 6);
      }, 0);
      bodyHtml = `
        <div class="armory-inline-profs-grid">
          ${profs.map(p => {
            const pct = p.maxSkillPoints > 0 ? Math.min(100, Math.round((p.skillPoints / p.maxSkillPoints) * 100)) : 0;
            const recipes = Array.isArray(p.knownRecipes) ? p.knownRecipes : [];
            return `
              <div class="armory-inline-prof-card">
                <div class="armory-inline-prof-head">
                  <div>
                    <strong>${escHtml(p.name)}</strong>
                    <span class="armory-inline-prof-kind">${escHtml(p.kind)}${p.tierName ? ` &bull; ${escHtml(p.tierName)}` : ''}</span>
                  </div>
                  <span class="gold armory-inline-prof-pts">${escHtml(String(p.skillPoints))} / ${escHtml(String(p.maxSkillPoints))}</span>
                </div>
                <div class="progress-bar-bg" style="height:5px; margin: 0.35rem 0 0.45rem;">
                  <div class="progress-bar-fill" style="width:${pct}%;"></div>
                </div>
                ${recipes.length
                  ? `<div class="armory-recipe-chips">
                       ${recipes.slice(0, 6).map(r => `<span class="armory-talent-pill">${escHtml(r.name)}</span>`).join('')}
                       ${recipes.length > 6 ? `<span class="subview-hint">+${recipes.length - 6} more</span>` : ''}
                     </div>`
                  : `<span class="subview-hint">Recorded on Blizzard Armory</span>`
                }
              </div>
            `;
          }).join('')}
        </div>
        ${(totalRecipes > 0 || totalExtraRecipes > 0 || (snapshot?.reputations || []).length > 0) && hasViewAllHandler
          ? `<div class="armory-inline-profs-footer">
               ${totalRecipes > 0
                 ? `<div class="armory-inline-profs-jumps">
                      ${profs.map(p => {
                        const cnt = dedupeProfRecipes(p.knownRecipes).length;
                        if (!cnt) return '';
                        return `<button type="button" class="armory-inline-jump-pill" data-jump-prof="${escAttr(p.name)}" title="Browse & search ${escAttr(p.name)} recipes">${escHtml(p.name)} (${cnt})</button>`;
                      }).join('')}
                    </div>`
                 : ''
               }
               <button type="button" class="btn-link-subtle armory-view-all-profs-btn">${totalRecipes > 0 ? `Search &amp; Browse All ${totalRecipes} Recipes &rarr;` : 'View All Recipes &amp; Reputations &rarr;'}</button>
             </div>`
          : ''
        }
      `;
    } else if (storedTags.length) {
      bodyHtml = `
        <div class="armory-inline-prof-chips">
          ${storedTags.map(tag => `<span class="armory-prof-chip">${escHtml(tag)}</span>`).join('')}
        </div>
      `;
    } else {
      bodyHtml = `<div class="armory-empty-note" style="padding:0.65rem;">No professions recorded for this character yet.</div>`;
    }

    return `
      <div class="armory-inline-profs-section">
        <div class="armory-inline-profs-title-row">
          <h6 class="armory-section-label" style="margin:0;">Professions &amp; Skills</h6>
          ${profs.length ? `<span class="subview-hint">${primaries.length} Primary &bull; ${secondaries.length} Secondary</span>` : ''}
        </div>
        ${bodyHtml}
      </div>
    `;
  }

  function renderPaperdollTab(snapshot, memberCharMeta = null, { hasViewAllHandler = false } = {}) {
    const equipmentBySlot = new Map();
    for (const eq of snapshot.equipment || []) {
      if (eq.slotType) {
        equipmentBySlot.set(String(eq.slotType).toUpperCase(), eq);
      }
    }

    const className = snapshot.className || memberCharMeta?.class || 'Warrior';
    const classColor = CLASS_COLORS[className] || '#ffd100';
    const mainRaw = sanitizeUrl(snapshot.media?.mainRaw || snapshot.media?.inset || '');
    const leftHtml = SLOT_LEFT.map(s => renderSlotBox(s, equipmentBySlot.get(s.key), false)).join('');
    const rightHtml = SLOT_RIGHT.map(s => renderSlotBox(s, equipmentBySlot.get(s.key), true)).join('');
    const weaponsHtml = SLOT_WEAPONS.map(s => renderSlotBox(s, equipmentBySlot.get(s.key), false)).join('');

    return `
      <div class="armory-paperdoll-grid">
        <div class="armory-slots-col armory-slots-left">
          ${leftHtml}
        </div>

        <div class="armory-model-stage">
          <div class="armory-model-frame" style="border-color: ${classColor}40;">
            ${mainRaw
              ? `<img src="${escAttr(mainRaw)}" alt="${escAttr(snapshot.displayName || snapshot.name)}" class="armory-main-render"
                   onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                 <div class="armory-crest-fallback" style="display:none;">
                   ${buildClassCrestSvg(className)}
                   <span class="armory-crest-caption">${escHtml(snapshot.race || '')} ${escHtml(className)}</span>
                 </div>`
              : `<div class="armory-crest-fallback">
                   ${buildClassCrestSvg(className)}
                   <span class="armory-crest-caption">${escHtml(snapshot.race || '')} ${escHtml(className)}</span>
                 </div>`
            }
          </div>
          <div class="armory-stage-pills">
            ${snapshot.level ? `<span class="armory-stat-chip">Level <strong>${escHtml(String(snapshot.level))}</strong></span>` : ''}
            ${snapshot.avgItemLevel ? `<span class="armory-stat-chip">Avg iLvl <strong>${escHtml(String(snapshot.avgItemLevel))}</strong></span>` : ''}
            ${snapshot.activeSpec ? `<span class="armory-stat-chip">${escHtml(snapshot.activeSpec)}</span>` : ''}
            <span class="armory-stat-chip">${escHtml(String((snapshot.equipment || []).length))} Equipped</span>
          </div>
          <div class="armory-tooltip-hint">Hover or tap any equipped slot to inspect stats &amp; enchants.</div>
        </div>

        <div class="armory-slots-col armory-slots-right">
          ${rightHtml}
        </div>
      </div>

      <div class="armory-weapons-row">
        ${weaponsHtml}
      </div>

      ${renderInlineProfessionsStrip(snapshot, memberCharMeta, { hasViewAllHandler })}
    `;
  }

  function renderStatsAndTalentsTab(snapshot) {
    const s = snapshot.statistics || {};
    const fmt = (v, suffix = '') => (v !== null && v !== undefined ? `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}` : '&mdash;');

    const statCard = (title, rows) => `
      <div class="armory-stat-card">
        <h6>${escHtml(title)}</h6>
        ${rows.map(([lbl, val, highlight]) => `
          <div class="armory-stat-line">
            <span>${escHtml(lbl)}</span>
            <strong class="${highlight ? 'gold' : ''}">${val}</strong>
          </div>
        `).join('')}
      </div>
    `;

    const primaryStats = statCard('Vitals & Primary', [
      ['Health', fmt(s.health), true],
      [s.powerType || 'Resource', fmt(s.power), true],
      ['Strength', fmt(s.strength)],
      ['Agility', fmt(s.agility)],
      ['Stamina', fmt(s.stamina)],
      ['Intellect', fmt(s.intellect)],
      ['Spirit', fmt(s.spirit)],
      ['Armor', fmt(s.armor)]
    ]);

    const offensiveStats = statCard('Combat & Spell', [
      ['Attack Power', fmt(s.attackPower)],
      ['Ranged AP', fmt(s.rangedAttackPower)],
      ['Melee Crit', fmt(s.meleeCrit, '%')],
      ['Ranged Crit', fmt(s.rangedCrit, '%')],
      ['Spell Power', fmt(s.spellPower), true],
      ['Spell Crit', fmt(s.spellCrit, '%')],
      ['Dodge', fmt(s.dodge, '%')],
      ['Parry / Block', `${fmt(s.parry, '%')} / ${fmt(s.block, '%')}`]
    ]);

    const resistances = statCard('Classic Resistances', [
      ['Fire Resistance', fmt(s.fireResistance)],
      ['Frost Resistance', fmt(s.frostResistance)],
      ['Nature Resistance', fmt(s.natureResistance)],
      ['Shadow Resistance', fmt(s.shadowResistance)],
      ['Arcane Resistance', fmt(s.arcaneResistance)]
    ]);

    const groups = snapshot.specializations?.groups || [];
    const activeGrp = groups.find(g => g.isActive) || groups[0];
    let talentsHtml = '<div class="armory-empty-note">Talent data not yet reported by WoW: Forever API for this character.</div>';
    if (activeGrp?.trees?.length) {
      const totalPts = activeGrp.trees.reduce((sum, t) => sum + (t.spentPoints || 0), 0) || 1;
      talentsHtml = `
        <div class="armory-talent-trees">
          ${activeGrp.trees.map(t => {
            const pct = Math.min(100, Math.round(((t.spentPoints || 0) / Math.max(51, totalPts)) * 100));
            return `
              <div class="armory-talent-tree-card">
                <div class="armory-talent-tree-head">
                  <strong>${escHtml(t.name)}</strong>
                  <span class="gold">${escHtml(String(t.spentPoints || 0))} pts</span>
                </div>
                <div class="progress-bar-bg" style="height:6px; margin: 0.35rem 0 0.55rem;">
                  <div class="progress-bar-fill" style="width:${pct}%;"></div>
                </div>
                ${(t.talents || []).length
                  ? `<div class="armory-talent-pills">
                       ${t.talents.map(tal => `<span class="armory-talent-pill" title="${escAttr(tal.description || tal.name)}">${escHtml(tal.name)} <b>${tal.rank}</b></span>`).join('')}
                     </div>`
                  : `<span class="subview-hint">No points invested</span>`
                }
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    return `
      <div class="armory-stats-grid">
        ${primaryStats}
        ${offensiveStats}
        ${resistances}
      </div>
      <div style="margin-top: 1rem;">
        <h5 class="armory-section-label">Specializations &amp; Talents</h5>
        ${talentsHtml}
      </div>
    `;
  }

  function renderProfessionsAndRepsTab(snapshot, memberCharMeta = null) {
    syncRecipeFilterChar(snapshot, memberCharMeta);
    const profs = [
      ...(snapshot.professions?.primaries || []).map(p => ({ ...p, kind: 'Primary' })),
      ...(snapshot.professions?.secondaries || []).map(p => ({ ...p, kind: 'Secondary' }))
    ];
    const storedTags = parseStoredProfessions(memberCharMeta?.professions);
    const allRecipes = buildFlatLearnedRecipes(snapshot);

    let profsHtml = '';
    if (profs.length) {
      profsHtml = profs.map(p => {
        const pct = p.maxSkillPoints > 0 ? Math.min(100, Math.round((p.skillPoints / p.maxSkillPoints) * 100)) : 0;
        const recipes = dedupeProfRecipes(p.knownRecipes);
        const isFilterable = recipes.length > 0;
        const isSelected = isFilterable &&
          uiState.recipeFilter.profession !== 'all' &&
          uiState.recipeFilter.profession.toLowerCase() === String(p.name || '').toLowerCase();
        return `
          <div class="armory-prof-card${isFilterable ? ' is-filterable' : ''}${isSelected ? ' active' : ''}"${isFilterable ? ` data-filter-prof="${escAttr(p.name)}" role="button" tabindex="0" aria-pressed="${isSelected ? 'true' : 'false'}"` : ''}>
            <div class="armory-prof-header">
              <div>
                <strong>${escHtml(p.name)}</strong>
                <span class="armory-prof-kind">${escHtml(p.kind)}${p.tierName ? ` &bull; ${escHtml(p.tierName)}` : ''}</span>
              </div>
              <span class="gold" style="font-weight:700;">${escHtml(String(p.skillPoints))} / ${escHtml(String(p.maxSkillPoints))}</span>
            </div>
            <div class="progress-bar-bg" style="height:6px; margin: 0.4rem 0 0.55rem;">
              <div class="progress-bar-fill" style="width:${pct}%;"></div>
            </div>
            ${recipes.length
              ? `<div class="armory-prof-card-meta">
                   <span>${recipes.length} learned ${recipes.length === 1 ? 'recipe' : 'recipes'}</span>
                   <span class="armory-prof-filter-hint">${isSelected ? 'Filtered (click to show all)' : 'Click to filter'}</span>
                 </div>`
              : `<span class="subview-hint">No recipes synced yet for ${escHtml(p.name)}.</span>`
            }
          </div>
        `;
      }).join('');
    } else if (storedTags.length) {
      profsHtml = `
        <div class="armory-prof-card">
          <div class="armory-prof-header"><strong>Recorded Professions</strong></div>
          <div class="armory-inline-prof-chips" style="margin-top:0.5rem;">
            ${storedTags.map(tag => `<span class="armory-prof-chip">${escHtml(tag)}</span>`).join('')}
          </div>
        </div>
      `;
    } else {
      profsHtml = `<div class="armory-empty-note">No professions recorded on Battle.net Armory yet.</div>`;
    }

    const reps = [...(snapshot.reputations || [])].sort((a, b) => (b.tier - a.tier) || (b.raw - a.raw));
    const standingClass = (standing) => {
      const s = String(standing || '').toLowerCase();
      if (s.includes('exalted')) return 'rep-exalted';
      if (s.includes('revered')) return 'rep-revered';
      if (s.includes('honored')) return 'rep-honored';
      if (s.includes('friendly')) return 'rep-friendly';
      if (s.includes('hostile') || s.includes('hated') || s.includes('unfriendly')) return 'rep-hostile';
      return 'rep-neutral';
    };

    const repsHtml = reps.length
      ? `<div class="armory-reps-grid">
           ${reps.slice(0, 24).map(r => {
             const max = Math.max(1, Number(r.max || 3000));
             const val = Math.max(0, Number(r.value || 0));
             const pct = Math.min(100, Math.round((val / max) * 100));
             const cls = standingClass(r.standing);
             return `
               <div class="armory-rep-row">
                 <div class="armory-rep-top">
                   <span class="armory-rep-name">${escHtml(r.name)}</span>
                   <span class="armory-rep-standing ${cls}">${escHtml(r.standing)} (${val.toLocaleString()}/${max.toLocaleString()})</span>
                 </div>
                 <div class="armory-rep-bar-bg">
                   <div class="armory-rep-bar-fill ${cls}" style="width:${pct}%;"></div>
                 </div>
               </div>
             `;
           }).join('')}
         </div>`
      : `<div class="armory-empty-note">No Classic faction reputations reported yet.</div>`;

    let explorerHtml = '';
    if (allRecipes.length) {
      const { afterProfAndQuery, filtered } = filterAndSortRecipes(allRecipes, uiState.recipeFilter);
      const countText = filtered.length === allRecipes.length
        ? `${allRecipes.length} learned`
        : `${filtered.length} of ${allRecipes.length}`;
      const activeProf = uiState.recipeFilter.profession;
      const sort = uiState.recipeFilter.sort || 'category';
      explorerHtml = `
        <div class="armory-recipe-explorer" style="margin-top: 1.1rem;">
          <div class="armory-recipe-explorer-header">
            <h5 class="armory-section-label" style="margin: 0;">
              Learned Recipes
              <span id="armoryRecipeCountLabel" class="armory-recipe-header-count">${escHtml(countText)}</span>
            </h5>
            <span id="armoryRecipeActiveProfWrap">
              ${activeProf && activeProf !== 'all'
                ? `<button type="button" class="armory-active-prof-tag" data-clear-prof-filter title="Clear profession filter">${escHtml(activeProf)} &times;</button>`
                : ''
              }
            </span>
          </div>
          <div class="armory-recipe-toolbar">
            <div class="armory-recipe-search-wrap">
              <input
                type="search"
                id="armoryRecipeSearch"
                class="armory-recipe-search-input"
                placeholder="Search recipes or profession..."
                value="${escAttr(uiState.recipeFilter.query || '')}"
                autocomplete="off"
                spellcheck="false"
                aria-label="Search learned recipes"
              />
              <button
                type="button"
                id="btnClearArmoryRecipeSearch"
                class="armory-recipe-clear-btn${String(uiState.recipeFilter.query || '').trim() ? '' : ' hidden'}"
                aria-label="Clear recipe search"
                title="Clear search"
              >&times;</button>
            </div>
            <label class="armory-recipe-sort-wrap">
              <span class="sr-only">Sort recipes</span>
              <select id="armoryRecipeSort" class="armory-recipe-sort-select" aria-label="Sort learned recipes">
                <option value="category"${sort === 'category' ? ' selected' : ''}>Sort: Category</option>
                <option value="profession"${sort === 'profession' ? ' selected' : ''}>Sort: Profession</option>
                <option value="name-asc"${sort === 'name-asc' ? ' selected' : ''}>Sort: A &rarr; Z</option>
                <option value="name-desc"${sort === 'name-desc' ? ' selected' : ''}>Sort: Z &rarr; A</option>
                <option value="learned"${sort === 'learned' ? ' selected' : ''}>Sort: Armory Order</option>
              </select>
            </label>
          </div>
          <div id="armoryRecipeCategoryPills" class="armory-recipe-cat-bar" role="group" aria-label="Recipe category filters">
            ${renderRecipeCategoryPillsHtml(afterProfAndQuery, uiState.recipeFilter.category)}
          </div>
          <div id="armoryRecipeResults" class="armory-recipe-results">
            ${renderRecipeResultsHtml(filtered, sort)}
          </div>
        </div>
      `;
    }

    return `
      <h5 class="armory-section-label">Professions &amp; Known Recipes</h5>
      <div class="armory-profs-grid">${profsHtml}</div>
      ${explorerHtml}
      <h5 class="armory-section-label" style="margin-top: 1.15rem;">Classic Faction Reputations</h5>
      ${repsHtml}
    `;
  }

  function renderFallbackArmorySheet(containerEl, { memberChar = null, snapshot = null, isSelf = false, statusTitle = '', statusMessage = '', onRefresh = null } = {}) {
    if (!containerEl) return;
    const ch = memberChar || {};
    const className = snapshot?.className || ch.class || 'Warrior';
    const classColor = CLASS_COLORS[className] || '#ffd100';
    const dispName = snapshot?.displayName || (ch.surname ? `${ch.name} ${ch.surname}` : ch.name) || 'Character';
    const level = snapshot?.level || ch.level || null;
    const race = snapshot?.race || ch.race || '';
    const role = ch.role || '';
    const ruleset = snapshot?.ruleset?.name || ch.ruleset || '';
    const guildName = snapshot?.guild?.name || ch.guildName || '';
    const armoryHref = sanitizeUrl(snapshot?.armoryUrl || '');
    const avatarUrl = sanitizeUrl(snapshot?.media?.avatar || ch.avatarThumbUrl || '');
    const profTags = parseStoredProfessions(ch.professions);

    containerEl.innerHTML = `
      <div class="armory-sheet-card armory-sheet-fallback">
        <div class="armory-sheet-banner">
          <div class="armory-sheet-identity">
            ${avatarUrl
              ? `<img src="${escAttr(avatarUrl)}" alt="" class="armory-sheet-avatar" onerror="this.style.display='none';">`
              : `<div class="armory-fallback-mini-crest">${buildClassCrestSvg(className)}</div>`
            }
            <div>
              <div class="armory-sheet-name-row">
                <strong style="color:${classColor};">${escHtml(dispName)}</strong>
                ${level ? `<span class="armory-level-pill">Level ${escHtml(String(level))}</span>` : `<span class="armory-level-pill is-unset">Level Unverified</span>`}
                ${role ? `<span class="role-pill ${escAttr(role.toLowerCase())}">${escHtml(role)}</span>` : ''}
              </div>
              <div class="armory-sheet-meta">
                <span>${race ? `${escHtml(race)} ` : ''}${escHtml(className)}</span>
                ${guildName ? `<span>&bull; &lt;${escHtml(guildName)}&gt;</span>` : ''}
                ${ruleset ? `<span>&bull; ${escHtml(ruleset)}</span>` : ''}
              </div>
            </div>
          </div>

          <div class="armory-sheet-actions">
            ${onRefresh ? `<button type="button" class="btn-secondary btn-xs armory-retry-btn">Retry Sync</button>` : ''}
            ${armoryHref ? `<a href="${escAttr(armoryHref)}" target="_blank" rel="noopener noreferrer" class="btn-secondary btn-xs">Blizzard Armory &nearr;</a>` : ''}
            ${isSelf && !ch.surname ? `<button type="button" class="btn-primary btn-xs armory-open-manage-btn">Add Surname &amp; Verify</button>` : ''}
          </div>
        </div>

        <div class="armory-inner-body">
          <div class="armory-fallback-grid">
            <div class="armory-fallback-panel">
              <h6 class="armory-section-label">Professions</h6>
              ${profTags.length
                ? `<div class="armory-inline-prof-chips">
                     ${profTags.map(tag => `<span class="armory-prof-chip">${escHtml(tag)}</span>`).join('')}
                   </div>`
                : `<p class="armory-fallback-empty">No professions listed on this character yet.</p>`
              }
            </div>

            <div class="armory-fallback-panel">
              <h6 class="armory-section-label">${escHtml(statusTitle || 'Equipped Gear Snapshot')}</h6>
              <p class="armory-fallback-note">${escHtml(statusMessage || 'Equipped slot gear will appear once synced with Blizzard WoW: Forever US Armory.')}</p>
            </div>
          </div>
        </div>
      </div>
    `;

    containerEl.querySelector('.armory-retry-btn')?.addEventListener('click', () => onRefresh?.());
    containerEl.querySelector('.armory-open-manage-btn')?.addEventListener('click', () => {
      document.getElementById('modalMemberProfile')?.classList.remove('active');
      hostCtx.openCharacterModal();
    });
  }

  async function fetchCharacterArmoryClient({ slug = '', name = '', surname = '', forceRefresh = false } = {}) {
    const cacheKey = slug || buildCharSlugClient(name, surname);
    if (!forceRefresh && cacheKey && characterCache.has(cacheKey)) {
      return characterCache.get(cacheKey);
    }

    const params = new URLSearchParams();
    if (slug) params.set('slug', slug);
    if (name) params.set('name', name);
    if (surname) params.set('surname', surname);
    if (forceRefresh) params.set('refresh', '1');

    const res = await fetch(`/api/exchange/armory/character?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Armory HTTP ${res.status}`);
    }
    if (data.slug) {
      characterCache.set(data.slug, data);
    }
    return data;
  }

  function renderSnapshotIntoContainer(containerEl, snapshot, { innerTab = 'paperdoll', memberCharMeta = null, isSelf = false, onTabChange = null, onRefresh = null } = {}) {
    if (!containerEl) return;

    if (!snapshot || !snapshot.found) {
      const msg = snapshot?.configured === false
        ? 'Battle.net API credentials are not yet configured on the Worker.'
        : (snapshot?.message || 'Character was not found on WoW: Forever US Armory yet. Characters appear once they reach Level 10+ and log out once.');

      renderFallbackArmorySheet(containerEl, {
        memberChar: memberCharMeta,
        snapshot,
        isSelf,
        statusTitle: 'Equipped Gear Snapshot',
        statusMessage: msg,
        onRefresh
      });
      return;
    }

    syncRecipeFilterChar(snapshot, memberCharMeta);
    const classColor = CLASS_COLORS[snapshot.className] || '#ffd100';
    const armoryHref = sanitizeUrl(snapshot.armoryUrl || '');
    const avatarUrl = sanitizeUrl(snapshot.media?.avatar || '');
    const activeTab = ['paperdoll', 'stats', 'profs'].includes(innerTab) ? innerTab : 'paperdoll';

    const bannerProfs = [
      ...(snapshot.professions?.primaries || []),
      ...(snapshot.professions?.secondaries || [])
    ];
    const bannerProfHtml = bannerProfs.length
      ? bannerProfs.map(p => `<span class="armory-banner-prof-chip">${escHtml(p.name)} <b>${escHtml(String(p.skillPoints))}/${escHtml(String(p.maxSkillPoints))}</b></span>`).join('')
      : parseStoredProfessions(memberCharMeta?.professions).map(t => `<span class="armory-banner-prof-chip">${escHtml(t)}</span>`).join('');

    let bodyHtml = '';
    if (activeTab === 'paperdoll') {
      bodyHtml = renderPaperdollTab(snapshot, memberCharMeta, { hasViewAllHandler: Boolean(onTabChange) });
    } else if (activeTab === 'stats') {
      bodyHtml = renderStatsAndTalentsTab(snapshot);
    } else {
      bodyHtml = renderProfessionsAndRepsTab(snapshot, memberCharMeta);
    }

    containerEl.innerHTML = `
      <div class="armory-sheet-card">
        <div class="armory-sheet-banner">
          <div class="armory-sheet-identity">
            ${avatarUrl
              ? `<img src="${escAttr(avatarUrl)}" alt="" class="armory-sheet-avatar" onerror="this.style.display='none';">`
              : ''
            }
            <div>
              <div class="armory-sheet-name-row">
                <strong style="color:${classColor};">${escHtml(snapshot.displayName || snapshot.name)}</strong>
                ${snapshot.level ? `<span class="armory-level-pill">Level ${escHtml(String(snapshot.level))}</span>` : ''}
                ${snapshot.title ? `<span class="armory-title-pill">${escHtml(snapshot.title)}</span>` : ''}
                ${snapshot.avgItemLevel ? `<span class="armory-ilvl-pill">iLvl ${escHtml(String(snapshot.avgItemLevel))}</span>` : ''}
              </div>
              <div class="armory-sheet-meta">
                <span>${escHtml(snapshot.race || '')} ${escHtml(snapshot.className || '')}</span>
                ${snapshot.guild?.name ? `<span>&bull; &lt;${escHtml(snapshot.guild.name)}&gt;</span>` : ''}
                ${snapshot.ruleset?.name ? `<span>&bull; ${escHtml(snapshot.ruleset.name)}</span>` : ''}
                <span>&bull; Synced ${escHtml(formatRelativeTime(snapshot.syncedAt))}</span>
              </div>
              ${bannerProfHtml ? `<div class="armory-banner-profs">${bannerProfHtml}</div>` : ''}
            </div>
          </div>

          <div class="armory-sheet-actions">
            ${onRefresh ? `<button type="button" class="btn-secondary btn-xs armory-refresh-btn" title="Refresh from Blizzard (5m cooldown)">Refresh Armory</button>` : ''}
            ${armoryHref ? `<a href="${escAttr(armoryHref)}" target="_blank" rel="noopener noreferrer" class="btn-secondary btn-xs">Blizzard Armory &nearr;</a>` : ''}
          </div>
        </div>

        <div class="armory-inner-tabs" role="tablist">
          <button type="button" class="armory-inner-tab ${activeTab === 'paperdoll' ? 'active' : ''}" data-armory-tab="paperdoll">Gear &amp; Professions</button>
          <button type="button" class="armory-inner-tab ${activeTab === 'stats' ? 'active' : ''}" data-armory-tab="stats">Stats &amp; Talents</button>
          <button type="button" class="armory-inner-tab ${activeTab === 'profs' ? 'active' : ''}" data-armory-tab="profs">Recipes &amp; Reps</button>
        </div>

        <div class="armory-inner-body">
          ${bodyHtml}
        </div>
      </div>
    `;

    containerEl.querySelectorAll('[data-armory-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = btn.getAttribute('data-armory-tab');
        hideTooltip(true);
        if (onTabChange) {
          onTabChange(next);
        } else {
          renderSnapshotIntoContainer(containerEl, snapshot, { innerTab: next, memberCharMeta, isSelf, onRefresh });
        }
      });
    });

    containerEl.querySelectorAll('[data-jump-prof]').forEach(btn => {
      btn.addEventListener('click', () => {
        const prof = btn.getAttribute('data-jump-prof') || 'all';
        uiState.recipeFilter.profession = prof;
        uiState.recipeFilter.category = 'all';
        uiState.recipeFilter.query = '';
        hideTooltip(true);
        if (onTabChange) {
          onTabChange('profs');
        } else {
          renderSnapshotIntoContainer(containerEl, snapshot, { innerTab: 'profs', memberCharMeta, isSelf, onRefresh });
        }
      });
    });

    containerEl.querySelector('.armory-view-all-profs-btn')?.addEventListener('click', () => {
      uiState.recipeFilter.profession = 'all';
      hideTooltip(true);
      if (onTabChange) {
        onTabChange('profs');
      } else {
        renderSnapshotIntoContainer(containerEl, snapshot, { innerTab: 'profs', memberCharMeta, isSelf, onRefresh });
      }
    });

    if (activeTab === 'profs') {
      const allRecipes = buildFlatLearnedRecipes(snapshot);
      const searchInput = containerEl.querySelector('#armoryRecipeSearch');
      const clearSearchBtn = containerEl.querySelector('#btnClearArmoryRecipeSearch');
      const sortSelect = containerEl.querySelector('#armoryRecipeSort');
      const categoryPillsEl = containerEl.querySelector('#armoryRecipeCategoryPills');
      const profGridEl = containerEl.querySelector('.armory-profs-grid');
      const activeProfWrap = containerEl.querySelector('#armoryRecipeActiveProfWrap');
      const resultsEl = containerEl.querySelector('#armoryRecipeResults');

      if (searchInput) {
        searchInput.addEventListener('input', () => {
          uiState.recipeFilter.query = searchInput.value;
          updateRecipeExplorerUI(containerEl, allRecipes);
        });
        searchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && searchInput.value) {
            e.preventDefault();
            e.stopPropagation();
            searchInput.value = '';
            uiState.recipeFilter.query = '';
            updateRecipeExplorerUI(containerEl, allRecipes);
          }
        });
      }

      clearSearchBtn?.addEventListener('click', () => {
        uiState.recipeFilter.query = '';
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        updateRecipeExplorerUI(containerEl, allRecipes);
      });

      sortSelect?.addEventListener('change', () => {
        uiState.recipeFilter.sort = sortSelect.value || 'category';
        updateRecipeExplorerUI(containerEl, allRecipes);
      });

      categoryPillsEl?.addEventListener('click', (e) => {
        const pill = e.target.closest('[data-recipe-cat]');
        if (!pill) return;
        uiState.recipeFilter.category = pill.getAttribute('data-recipe-cat') || 'all';
        updateRecipeExplorerUI(containerEl, allRecipes);
      });

      const toggleProfFilter = (profName) => {
        if (!profName) return;
        const current = String(uiState.recipeFilter.profession || 'all').toLowerCase();
        const nextProf = current === profName.toLowerCase() ? 'all' : profName;
        uiState.recipeFilter.profession = nextProf;
        if (uiState.recipeFilter.category !== 'all') {
          const { filtered } = filterAndSortRecipes(allRecipes, uiState.recipeFilter);
          if (!filtered.length) {
            uiState.recipeFilter.category = 'all';
          }
        }
        updateRecipeExplorerUI(containerEl, allRecipes);
      };

      profGridEl?.addEventListener('click', (e) => {
        const card = e.target.closest('.armory-prof-card[data-filter-prof]');
        if (!card) return;
        toggleProfFilter(card.getAttribute('data-filter-prof'));
      });

      profGridEl?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const card = e.target.closest('.armory-prof-card[data-filter-prof]');
        if (!card) return;
        e.preventDefault();
        toggleProfFilter(card.getAttribute('data-filter-prof'));
      });

      activeProfWrap?.addEventListener('click', (e) => {
        if (!e.target.closest('[data-clear-prof-filter]')) return;
        uiState.recipeFilter.profession = 'all';
        updateRecipeExplorerUI(containerEl, allRecipes);
      });

      resultsEl?.addEventListener('click', (e) => {
        const resetBtn = e.target.closest('[data-reset-recipe-filters]');
        if (resetBtn) {
          uiState.recipeFilter.query = '';
          uiState.recipeFilter.profession = 'all';
          uiState.recipeFilter.category = 'all';
          if (searchInput) searchInput.value = '';
          updateRecipeExplorerUI(containerEl, allRecipes);
          return;
        }
        const chip = e.target.closest('[data-copy-recipe]');
        if (!chip) return;
        const recipeName = chip.getAttribute('data-copy-recipe');
        if (recipeName) {
          copyToClipboard(recipeName, `Copied recipe "${recipeName}" to clipboard.`);
        }
      });
    }

    containerEl.querySelector('.armory-refresh-btn')?.addEventListener('click', () => onRefresh?.());
  }

  // =========================================================================
  // MEMBER PROFILE MODAL (#modalMemberProfile)
  // =========================================================================

  function renderMemberProfileModal(discordId, providedWallet = null, preferredCharKey = null) {
    const appState = hostCtx.getState() || {};
    const w = providedWallet || appState.bseState?.wallets?.[discordId];
    if (!w) return;

    const modalBody = document.getElementById('memberProfileModalBody');
    const modalOverlay = document.getElementById('modalMemberProfile');
    if (!modalBody || !modalOverlay) return;

    const isSwitchingMember = uiState.modalMemberId !== discordId;
    uiState.modalMemberId = discordId;
    if (isSwitchingMember) {
      uiState.modalActiveInnerTab = 'paperdoll';
      uiState.modalSelectedCharSlug = null;
    }

    const name = w.serverNickname || w.globalName || w.username || 'Guild Member';
    const handle = w.username ? `@${w.username}` : '';
    const avatarUrl = hostCtx.getDiscordAvatarUrl(w.discordId, w.avatarHash, 128);
    const rankTitle = hostCtx.resolveRankTitle(w.rankTier || 0);
    const isSelf = Boolean(appState.user?.id && appState.user.id === discordId);
    const isOfficer = Boolean(appState.user?.isOfficer);

    const chars = Array.isArray(w.characters) && w.characters.length
      ? w.characters
      : (w.primaryCharacter ? [{ name: w.primaryCharacter, class: 'Warrior', role: 'DPS', isPrimary: true }] : []);

    const charKeys = chars.map((c, idx) => ({
      ...c,
      _key: c.slug || buildCharSlugClient(c.name, c.surname || '') || `char_${idx}`
    }));

    if (preferredCharKey && charKeys.some(c => c._key === preferredCharKey)) {
      uiState.modalSelectedCharSlug = preferredCharKey;
      uiState.modalActiveInnerTab = 'paperdoll';
    } else if (!uiState.modalSelectedCharSlug || !charKeys.some(c => c._key === uiState.modalSelectedCharSlug)) {
      const def = charKeys.find(c => c.isPrimary) || charKeys[0];
      uiState.modalSelectedCharSlug = def ? def._key : null;
    }

    const activeChar = charKeys.find(c => c._key === uiState.modalSelectedCharSlug) || charKeys[0] || null;

    const switcherHtml = charKeys.length
      ? `<div class="armory-char-switcher">
           ${charKeys.map(c => {
             const active = c._key === activeChar?._key;
             const disp = c.surname ? `${c.name} ${c.surname}` : c.name;
             return `
               <button type="button" class="armory-char-pill ${active ? 'active' : ''}" data-switch-char="${escAttr(c._key)}">
                 <span class="class-badge ${classBadgeCss(c.class)}">${escHtml(disp)}</span>
                 ${c.level ? `<span class="armory-char-lv">Lv ${escHtml(String(c.level))}</span>` : ''}
                 ${c.armoryVerified ? `<span class="armory-verified-dot" title="Verified on WoW: Forever Armory">&#10003;</span>` : ''}
                 ${c.isPrimary ? `<span class="char-pill" style="font-size:0.62rem;">MAIN</span>` : ''}
               </button>
             `;
           }).join('')}
         </div>`
      : `<p style="color:var(--text-dim); font-size:0.85rem; text-align:center; padding:0.75rem;">
           This member hasn't linked any WoW: Forever characters yet.
         </p>`;

    const noteHtml = w.guildNote
      ? `<div class="guild-note-card">"${escHtml(w.guildNote)}"</div>`
      : `<div style="color:var(--text-dim); font-size:0.85rem; font-style:italic; margin:0.4rem 0;">No public guild note provided yet.</div>`;

    const wkStatus = hostCtx.resolveClientMemberWeeklyStatus?.(w, appState.bseState) || {
      enabled: true,
      weeklyEarned: w.weeklyBonesEarned || 0,
      effectiveCap: appState.bseState?.config?.weeklyCap?.cap || 50,
      label: `${(w.weeklyBonesEarned || 0).toLocaleString()} / ${(appState.bseState?.config?.weeklyCap?.cap || 50).toLocaleString()}`
    };

    const officerHtml = isOfficer
      ? `<div class="wow-inner-box" style="margin-top: 1.15rem; padding: 0.85rem;">
           <div style="font-size: 0.75rem; color: var(--gold-300); font-weight: 700; text-transform: uppercase; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
             <span>Officer Controls</span>
             <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
               <span style="font-size: 0.7rem; color: var(--text-muted); text-transform: none; font-weight: 500;">Weekly Cap: <strong style="color: ${wkStatus.enabled && wkStatus.weeklyEarned >= wkStatus.effectiveCap ? '#f87171' : 'var(--gold-200)'};">${escHtml(wkStatus.label)}</strong></span>
               ${w.officerHidden ? `<span class="badge-officer-hidden">Hidden from Leaderboard</span>` : ''}
             </div>
           </div>
           <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
             <button type="button" class="btn-officer-award" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" data-officer-op="award">+ Award Bones</button>
             <button type="button" class="btn-officer-deduct" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" data-officer-op="deduct">- Deduct Bones</button>
             <button type="button" class="btn-officer-adjust" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" data-officer-op="spendable">Override Spendable Bones</button>
             <button type="button" class="btn-officer-adjust" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" data-officer-op="lifetime">Adjust Lifetime Bones</button>
             <button type="button" class="btn-officer-adjust" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" data-officer-op="bountystats">Override Bounty Stats</button>
             <button type="button" class="btn-officer-hide" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" data-officer-op="hide">${w.officerHidden ? 'Unhide Member' : 'Hide from Leaderboard'}</button>
             <button type="button" class="btn-officer-purge" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" data-officer-op="purge">Purge from Roster</button>
           </div>
         </div>`
      : '';

    modalBody.innerHTML = `
      <div class="member-profile-header">
        <img src="${escAttr(avatarUrl)}" class="member-profile-avatar" alt="${escAttr(name)}" onerror="this.onerror=null;this.src='assets/favicon.svg';">
        <div style="flex:1; min-width:0;">
          <h3 style="color: var(--gold-100); font-size: 1.25rem; margin-bottom: 0.15rem;">${escHtml(name)}</h3>
          <div style="font-size: 0.84rem; color: var(--text-muted); margin-bottom: 0.5rem;">
            ${escHtml(handle)} &bull; <span class="card-badge economy">${escHtml(rankTitle)}</span>
          </div>
          <div style="display: flex; gap: 1.15rem; flex-wrap: wrap;">
            <div><span class="armory-metric-lbl">Spendable Bones</span><strong class="armory-metric-val gold">${(w.spendableBones || 0).toLocaleString()}</strong></div>
            <div><span class="armory-metric-lbl">Career Score</span><strong class="armory-metric-val amber">${(w.boneScore || 0).toLocaleString()}</strong></div>
            <div><span class="armory-metric-lbl">Bounties Completed</span><strong class="armory-metric-val blue">${(w.bountiesCompleted || 0).toLocaleString()}</strong></div>
            <div><span class="armory-metric-lbl">Posted Bounties</span><strong class="armory-metric-val legendary">${(w.postedBountiesCompleted || 0).toLocaleString()}</strong></div>
          </div>
        </div>
      </div>

      <div style="margin-bottom: 0.9rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; margin-bottom:0.45rem; flex-wrap:wrap;">
          <h5 class="armory-section-label" style="margin:0;">Character Armory (Level, Gear &amp; Professions)</h5>
          ${isSelf ? `<button type="button" class="btn-secondary btn-xs" id="btnProfileEditChars">Manage Characters</button>` : ''}
        </div>
        ${switcherHtml}
      </div>

      <div id="memberArmoryPaperdollStage"></div>

      <div style="margin-top: 1.15rem;">
        <h5 class="armory-section-label">Public Guild Note</h5>
        ${noteHtml}
      </div>

      ${officerHtml}
    `;

    // Bind Character Switcher
    modalBody.querySelectorAll('[data-switch-char]').forEach(btn => {
      btn.addEventListener('click', () => {
        hideTooltip(true);
        uiState.modalSelectedCharSlug = btn.getAttribute('data-switch-char');
        uiState.modalActiveInnerTab = 'paperdoll';
        renderMemberProfileModal(discordId, w);
      });
    });

    modalBody.querySelector('#btnProfileEditChars')?.addEventListener('click', () => {
      modalOverlay.classList.remove('active');
      hostCtx.openCharacterModal();
    });

    // Bind Officer Actions cleanly without inline JS string escaping risks
    modalBody.querySelectorAll('[data-officer-op]').forEach(btn => {
      btn.addEventListener('click', () => {
        const op = btn.getAttribute('data-officer-op');
        if (op === 'award') window.openBonesAdjustModal?.(discordId, name, 'award');
        else if (op === 'deduct') window.openBonesAdjustModal?.(discordId, name, 'deduct');
        else if (op === 'spendable') window.quickAdjustSpendable?.(discordId, name, w.spendableBones || 0);
        else if (op === 'lifetime') window.quickAdjustLifetime?.(discordId, name, w.boneScore || 0);
        else if (op === 'bountystats') window.quickAdjustBountyStats?.(discordId, name, w.bountiesCompleted || 0, w.postedBountiesCompleted || 0);
        else if (op === 'hide') window.quickToggleHideMember?.(discordId, name, Boolean(w.officerHidden));
        else if (op === 'purge') window.quickDeleteMember?.(discordId, name, w.spendableBones || 0, w.boneScore || 0);
      });
    });

    appState.inspectedMemberId = discordId;
    modalOverlay.classList.add('active');

    // Load Character Armory for activeChar
    const stage = modalBody.querySelector('#memberArmoryPaperdollStage');
    if (stage && activeChar) {
      loadArmoryForMemberCharacter(stage, activeChar, isSelf, false);
    }
  }

  async function loadArmoryForMemberCharacter(stageEl, ch, isSelf, forceRefresh = false) {
    const slug = ch.slug || buildCharSlugClient(ch.name, ch.surname || '');
    const hasSurname = Boolean(ch.surname || (slug && slug.includes('-')));

    if (!hasSurname && !ch.armoryVerified) {
      renderFallbackArmorySheet(stageEl, {
        memberChar: ch,
        isSelf,
        statusTitle: 'Equipped Gear (Surname Needed)',
        statusMessage: 'WoW: Forever Armory looks up gear by Name-Surname. Add a Surname in Manage Characters to load equipped gear slots, enchants, and live Battle.net recipes.'
      });
      return;
    }

    stageEl.innerHTML = `<div class="armory-loading-box">Loading Character Armory for <strong>${escHtml(ch.surname ? `${ch.name} ${ch.surname}` : ch.name)}</strong>...</div>`;

    try {
      const snapshot = await fetchCharacterArmoryClient({
        slug,
        name: ch.name,
        surname: ch.surname || '',
        forceRefresh
      });

      const handleRender = (nextTab) => {
        uiState.modalActiveInnerTab = nextTab;
        renderSnapshotIntoContainer(stageEl, snapshot, {
          innerTab: nextTab,
          memberCharMeta: ch,
          isSelf,
          onTabChange: handleRender,
          onRefresh: () => loadArmoryForMemberCharacter(stageEl, ch, isSelf, true)
        });
      };

      handleRender(uiState.modalActiveInnerTab);
    } catch (err) {
      renderFallbackArmorySheet(stageEl, {
        memberChar: ch,
        isSelf,
        statusTitle: 'Equipped Gear Unavailable',
        statusMessage: err.message || 'Unable to reach Battle.net Armory right now.',
        onRefresh: () => loadArmoryForMemberCharacter(stageEl, ch, isSelf, true)
      });
    }
  }

  // =========================================================================
  // #modalCharacters "VERIFY VIA ARMORY" INTEGRATION
  // =========================================================================

  let pendingVerifyQuery = '';
  let pendingVerifyPromise = null;
  let verifyDebounceTimer = null;

  function parseNameInputForLookup(raw) {
    const clean = String(raw || '').trim();
    if (!clean) return { raw: '', name: '', surname: '', normQuery: '' };
    if (clean.includes('-')) {
      const parts = clean.split('-').map(p => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return { raw: clean, name: parts[0], surname: parts.slice(1).join('-'), normQuery: clean.toLowerCase() };
      }
    }
    const ws = clean.split(/\s+/).filter(Boolean);
    if (ws.length >= 2) {
      return { raw: clean, name: ws[0], surname: ws.slice(1).join(' '), normQuery: clean.toLowerCase() };
    }
    return { raw: clean, name: clean, surname: '', normQuery: clean.toLowerCase() };
  }

  async function verifyCharacterInput(rawInput, { allowAutoPreview = false, forceRefresh = false } = {}) {
    const nameInput = document.getElementById('newCharName');
    const statusBox = document.getElementById('newCharArmoryStatus');
    const parsed = parseNameInputForLookup(rawInput !== undefined ? rawInput : (nameInput?.value || ''));

    if (!parsed.name) {
      return { found: false, reason: 'EMPTY' };
    }

    // Reuse already-verified snapshot for identical input without re-fetching
    if (uiState.pendingVerifiedChar && uiState.pendingVerifiedChar._sourceQuery === parsed.normQuery) {
      return { found: true, verifiedMeta: uiState.pendingVerifiedChar };
    }

    // Deduplicate concurrent verification for identical input (e.g. debounce + immediate Add click)
    if (pendingVerifyPromise && pendingVerifyQuery === parsed.normQuery) {
      return pendingVerifyPromise;
    }

    pendingVerifyQuery = parsed.normQuery;
    if (statusBox) {
      statusBox.style.display = 'block';
      statusBox.className = 'armory-verify-status';
      statusBox.textContent = `Verifying "${parsed.raw}" with WoW: Forever Armory...`;
    }

    const run = (async () => {
      try {
        const snapshot = await fetchCharacterArmoryClient({
          name: parsed.name,
          surname: parsed.surname,
          forceRefresh
        });

        // Guard against stale async result if user modified the input while loading
        const curNorm = parseNameInputForLookup(nameInput?.value || '').normQuery;
        if (curNorm && curNorm !== parsed.normQuery) {
          return { found: false, stale: true };
        }

        if (snapshot?.found) {
          const verifiedMeta = {
            _sourceQuery: parsed.normQuery,
            name: snapshot.name || parsed.name,
            surname: snapshot.surname || parsed.surname,
            slug: snapshot.slug,
            className: snapshot.className || 'Warrior',
            activeSpec: snapshot.activeSpec || null,
            ruleset: snapshot.ruleset?.name || '',
            professions: snapshot.professions?.allSummary || '',
            race: snapshot.race || '',
            level: snapshot.level || null,
            avgItemLevel: snapshot.avgItemLevel || null,
            guildName: snapshot.guild?.name || '',
            avatarThumbUrl: snapshot.media?.avatar || '',
            armoryVerified: true,
            lastArmorySyncAt: snapshot.syncedAt || new Date().toISOString()
          };
          uiState.pendingVerifiedChar = verifiedMeta;

          if (statusBox) {
            statusBox.style.display = 'block';
            statusBox.className = 'armory-verify-status is-verified';
            const rulesetBit = verifiedMeta.ruleset ? ` &bull; ${escHtml(verifiedMeta.ruleset)}` : '';
            const guildBit = verifiedMeta.guildName ? ` &bull; &lt;${escHtml(verifiedMeta.guildName)}&gt;` : '';
            const profBit = verifiedMeta.professions ? ` &bull; ${escHtml(verifiedMeta.professions)}` : '';
            statusBox.innerHTML = `Verified: <strong>${escHtml(snapshot.displayName)}</strong> &mdash; Lv ${escHtml(String(verifiedMeta.level || '?'))} ${escHtml(verifiedMeta.race)} ${escHtml(verifiedMeta.className)}${rulesetBit}${guildBit}${profBit}`;
          }
          return { found: true, verifiedMeta, snapshot };
        }

        uiState.pendingVerifiedChar = null;

        if (snapshot?.ambiguous && Array.isArray(snapshot.matches) && snapshot.matches.length > 0) {
          if (statusBox) {
            statusBox.style.display = 'block';
            statusBox.className = 'armory-verify-status is-warning';
            statusBox.innerHTML = `
              <div>${escHtml(snapshot.message)}</div>
              <div class="armory-match-picks">
                ${snapshot.matches.map(m => `
                  <button type="button" class="armory-match-chip" data-pick-char-name="${escAttr(m.displayName)}">
                    ${escHtml(m.displayName)} (Lv ${escHtml(String(m.level || '?'))} ${escHtml(m.className || '')})
                  </button>
                `).join('')}
              </div>
            `;
            statusBox.querySelectorAll('[data-pick-char-name]').forEach(btn => {
              btn.addEventListener('click', async () => {
                const chosen = btn.getAttribute('data-pick-char-name');
                if (nameInput && chosen) {
                  nameInput.value = chosen;
                  await verifyCharacterInput(chosen, { forceRefresh: true });
                }
              });
            });
          }
          return { found: false, ambiguous: true, matches: snapshot.matches, message: snapshot.message };
        }

        const missMsg = snapshot?.message || 'Character was not found on WoW: Forever Armory yet (requires Level 10+, 1 logout, or Name + Surname).';
        if (statusBox) {
          if (allowAutoPreview && !parsed.surname && snapshot?.configured !== false) {
            // While typing a single name before hitting Enter/Add, keep hint gentle
            statusBox.style.display = 'block';
            statusBox.className = 'armory-verify-status';
            statusBox.textContent = `${missMsg} Press Verify & Add or include Surname if needed.`;
          } else {
            statusBox.style.display = 'block';
            statusBox.className = 'armory-verify-status is-warning';
            statusBox.innerHTML = `
              <div>${escHtml(missMsg)}</div>
              <div class="armory-force-add-row">
                <button type="button" class="btn-secondary btn-xs armory-force-add-btn">Add Unverified Anyway</button>
              </div>
            `;
            statusBox.querySelector('.armory-force-add-btn')?.addEventListener('click', () => {
              hostCtx.addUnverifiedCharacter?.();
            });
          }
        }
        return { found: false, message: missMsg };
      } catch (err) {
        uiState.pendingVerifiedChar = null;
        if (statusBox) {
          statusBox.style.display = 'block';
          statusBox.className = 'armory-verify-status is-warning';
          statusBox.innerHTML = `
            <div>Armory check unavailable: ${escHtml(err.message)}</div>
            <div class="armory-force-add-row">
              <button type="button" class="btn-secondary btn-xs armory-force-add-btn">Add Unverified Anyway</button>
            </div>
          `;
          statusBox.querySelector('.armory-force-add-btn')?.addEventListener('click', () => {
            hostCtx.addUnverifiedCharacter?.();
          });
        }
        return { found: false, error: err.message };
      } finally {
        if (pendingVerifyPromise === run) {
          pendingVerifyPromise = null;
          pendingVerifyQuery = '';
        }
      }
    })();

    pendingVerifyPromise = run;
    return run;
  }

  function bindCharacterVerifyControls() {
    const nameInput = document.getElementById('newCharName');
    const statusBox = document.getElementById('newCharArmoryStatus');

    const clearPending = () => {
      uiState.pendingVerifiedChar = null;
      if (verifyDebounceTimer) {
        clearTimeout(verifyDebounceTimer);
        verifyDebounceTimer = null;
      }
      if (statusBox) {
        statusBox.style.display = 'none';
        statusBox.className = 'armory-verify-status';
        statusBox.textContent = '';
      }
    };

    nameInput?.addEventListener('input', () => {
      const val = String(nameInput.value || '').trim();
      if (uiState.pendingVerifiedChar && uiState.pendingVerifiedChar._sourceQuery === parseNameInputForLookup(val).normQuery) {
        return;
      }
      clearPending();
      if (val.length >= 2) {
        verifyDebounceTimer = setTimeout(() => {
          if (document.getElementById('modalCharacters')?.classList.contains('active')) {
            verifyCharacterInput(val, { allowAutoPreview: true, forceRefresh: false });
          }
        }, 550);
      }
    });

    nameInput?.addEventListener('blur', () => {
      const val = String(nameInput.value || '').trim();
      if (verifyDebounceTimer) {
        clearTimeout(verifyDebounceTimer);
        verifyDebounceTimer = null;
      }
      if (val.length >= 2 && document.getElementById('modalCharacters')?.classList.contains('active')) {
        verifyCharacterInput(val, { allowAutoPreview: true, forceRefresh: false });
      }
    });
  }

  function consumePendingVerifiedCharacter() {
    const out = uiState.pendingVerifiedChar;
    uiState.pendingVerifiedChar = null;
    pendingVerifyQuery = '';
    pendingVerifyPromise = null;
    if (verifyDebounceTimer) {
      clearTimeout(verifyDebounceTimer);
      verifyDebounceTimer = null;
    }
    const statusBox = document.getElementById('newCharArmoryStatus');
    if (statusBox) {
      statusBox.style.display = 'none';
      statusBox.textContent = '';
    }
    return out;
  }

  // =========================================================================
  // OFFICER HALL FOREVER ARMORY CONTROLS (#subview-armory)
  // =========================================================================

  function syncOfficerArmoryForm() {
    const bse = hostCtx.getState()?.bseState;
    if (!bse) return;

    const cfg = bse.config?.armory || {};
    const status = bse.armoryStatus || {};
    const activeEl = document.activeElement;

    const slugIn = document.getElementById('officerArmoryGuildSlug');
    if (slugIn && activeEl !== slugIn) slugIn.value = cfg.guildSlug || 'black-sands';

    const rulesetSel = document.getElementById('officerArmoryRuleset');
    if (rulesetSel && activeEl !== rulesetSel) rulesetSel.value = String(cfg.guildRulesetId || 1);

    const houseIn = document.getElementById('officerArmoryHouseId');
    if (houseIn && activeEl !== houseIn) houseIn.value = String(cfg.defaultAuctionHouseId || 110);

    const enabledChk = document.getElementById('officerArmoryEnabled');
    if (enabledChk && activeEl !== enabledChk) enabledChk.checked = cfg.enabled !== false;

    const autoChk = document.getElementById('officerArmoryAutoSync');
    if (autoChk && activeEl !== autoChk) autoChk.checked = cfg.autoSyncGuildRoster !== false;

    const diag = document.getElementById('officerArmoryDiagnostics');
    if (diag) {
      diag.innerHTML = `
        <span class="armory-diag-pill ${status.configured ? 'is-ok' : 'is-warn'}">
          Battle.net OAuth: ${status.configured ? 'Configured' : 'Secrets Not Set'}
        </span>
        <span class="armory-diag-pill ${status.ingestConfigured ? 'is-ok' : 'is-warn'}">
          AH Ingest Secret: ${status.ingestConfigured ? 'Ready' : 'Optional / Unset'}
        </span>
        <span class="armory-diag-pill">
          Static NS: <code>${escHtml(cfg.staticNamespaceCache || 'auto')}</code>
        </span>
      `;
    }
  }

  function bindOfficerArmoryControls() {
    const resultBox = document.getElementById('officerArmoryActionResult');
    const setResult = (msg, ok = true) => {
      if (!resultBox) return;
      resultBox.style.color = ok ? 'var(--gold-100)' : '#fca5a5';
      resultBox.textContent = msg;
    };

    document.getElementById('btnSaveArmoryConfig')?.addEventListener('click', async () => {
      const btn = document.getElementById('btnSaveArmoryConfig');
      btn.disabled = true;
      btn.textContent = 'Saving...';
      try {
        const res = await fetch('/api/exchange/armory/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guildSlug: document.getElementById('officerArmoryGuildSlug')?.value.trim(),
            guildRulesetId: Number(document.getElementById('officerArmoryRuleset')?.value) || 1,
            defaultAuctionHouseId: Number(document.getElementById('officerArmoryHouseId')?.value) || 110,
            enabled: Boolean(document.getElementById('officerArmoryEnabled')?.checked),
            autoSyncGuildRoster: Boolean(document.getElementById('officerArmoryAutoSync')?.checked)
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save config');
        hostCtx.showToast('WoW: Forever Armory config saved.');
        setResult(`Saved config for guild "${data.armory?.guildSlug}" (Ruleset ${data.armory?.guildRulesetId}, AH #${data.armory?.defaultAuctionHouseId}).`);
        await hostCtx.refreshBseState();
      } catch (err) {
        hostCtx.showToast(`Error: ${err.message}`);
        setResult(err.message, false);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save Armory Configuration';
      }
    });

    document.getElementById('btnTestBlizzardArmory')?.addEventListener('click', async () => {
      setResult('Querying Battle.net Forever Rulesets & Houses...');
      try {
        const rulesetId = Number(document.getElementById('officerArmoryRuleset')?.value) || 1;
        const res = await fetch(`/api/exchange/armory/rulesets?rulesetId=${rulesetId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ruleset probe failed');
        const rulesetList = (data.rulesets || []).map(r => `${r.name} (${r.id})`).join(', ');
        const houseList = (data.houses || []).slice(0, 12).join(', ');
        setResult(`${data.configured ? 'Live API Connected!' : 'Battle.net secrets not set yet (showing defaults).'} Rulesets: ${rulesetList}. AH Houses: ${houseList}.`);
        hostCtx.showToast(data.configured ? 'Battle.net Forever API verified!' : 'API not configured yet.');
      } catch (err) {
        setResult(`API test failed: ${err.message}`, false);
        hostCtx.showToast(`API test failed: ${err.message}`);
      }
    });

    document.getElementById('btnOfficerSyncForeverRoster')?.addEventListener('click', async () => {
      const btn = document.getElementById('btnOfficerSyncForeverRoster');
      btn.disabled = true;
      btn.textContent = 'Syncing...';
      setResult('Pulling live Forever guild roster from Battle.net...');
      try {
        const guildSlug = document.getElementById('officerArmoryGuildSlug')?.value.trim();
        const res = await fetch('/api/exchange/armory/sync-roster', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guildSlug })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Roster sync failed');
        const count = data.roster?.memberCount || data.roster?.members?.length || 0;
        setResult(`Synced "${data.roster?.guildName || guildSlug}": ${count} in-game characters indexed.`);
        hostCtx.showToast(`Synced ${count} Forever roster characters.`);
      } catch (err) {
        setResult(`Roster sync failed: ${err.message}`, false);
        hostCtx.showToast(`Roster sync failed: ${err.message}`);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Sync Guild Roster';
      }
    });

    document.getElementById('btnOfficerAutoMatchWallets')?.addEventListener('click', async () => {
      const btn = document.getElementById('btnOfficerAutoMatchWallets');
      btn.disabled = true;
      btn.textContent = 'Matching...';
      setResult('Matching Forever roster surnames onto linked Discord wallets...');
      try {
        const guildSlug = document.getElementById('officerArmoryGuildSlug')?.value.trim();
        const res = await fetch('/api/exchange/armory/auto-match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guildSlug })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Auto-match failed');
        setResult(`Matched ${data.matchedCount || 0} new legacy characters (${data.alreadyLinkedCount || 0} already linked across ${data.totalRosterMembers || 0} roster members).`);
        hostCtx.showToast(`Auto-matched ${data.matchedCount || 0} Forever characters!`);
        await hostCtx.refreshBseState();
      } catch (err) {
        setResult(`Auto-match failed: ${err.message}`, false);
        hostCtx.showToast(`Auto-match failed: ${err.message}`);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Auto-Match Wallets';
      }
    });
  }

  // =========================================================================
  // PUBLIC API
  // =========================================================================

  window.BSEArmory = {
    init(ctx) {
      if (ctx) hostCtx = { ...hostCtx, ...ctx };
      if (uiState.initialized) return;
      uiState.initialized = true;
      bindGlobalTooltipHandlers();
      bindCharacterVerifyControls();
      bindOfficerArmoryControls();
    },

    onTabActivated() {
      hideTooltip(true);
    },

    onBseStateUpdated() {},

    renderMemberProfileModal,
    verifyCharacterInput,
    consumePendingVerifiedCharacter,
    syncOfficerArmoryForm,
    formatWowCoinsHtml
  };
})();
