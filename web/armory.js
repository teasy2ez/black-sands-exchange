/**
 * Black Sands Exchange — WoW: Forever US Armory, Paperdoll & Item Database Client
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

  const RULESET_NAMES = {
    1: 'PvP',
    2: 'Normal',
    3: 'Roleplay',
    15: 'Roleplay PvP'
  };

  let hostCtx = {
    getState: () => ({}),
    showToast: () => {},
    refreshBseState: async () => {},
    getDiscordAvatarUrl: () => 'assets/favicon.svg',
    resolveRankTitle: () => 'Initiate',
    switchTab: () => {},
    openCharacterModal: () => {}
  };

  // Module UI state
  const uiState = {
    initialized: false,
    activeDbSubtab: 'items',
    itemQuery: '',
    itemPage: 1,
    itemResults: [],
    itemSelected: null,
    itemPickerCallback: null,
    craftingData: null,
    craftingQuery: '',
    craftingProf: 'all',
    rosterData: null,
    rosterQuery: '',
    rosterFilter: 'all',
    ahData: null,
    ahQuery: '',
    lookupLastSlug: '',
    modalSelectedCharSlug: null,
    modalActiveInnerTab: 'paperdoll',
    pendingVerifiedChar: null
  };

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

  function renderPaperdollTab(snapshot) {
    const equipmentBySlot = new Map();
    for (const eq of snapshot.equipment || []) {
      if (eq.slotType) {
        equipmentBySlot.set(String(eq.slotType).toUpperCase(), eq);
      }
    }

    const className = snapshot.className || 'Warrior';
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

  function renderProfessionsAndRepsTab(snapshot) {
    const profs = [
      ...(snapshot.professions?.primaries || []).map(p => ({ ...p, kind: 'Primary' })),
      ...(snapshot.professions?.secondaries || []).map(p => ({ ...p, kind: 'Secondary' }))
    ];

    const profsHtml = profs.length
      ? profs.map(p => {
          const pct = p.maxSkillPoints > 0 ? Math.min(100, Math.round((p.skillPoints / p.maxSkillPoints) * 100)) : 0;
          const recipes = Array.isArray(p.knownRecipes) ? p.knownRecipes : [];
          return `
            <div class="armory-prof-card">
              <div class="armory-prof-header">
                <div>
                  <strong>${escHtml(p.name)}</strong>
                  <span class="armory-prof-kind">${escHtml(p.kind)}${p.tierName ? ` &bull; ${escHtml(p.tierName)}` : ''}</span>
                </div>
                <span class="gold" style="font-weight:700;">${escHtml(String(p.skillPoints))} / ${escHtml(String(p.maxSkillPoints))}</span>
              </div>
              <div class="progress-bar-bg" style="height:6px; margin: 0.4rem 0 0.6rem;">
                <div class="progress-bar-fill" style="width:${pct}%;"></div>
              </div>
              ${recipes.length
                ? `<div class="armory-recipe-chips">
                     ${recipes.slice(0, 18).map(r => `<span class="armory-talent-pill">${escHtml(r.name)}</span>`).join('')}
                     ${recipes.length > 18 ? `<span class="subview-hint">+${recipes.length - 18} more indexed in Guild Crafters</span>` : ''}
                   </div>`
                : `<span class="subview-hint">No recipes synced yet for ${escHtml(p.name)}.</span>`
              }
            </div>
          `;
        }).join('')
      : `<div class="armory-empty-note">No professions recorded on Battle.net Armory yet.</div>`;

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

    return `
      <h5 class="armory-section-label">Professions &amp; Known Recipes</h5>
      <div class="armory-profs-grid">${profsHtml}</div>
      <h5 class="armory-section-label" style="margin-top: 1.15rem;">Classic Faction Reputations</h5>
      ${repsHtml}
    `;
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

  function renderSnapshotIntoContainer(containerEl, snapshot, { innerTab = 'paperdoll', onTabChange = null, onRefresh = null } = {}) {
    if (!containerEl) return;

    if (!snapshot || !snapshot.found) {
      const armoryHref = sanitizeUrl(snapshot?.armoryUrl || '');
      const msg = snapshot?.configured === false
        ? 'Battle.net API credentials are not yet configured on the Worker.'
        : (snapshot?.message || 'Character was not found on WoW: Forever US Armory. Note: characters appear once Level 10+ and after at least 1 logout.');

      containerEl.innerHTML = `
        <div class="armory-unavailable-card">
          <div style="margin-bottom:0.5rem;">
            ${buildClassCrestSvg(snapshot?.className || 'Warrior')}
          </div>
          <h5>Armory Snapshot Unavailable</h5>
          <p>${escHtml(msg)}</p>
          <div style="display:flex; gap:0.5rem; justify-content:center; flex-wrap:wrap; margin-top:0.75rem;">
            ${onRefresh ? `<button type="button" class="btn-secondary btn-sm armory-retry-btn">Retry Lookup</button>` : ''}
            ${armoryHref ? `<a href="${escAttr(armoryHref)}" target="_blank" rel="noopener noreferrer" class="btn-secondary btn-sm">Open Blizzard Forever Armory &nearr;</a>` : ''}
          </div>
        </div>
      `;
      containerEl.querySelector('.armory-retry-btn')?.addEventListener('click', () => onRefresh?.());
      return;
    }

    const classColor = CLASS_COLORS[snapshot.className] || '#ffd100';
    const armoryHref = sanitizeUrl(snapshot.armoryUrl || '');
    const avatarUrl = sanitizeUrl(snapshot.media?.avatar || '');
    const activeTab = ['paperdoll', 'stats', 'profs'].includes(innerTab) ? innerTab : 'paperdoll';

    let bodyHtml = '';
    if (activeTab === 'paperdoll') bodyHtml = renderPaperdollTab(snapshot);
    else if (activeTab === 'stats') bodyHtml = renderStatsAndTalentsTab(snapshot);
    else bodyHtml = renderProfessionsAndRepsTab(snapshot);

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
                ${snapshot.title ? `<span class="armory-title-pill">${escHtml(snapshot.title)}</span>` : ''}
                ${snapshot.avgItemLevel ? `<span class="armory-ilvl-pill">iLvl ${escHtml(String(snapshot.avgItemLevel))}</span>` : ''}
              </div>
              <div class="armory-sheet-meta">
                <span>Level ${escHtml(String(snapshot.level || '?'))} ${escHtml(snapshot.race || '')} ${escHtml(snapshot.className || '')}</span>
                ${snapshot.guild?.name ? `<span>&bull; &lt;${escHtml(snapshot.guild.name)}&gt;</span>` : ''}
                ${snapshot.ruleset?.name ? `<span>&bull; ${escHtml(snapshot.ruleset.name)}</span>` : ''}
                <span>&bull; Synced ${escHtml(formatRelativeTime(snapshot.syncedAt))}</span>
              </div>
            </div>
          </div>

          <div class="armory-sheet-actions">
            ${onRefresh ? `<button type="button" class="btn-secondary btn-xs armory-refresh-btn" title="Refresh from Blizzard (5m cooldown)">Refresh Armory</button>` : ''}
            ${armoryHref ? `<a href="${escAttr(armoryHref)}" target="_blank" rel="noopener noreferrer" class="btn-secondary btn-xs">Blizzard Armory &nearr;</a>` : ''}
          </div>
        </div>

        <div class="armory-inner-tabs" role="tablist">
          <button type="button" class="armory-inner-tab ${activeTab === 'paperdoll' ? 'active' : ''}" data-armory-tab="paperdoll">Paperdoll &amp; Gear</button>
          <button type="button" class="armory-inner-tab ${activeTab === 'stats' ? 'active' : ''}" data-armory-tab="stats">Stats &amp; Talents</button>
          <button type="button" class="armory-inner-tab ${activeTab === 'profs' ? 'active' : ''}" data-armory-tab="profs">Professions &amp; Reps</button>
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
          renderSnapshotIntoContainer(containerEl, snapshot, { innerTab: next, onRefresh });
        }
      });
    });

    containerEl.querySelector('.armory-refresh-btn')?.addEventListener('click', () => onRefresh?.());
  }

  // =========================================================================
  // MEMBER PROFILE MODAL (#modalMemberProfile)
  // =========================================================================

  function renderMemberProfileModal(discordId, providedWallet = null) {
    const appState = hostCtx.getState() || {};
    const w = providedWallet || appState.bseState?.wallets?.[discordId];
    if (!w) return;

    const modalBody = document.getElementById('memberProfileModalBody');
    const modalOverlay = document.getElementById('modalMemberProfile');
    if (!modalBody || !modalOverlay) return;

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

    if (!uiState.modalSelectedCharSlug || !charKeys.some(c => c._key === uiState.modalSelectedCharSlug)) {
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
                 ${c.level ? `<span class="armory-char-lv">Lv${escHtml(String(c.level))}</span>` : ''}
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

    const officerHtml = isOfficer
      ? `<div class="wow-inner-box" style="margin-top: 1.15rem; padding: 0.85rem;">
           <div style="font-size: 0.75rem; color: var(--gold-300); font-weight: 700; text-transform: uppercase; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center;">
             <span>Officer Controls</span>
             ${w.officerHidden ? `<span class="badge-officer-hidden">Hidden from Leaderboard</span>` : ''}
           </div>
           <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
             <button type="button" class="btn-officer-award" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" data-officer-op="award">+ Award Bones</button>
             <button type="button" class="btn-officer-deduct" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" data-officer-op="deduct">- Deduct Bones</button>
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
          <h5 class="armory-section-label" style="margin:0;">WoW: Forever Characters &amp; Paperdoll</h5>
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
        else if (op === 'lifetime') window.quickAdjustLifetime?.(discordId, name, w.boneScore || 0);
        else if (op === 'bountystats') window.quickAdjustBountyStats?.(discordId, name, w.bountiesCompleted || 0, w.postedBountiesCompleted || 0);
        else if (op === 'hide') window.quickToggleHideMember?.(discordId, name, Boolean(w.officerHidden));
        else if (op === 'purge') window.quickDeleteMember?.(discordId, name, w.spendableBones || 0, w.boneScore || 0);
      });
    });

    appState.inspectedMemberId = discordId;
    modalOverlay.classList.add('active');

    // Load Paperdoll for activeChar
    const stage = modalBody.querySelector('#memberArmoryPaperdollStage');
    if (stage && activeChar) {
      loadArmoryForMemberCharacter(stage, activeChar, isSelf, false);
    }
  }

  async function loadArmoryForMemberCharacter(stageEl, ch, isSelf, forceRefresh = false) {
    const slug = ch.slug || buildCharSlugClient(ch.name, ch.surname || '');
    const hasSurname = Boolean(ch.surname || (slug && slug.includes('-')));

    if (!hasSurname && !ch.armoryVerified) {
      const profTags = String(ch.professions || '').split(',').map(s => s.trim()).filter(Boolean);
      stageEl.innerHTML = `
        <div class="armory-unavailable-card">
          <h5>${escHtml(ch.name)} &mdash; Forever Surname Not Linked Yet</h5>
          <p>WoW: Forever identifies characters as <strong>Name-Surname</strong>. ${ch.role ? `Role: <strong>${escHtml(ch.role)}</strong>.` : ''} ${profTags.length ? `Professions: <strong>${escHtml(profTags.join(', '))}</strong>.` : ''}</p>
          <p style="font-size:0.78rem; color:var(--text-dim);">Link this character's Surname in Manage Characters to display their live gear Paperdoll, stats, talents, and recipes.</p>
          ${isSelf ? `<button type="button" class="btn-primary btn-sm armory-open-manage-btn" style="margin-top:0.5rem;">Add Surname &amp; Verify</button>` : ''}
        </div>
      `;
      stageEl.querySelector('.armory-open-manage-btn')?.addEventListener('click', () => {
        document.getElementById('modalMemberProfile')?.classList.remove('active');
        hostCtx.openCharacterModal();
      });
      return;
    }

    stageEl.innerHTML = `<div class="armory-loading-box">Querying WoW: Forever Armory for <strong>${escHtml(slug)}</strong>...</div>`;

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
          onTabChange: handleRender,
          onRefresh: () => loadArmoryForMemberCharacter(stageEl, ch, isSelf, true)
        });
      };

      handleRender(uiState.modalActiveInnerTab);
    } catch (err) {
      stageEl.innerHTML = `
        <div class="armory-unavailable-card">
          <h5>Armory Lookup Failed</h5>
          <p>${escHtml(err.message)}</p>
          <button type="button" class="btn-secondary btn-sm armory-retry-fetch" style="margin-top:0.5rem;">Retry</button>
        </div>
      `;
      stageEl.querySelector('.armory-retry-fetch')?.addEventListener('click', () => loadArmoryForMemberCharacter(stageEl, ch, isSelf, true));
    }
  }

  // =========================================================================
  // DATABASE & ARMORY TAB (#view-database)
  // =========================================================================

  function switchDbSubtab(subtab) {
    uiState.activeDbSubtab = subtab;
    document.querySelectorAll('.db-subtab').forEach(btn => {
      const active = btn.getAttribute('data-db-subtab') === subtab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.db-subview').forEach(v => v.classList.remove('active'));
    document.getElementById(`db-subview-${subtab}`)?.classList.add('active');

    hideTooltip(true);

    if (subtab === 'items' && !uiState.itemResults.length) {
      searchItems('');
    } else if (subtab === 'crafting') {
      loadCraftingDirectory();
    } else if (subtab === 'roster') {
      loadForeverRoster();
    } else if (subtab === 'ah') {
      loadAhWatchlist();
    }
  }

  function updateConnectionBadge() {
    const badge = document.getElementById('armoryConnectionBadge');
    if (!badge) return;
    const armoryCfg = hostCtx.getState()?.bseState?.config?.armory || {};
    const rulesetLabel = RULESET_NAMES[armoryCfg.guildRulesetId] || 'Forever US';
    const configured = hostCtx.getState()?.bseState?.armoryStatus?.configured !== false;
    badge.textContent = configured ? `Forever US · ${rulesetLabel}` : 'Forever US · Offline Stub';
    badge.classList.toggle('is-online', configured);
  }

  // ---- 1. Items & Loot DB -------------------------------------------------

  async function searchItems(query, page = 1) {
    const cleanQ = String(query ?? '').trim();
    uiState.itemQuery = cleanQ;
    uiState.itemPage = page;

    const input = document.getElementById('dbItemSearchInput');
    if (input && input.value !== cleanQ && cleanQ) input.value = cleanQ;
    const clearBtn = document.getElementById('btnClearDbItemSearch');
    if (clearBtn) clearBtn.style.display = cleanQ ? 'inline-flex' : 'none';

    const grid = document.getElementById('dbItemsGrid');
    const hdr = document.getElementById('dbItemsHeaderLabel');
    if (grid) grid.innerHTML = `<div class="table-loading-cell">Searching WoW: Forever items...</div>`;

    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '24' });
      if (cleanQ) params.set('q', cleanQ);
      const res = await fetch(`/api/exchange/armory/items/search?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Search failed [${res.status}]`);

      uiState.itemResults = Array.isArray(data.results) ? data.results : [];
      if (hdr) {
        hdr.textContent = data.featured
          ? 'Featured WoW: Forever Items & Raid Classics'
          : (uiState.itemResults.length
            ? `Showing ${uiState.itemResults.length} results for "${cleanQ}" (Page ${data.page || 1})`
            : `No items found matching "${cleanQ}"`);
      }

      renderItemsGrid(data);
    } catch (err) {
      if (grid) {
        grid.innerHTML = `<div class="bounty-empty-state">Unable to search items: ${escHtml(err.message)}</div>`;
      }
    }
  }

  function renderItemsGrid(searchPayload) {
    const grid = document.getElementById('dbItemsGrid');
    const pagination = document.getElementById('dbItemPagination');
    if (!grid) return;

    if (!uiState.itemResults.length) {
      grid.innerHTML = `<div class="bounty-empty-state">No matching WoW: Forever items found. Try an item name like <strong>Thunderfury</strong> or a numeric Item ID like <strong>19019</strong>.</div>`;
      if (pagination) pagination.innerHTML = '';
      return;
    }

    grid.innerHTML = uiState.itemResults.map(item => {
      const q = qualityInfo(item.quality);
      const tipKey = registerTooltipItem(item);
      const icon = sanitizeUrl(item.iconUrl);
      const subtitle = [
        item.itemSubclass || item.itemClass || item.category || '',
        item.level ? `iLvl ${item.level}` : ''
      ].filter(Boolean).join(' · ');

      return `
        <article class="db-item-card ${q.cls}" data-item-id="${escAttr(String(item.id))}" data-wow-tip="${escAttr(tipKey)}">
          <div class="db-item-card-top">
            <div class="db-item-icon-wrap" style="border-color:${q.color};">
              ${icon
                ? `<img src="${escAttr(icon)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                   <span class="armory-slot-glyph" style="display:none;">#</span>`
                : `<span class="armory-slot-glyph">#</span>`
              }
            </div>
            <div class="db-item-meta">
              <div class="db-item-name" style="color:${q.color};">${escHtml(item.name)}</div>
              <div class="db-item-sub">${escHtml(subtitle || `Item #${item.id}`)}</div>
            </div>
          </div>

          <div class="db-item-card-footer">
            ${item.ahPrice?.min > 0
              ? `<span class="db-ah-mini-badge" title="Lowest active Forever AH buyout">AH Min: ${formatWowCoinsHtml(item.ahPrice.min)}</span>`
              : `<span class="db-id-tag">#${escHtml(String(item.id))}</span>`
            }
            <div style="display:flex; gap:0.35rem; align-items:center;">
              ${uiState.itemPickerCallback
                ? `<button type="button" class="btn-primary btn-xs db-pick-item-btn" data-pick-item-id="${escAttr(String(item.id))}">Select</button>`
                : ''
              }
              <button type="button" class="btn-secondary btn-xs db-inspect-item-btn" data-inspect-item-id="${escAttr(String(item.id))}">Inspect</button>
            </div>
          </div>
        </article>
      `;
    }).join('');

    grid.querySelectorAll('.db-inspect-item-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideTooltip(true);
        openItemDetail(Number(btn.getAttribute('data-inspect-item-id')));
      });
    });

    grid.querySelectorAll('.db-pick-item-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const itemId = Number(btn.getAttribute('data-pick-item-id'));
        const item = uiState.itemResults.find(it => Number(it.id) === itemId);
        if (item && uiState.itemPickerCallback) {
          const cb = uiState.itemPickerCallback;
          uiState.itemPickerCallback = null;
          cb(item);
        }
      });
    });

    if (pagination) {
      const page = Number(searchPayload?.page || 1);
      const pageCount = Number(searchPayload?.pageCount || 1);
      if (pageCount > 1) {
        pagination.innerHTML = `
          <button type="button" class="btn-secondary btn-xs" id="btnDbItemPrev" ${page <= 1 ? 'disabled' : ''}>&larr; Prev</button>
          <span class="pagination-info">Page ${page} / ${pageCount}</span>
          <button type="button" class="btn-secondary btn-xs" id="btnDbItemNext" ${page >= pageCount ? 'disabled' : ''}>Next &rarr;</button>
        `;
        pagination.querySelector('#btnDbItemPrev')?.addEventListener('click', () => searchItems(uiState.itemQuery, page - 1));
        pagination.querySelector('#btnDbItemNext')?.addEventListener('click', () => searchItems(uiState.itemQuery, page + 1));
      } else {
        pagination.innerHTML = '';
      }
    }
  }

  async function openItemDetail(itemId) {
    const panel = document.getElementById('dbItemDetailPanel');
    if (!panel || !itemId) return;
    panel.style.display = 'block';
    panel.innerHTML = `<div class="armory-loading-box">Loading full Forever item data for #${escHtml(String(itemId))}...</div>`;

    try {
      const res = await fetch(`/api/exchange/armory/item/${encodeURIComponent(String(itemId))}`);
      const item = await res.json();
      if (!res.ok) throw new Error(item.error || 'Failed to load item details');

      uiState.itemSelected = item;
      const q = qualityInfo(item.quality);
      const icon = sanitizeUrl(item.iconUrl);
      const wowhead = sanitizeUrl(item.wowheadUrl || `https://www.wowhead.com/forever/item=${item.id}`);

      panel.innerHTML = `
        <div class="db-detail-drawer">
          <div class="db-detail-header">
            <div style="display:flex; align-items:center; gap:0.75rem; min-width:0;">
              <div class="db-item-icon-wrap" style="border-color:${q.color}; width:44px; height:44px;">
                ${icon ? `<img src="${escAttr(icon)}" alt="">` : `<span class="armory-slot-glyph">#</span>`}
              </div>
              <div style="min-width:0;">
                <h4 style="color:${q.color}; margin:0;">${escHtml(item.name)}</h4>
                <span class="subview-hint">Item ID #${escHtml(String(item.id))}${item.itemSubclass ? ` &bull; ${escHtml(item.itemSubclass)}` : ''}</span>
              </div>
            </div>
            <div style="display:flex; gap:0.45rem; flex-wrap:wrap;">
              <button type="button" class="btn-secondary btn-xs" id="btnCopyDetailItemId">Copy ID</button>
              ${wowhead ? `<a href="${escAttr(wowhead)}" target="_blank" rel="noopener noreferrer" class="btn-secondary btn-xs">Wowhead Forever &nearr;</a>` : ''}
              <button type="button" class="btn-secondary btn-xs" id="btnCloseItemDetailPanel">Close</button>
            </div>
          </div>

          <div class="db-detail-body">
            <div class="wow-tooltip-inline-card">
              ${buildTooltipInnerHtml(item, { includeActions: false })}
            </div>
            <div class="db-detail-market-box">
              <h6>Forever US Market &amp; Utility</h6>
              <div class="armory-stat-line"><span>Min Buyout</span><strong>${formatWowCoinsHtml(item.ahPrice?.min)}</strong></div>
              <div class="armory-stat-line"><span>Weighted Median</span><strong>${formatWowCoinsHtml(item.ahPrice?.median)}</strong></div>
              <div class="armory-stat-line"><span>Auction Quantity</span><strong>${item.ahPrice?.qty ? escHtml(String(item.ahPrice.qty)) : '&mdash;'}</strong></div>
              ${item.ahPrice?.updatedAt ? `<div class="subview-hint" style="margin-top:0.35rem;">AH snapshot updated ${escHtml(formatRelativeTime(item.ahPrice.updatedAt))}</div>` : ''}
              <button type="button" class="btn-secondary btn-sm" id="btnFindCraftersForItem" style="margin-top:0.65rem; width:100%;">Search Guild Crafters for This Item</button>
            </div>
          </div>
        </div>
      `;

      panel.querySelector('#btnCopyDetailItemId')?.addEventListener('click', () => copyToClipboard(item.id, `Copied Item ID #${item.id}`));
      panel.querySelector('#btnCloseItemDetailPanel')?.addEventListener('click', () => { panel.style.display = 'none'; });
      panel.querySelector('#btnFindCraftersForItem')?.addEventListener('click', () => {
        const searchWord = String(item.name || '').split(':')[0].trim();
        uiState.craftingQuery = searchWord;
        const cSearch = document.getElementById('dbCraftingSearch');
        if (cSearch) cSearch.value = searchWord;
        switchDbSubtab('crafting');
      });
    } catch (err) {
      panel.innerHTML = `<div class="bounty-empty-state">Could not load Item #${escHtml(String(itemId))}: ${escHtml(err.message)}</div>`;
    }
  }

  // ---- 2. Guild Crafters Directory ----------------------------------------

  async function loadCraftingDirectory(force = false) {
    const recipesList = document.getElementById('dbCraftingRecipesList');
    if (recipesList && !uiState.craftingData) {
      recipesList.innerHTML = `<div class="table-loading-cell">Loading Guild Crafting Directory...</div>`;
    }

    try {
      const params = new URLSearchParams();
      if (uiState.craftingQuery) params.set('q', uiState.craftingQuery);
      if (uiState.craftingProf && uiState.craftingProf !== 'all') params.set('profession', uiState.craftingProf);
      const res = await fetch(`/api/exchange/armory/crafting?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load crafting directory');

      uiState.craftingData = data;
      renderCraftingDirectory(data);
    } catch (err) {
      if (recipesList) {
        recipesList.innerHTML = `<div class="bounty-empty-state">Unable to load Guild Crafters: ${escHtml(err.message)}</div>`;
      }
    }
  }

  function renderCraftingDirectory(data) {
    const statsBadge = document.getElementById('dbCraftingStatsBadge');
    const chipsBar = document.getElementById('dbCraftingProfChips');
    const craftersBar = document.getElementById('dbCraftingCraftersBar');
    const recipesList = document.getElementById('dbCraftingRecipesList');

    if (statsBadge) {
      statsBadge.textContent = `${data.totalRecipes || 0} Recipes · ${data.totalCrafters || 0} Crafters`;
    }

    if (chipsBar) {
      const profs = ['all', ...(data.professions || [])];
      chipsBar.innerHTML = profs.map(p => {
        const active = (uiState.craftingProf || 'all').toLowerCase() === String(p).toLowerCase();
        return `<button type="button" class="category-chip ${active ? 'active' : ''}" data-prof="${escAttr(p)}">${p === 'all' ? 'All Professions' : escHtml(p)}</button>`;
      }).join('');

      chipsBar.querySelectorAll('[data-prof]').forEach(btn => {
        btn.addEventListener('click', () => {
          uiState.craftingProf = btn.getAttribute('data-prof');
          loadCraftingDirectory();
        });
      });
    }

    if (craftersBar) {
      const crafters = Array.isArray(data.crafters) ? data.crafters : [];
      craftersBar.innerHTML = crafters.length
        ? crafters.map(c => `
            <button type="button" class="db-crafter-card" data-inspect-char-slug="${escAttr(c.slug)}">
              <div class="db-crafter-head">
                <span class="class-badge ${classBadgeCss(c.className)}">${escHtml(c.displayName)}</span>
                ${c.discordName ? `<span class="subview-hint">@${escHtml(c.discordName)}</span>` : ''}
              </div>
              <div class="db-crafter-profs">
                ${(c.professions || []).map(pr => `<span class="armory-talent-pill">${escHtml(pr.name)} <b>${pr.skill}/${pr.maxSkill}</b></span>`).join('')}
              </div>
            </button>
          `).join('')
        : '';

      craftersBar.querySelectorAll('[data-inspect-char-slug]').forEach(btn => {
        btn.addEventListener('click', () => inspectCharFromDatabase(btn.getAttribute('data-inspect-char-slug')));
      });
    }

    if (recipesList) {
      const recipes = Array.isArray(data.recipes) ? data.recipes : [];
      if (!recipes.length) {
        recipesList.innerHTML = `
          <div class="bounty-empty-state">
            No indexed recipes match your filter yet. Once guild members verify their Forever characters, their known professions and recipes populate automatically.
          </div>
        `;
        return;
      }

      recipesList.innerHTML = recipes.map(rec => `
        <div class="db-recipe-row">
          <div class="db-recipe-title">
            <strong>${escHtml(rec.name)}</strong>
            <span class="card-badge crafting">${escHtml(rec.profession)}</span>
          </div>
          <div class="db-recipe-crafters">
            ${(rec.crafters || []).map(cr => `
              <button type="button" class="db-recipe-crafter-pill" data-inspect-char-slug="${escAttr(cr.slug)}" title="Click to inspect Armory">
                <span style="color:${CLASS_COLORS[cr.className] || '#fff'}; font-weight:700;">${escHtml(cr.displayName)}</span>
                <span class="subview-hint">${escHtml(String(cr.skill || 0))}${cr.discordName ? ` · ${escHtml(cr.discordName)}` : ''}</span>
              </button>
            `).join('')}
          </div>
        </div>
      `).join('');

      recipesList.querySelectorAll('[data-inspect-char-slug]').forEach(btn => {
        btn.addEventListener('click', () => inspectCharFromDatabase(btn.getAttribute('data-inspect-char-slug')));
      });
    }
  }

  // ---- 3. Forever Guild Roster --------------------------------------------

  async function loadForeverRoster(forceRefresh = false) {
    const tbody = document.getElementById('dbRosterTableBody');
    const mobileList = document.getElementById('dbRosterMobileList');
    if (tbody && !uiState.rosterData) {
      tbody.innerHTML = `<tr><td colspan="6" class="table-loading-cell">Loading WoW: Forever guild roster...</td></tr>`;
    }

    const isOfficer = Boolean(hostCtx.getState()?.user?.isOfficer);
    const syncBtn = document.getElementById('btnDbSyncRoster');
    if (syncBtn) syncBtn.style.display = isOfficer ? 'inline-flex' : 'none';

    try {
      const qs = forceRefresh ? '?refresh=1' : '';
      const res = await fetch(`/api/exchange/armory/guild-roster${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load guild roster');

      uiState.rosterData = data;
      renderForeverRoster(data);
    } catch (err) {
      const errMsg = `Unable to load Forever guild roster: ${escHtml(err.message)}`;
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="table-loading-cell">${errMsg}</td></tr>`;
      if (mobileList) mobileList.innerHTML = `<div class="table-loading-cell">${errMsg}</div>`;
    }
  }

  function renderForeverRoster(data) {
    const banner = document.getElementById('dbRosterBanner');
    const tbody = document.getElementById('dbRosterTableBody');
    const mobileList = document.getElementById('dbRosterMobileList');

    const members = Array.isArray(data?.members) ? data.members : [];
    const linkedCount = members.filter(m => Boolean(m.matchedDiscordId)).length;

    if (banner) {
      banner.innerHTML = `
        <div class="db-banner-stat"><span>Guild</span><strong>${escHtml(data?.guildName || data?.guildSlug || 'Unconfigured')}</strong></div>
        <div class="db-banner-stat"><span>Characters</span><strong>${members.length.toLocaleString()}</strong></div>
        <div class="db-banner-stat"><span>Linked to Discord</span><strong class="gold">${linkedCount.toLocaleString()}</strong></div>
        <div class="db-banner-stat"><span>Last Sync</span><strong>${escHtml(formatRelativeTime(data?.syncedAt))}</strong></div>
      `;
    }

    const q = String(uiState.rosterQuery || '').trim().toLowerCase();
    const filter = uiState.rosterFilter || 'all';
    const filtered = members.filter(m => {
      if (filter === 'linked' && !m.matchedDiscordId) return false;
      if (filter === 'unlinked' && m.matchedDiscordId) return false;
      if (filter === 'max' && Number(m.level) < 60) return false;
      if (!q) return true;
      return (
        String(m.displayName || m.name || '').toLowerCase().includes(q) ||
        String(m.className || '').toLowerCase().includes(q) ||
        String(m.raceName || '').toLowerCase().includes(q) ||
        String(m.matchedDiscordName || '').toLowerCase().includes(q)
      );
    });

    if (!filtered.length) {
      const empty = data?.found === false
        ? (data.message || 'Guild roster not synced yet.')
        : 'No guild characters match the active filters.';
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="table-loading-cell">${escHtml(empty)}</td></tr>`;
      if (mobileList) mobileList.innerHTML = `<div class="table-loading-cell">${escHtml(empty)}</div>`;
      return;
    }

    if (tbody) {
      tbody.innerHTML = filtered.slice(0, 150).map(m => `
        <tr>
          <td class="subview-hint">Rank ${escHtml(String(m.rank ?? '—'))}</td>
          <td><span class="class-badge ${classBadgeCss(m.className)}">${escHtml(m.displayName || m.name)}</span></td>
          <td><strong>${escHtml(String(m.level || '?'))}</strong></td>
          <td>${escHtml(m.raceName || '')} ${escHtml(m.className || '')}</td>
          <td>
            ${m.matchedDiscordId
              ? `<button type="button" class="btn-link-subtle roster-open-wallet" data-discord-id="${escAttr(m.matchedDiscordId)}">${escHtml(m.matchedDiscordName || 'Linked Member')}</button>`
              : `<span class="subview-hint">Unlinked</span>`
            }
          </td>
          <td style="text-align:right;">
            <button type="button" class="btn-secondary btn-xs roster-inspect-char" data-char-slug="${escAttr(m.slug)}">Armory</button>
          </td>
        </tr>
      `).join('');
    }

    if (mobileList) {
      mobileList.innerHTML = filtered.slice(0, 100).map(m => `
        <div class="mobile-roster-card roster-inspect-char" data-char-slug="${escAttr(m.slug)}">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:0.65rem;">
            <div style="min-width:0;">
              <div style="display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap;">
                <span class="class-badge ${classBadgeCss(m.className)}">${escHtml(m.displayName || m.name)}</span>
                <span class="subview-hint">Lv ${escHtml(String(m.level || '?'))} &bull; Rank ${escHtml(String(m.rank ?? '—'))}</span>
              </div>
              <div class="mobile-roster-meta">
                <span>${escHtml(m.raceName || '')} ${escHtml(m.className || '')}</span>
                ${m.matchedDiscordName ? `<span class="gold">&bull; ${escHtml(m.matchedDiscordName)}</span>` : ''}
              </div>
            </div>
            <div class="mobile-roster-arrow">&rsaquo;</div>
          </div>
        </div>
      `).join('');
    }

    const bindContainer = (root) => {
      if (!root) return;
      root.querySelectorAll('.roster-open-wallet').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const did = btn.getAttribute('data-discord-id');
          window.inspectMemberProfile?.(did);
        });
      });
      root.querySelectorAll('.roster-inspect-char').forEach(el => {
        el.addEventListener('click', () => inspectCharFromDatabase(el.getAttribute('data-char-slug')));
      });
    };
    bindContainer(tbody);
    bindContainer(mobileList);
  }

  // ---- 4. AH Price Watch --------------------------------------------------

  async function loadAhWatchlist() {
    const tbody = document.getElementById('dbAhTableBody');
    const mobileList = document.getElementById('dbAhMobileList');
    if (tbody && !uiState.ahData) {
      tbody.innerHTML = `<tr><td colspan="6" class="table-loading-cell">Loading Auction House snapshot...</td></tr>`;
    }

    try {
      const res = await fetch('/api/exchange/armory/ah/watchlist');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load AH watchlist');
      uiState.ahData = data;
      renderAhWatchlist(data);
    } catch (err) {
      const msg = `Unable to load AH watchlist: ${escHtml(err.message)}`;
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="table-loading-cell">${msg}</td></tr>`;
      if (mobileList) mobileList.innerHTML = `<div class="table-loading-cell">${msg}</div>`;
    }
  }

  function renderAhWatchlist(data) {
    const banner = document.getElementById('dbAhSummaryBanner');
    const tbody = document.getElementById('dbAhTableBody');
    const mobileList = document.getElementById('dbAhMobileList');

    if (banner) {
      banner.innerHTML = `
        <div class="db-banner-stat"><span>Auction House</span><strong>#${escHtml(String(data?.houseId || 110))}</strong></div>
        <div class="db-banner-stat"><span>Ruleset</span><strong>${escHtml(RULESET_NAMES[data?.rulesetId] || `ID ${data?.rulesetId || 1}`)}</strong></div>
        <div class="db-banner-stat"><span>Distinct Items</span><strong>${(data?.distinctItemCount || 0).toLocaleString()}</strong></div>
        <div class="db-banner-stat"><span>Snapshot</span><strong>${data?.hasSnapshot ? escHtml(formatRelativeTime(data.updatedAt)) : 'Awaiting 1st hourly ingest'}</strong></div>
      `;
    }

    const q = String(uiState.ahQuery || '').trim().toLowerCase();
    const rows = (data?.items || []).filter(r =>
      !q || String(r.name || '').toLowerCase().includes(q) || String(r.id).includes(q)
    );

    if (!rows.length) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="table-loading-cell">No tracked consumables match your filter.</td></tr>`;
      if (mobileList) mobileList.innerHTML = `<div class="table-loading-cell">No tracked consumables match your filter.</div>`;
      return;
    }

    if (tbody) {
      tbody.innerHTML = rows.map(r => {
        const qual = qualityInfo(r.quality);
        const icon = sanitizeUrl(r.iconUrl);
        const wowhead = sanitizeUrl(r.wowheadUrl);
        return `
          <tr>
            <td>
              <div style="display:flex; align-items:center; gap:0.55rem;">
                <div class="db-item-icon-wrap" style="border-color:${qual.color}; width:30px; height:30px;">
                  ${icon ? `<img src="${escAttr(icon)}" alt="">` : `<span class="armory-slot-glyph" style="font-size:0.65rem;">#</span>`}
                </div>
                <strong style="color:${qual.color};">${escHtml(r.name)}</strong>
              </div>
            </td>
            <td class="subview-hint">#${escHtml(String(r.id))}</td>
            <td>${formatWowCoinsHtml(r.minBuyout)}</td>
            <td>${formatWowCoinsHtml(r.medianPrice)}</td>
            <td>${r.qty > 0 ? escHtml(String(r.qty)) : '<span class="subview-hint">0</span>'}</td>
            <td style="text-align:right;">
              <button type="button" class="btn-secondary btn-xs ah-inspect-item" data-item-id="${escAttr(String(r.id))}">Item DB</button>
              ${wowhead ? `<a href="${escAttr(wowhead)}" target="_blank" rel="noopener noreferrer" class="btn-secondary btn-xs" style="margin-left:0.25rem;">Wowhead &nearr;</a>` : ''}
            </td>
          </tr>
        `;
      }).join('');
    }

    if (mobileList) {
      mobileList.innerHTML = rows.map(r => {
        const qual = qualityInfo(r.quality);
        return `
          <div class="mobile-roster-card ah-inspect-item" data-item-id="${escAttr(String(r.id))}">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem;">
              <strong style="color:${qual.color}; font-size:0.9rem;">${escHtml(r.name)}</strong>
              <span class="subview-hint">${r.qty > 0 ? `${r.qty} listed` : 'None listed'}</span>
            </div>
            <div class="mobile-roster-meta" style="margin-top:0.35rem; justify-content:space-between;">
              <span>Min: ${formatWowCoinsHtml(r.minBuyout)}</span>
              <span>Med: ${formatWowCoinsHtml(r.medianPrice)}</span>
            </div>
          </div>
        `;
      }).join('');
    }

    const bind = (root) => {
      root?.querySelectorAll('.ah-inspect-item').forEach(el => {
        el.addEventListener('click', () => {
          const itemId = Number(el.getAttribute('data-item-id'));
          switchDbSubtab('items');
          openItemDetail(itemId);
        });
      });
    };
    bind(tbody);
    bind(mobileList);
  }

  // ---- 5. Ad-Hoc Character Lookup -----------------------------------------

  async function inspectCharFromDatabase(slugOrName, surname = '') {
    const clean = String(slugOrName || '').trim();
    if (!clean) return;
    let first = clean;
    let last = String(surname || '').trim();
    if (!last && clean.includes('-')) {
      const parts = clean.split('-');
      first = parts[0] || '';
      last = parts.slice(1).join('-');
    }

    const nameIn = document.getElementById('dbLookupName');
    const surIn = document.getElementById('dbLookupSurname');
    if (nameIn) nameIn.value = first;
    if (surIn) surIn.value = last;

    hostCtx.switchTab('database');
    switchDbSubtab('lookup');
    await executeDatabaseCharLookup(first, last, false);
  }

  async function executeDatabaseCharLookup(name, surname, forceRefresh = false) {
    const resultEl = document.getElementById('dbCharLookupResult');
    if (!resultEl) return;

    const slug = buildCharSlugClient(name, surname);
    if (!slug) {
      hostCtx.showToast('Please enter a character name and surname.');
      return;
    }

    uiState.lookupLastSlug = slug;
    resultEl.innerHTML = `<div class="armory-loading-box">Loading WoW: Forever Armory for <strong>${escHtml(slug)}</strong>...</div>`;

    try {
      const snapshot = await fetchCharacterArmoryClient({ slug, name, surname, forceRefresh });
      let tab = 'paperdoll';
      const draw = (nextTab) => {
        tab = nextTab;
        renderSnapshotIntoContainer(resultEl, snapshot, {
          innerTab: tab,
          onTabChange: draw,
          onRefresh: () => executeDatabaseCharLookup(name, surname, true)
        });
      };
      draw('paperdoll');
    } catch (err) {
      resultEl.innerHTML = `<div class="bounty-empty-state">Armory lookup failed: ${escHtml(err.message)}</div>`;
    }
  }

  // =========================================================================
  // #modalCharacters "VERIFY VIA ARMORY" INTEGRATION
  // =========================================================================

  function bindCharacterVerifyControls() {
    const verifyBtn = document.getElementById('btnVerifyNewCharArmory');
    const nameInput = document.getElementById('newCharName');
    const surnameInput = document.getElementById('newCharSurname');
    const statusBox = document.getElementById('newCharArmoryStatus');

    const clearPending = () => {
      uiState.pendingVerifiedChar = null;
      if (statusBox) {
        statusBox.style.display = 'none';
        statusBox.className = 'armory-verify-status';
        statusBox.textContent = '';
      }
    };

    nameInput?.addEventListener('input', clearPending);
    surnameInput?.addEventListener('input', clearPending);

    verifyBtn?.addEventListener('click', async () => {
      const name = String(nameInput?.value || '').trim();
      const surname = String(surnameInput?.value || '').trim();
      if (!name || !surname) {
        hostCtx.showToast('Enter both Character Name and Forever Surname first.');
        return;
      }

      verifyBtn.disabled = true;
      verifyBtn.textContent = 'Verifying...';
      if (statusBox) {
        statusBox.style.display = 'block';
        statusBox.className = 'armory-verify-status';
        statusBox.textContent = 'Querying Battle.net WoW: Forever US Armory...';
      }

      try {
        const snapshot = await fetchCharacterArmoryClient({ name, surname, forceRefresh: true });
        if (snapshot?.found) {
          const classEl = document.getElementById('newCharClass');
          const profEl = document.getElementById('newCharProfessions');
          if (classEl && snapshot.className) classEl.value = snapshot.className;
          if (profEl && snapshot.professions?.allSummary) profEl.value = snapshot.professions.allSummary;

          uiState.pendingVerifiedChar = {
            name: snapshot.name || name,
            surname: snapshot.surname || surname,
            slug: snapshot.slug,
            ruleset: snapshot.ruleset?.name || document.getElementById('newCharRuleset')?.value || 'PvP',
            race: snapshot.race || '',
            level: snapshot.level || null,
            avgItemLevel: snapshot.avgItemLevel || null,
            guildName: snapshot.guild?.name || '',
            avatarThumbUrl: snapshot.media?.avatar || '',
            armoryVerified: true,
            lastArmorySyncAt: snapshot.syncedAt || new Date().toISOString()
          };

          if (statusBox) {
            statusBox.className = 'armory-verify-status is-verified';
            statusBox.innerHTML = `Verified: <strong>${escHtml(snapshot.displayName)}</strong> &mdash; Lv ${escHtml(String(snapshot.level || '?'))} ${escHtml(snapshot.race || '')} ${escHtml(snapshot.className || '')}${snapshot.guild?.name ? ` &lt;${escHtml(snapshot.guild.name)}&gt;` : ''}`;
          }
          hostCtx.showToast(`Verified ${snapshot.displayName} on Forever Armory!`);
        } else {
          uiState.pendingVerifiedChar = null;
          if (statusBox) {
            statusBox.className = 'armory-verify-status is-warning';
            statusBox.textContent = snapshot?.message || 'Not found yet on Forever Armory (requires Level 10+ and at least 1 logout). You can still add manually.';
          }
        }
      } catch (err) {
        uiState.pendingVerifiedChar = null;
        if (statusBox) {
          statusBox.className = 'armory-verify-status is-warning';
          statusBox.textContent = `Armory check unavailable: ${err.message}`;
        }
      } finally {
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verify via Armory';
      }
    });
  }

  function consumePendingVerifiedCharacter() {
    const out = uiState.pendingVerifiedChar;
    uiState.pendingVerifiedChar = null;
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
        uiState.rosterData = data.roster || null;
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
  // DATABASE UI BINDINGS & PUBLIC API
  // =========================================================================

  function bindDatabaseEvents() {
    document.querySelectorAll('.db-subtab').forEach(btn => {
      btn.addEventListener('click', () => switchDbSubtab(btn.getAttribute('data-db-subtab')));
    });

    const itemInput = document.getElementById('dbItemSearchInput');
    document.getElementById('btnDbItemSearch')?.addEventListener('click', () => searchItems(itemInput?.value || '', 1));
    itemInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        searchItems(itemInput.value, 1);
      }
    });
    document.getElementById('btnClearDbItemSearch')?.addEventListener('click', () => {
      if (itemInput) itemInput.value = '';
      searchItems('', 1);
    });

    document.querySelectorAll('.db-item-preset').forEach(chip => {
      chip.addEventListener('click', () => {
        const q = chip.getAttribute('data-query') || '';
        if (itemInput) itemInput.value = q;
        searchItems(q, 1);
      });
    });

    // Crafting search debounce
    let craftTimer = null;
    document.getElementById('dbCraftingSearch')?.addEventListener('input', (e) => {
      uiState.craftingQuery = e.target.value;
      clearTimeout(craftTimer);
      craftTimer = setTimeout(() => loadCraftingDirectory(), 220);
    });

    // Roster filter & search
    document.getElementById('dbRosterSearch')?.addEventListener('input', (e) => {
      uiState.rosterQuery = e.target.value;
      if (uiState.rosterData) renderForeverRoster(uiState.rosterData);
    });
    document.querySelectorAll('#dbRosterFilterPills [data-roster-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#dbRosterFilterPills [data-roster-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        uiState.rosterFilter = btn.getAttribute('data-roster-filter');
        if (uiState.rosterData) renderForeverRoster(uiState.rosterData);
      });
    });
    document.getElementById('btnDbSyncRoster')?.addEventListener('click', () => loadForeverRoster(true));

    // AH search & refresh
    document.getElementById('dbAhSearchInput')?.addEventListener('input', (e) => {
      uiState.ahQuery = e.target.value;
      if (uiState.ahData) renderAhWatchlist(uiState.ahData);
    });
    document.getElementById('btnRefreshAhWatch')?.addEventListener('click', () => loadAhWatchlist());

    // Ad-hoc character lookup
    const runLookup = () => {
      const first = document.getElementById('dbLookupName')?.value.trim() || '';
      const last = document.getElementById('dbLookupSurname')?.value.trim() || '';
      executeDatabaseCharLookup(first, last, false);
    };
    document.getElementById('btnDbCharLookup')?.addEventListener('click', runLookup);
    document.getElementById('dbLookupSurname')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runLookup();
      }
    });
  }

  window.BSEArmory = {
    init(ctx) {
      if (ctx) hostCtx = { ...hostCtx, ...ctx };
      if (uiState.initialized) return;
      uiState.initialized = true;
      bindGlobalTooltipHandlers();
      bindDatabaseEvents();
      bindCharacterVerifyControls();
      bindOfficerArmoryControls();
      updateConnectionBadge();
    },

    onTabActivated(tabName) {
      hideTooltip(true);
      updateConnectionBadge();
      if (tabName === 'database') {
        switchDbSubtab(uiState.activeDbSubtab || 'items');
      }
    },

    onBseStateUpdated() {
      updateConnectionBadge();
    },

    renderMemberProfileModal,
    consumePendingVerifiedCharacter,
    syncOfficerArmoryForm,
    inspectCharacter: inspectCharFromDatabase,

    openItemPicker(callback) {
      uiState.itemPickerCallback = typeof callback === 'function' ? callback : null;
      hostCtx.switchTab('database');
      switchDbSubtab('items');
      if (uiState.itemResults.length) {
        renderItemsGrid({ page: uiState.itemPage, pageCount: 1 });
      }
    },

    formatWowCoinsHtml
  };
})();
