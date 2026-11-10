/**
 * Black Sands Exchange (BSE) - Full Modular Application Client
 */

// Application State
const state = {
  user: null,
  bseState: null,
  activeTab: 'leaderboard',
  activeOfficerSubtab: 'claims',
  selectedBountyForClaim: null,
  selectedItemForBuy: null,
  inspectedMemberId: null,
  userCharacters: [],
  editorMode: false,
  pollTimer: null,
  // Draft rank and FAQ builders for live officer editing
  draftRanks: [],
  draftFaq: [],
  officerLeaderboardFilter: 'active'
};

// DOM Elements
const authContainer = document.getElementById('authContainer');
const discordLoginBtn = document.getElementById('discordLoginBtn');
const userProfileBadge = document.getElementById('userProfileBadge');
const headerAvatar = document.getElementById('headerAvatar');
const headerDisplayName = document.getElementById('headerDisplayName');
const headerRoleBadge = document.getElementById('headerRoleBadge');
const logoutBtn = document.getElementById('logoutBtn');

const announcementBanner = document.getElementById('announcementBanner');
const announcementIcon = document.getElementById('announcementIcon');
const announcementText = document.getElementById('announcementText');

const brandLogo = document.getElementById('brandLogo');
const brandGuildName = document.getElementById('brandGuildName');
const brandTagline = document.getElementById('brandTagline');
const pageTitle = document.getElementById('pageTitle');
const pageFavicon = document.getElementById('pageFavicon');

const walletAvatar = document.getElementById('walletAvatar');
const walletName = document.getElementById('walletName');
const walletHandle = document.getElementById('walletHandle');
const walletSpendable = document.getElementById('walletSpendable');
const walletScore = document.getElementById('walletScore');
const walletRankTitle = document.getElementById('walletRankTitle');
const nextRankTitle = document.getElementById('nextRankTitle');
const rankProgressText = document.getElementById('rankProgressText');
const rankProgressBar = document.getElementById('rankProgressBar');
const btnPromoteRank = document.getElementById('btnPromoteRank');

const walletCharContainer = document.getElementById('walletCharContainer');
const walletPrimaryCharName = document.getElementById('walletPrimaryCharName');
const btnOpenCharModal = document.getElementById('btnOpenCharModal');

const labelSpendableCurrency = document.getElementById('labelSpendableCurrency');
const labelCareerScore = document.getElementById('labelCareerScore');
const thSpendable = document.getElementById('thSpendable');
const thScore = document.getElementById('thScore');

const tabNavLeaderboard = document.getElementById('tabNavLeaderboard');
const tabNavBounties = document.getElementById('tabNavBounties');
const tabNavShop = document.getElementById('tabNavShop');
const tabNavFaq = document.getElementById('tabNavFaq');
const tabHistory = document.getElementById('tabHistory');
const tabOfficer = document.getElementById('tabOfficer');
const officerActionBadge = document.getElementById('officerActionBadge');
const subtabClaimCount = document.getElementById('subtabClaimCount');
const subtabDeliveryCount = document.getElementById('subtabDeliveryCount');

const leaderboardTbody = document.getElementById('leaderboardTbody');
const mobileLeaderboardList = document.getElementById('mobileLeaderboardList');
const searchLeaderboard = document.getElementById('searchLeaderboard');
const thLeaderboardActions = document.getElementById('thLeaderboardActions');

const memberHistoryTbody = document.getElementById('memberHistoryTbody');
const mobileHistoryList = document.getElementById('mobileHistoryList');

const bountiesGrid = document.getElementById('bountiesGrid');
const shopGrid = document.getElementById('shopGrid');
const faqAccordionContainer = document.getElementById('faqAccordionContainer');

// Mobile Bottom Nav elements
const mobileBottomNav = document.getElementById('mobileBottomNav');
const mobileTabHistory = document.getElementById('mobileTabHistory');
const mobileTabOfficer = document.getElementById('mobileTabOfficer');
const mobileOfficerActionBadge = document.getElementById('mobileOfficerActionBadge');

// Officer views
const pendingClaimsList = document.getElementById('pendingClaimsList');
const pendingDeliveriesList = document.getElementById('pendingDeliveriesList');
const officerBountiesList = document.getElementById('officerBountiesList');
const officerShopList = document.getElementById('officerShopList');
const auditTrailTbody = document.getElementById('auditTrailTbody');
const ranksBuilderContainer = document.getElementById('ranksBuilderContainer');
// Data Editor elements
const dataEditorAnnounceEnabled = document.getElementById('dataEditorAnnounceEnabled');
const dataEditorAnnounceText = document.getElementById('dataEditorAnnounceText');
const dataEditorAnnounceType = document.getElementById('dataEditorAnnounceType');

// Leaderboard Officer Filter Elements
const officerLeaderboardFilters = document.getElementById('officerLeaderboardFilters');
const btnFilterActive = document.getElementById('btnFilterActive');
const btnFilterZero = document.getElementById('btnFilterZero');
const btnFilterHidden = document.getElementById('btnFilterHidden');
const btnFilterAll = document.getElementById('btnFilterAll');
const cntActive = document.getElementById('cntActive');
const cntZero = document.getElementById('cntZero');
const cntHidden = document.getElementById('cntHidden');
const cntAll = document.getElementById('cntAll');

// Officer Hall Header Workflow Buttons
const btnSyncDiscordRoster = document.getElementById('btnSyncDiscordRoster');
const btnOpenRaidAwardModal = document.getElementById('btnOpenRaidAwardModal');
const btnExportLedgerCsv = document.getElementById('btnExportLedgerCsv');
const btnSyncDiscordStandings = document.getElementById('btnSyncDiscordStandings');

// Raid Multi-Award Modal elements
const modalRaidAward = document.getElementById('modalRaidAward');
const raidAwardMemberList = document.getElementById('raidAwardMemberList');
const batchAwardAmount = document.getElementById('batchAwardAmount');
const batchEventName = document.getElementById('batchEventName');
const batchAwardReason = document.getElementById('batchAwardReason');
const btnSelectAllRaid = document.getElementById('btnSelectAllRaid');
const btnDeselectAllRaid = document.getElementById('btnDeselectAllRaid');
const filterRaidMembers = document.getElementById('filterRaidMembers');
const raidAwardSummary = document.getElementById('raidAwardSummary');
const btnExecuteBatchAward = document.getElementById('btnExecuteBatchAward');

// Inspector officer hide checkbox
const inspectorOfficerHidden = document.getElementById('inspectorOfficerHidden');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupOfficerSubtabs();
  setupModals();
  setupCharacterManagement();
  setupHistory();
  setupOfficerTools();
  setupOfficerLeaderboardFilters();
  setupRaidMultiAward();
  setupDataEditor();

  // Concurrently fetch auth session and central BSE state
  await Promise.allSettled([checkAuthSession(), refreshBseState()]);

  // Ensure leaderboard renders immediately
  renderLeaderboard();

  // Poll state every 4 seconds for real-time reactivity
  state.pollTimer = setInterval(refreshBseState, 4000);
});

/**
 * Check Discord OAuth Session
 */
async function checkAuthSession() {
  try {
    const res = await fetch('/api/auth/discord/me');
    const data = await res.json();
    if (data.authenticated && data.user) {
      state.user = data.user;
      state.userCharacters = data.user.characters || [];
      renderAuthenticatedUser(data.user);
      if (state.bseState) {
        renderLeaderboard();
      }
    } else {
      renderUnauthenticatedUser();
    }
  } catch (err) {
    console.warn('Session check failed:', err);
    renderUnauthenticatedUser();
  }
}

function renderAuthenticatedUser(user) {
  discordLoginBtn.style.display = 'none';
  userProfileBadge.style.display = 'flex';

  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
    : 'assets/favicon.svg';

  headerAvatar.src = avatarUrl;
  headerDisplayName.textContent = user.serverNickname || user.globalName || user.username;
  headerRoleBadge.textContent = user.isOfficer ? 'Guild Officer' : 'Guild Member';

  walletAvatar.src = avatarUrl;
  walletName.textContent = user.serverNickname || user.globalName || user.username;
  walletHandle.textContent = `@${user.username}`;
  walletSpendable.textContent = (user.spendableBones || 0).toLocaleString();
  walletScore.textContent = (user.boneScore || 0).toLocaleString();

  // Populate Public Guild Note
  const modalNoteInput = document.getElementById('modalGuildNoteInput');
  if (modalNoteInput) modalNoteInput.value = user.guildNote || '';

  // Primary Character Pill in Wallet
  walletCharContainer.style.display = 'flex';
  if (user.primaryCharacter) {
    walletPrimaryCharName.textContent = user.primaryCharacter;
  } else {
    walletPrimaryCharName.textContent = 'None';
  }

  updatePrestigeBanner(user.boneScore || 0, user.spendableBones || 0);

  // Show Member Transaction History Tab (Desktop + Mobile)
  if (tabHistory) tabHistory.style.display = 'inline-flex';
  if (mobileTabHistory) mobileTabHistory.style.display = 'flex';

  // STRICT OFFICER PERMISSION CHECK: Show or Hide Officer Hall
  if (user.isOfficer) {
    tabOfficer.style.display = 'inline-flex';
    if (mobileTabOfficer) mobileTabOfficer.style.display = 'flex';
  } else {
    tabOfficer.style.display = 'none';
    if (mobileTabOfficer) mobileTabOfficer.style.display = 'none';
    if (state.activeTab === 'officer') {
      switchTab('leaderboard');
    }
  }
}

function renderUnauthenticatedUser() {
  discordLoginBtn.style.display = 'inline-flex';
  userProfileBadge.style.display = 'none';
  walletName.textContent = 'Welcome, Traveler';
  walletHandle.textContent = 'Sign in with Discord to access your ledger';
  walletSpendable.textContent = '0';
  walletScore.textContent = '0';
  walletCharContainer.style.display = 'none';
  if (tabHistory) tabHistory.style.display = 'none';
  if (mobileTabHistory) mobileTabHistory.style.display = 'none';
  tabOfficer.style.display = 'none';
  if (mobileTabOfficer) mobileTabOfficer.style.display = 'none';
  if (state.activeTab === 'officer' || state.activeTab === 'history') {
    switchTab('leaderboard');
  }
}

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  state.user = null;
  window.location.reload();
});

/**
 * Fetch and Render Central BSE State
 */
async function refreshBseState() {
  try {
    const res = await fetch('/api/exchange/state');
    if (!res.ok) return;
    const bse = await res.json();
    state.bseState = bse;

    // Apply modular customizations
    applySiteCustomization(bse);

    // Refresh wallet if logged in
    if (state.user && bse.wallets?.[state.user.id]) {
      const w = bse.wallets[state.user.id];
      state.user.spendableBones = w.spendableBones || 0;
      state.user.boneScore = w.boneScore || 0;
      state.user.primaryCharacter = w.primaryCharacter || state.user.primaryCharacter;
      state.user.characters = w.characters || state.user.characters || [];
      state.userCharacters = state.user.characters;

      walletSpendable.textContent = state.user.spendableBones.toLocaleString();
      walletScore.textContent = state.user.boneScore.toLocaleString();
      walletPrimaryCharName.textContent = state.user.primaryCharacter || 'None (Click to link)';
      updatePrestigeBanner(state.user.boneScore, state.user.spendableBones);
    }

    renderLeaderboard();
    renderMemberHistory();
    renderBounties();
    renderShop();
    renderFaq();

    if (state.user?.isOfficer) {
      renderOfficerQueues();
      renderOfficerBountiesList();
      renderOfficerShopList();
      renderAuditTrail();
      if (!state.editorMode) {
        populateOfficerSettingsForms();
      }
    }
  } catch (err) {
    console.error('State refresh error:', err);
  }
}

/**
 * Apply Modular Branding, Theme, and Navigation Modules
 */
function applySiteCustomization(bse) {
  if (!bse) return;
  const branding = bse.branding || {};
  const modules = bse.siteModules || {};
  const theme = bse.theme || {};

  const currName = branding.currencyName || 'Bones';

  // Currency Labels
  if (labelSpendableCurrency) labelSpendableCurrency.textContent = `Spendable ${currName}`;
  if (labelCareerScore) labelCareerScore.textContent = `Career ${currName} Score`;
  if (thSpendable) thSpendable.textContent = `Spendable ${currName}`;
  if (thScore) thScore.textContent = `Career Score`;

  // Branding text & title
  if (branding.guildName) {
    if (brandGuildName) brandGuildName.textContent = branding.guildName;
    if (pageTitle) pageTitle.textContent = `${branding.guildName} — Guild Economy & Bounty Board`;
  }
  if (branding.tagline && brandTagline) brandTagline.textContent = branding.tagline;
  if (branding.logoUrl && brandLogo) brandLogo.src = branding.logoUrl;
  if (branding.logoUrl && pageFavicon) pageFavicon.href = branding.logoUrl;

  // Announcement Banner
  if (announcementBanner && announcementText) {
    if (branding.announcement?.enabled && branding.announcement?.text) {
      announcementBanner.style.display = 'flex';
      announcementBanner.className = `announcement-banner ${branding.announcement.type || 'gold'}`;
      announcementText.textContent = branding.announcement.text;
    } else {
      announcementBanner.style.display = 'none';
    }
  }

  // Navigation Module Visibility & Custom Titles (Clean non-emoji labels)
  const cleanTitle = (raw, fallback) => {
    if (!raw) return fallback;
    return raw.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim() || fallback;
  };

  if (modules.leaderboard && tabNavLeaderboard) {
    tabNavLeaderboard.textContent = cleanTitle(modules.leaderboard.title, 'Leaderboard');
    tabNavLeaderboard.style.display = modules.leaderboard.enabled === false ? 'none' : 'inline-flex';
  }
  if (modules.bounties && tabNavBounties) {
    tabNavBounties.textContent = cleanTitle(modules.bounties.title, 'Bounty Board');
    tabNavBounties.style.display = modules.bounties.enabled === false ? 'none' : 'inline-flex';
  }
  if (modules.shop && tabNavShop) {
    tabNavShop.textContent = cleanTitle(modules.shop.title, 'Exchange Shop');
    tabNavShop.style.display = modules.shop.enabled === false ? 'none' : 'inline-flex';
  }
  if (modules.faq && tabNavFaq) {
    tabNavFaq.textContent = cleanTitle(modules.faq.title, 'Rules & FAQ');
    tabNavFaq.style.display = modules.faq.enabled === false ? 'none' : 'inline-flex';
  }
}

/**
 * Prestige Rank Progress Calculation
 */
function updatePrestigeBanner(boneScore, spendableBones) {
  const ranks = state.bseState?.ranks || [
    { tier: 0, title: 'Initiate', costBones: 0 },
    { tier: 1, title: 'Dune Scavenger', costBones: 25 },
    { tier: 2, title: 'Wasteland Raider', costBones: 75 },
    { tier: 3, title: 'Shadow Broker', costBones: 150 },
    { tier: 4, title: 'Exalted Broker', costBones: 300 }
  ];

  let currentRank = ranks[0];
  let nextRank = null;

  for (let i = 0; i < ranks.length; i++) {
    if (boneScore >= ranks[i].costBones) {
      currentRank = ranks[i];
      nextRank = ranks[i + 1] || null;
    }
  }

  const currName = state.bseState?.branding?.currencyName || 'Bones';
  walletRankTitle.textContent = currentRank.title;

  if (!nextRank) {
    nextRankTitle.textContent = 'Max Prestige Achieved';
    rankProgressText.textContent = `${boneScore} ${currName}`;
    rankProgressBar.style.width = '100%';
    btnPromoteRank.style.display = 'none';
  } else {
    nextRankTitle.textContent = `Next: ${nextRank.title}`;
    const required = nextRank.costBones;
    const progress = Math.min(100, Math.floor((spendableBones / required) * 100));
    rankProgressText.textContent = `${spendableBones} / ${required} ${currName}`;
    rankProgressBar.style.width = `${progress}%`;

    btnPromoteRank.style.display = 'block';
    btnPromoteRank.textContent = `Promote to ${nextRank.title} (${required} ${currName})`;
    btnPromoteRank.onclick = () => openRankPromoteModal(nextRank);
  }
}

/**
 * Helper: Classic WoW Class Icon (Clean empty prefix)
 */
function getClassIcon(className = '') {
  return '';
}

/**
 * Render Leaderboard with Dual Desktop Table & Mobile Roster Stream
 */
function renderLeaderboard() {
  if (!state.bseState) return;
  const allWallets = Object.values(state.bseState.wallets || {});
  const query = (searchLeaderboard?.value || '').toLowerCase().trim();
  const isOfficer = Boolean(state.user?.isOfficer);

  // Helper check: Zero-Bones member (separate from officer-hidden)
  const isZeroBones = (w) => (w.boneScore || 0) === 0 && (w.spendableBones || 0) === 0;

  // Counts for officer filter pills
  const activeCount = allWallets.filter(w => !w.officerHidden && !isZeroBones(w)).length;
  const zeroCount = allWallets.filter(w => !w.officerHidden && isZeroBones(w)).length;
  const hiddenCount = allWallets.filter(w => Boolean(w.officerHidden)).length;
  const totalCount = allWallets.length;

  if (cntActive) cntActive.textContent = activeCount;
  if (cntZero) cntZero.textContent = zeroCount;
  if (cntHidden) cntHidden.textContent = hiddenCount;
  if (cntAll) cntAll.textContent = totalCount;

  if (officerLeaderboardFilters) {
    officerLeaderboardFilters.style.display = isOfficer ? 'flex' : 'none';
  }

  // Determine visible pool based on permissions and filter selection
  let visiblePool = [];
  if (!isOfficer) {
    // Regular Guild Members:
    // 1. Hide members who have 0 bones (auto-unhidden once earning bones)
    // 2. Hide members who are officer-hidden
    visiblePool = allWallets.filter(w => !w.officerHidden && !isZeroBones(w));
    visiblePool.sort((a, b) => (b.boneScore || b.spendableBones || 0) - (a.boneScore || a.spendableBones || 0));
  } else {
    // Officers: respect selected filter tab
    const currentFilter = state.officerLeaderboardFilter || 'active';
    let pool = [];

    if (currentFilter === 'active') {
      pool = allWallets.filter(w => !w.officerHidden && !isZeroBones(w));
      pool.sort((a, b) => (b.boneScore || b.spendableBones || 0) - (a.boneScore || a.spendableBones || 0));
    } else if (currentFilter === 'zero') {
      pool = allWallets.filter(w => !w.officerHidden && isZeroBones(w));
      pool.sort((a, b) => {
        const nameA = (a.serverNickname || a.globalName || a.username || '').toLowerCase();
        const nameB = (b.serverNickname || b.globalName || b.username || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });
    } else if (currentFilter === 'hidden') {
      pool = allWallets.filter(w => Boolean(w.officerHidden));
      pool.sort((a, b) => (b.boneScore || 0) - (a.boneScore || 0));
    } else {
      // 'all'
      // Segregate into: active members (top), zero-bones members (middle), officer-hidden (bottom)
      const activePart = allWallets.filter(w => !w.officerHidden && !isZeroBones(w));
      activePart.sort((a, b) => (b.boneScore || b.spendableBones || 0) - (a.boneScore || a.spendableBones || 0));

      const zeroPart = allWallets.filter(w => !w.officerHidden && isZeroBones(w));
      zeroPart.sort((a, b) => {
        const nameA = (a.serverNickname || a.globalName || a.username || '').toLowerCase();
        const nameB = (b.serverNickname || b.globalName || b.username || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });

      const hiddenPart = allWallets.filter(w => Boolean(w.officerHidden));
      hiddenPart.sort((a, b) => (b.boneScore || 0) - (a.boneScore || 0));

      pool = [...activePart, ...zeroPart, ...hiddenPart];
    }
    visiblePool = pool;
  }

  // Apply search query filter
  const filtered = visiblePool.filter(w => {
    if (!query) return true;
    const name = (w.serverNickname || w.globalName || w.username || '').toLowerCase();
    const handle = (w.username || '').toLowerCase();
    const char = (w.primaryCharacter || '').toLowerCase();
    const note = (w.guildNote || '').toLowerCase();
    return name.includes(query) || handle.includes(query) || char.includes(query) || note.includes(query);
  });

  if (thLeaderboardActions) {
    thLeaderboardActions.style.display = isOfficer ? 'table-cell' : 'none';
  }

  const colSpanCount = isOfficer ? 8 : 7;

  if (!filtered.length) {
    let emptyMsg = 'No members match the search query.';
    if (!query) {
      if (!isOfficer && !activeCount) {
        emptyMsg = 'The season standings are reset! Complete bounties or attend guild events to claim the #1 rank on the leaderboard.';
      } else if (isOfficer && state.officerLeaderboardFilter === 'active' && !activeCount) {
        emptyMsg = 'All members currently have 0 Bones. Use "0-Bones Members" or "All Guild Members" filter tab above to view the roster and award Bones.';
      }
    }
    leaderboardTbody.innerHTML = `<tr><td colspan="${colSpanCount}" style="text-align: center; color: var(--gold-200); padding: 3rem; font-family: 'Cinzel', serif;">${emptyMsg}</td></tr>`;
    if (mobileLeaderboardList) {
      mobileLeaderboardList.innerHTML = `<div style="text-align: center; color: var(--gold-200); padding: 3rem; font-family: 'Cinzel', serif;">${emptyMsg}</div>`;
    }
    return;
  }

  // 1. Render Desktop Table (>= 768px)
  let activeRankCounter = 1;
  leaderboardTbody.innerHTML = filtered.map(w => {
    const isHidden = Boolean(w.officerHidden);
    const isZero = isZeroBones(w);
    let rankDisplay = '—';
    if (!isHidden && !isZero) {
      rankDisplay = `#${activeRankCounter++}`;
    }

    const name = w.serverNickname || w.globalName || w.username || 'Guild Member';
    const handle = w.username ? `@${w.username}` : '';
    const avatarUrl = w.avatarHash
      ? `https://cdn.discordapp.com/avatars/${w.discordId}/${w.avatarHash}.png?size=32`
      : 'assets/favicon.svg';

    const rankTitle = resolveRankTitle(w.boneScore);

    // Resolve character and class info
    const chars = w.characters || [];
    const primChar = chars.find(c => c.isPrimary) || (w.primaryCharacter ? chars.find(c => c.name === w.primaryCharacter) : chars[0]);
    const charName = primChar ? primChar.name : (w.primaryCharacter || null);
    const charClass = primChar ? (primChar.class || 'Warrior') : 'Warrior';
    const charRole = primChar ? (primChar.role || 'DPS') : 'DPS';
    const classCss = `class-${charClass.toLowerCase().replace(/\s+/g, '-')}`;

    const charDisplay = charName
      ? `<span class="class-badge ${classCss}">${charName}</span>`
      : `<span style="color:var(--text-dim); font-size:0.8rem;">—</span>`;

    const roleCss = (charRole || 'dps').toLowerCase();
    const roleDisplay = charName
      ? `<span class="role-pill ${roleCss}">${charRole}</span>`
      : `<span style="color:var(--text-dim); font-size:0.8rem;">—</span>`;

    const officerActionsCell = isOfficer ? `
      <td style="text-align: center;" onclick="event.stopPropagation()">
        <div class="officer-inline-actions">
          <button class="btn-officer-award" title="Award Bones" onclick="event.stopPropagation(); quickAwardMember('${w.discordId}', '${escapeAttr(name)}')">+ Bones</button>
          <button class="btn-officer-deduct" title="Deduct Bones" onclick="event.stopPropagation(); quickDeductMember('${w.discordId}', '${escapeAttr(name)}', ${w.spendableBones || 0})">- Bones</button>
          <button class="btn-officer-adjust" title="Adjust Lifetime Career Score" onclick="event.stopPropagation(); quickAdjustLifetime('${w.discordId}', '${escapeAttr(name)}', ${w.boneScore || 0})">Lifetime</button>
          <button class="btn-officer-hide" title="${isHidden ? 'Unhide member from public board' : 'Hide member from public board'}" onclick="event.stopPropagation(); quickToggleHideMember('${w.discordId}', '${escapeAttr(name)}', ${isHidden})">${isHidden ? 'Unhide' : 'Hide'}</button>
          <button class="btn-officer-purge" title="Delete Member from Roster" onclick="event.stopPropagation(); quickDeleteMember('${w.discordId}', '${escapeAttr(name)}', ${w.spendableBones || 0}, ${w.boneScore || 0})">Purge</button>
        </div>
      </td>
    ` : '';

    const statusBadge = isHidden
      ? `<span class="badge-officer-hidden">Hidden</span>`
      : (isZero ? `<span class="badge-zero-bones">0 Bones</span>` : '');

    const rowClass = isHidden ? 'class="officer-hidden-row"' : '';

    return `
      <tr ${rowClass} onclick="inspectMemberProfile('${w.discordId}')" title="Click to inspect ${name}'s WoW characters, roles, and guild note">
        <td class="table-rank-cell">${rankDisplay}</td>
        <td>
          <div class="member-cell">
            <img src="${avatarUrl}" class="table-avatar" alt="${name}">
            <div>
              <div style="font-weight: 700; color: var(--gold-100); display: flex; align-items: center; flex-wrap: wrap;">
                ${name} ${statusBadge}
              </div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">${handle}</div>
            </div>
          </div>
        </td>
        <td>${charDisplay}</td>
        <td>${roleDisplay}</td>
        <td><span class="card-badge economy">${rankTitle}</span></td>
        <td style="font-weight: 700; color: var(--gold-300);">${(w.spendableBones || 0).toLocaleString()}</td>
        <td style="font-weight: 700; color: var(--amber);">${(w.boneScore || 0).toLocaleString()}</td>
        ${officerActionsCell}
      </tr>
    `;
  }).join('');

  // 2. Render Mobile Roster Stream (< 768px)
  if (mobileLeaderboardList) {
    let mobCounter = 1;
    mobileLeaderboardList.innerHTML = filtered.map(w => {
      const isHidden = Boolean(w.officerHidden);
      const isZero = isZeroBones(w);
      const rankNum = (!isHidden && !isZero) ? `#${mobCounter++}` : '—';

      const name = w.serverNickname || w.globalName || w.username || 'Guild Member';
      const avatarUrl = w.avatarHash
        ? `https://cdn.discordapp.com/avatars/${w.discordId}/${w.avatarHash}.png?size=48`
        : 'assets/favicon.svg';

      const chars = w.characters || [];
      const primChar = chars.find(c => c.isPrimary) || (w.primaryCharacter ? chars.find(c => c.name === w.primaryCharacter) : chars[0]);
      const charName = primChar ? primChar.name : (w.primaryCharacter || null);
      const charClass = primChar ? (primChar.class || 'Warrior') : 'Warrior';
      const charRole = primChar ? (primChar.role || 'DPS') : 'DPS';
      const classCss = `class-${charClass.toLowerCase().replace(/\s+/g, '-')}`;
      const roleCss = (charRole || 'dps').toLowerCase();

      const mobileOfficerStrip = isOfficer ? `
        <div class="mobile-card-officer-strip" onclick="event.stopPropagation()">
          <button class="btn-officer-award" onclick="event.stopPropagation(); quickAwardMember('${w.discordId}', '${escapeAttr(name)}')">+ Bones</button>
          <button class="btn-officer-deduct" onclick="event.stopPropagation(); quickDeductMember('${w.discordId}', '${escapeAttr(name)}', ${w.spendableBones || 0})">- Bones</button>
          <button class="btn-officer-adjust" onclick="event.stopPropagation(); quickAdjustLifetime('${w.discordId}', '${escapeAttr(name)}', ${w.boneScore || 0})">Lifetime</button>
          <button class="btn-officer-hide" onclick="event.stopPropagation(); quickToggleHideMember('${w.discordId}', '${escapeAttr(name)}', ${isHidden})">${isHidden ? 'Unhide' : 'Hide'}</button>
        </div>
      ` : '';

      const statusBadge = isHidden
        ? `<span class="badge-officer-hidden">Hidden</span>`
        : (isZero ? `<span class="badge-zero-bones">0 Bones</span>` : '');

      const cardClass = isHidden ? 'mobile-roster-card officer-hidden-card' : 'mobile-roster-card';

      return `
        <div class="${cardClass}" onclick="inspectMemberProfile('${w.discordId}')">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <div class="mobile-roster-rank">${rankNum}</div>
            <img src="${avatarUrl}" class="mobile-roster-avatar" alt="${name}">
            <div class="mobile-roster-info">
              <div class="mobile-roster-name" style="display: flex; align-items: center; flex-wrap: wrap;">
                ${name} ${statusBadge}
              </div>
              <div class="mobile-roster-meta">
                ${charName ? `<span class="class-badge ${classCss}" style="padding:0.1rem 0.35rem; font-size:0.7rem;">${charName}</span> <span class="role-pill ${roleCss}">${charRole}</span>` : `<span style="color:var(--text-dim);">No character</span>`}
              </div>
            </div>
            <div class="mobile-roster-score">
              <span class="score-num">${(w.boneScore || 0).toLocaleString()}</span>
              <span class="score-label">Score</span>
            </div>
            <div class="mobile-roster-arrow">›</div>
          </div>
          ${mobileOfficerStrip}
        </div>
      `;
    }).join('');
  }
}

searchLeaderboard.addEventListener('input', renderLeaderboard);

/**
 * Inspect Member Profile & WoW Characters Modal (Click from Leaderboard)
 */
window.inspectMemberProfile = function(discordId) {
  const w = state.bseState?.wallets?.[discordId];
  if (!w) return;

  const name = w.serverNickname || w.globalName || w.username || 'Guild Member';
  const handle = w.username ? `@${w.username}` : '';
  const avatarUrl = w.avatarHash
    ? `https://cdn.discordapp.com/avatars/${w.discordId}/${w.avatarHash}.png?size=72`
    : 'assets/favicon.svg';
  const rankTitle = resolveRankTitle(w.boneScore);
  const chars = w.characters || [];

  let charactersHtml = '';
  if (!chars.length) {
    if (w.primaryCharacter) {
      charactersHtml = `
        <div class="character-card-item">
          <div>
            <span class="class-badge class-warrior">${w.primaryCharacter}</span>
            <span style="font-size:0.75rem; color:var(--text-muted); margin-left:0.5rem;">Classic Character</span>
          </div>
          <span class="char-pill" style="font-size:0.7rem;">PRIMARY</span>
        </div>
      `;
    } else {
      charactersHtml = `<p style="color:var(--text-dim); font-size:0.85rem; text-align:center; padding:1rem;">This member hasn't linked any WoW characters yet.</p>`;
    }
  } else {
    charactersHtml = chars.map(c => {
      const classCss = `class-${(c.class || 'warrior').toLowerCase().replace(/\s+/g, '-')}`;
      const roleCss = (c.role || 'dps').toLowerCase();
      const profs = (c.professions || '').split(',').map(p => p.trim()).filter(Boolean);
      const profTags = profs.map(p => `<span class="char-pill" style="font-size:0.7rem; color:var(--text-muted);">${p}</span>`).join(' ');

      return `
        <div class="character-card-item">
          <div style="display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap;">
            <span class="class-badge ${classCss}">${c.name}</span>
            <span class="role-pill ${roleCss}">${c.role || 'DPS'}</span>
            ${c.isPrimary ? '<span class="char-pill" style="font-size:0.65rem;">PRIMARY</span>' : ''}
          </div>
          ${profTags ? `<div style="margin-top:0.35rem; width:100%; display:flex; gap:0.35rem; flex-wrap:wrap;">${profTags}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  const noteHtml = w.guildNote
    ? `<div class="guild-note-card">"${w.guildNote}"</div>`
    : `<div style="color:var(--text-dim); font-size:0.85rem; font-style:italic; margin:0.5rem 0;">No public guild note provided yet.</div>`;

  const modalBody = document.getElementById('memberProfileModalBody');
  modalBody.innerHTML = `
    <div class="member-profile-header">
      <img src="${avatarUrl}" class="member-profile-avatar" alt="${name}">
      <div>
        <h3 style="color: var(--gold-100); font-size: 1.3rem; margin-bottom: 0.15rem;">${name}</h3>
        <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem;">${handle} &bull; <span class="card-badge economy">${rankTitle}</span></div>
        <div style="display: flex; gap: 1.5rem; flex-wrap: wrap;">
          <div><span style="font-size:0.75rem; color:var(--text-muted); display:block;">SPENDABLE BONES</span> <strong style="color:var(--gold-300); font-size:1.15rem;">${(w.spendableBones || 0).toLocaleString()}</strong></div>
          <div><span style="font-size:0.75rem; color:var(--text-muted); display:block;">CAREER SCORE</span> <strong style="color:var(--amber); font-size:1.15rem;">${(w.boneScore || 0).toLocaleString()}</strong></div>
        </div>
      </div>
    </div>

    <div style="margin-bottom: 1.25rem;">
      <h5 style="color: var(--gold-100); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.3rem;">Public Guild Note</h5>
      ${noteHtml}
    </div>

    <div>
      <h5 style="color: var(--gold-100); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;">Linked Characters (WoW: Forever)</h5>
      ${charactersHtml}
    </div>

    ${state.user?.isOfficer ? `
      <div class="wow-inner-box" style="margin-top: 1.25rem; padding: 0.85rem;">
        <div style="font-size: 0.75rem; color: var(--gold-300); font-weight: 700; text-transform: uppercase; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center;">
          <span>Officer Controls</span>
          ${w.officerHidden ? `<span class="badge-officer-hidden">Hidden from Leaderboard</span>` : ''}
        </div>
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          <button class="btn-officer-award" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" onclick="quickAwardMember('${discordId}', '${escapeAttr(name)}')">+ Award Bones</button>
          <button class="btn-officer-deduct" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" onclick="quickDeductMember('${discordId}', '${escapeAttr(name)}', ${w.spendableBones || 0})">- Deduct Bones</button>
          <button class="btn-officer-adjust" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" onclick="quickAdjustLifetime('${discordId}', '${escapeAttr(name)}', ${w.boneScore || 0})">⚙️ Adjust Lifetime Bones</button>
          <button class="btn-officer-hide" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" onclick="quickToggleHideMember('${discordId}', '${escapeAttr(name)}', ${Boolean(w.officerHidden)})">${w.officerHidden ? '👁️ Unhide Member' : '👁️ Hide from Leaderboard'}</button>
          <button class="btn-officer-purge" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" onclick="quickDeleteMember('${discordId}', '${escapeAttr(name)}', ${w.spendableBones || 0}, ${w.boneScore || 0})">Purge from Roster</button>
        </div>
      </div>
    ` : ''}
  `;

  state.inspectedMemberId = discordId;
  document.getElementById('modalMemberProfile').classList.add('active');
};

function resolveRankTitle(boneScore = 0) {
  const ranks = state.bseState?.ranks || [];
  let title = 'Initiate';
  for (const r of ranks) {
    if (boneScore >= r.costBones) title = r.title;
  }
  return title;
}

/**
 * Render Bounty Board
 */
function renderBounties() {
  if (!state.bseState) return;
  const bounties = (state.bseState.bounties || []).filter(b => b.status === 'active');
  const currName = state.bseState?.branding?.currencyName || 'Bones';

  if (!bounties.length) {
    bountiesGrid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--text-dim); padding: 3rem;">No active bounties posted right now.</div>`;
    return;
  }

  bountiesGrid.innerHTML = bounties.map(b => {
    const badgeClass = (b.category || 'General').toLowerCase();
    return `
      <div class="exchange-card">
        <div>
          <div class="card-top">
            <span class="card-badge ${badgeClass}">${b.category || 'Guild'}</span>
            <div class="card-reward">+${(b.rewardBones || 0).toLocaleString()} ${currName}</div>
          </div>
          <div class="card-title">${b.title}</div>
          <div class="card-desc">${b.description || ''}</div>
        </div>
        <div class="card-footer">
          <span class="stock-indicator">ID: <code>${b.id}</code></span>
          <button class="btn-primary" onclick="openClaimModal('${b.id}')">Claim Bounty</button>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Render Exchange Shop
 */
function renderShop() {
  if (!state.bseState) return;
  const items = (state.bseState.shop || []).filter(i => i.enabled !== false);
  const currName = state.bseState?.branding?.currencyName || 'Bones';

  if (!items.length) {
    shopGrid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--text-dim); padding: 3rem;">The Exchange Shop is currently restocking.</div>`;
    return;
  }

  shopGrid.innerHTML = items.map(item => {
    const stockText = item.unlimitedStock
      ? 'Unlimited'
      : (item.stock > 0 ? `${item.stock} in stock` : '<strong style="color:var(--danger)">Sold Out</strong>');
    const isSoldOut = !item.unlimitedStock && item.stock <= 0;

    return `
      <div class="exchange-card">
        <div>
          <div class="card-top">
            <span class="card-badge perk">${item.category || 'Perk'}</span>
            <div class="card-reward">${(item.costBones || 0).toLocaleString()} ${currName}</div>
          </div>
          <div class="card-title">${item.title}</div>
          <div class="card-desc">${item.description || ''}</div>
        </div>
        <div class="card-footer">
          <span class="stock-indicator">${stockText}</span>
          <button class="btn-primary" ${isSoldOut ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''} onclick="openBuyModal('${item.id}')">
            ${isSoldOut ? 'Sold Out' : 'Purchase'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Render Rules & FAQ Accordion
 */
function renderFaq() {
  const faqItems = state.bseState?.siteModules?.faq?.items || [];
  if (!faqItems.length) {
    faqAccordionContainer.innerHTML = `<p style="color: var(--text-dim); text-align: center; padding: 2rem;">No FAQ items posted yet.</p>`;
    return;
  }

  faqAccordionContainer.innerHTML = faqItems.map((item, idx) => `
    <div class="faq-item ${idx === 0 ? 'active' : ''}">
      <div class="faq-question" onclick="toggleFaqAccordion(this)">
        <span>${item.q}</span>
        <span class="faq-arrow">▼</span>
      </div>
      <div class="faq-answer">
        ${item.a}
      </div>
    </div>
  `).join('');
}

window.toggleFaqAccordion = function(element) {
  const parent = element.parentElement;
  parent.classList.toggle('active');
};

/**
 * Personal Transaction History for Signed-In Member
 */
function setupHistory() {
  // Personal history listeners if needed
}

function renderMemberHistory() {
  if (!memberHistoryTbody) return;
  if (!state.user) {
    memberHistoryTbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 2rem;">Please sign in with Discord to view your transaction history.</td></tr>`;
    if (mobileHistoryList) {
      mobileHistoryList.innerHTML = `<div style="text-align: center; color: var(--text-dim); padding: 2rem;">Please sign in with Discord to view your transaction history.</div>`;
    }
    return;
  }

  const allLogs = state.bseState?.auditLog || [];
  const myLogs = allLogs.filter(e => e.targetId === state.user.id).slice().reverse();

  if (!myLogs.length) {
    memberHistoryTbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 2rem;">No transactions recorded yet. Complete bounties or redeem items in the Exchange Shop to see activity here.</td></tr>`;
    if (mobileHistoryList) {
      mobileHistoryList.innerHTML = `<div style="text-align: center; color: var(--text-dim); padding: 2rem;">No transactions recorded yet. Complete bounties or redeem items in the Exchange Shop to see activity here.</div>`;
    }
    return;
  }

  // 1. Desktop Table
  memberHistoryTbody.innerHTML = myLogs.map(e => {
    const timeStr = new Date(e.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' +
                    new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let badgeClass = 'adjust';
    let badgeText = e.action;
    if (e.action === 'AWARD') { badgeClass = 'award'; badgeText = 'Award'; }
    else if (e.action === 'DEDUCT') { badgeClass = 'deduct'; badgeText = 'Deduct'; }
    else if (e.action === 'BOUNTY_REWARD') { badgeClass = 'bounty'; badgeText = 'Bounty'; }
    else if (e.action === 'SHOP_PURCHASE') { badgeClass = 'purchase'; badgeText = 'Purchase'; }
    else if (e.action === 'SHOP_REFUND') { badgeClass = 'award'; badgeText = 'Refund'; }
    else if (e.action === 'LEDGER_CORRECTION') { badgeClass = 'adjust'; badgeText = 'Correction'; }
    else if (e.action === 'MEMBER_DELETE') { badgeClass = 'purge'; badgeText = 'Purged'; }

    let amountHtml = '—';
    if (e.amount > 0) {
      amountHtml = `<span class="history-amount-positive">+${e.amount}</span>`;
    } else if (e.amount < 0) {
      amountHtml = `<span class="history-amount-negative">${e.amount}</span>`;
    } else if (e.amount === 0) {
      amountHtml = `<span class="history-amount-neutral">0</span>`;
    }

    const balAfter = e.spendableBones !== null && e.spendableBones !== undefined ? `${e.spendableBones} Bones` : '—';

    return `
      <tr>
        <td style="font-size: 0.8rem; color: var(--text-dim); white-space: nowrap;">${timeStr}</td>
        <td><span class="history-tx-badge ${badgeClass}">${badgeText}</span></td>
        <td style="font-size: 0.95rem;">${amountHtml}</td>
        <td style="font-size: 0.85rem; color: var(--gold-300);">${balAfter}</td>
        <td style="font-size: 0.85rem; color: var(--text-main);">${escapeHtml(e.reason || '—')}</td>
        <td style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(e.officerName || 'System')}</td>
      </tr>
    `;
  }).join('');

  // 2. Mobile Card Stream
  if (mobileHistoryList) {
    mobileHistoryList.innerHTML = myLogs.map(e => {
      const timeStr = new Date(e.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
                      new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      let badgeClass = 'adjust';
      let badgeText = e.action;
      if (e.action === 'AWARD') { badgeClass = 'award'; badgeText = 'Award'; }
      else if (e.action === 'DEDUCT') { badgeClass = 'deduct'; badgeText = 'Deduct'; }
      else if (e.action === 'BOUNTY_REWARD') { badgeClass = 'bounty'; badgeText = 'Bounty'; }
      else if (e.action === 'SHOP_PURCHASE') { badgeClass = 'purchase'; badgeText = 'Purchase'; }
      else if (e.action === 'SHOP_REFUND') { badgeClass = 'award'; badgeText = 'Refund'; }
      else if (e.action === 'LEDGER_CORRECTION') { badgeClass = 'adjust'; badgeText = 'Correction'; }
      else if (e.action === 'MEMBER_DELETE') { badgeClass = 'purge'; badgeText = 'Purged'; }

      let amountHtml = '—';
      if (e.amount > 0) {
        amountHtml = `<span class="history-amount-positive">+${e.amount}</span>`;
      } else if (e.amount < 0) {
        amountHtml = `<span class="history-amount-negative">${e.amount}</span>`;
      } else if (e.amount === 0) {
        amountHtml = `<span class="history-amount-neutral">0</span>`;
      }

      const balAfter = e.spendableBones !== null && e.spendableBones !== undefined ? `${e.spendableBones} Bones` : '—';

      return `
        <div class="mobile-history-card">
          <div class="history-card-header">
            <span class="history-tx-badge ${badgeClass}">${badgeText}</span>
            <span style="font-size: 0.75rem; color: var(--text-dim);">${timeStr}</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: baseline; margin: 0.2rem 0;">
            <div style="font-size: 1.1rem;">${amountHtml}</div>
            <div style="font-size: 0.78rem; color: var(--gold-300);">Balance: <strong>${balAfter}</strong></div>
          </div>
          <div style="font-size: 0.82rem; color: var(--text-muted);">${escapeHtml(e.reason || '—')}</div>
          <div style="font-size: 0.72rem; color: var(--text-dim); text-align: right;">By: ${escapeHtml(e.officerName || 'System')}</div>
        </div>
      `;
    }).join('');
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return String(str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// Global officer quick actions from leaderboard
window.quickAwardMember = async function(userId, memberName) {
  const amountStr = prompt(`Award Bones to ${memberName}:\nEnter amount to award (e.g. 25):`);
  if (!amountStr) return;
  const amount = parseInt(amountStr, 10);
  if (isNaN(amount) || amount < 1) {
    showToast('Invalid award amount entered.');
    return;
  }
  const reason = prompt(`Reason for awarding ${amount} Bones to ${memberName}:`, 'Guild event contribution');
  if (reason === null) return;

  try {
    const res = await fetch('/api/exchange/award', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId: userId, amount, reason: reason.trim() })
    });
    if (res.ok) {
      showToast(`Awarded +${amount} Bones to ${memberName}.`);
      await refreshBseState();
    } else {
      const data = await res.json();
      showToast(`Failed to award Bones: ${data.error || 'Server error'}`);
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
};

window.quickDeductMember = async function(userId, memberName, currentBones) {
  const amountStr = prompt(`Deduct Bones from ${memberName} (Current balance: ${currentBones} Bones):\nEnter amount to deduct:`);
  if (!amountStr) return;
  const amount = parseInt(amountStr, 10);
  if (isNaN(amount) || amount < 1) {
    showToast('Invalid deduction amount entered.');
    return;
  }
  const reason = prompt(`Reason for deducting ${amount} Bones from ${memberName}:`, 'Penalty or correction');
  if (reason === null) return;

  try {
    const res = await fetch('/api/exchange/deduct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId: userId, amount, reason: reason.trim() })
    });
    if (res.ok) {
      showToast(`Deducted -${amount} Bones from ${memberName}.`);
      await refreshBseState();
    } else {
      const data = await res.json();
      showToast(`Failed to deduct Bones: ${data.error || 'Server error'}`);
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
};

window.quickDeleteMember = async function(userId, memberName, spendableBones, boneScore) {
  const confirmMsg = `WARNING: Are you sure you want to PERMANENTLY remove "${memberName}" from the guild roster?\n\nMember Current Ledger:\n- Spendable Bones: ${spendableBones}\n- Career Score: ${boneScore} Pts\n\nThis will purge their balance and record from the exchange and standings.`;
  if (!confirm(confirmMsg)) return;

  const finalCheck = prompt(`FINAL CONFIRMATION:\nType DELETE to permanently purge "${memberName}" with ${spendableBones} Bones from the roster:`);
  if (!finalCheck || finalCheck.trim().toUpperCase() !== 'DELETE') {
    showToast('Purge cancelled.');
    return;
  }

  const reason = prompt(`Reason for purging ${memberName} from roster (logged in audit trail):`, 'Left guild / Inactive purge');

  try {
    const res = await fetch('/api/exchange/member/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId: userId, reason: (reason || '').trim() })
    });
    if (res.ok) {
      showToast(`Purged ${memberName} from roster (${spendableBones} Bones logged).`);
      document.getElementById('modalMemberProfile')?.classList.remove('active');
      await refreshBseState();
    } else {
      const data = await res.json();
      showToast(`Failed to delete member: ${data.error || 'Server error'}`);
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
};

window.quickAdjustLifetime = async function(userId, memberName, currentScore = 0) {
  const input = prompt(`Enter new Lifetime Bones (Career Score) for ${memberName}:\n(Current Lifetime Score: ${currentScore})`, currentScore);
  if (input === null) return;
  const newScore = parseInt(input.trim(), 10);
  if (isNaN(newScore) || newScore < 0) {
    showToast('Invalid lifetime score amount.');
    return;
  }

  const reason = prompt(`Reason for adjusting ${memberName}'s lifetime bones:`, 'Officer score calibration');
  if (reason === null) return;

  try {
    const res = await fetch('/api/exchange/member/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetId: userId,
        boneScore: newScore,
        reason: reason.trim() || 'Officer lifetime score calibration'
      })
    });
    if (res.ok) {
      showToast(`Adjusted ${memberName}'s lifetime bones to ${newScore.toLocaleString()}.`);
      await refreshBseState();
      if (state.inspectedMemberId === userId) {
        inspectMemberProfile(userId);
      }
    } else {
      const data = await res.json();
      showToast(`Failed: ${data.error || 'Server error'}`);
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
};

window.quickToggleHideMember = async function(userId, memberName, isCurrentlyHidden) {
  const confirmMsg = isCurrentlyHidden
    ? `Unhide ${memberName}? They will be restored to the public leaderboard (if they have > 0 bones).`
    : `Hide ${memberName} from the leaderboard? They will be removed from the public leaderboard and placed at the bottom for officers.`;
  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch('/api/exchange/member/toggle-hide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId: userId })
    });
    if (res.ok) {
      const data = await res.json();
      showToast(data.officerHidden ? `Hid ${memberName} from public leaderboard.` : `Restored ${memberName} to public leaderboard.`);
      await refreshBseState();
      if (state.inspectedMemberId === userId) {
        inspectMemberProfile(userId);
      }
    } else {
      const data = await res.json();
      showToast(`Failed: ${data.error || 'Server error'}`);
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
};

/**
 * Elaborate Officer Queues & Subtabs
 */
function renderOfficerQueues() {
  if (!state.bseState) return;
  const currName = state.bseState?.branding?.currencyName || 'Bones';

  // 1. Pending Claims
  const claims = Object.values(state.bseState.claims || {}).filter(c => c.status === 'pending');
  subtabClaimCount.textContent = claims.length;
  updateOfficerBadge();

  if (!claims.length) {
    pendingClaimsList.innerHTML = `<p style="color: var(--text-dim); font-size: 0.85rem; padding: 1.5rem; text-align: center;">No pending claims awaiting review. All caught up!</p>`;
  } else {
    pendingClaimsList.innerHTML = claims.map(c => {
      const isImg = c.proofUrl && /\.(png|jpe?g|webp|gif)$/i.test(c.proofUrl.split('?')[0]);
      const charPart = c.characterName
        ? `<span class="char-pill" style="font-size:0.75rem;">Character: <strong>${c.characterName}</strong></span>`
        : `<span style="color:var(--text-dim); font-size:0.75rem;">No character linked</span>`;

      return `
        <div class="officer-review-card">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <strong style="color: var(--gold-100); font-size: 1.05rem;">${c.bountyTitle}</strong>
              <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.2rem;">
                Submitted by: <strong>${c.serverNickname || c.discordUsername}</strong> (@${c.discordUsername || ''}) &bull; ${charPart}
              </div>
            </div>
            <div style="text-align: right;">
              <span style="color: var(--gold-300); font-weight: 800; font-size: 1.1rem;">+${c.rewardBones} ${currName}</span>
              <div style="font-size: 0.7rem; color: var(--text-dim);">Claim ID: <code>${c.id}</code></div>
            </div>
          </div>

          <div style="display: flex; gap: 1rem; align-items: center; margin: 0.75rem 0; background: var(--bg-inner); padding: 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); flex-wrap: wrap;">
            ${isImg ? `<img src="${c.proofUrl}" class="proof-thumbnail" alt="Proof" onclick="zoomImage('${c.proofUrl}')">` : ''}
            <div style="flex: 1; min-width: 200px;">
              ${c.proofUrl ? `<div style="font-size: 0.85rem; margin-bottom: 0.25rem;"><a href="${c.proofUrl}" target="_blank" rel="noopener" style="color: var(--blue); font-weight: 600;">Open Proof Link</a></div>` : '<div style="color: var(--text-dim); font-size: 0.8rem;">No link provided</div>'}
              ${c.notes ? `<div style="font-size: 0.85rem; color: var(--text-main); font-style: italic;">"${c.notes}"</div>` : '<div style="color: var(--text-dim); font-size: 0.8rem;">No notes provided</div>'}
            </div>
          </div>

          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <button class="btn-success" onclick="approveClaim('${c.id}')" style="flex: 1; min-width: 140px;">Approve (+${c.rewardBones} ${currName})</button>
            <button class="btn-secondary" onclick="approveClaimCustom('${c.id}', ${c.rewardBones})" style="min-width: 140px;">Custom Amount</button>
            <button class="btn-danger" onclick="denyClaim('${c.id}')" style="min-width: 100px;">Deny</button>
          </div>
        </div>
      `;
    }).join('');
  }

  // 2. Pending Deliveries
  const deliveries = Object.values(state.bseState.deliveries || {}).filter(d => d.status === 'pending');
  subtabDeliveryCount.textContent = deliveries.length;
  updateOfficerBadge();

  if (!deliveries.length) {
    pendingDeliveriesList.innerHTML = `<p style="color: var(--text-dim); font-size: 0.85rem; padding: 1.5rem; text-align: center;">No shop orders pending delivery. All fulfilled!</p>`;
  } else {
    pendingDeliveriesList.innerHTML = deliveries.map(d => {
      const charPart = d.characterName
        ? `<strong style="color: var(--gold-300);">${d.characterName}</strong>`
        : `<em style="color: var(--danger);">Unspecified character — check with member</em>`;

      return `
        <div class="officer-review-card">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <strong style="color: var(--gold-100); font-size: 1.05rem;">${d.itemTitle}</strong>
              <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.2rem;">
                Buyer: <strong>${d.serverNickname || d.discordUsername}</strong> &bull; Order: <code>${d.id}</code>
              </div>
            </div>
            <div style="text-align: right;">
              <span style="color: var(--amber); font-weight: 700;">${d.costBones} ${currName} Paid</span>
              <div style="font-size: 0.7rem; color: var(--text-dim);">${new Date(d.createdAt).toLocaleDateString()}</div>
            </div>
          </div>

          <div style="background: var(--bg-inner); padding: 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); margin: 0.5rem 0; font-size: 0.85rem;">
            <div><strong>Send Delivery To:</strong> ${charPart}</div>
          </div>

          <div style="display: flex; gap: 0.5rem;">
            <button class="btn-success" onclick="fulfillDelivery('${d.id}')" style="flex: 2;">Mark Delivered</button>
            <button class="btn-danger" onclick="refundDelivery('${d.id}')" style="flex: 1;">Refund ${currName}</button>
          </div>
        </div>
      `;
    }).join('');
  }
}

function updateOfficerBadge() {
  const pendingClaims = Object.values(state.bseState?.claims || {}).filter(c => c.status === 'pending').length;
  const pendingDeliveries = Object.values(state.bseState?.deliveries || {}).filter(d => d.status === 'pending').length;
  const total = pendingClaims + pendingDeliveries;
  if (total > 0) {
    officerActionBadge.textContent = total;
    officerActionBadge.style.display = 'inline-block';
    if (mobileOfficerActionBadge) {
      mobileOfficerActionBadge.textContent = total;
      mobileOfficerActionBadge.style.display = 'inline-block';
    }
  } else {
    officerActionBadge.style.display = 'none';
    if (mobileOfficerActionBadge) {
      mobileOfficerActionBadge.style.display = 'none';
    }
  }
}

/**
 * Populate Officer Settings Forms from State
 */
function populateOfficerSettingsForms() {
  const branding = state.bseState?.branding || {};
  const modules = state.bseState?.siteModules || {};
  const ranks = state.bseState?.ranks || [];

  // Data Editor: Announcement inputs
  if (dataEditorAnnounceEnabled) {
    dataEditorAnnounceEnabled.checked = branding.announcement?.enabled !== false;
  }
  if (dataEditorAnnounceText) {
    dataEditorAnnounceText.value = branding.announcement?.text || '';
  }
  if (dataEditorAnnounceType) {
    dataEditorAnnounceType.value = branding.announcement?.type || 'gold';
  }

  // Modules toggles
  const modLead = document.getElementById('modToggleLeaderboard');
  if (modLead) modLead.checked = modules.leaderboard?.enabled !== false;
  const modBounties = document.getElementById('modToggleBounties');
  if (modBounties) modBounties.checked = modules.bounties?.enabled !== false;
  const modShop = document.getElementById('modToggleShop');
  if (modShop) modShop.checked = modules.shop?.enabled !== false;
  const modFaq = document.getElementById('modToggleFaq');
  if (modFaq) modFaq.checked = modules.faq?.enabled !== false;

  // Render Ranks Builder
  state.draftRanks = [...ranks];
  renderRanksBuilder();

  // Render FAQ Builder
  state.draftFaq = [...(modules.faq?.items || [])];
  renderFaqBuilder();

}

/**
 * Render Prestige Ranks Builder
 */
function renderRanksBuilder() {
  ranksBuilderContainer.innerHTML = state.draftRanks.map((r, idx) => `
    <div class="officer-review-card" style="display: grid; grid-template-columns: 60px 1fr 100px 140px auto; gap: 0.5rem; align-items: center;">
      <input type="text" class="form-control" value="${r.icon || ''}" placeholder="Icon" onchange="updateDraftRank(${idx}, 'icon', this.value)" style="text-align: center; font-size: 0.85rem;">
      <input type="text" class="form-control" value="${r.title}" placeholder="Rank Title" onchange="updateDraftRank(${idx}, 'title', this.value)">
      <input type="number" class="form-control" value="${r.costBones}" placeholder="Cost" min="0" onchange="updateDraftRank(${idx}, 'costBones', this.value)">
      <input type="text" class="form-control" value="${r.roleId || ''}" placeholder="Discord Role ID" onchange="updateDraftRank(${idx}, 'roleId', this.value)">
      <button class="btn-danger" onclick="removeDraftRank(${idx})" style="padding: 0.35rem 0.6rem;">✕</button>
    </div>
  `).join('');
}

window.updateDraftRank = function(idx, field, val) {
  if (field === 'costBones') val = parseInt(val, 10) || 0;
  state.draftRanks[idx][field] = val;
};

window.removeDraftRank = function(idx) {
  state.draftRanks.splice(idx, 1);
  renderRanksBuilder();
};

document.getElementById('btnAddRankTier').addEventListener('click', () => {
  const newTier = state.draftRanks.length;
  state.draftRanks.push({
    tier: newTier,
    title: `Rank ${newTier + 1}`,
    costBones: (newTier + 1) * 50,
    icon: '',
    roleId: ''
  });
  renderRanksBuilder();
});

/**
 * Render FAQ Builder
 */
function renderFaqBuilder() {
  faqBuilderContainer.innerHTML = state.draftFaq.map((item, idx) => `
    <div class="officer-review-card">
      <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
        <strong style="color: var(--gold-100);">Item #${idx + 1}</strong>
        <button class="btn-danger" onclick="removeDraftFaq(${idx})" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;">✕ Remove</button>
      </div>
      <div class="form-group">
        <label>Question</label>
        <input type="text" class="form-control" value="${item.q}" onchange="updateDraftFaq(${idx}, 'q', this.value)">
      </div>
      <div class="form-group">
        <label>Answer / Description</label>
        <textarea class="form-control" rows="2" onchange="updateDraftFaq(${idx}, 'a', this.value)">${item.a}</textarea>
      </div>
    </div>
  `).join('');
}

window.updateDraftFaq = function(idx, field, val) {
  state.draftFaq[idx][field] = val;
};

window.removeDraftFaq = function(idx) {
  state.draftFaq.splice(idx, 1);
  renderFaqBuilder();
};

document.getElementById('btnAddFaqItem').addEventListener('click', () => {
  state.draftFaq.push({ q: 'New Question', a: 'Answer description...' });
  renderFaqBuilder();
});

/**
 * Setup Master Data & JSON Power Editor
 */
function setupDataEditor() {
  // 1. Save Announcement & Modules
  const btnSaveAnnounce = document.getElementById('btnSaveAnnouncementAndModules');
  if (btnSaveAnnounce) {
    btnSaveAnnounce.addEventListener('click', async () => {
      const announcement = {
        enabled: dataEditorAnnounceEnabled ? dataEditorAnnounceEnabled.checked : true,
        text: dataEditorAnnounceText ? dataEditorAnnounceText.value.trim() : '',
        type: dataEditorAnnounceType ? dataEditorAnnounceType.value : 'gold'
      };

      const siteModules = {
        leaderboard: {
          enabled: document.getElementById('modToggleLeaderboard')?.checked !== false,
          title: 'Leaderboard',
          order: 1
        },
        bounties: {
          enabled: document.getElementById('modToggleBounties')?.checked !== false,
          title: 'Bounty Board',
          order: 2
        },
        shop: {
          enabled: document.getElementById('modToggleShop')?.checked !== false,
          title: 'Exchange Shop',
          order: 3
        },
        faq: {
          enabled: document.getElementById('modToggleFaq')?.checked !== false,
          title: 'Rules & FAQ',
          order: 4,
          items: state.draftFaq || []
        }
      };

      try {
        const res = await fetch('/api/exchange/settings/officer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            branding: { announcement },
            siteModules
          })
        });
        const data = await res.json();
        if (res.ok) {
          showToast('Announcement and modules updated.');
          await refreshBseState();
        } else {
          showToast(`Failed: ${data.error || 'Server error'}`);
        }
      } catch (err) {
        showToast(`Error: ${err.message}`);
      }
    });
  }

  // 2. Save Prestige Ranks
  const btnSaveRanks = document.getElementById('btnSaveRanksHierarchy');
  if (btnSaveRanks) {
    btnSaveRanks.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/exchange/settings/officer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ranks: state.draftRanks
          })
        });
        const data = await res.json();
        if (res.ok) {
          showToast('Prestige ranks updated.');
          await refreshBseState();
        } else {
          showToast(`Failed: ${data.error || 'Server error'}`);
        }
      } catch (err) {
        showToast(`Error: ${err.message}`);
      }
    });
  }

  // 3. Save FAQ Content
  const btnSaveFaq = document.getElementById('btnSaveFaqItems');
  if (btnSaveFaq) {
    btnSaveFaq.addEventListener('click', async () => {
      try {
        const currentModules = state.bseState?.siteModules || {};
        const updatedModules = {
          ...currentModules,
          faq: {
            ...(currentModules.faq || { enabled: true, title: 'Rules & FAQ', order: 4 }),
            items: state.draftFaq
          }
        };

        const res = await fetch('/api/exchange/settings/officer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            siteModules: updatedModules
          })
        });
        const data = await res.json();
        if (res.ok) {
          showToast('Rules & FAQ content updated.');
          await refreshBseState();
        } else {
          showToast(`Failed: ${data.error || 'Server error'}`);
        }
      } catch (err) {
        showToast(`Error: ${err.message}`);
      }
    });
  }

}

/**
 * Render Officer Bounties Control
 */
function renderOfficerBountiesList() {
  const bounties = state.bseState?.bounties || [];
  officerBountiesList.innerHTML = bounties.map(b => `
    <div class="officer-review-card" style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">
      <div>
        <strong style="color: var(--gold-100);">${b.title}</strong>
        <div style="font-size: 0.75rem; color: var(--text-muted);">
          ID: <code>${b.id}</code> &bull; Category: ${b.category || 'General'} &bull; Status: <strong style="color:${b.status === 'active' ? 'var(--success)' : 'var(--danger)'};">${b.status || 'active'}</strong>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 0.75rem;">
        <span style="color: var(--gold-300); font-weight: 700;">+${b.rewardBones}</span>
        <button class="btn-secondary" onclick="toggleBountyStatus('${b.id}', '${b.status === 'active' ? 'paused' : 'active'}')">
          ${b.status === 'active' ? 'Pause' : 'Activate'}
        </button>
        <button class="btn-danger" onclick="deleteBounty('${b.id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

/**
 * Render Officer Shop Items Control
 */
function renderOfficerShopList() {
  const items = state.bseState?.shop || [];
  officerShopList.innerHTML = items.map(i => `
    <div class="officer-review-card" style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">
      <div>
        <strong style="color: var(--gold-100);">${i.title}</strong>
        <div style="font-size: 0.75rem; color: var(--text-muted);">
          ID: <code>${i.id}</code> &bull; ${i.unlimitedStock ? '∞ Unlimited' : `${i.stock} Stock`} &bull; Category: ${i.category || 'General'}
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 0.75rem;">
        <span style="color: var(--gold-300); font-weight: 700;">${i.costBones} Bones</span>
        <button class="btn-secondary" onclick="adjustShopStock('${i.id}', 10)">+10 Stock</button>
        <button class="btn-danger" onclick="deleteShopItem('${i.id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

/**
 * Render Live Audit Trail
 */
function renderAuditTrail() {
  if (!auditTrailTbody) return;
  const auditEntries = (state.bseState?.auditLog || []).slice(-100).reverse();
  if (!auditEntries.length) {
    auditTrailTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 1.5rem;">Audit events will appear as actions occur.</td></tr>`;
    return;
  }

  auditTrailTbody.innerHTML = auditEntries.map(e => {
    const timeStr = new Date(e.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
                    new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let badgeClass = 'adjust';
    let badgeText = e.action;
    if (e.action === 'AWARD') { badgeClass = 'award'; badgeText = 'Award'; }
    else if (e.action === 'DEDUCT') { badgeClass = 'deduct'; badgeText = 'Deduct'; }
    else if (e.action === 'BOUNTY_REWARD') { badgeClass = 'bounty'; badgeText = 'Bounty'; }
    else if (e.action === 'SHOP_PURCHASE') { badgeClass = 'purchase'; badgeText = 'Purchase'; }
    else if (e.action === 'SHOP_REFUND') { badgeClass = 'award'; badgeText = 'Refund'; }
    else if (e.action === 'LEDGER_CORRECTION') { badgeClass = 'adjust'; badgeText = 'Correction'; }
    else if (e.action === 'MEMBER_DELETE') { badgeClass = 'purge'; badgeText = 'Purge'; }

    let amountHtml = '—';
    if (e.amount > 0) {
      amountHtml = `<span class="history-amount-positive">+${e.amount}</span>`;
    } else if (e.amount < 0) {
      amountHtml = `<span class="history-amount-negative">${e.amount}</span>`;
    } else if (e.amount === 0) {
      amountHtml = `<span class="history-amount-neutral">0</span>`;
    }

    const balAfter = e.spendableBones !== null && e.spendableBones !== undefined ? `${e.spendableBones} Bones` : '—';

    return `
      <tr>
        <td style="font-size: 0.75rem; color: var(--text-dim); white-space: nowrap;">${timeStr}</td>
        <td><span class="history-tx-badge ${badgeClass}">${badgeText}</span></td>
        <td style="font-weight: 600; font-size: 0.85rem;">${escapeHtml(e.officerName || 'System')}</td>
        <td style="font-size: 0.85rem; color: var(--gold-100);">${escapeHtml(e.targetName || '—')}</td>
        <td style="font-size: 0.9rem;">${amountHtml}</td>
        <td style="font-size: 0.85rem; color: var(--gold-300);">${balAfter}</td>
        <td style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(e.reason || '—')}</td>
      </tr>
    `;
  }).join('');
}

/**
 * Character Management Modal Logic
 */
function setupCharacterManagement() {
  btnOpenCharModal.addEventListener('click', () => {
    openCharacterModal();
  });

  document.getElementById('btnAddCharacter').addEventListener('click', () => {
    const name = document.getElementById('newCharName').value.trim();
    const charClass = document.getElementById('newCharClass').value;
    const charRole = document.getElementById('newCharRole')?.value || 'DPS';
    const professions = document.getElementById('newCharProfessions')?.value.trim() || '';

    if (!name) {
      showToast('Please enter a character name.');
      return;
    }

    const isFirst = state.userCharacters.length === 0;
    state.userCharacters.push({
      name,
      class: charClass,
      role: charRole,
      professions,
      isPrimary: isFirst
    });

    document.getElementById('newCharName').value = '';
    if (document.getElementById('newCharProfessions')) document.getElementById('newCharProfessions').value = '';
    renderCharacterModalList();
    showToast(`Added ${name} (${charClass} ${charRole}). Click "Save Changes" to store.`);
  });

  document.getElementById('btnSaveCharacters').addEventListener('click', async () => {
    const primary = state.userCharacters.find(c => c.isPrimary)?.name || state.userCharacters[0]?.name || null;
    const guildNote = (document.getElementById('modalGuildNoteInput')?.value || document.getElementById('memberGuildNoteInput')?.value || '').trim();

    try {
      const res = await fetch('/api/exchange/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characters: state.userCharacters,
          primaryCharacter: primary,
          guildNote
        })
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Characters & Public Guild Note saved.');
        state.user.characters = data.characters;
        state.user.primaryCharacter = data.primaryCharacter;
        state.user.guildNote = data.guildNote || '';
        walletPrimaryCharName.textContent = data.primaryCharacter || 'None (Click to link)';
        if (document.getElementById('modalGuildNoteInput')) document.getElementById('modalGuildNoteInput').value = data.guildNote || '';
        document.getElementById('modalCharacters').classList.remove('active');
        await refreshBseState();
      } else {
        showToast(data.error || 'Failed to save characters');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  });
}

function openCharacterModal() {
  state.userCharacters = [...(state.user?.characters || [])];
  if (document.getElementById('modalGuildNoteInput')) {
    document.getElementById('modalGuildNoteInput').value = state.user?.guildNote || '';
  }
  renderCharacterModalList();
  document.getElementById('modalCharacters').classList.add('active');
}

function renderCharacterModalList() {
  const container = document.getElementById('characterListContainer');
  if (!state.userCharacters.length) {
    container.innerHTML = `<p style="color: var(--text-dim); font-size: 0.85rem; text-align: center; padding: 1rem;">No characters added yet. Add your main Classic character below!</p>`;
    return;
  }

  container.innerHTML = state.userCharacters.map((c, idx) => {
    const classCss = `class-${(c.class || 'warrior').toLowerCase().replace(/\s+/g, '-')}`;
    const roleCss = (c.role || 'dps').toLowerCase();
    const profs = c.professions ? `<span style="font-size:0.7rem; color:var(--text-muted); margin-left:0.35rem;">(${c.professions})</span>` : '';

    return `
      <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-inner); padding: 0.6rem 0.85rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); margin-bottom: 0.4rem; gap: 0.5rem; flex-wrap: wrap;">
        <div style="display: flex; align-items: center; gap: 0.6rem;">
          <input type="radio" name="primaryCharRadio" ${c.isPrimary ? 'checked' : ''} onchange="setPrimaryCharacter(${idx})" title="Set as primary character">
          <div>
            <span class="class-badge ${classCss}">${c.name}</span>
            <span class="role-pill ${roleCss}" style="margin-left: 0.3rem;">${c.role || 'DPS'}</span>
            ${profs}
            ${c.isPrimary ? '<span class="char-pill" style="font-size: 0.65rem; margin-left: 0.4rem;">PRIMARY</span>' : ''}
          </div>
        </div>
        <button class="btn-danger" style="padding: 0.2rem 0.5rem; font-size: 0.7rem;" onclick="removeCharacter(${idx})">✕</button>
      </div>
    `;
  }).join('');
}

window.setPrimaryCharacter = function(index) {
  state.userCharacters.forEach((c, idx) => {
    c.isPrimary = idx === index;
  });
  renderCharacterModalList();
};

window.removeCharacter = function(index) {
  state.userCharacters.splice(index, 1);
  if (state.userCharacters.length > 0 && !state.userCharacters.some(c => c.isPrimary)) {
    state.userCharacters[0].isPrimary = true;
  }
  renderCharacterModalList();
};

/**
 * Modals & Actions
 */
function setupModals() {
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close-modal');
      document.getElementById(modalId)?.classList.remove('active');
    });
  });

  document.getElementById('btnSubmitGeneralClaim').addEventListener('click', () => {
    openClaimModal();
  });

  // Submit Claim Execute
  document.getElementById('btnSubmitClaimExecute').addEventListener('click', async () => {
    const bountyId = document.getElementById('claimBountySelect').value;
    const characterName = document.getElementById('claimCharacterSelect').value;
    const proofUrl = document.getElementById('claimProofUrl').value.trim();
    const notes = document.getElementById('claimNotes').value.trim();

    if (!proofUrl) {
      showToast('Please provide a proof URL (image or logs)');
      return;
    }

    try {
      const res = await fetch('/api/exchange/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bountyId,
          characterName,
          proofUrl,
          notes,
          discordId: state.user?.id,
          discordUsername: state.user?.username
        })
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Claim submitted. Dispatched to Discord Officers for review.');
        document.getElementById('modalClaim').classList.remove('active');
        await refreshBseState();
      } else {
        showToast(`Error: ${data.error || 'Failed to submit'}`);
      }
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  });

  // Buy Execute
  document.getElementById('btnConfirmBuyExecute').addEventListener('click', async () => {
    if (!state.selectedItemForBuy) return;
    const characterName = document.getElementById('buyRecipientCharSelect').value;

    try {
      const res = await fetch('/api/exchange/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: state.selectedItemForBuy.id,
          discordId: state.user?.id,
          characterName
        })
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Purchased ${state.selectedItemForBuy.title}. Delivery ticket dispatched to Officers.`);
        document.getElementById('modalBuy').classList.remove('active');
        await refreshBseState();
      } else {
        showToast(data.error || 'Purchase failed');
      }
    } catch (err) {
      showToast(err.message);
    }
  });
}

window.openClaimModal = function(bountyId) {
  const select = document.getElementById('claimBountySelect');
  const bounties = (state.bseState?.bounties || []).filter(b => b.status === 'active');
  const currName = state.bseState?.branding?.currencyName || 'Bones';

  select.innerHTML = bounties.map(b => `
    <option value="${b.id}" ${b.id === bountyId ? 'selected' : ''}>
      ${b.title} (+${b.rewardBones} ${currName})
    </option>
  `).join('');

  // Completing Character Select
  const charSelect = document.getElementById('claimCharacterSelect');
  const chars = state.user?.characters || [];
  const defaultChar = state.user?.preferences?.defaultCharacter || state.user?.primaryCharacter;

  if (chars.length) {
    charSelect.innerHTML = chars.map(c => `
      <option value="${c.name}" ${c.name === defaultChar ? 'selected' : ''}>
        ${c.name} (${c.class || 'Character'})
      </option>
    `).join('');
  } else {
    charSelect.innerHTML = `<option value="">Unlinked (Add characters in your wallet)</option>`;
  }

  document.getElementById('claimProofUrl').value = '';
  document.getElementById('claimNotes').value = '';
  document.getElementById('modalClaim').classList.add('active');
};

window.openBuyModal = function(itemId) {
  const item = (state.bseState?.shop || []).find(i => i.id === itemId);
  if (!item) return;
  state.selectedItemForBuy = item;

  const currentBones = state.user?.spendableBones || 0;
  const canAfford = currentBones >= item.costBones;
  const currName = state.bseState?.branding?.currencyName || 'Bones';

  document.getElementById('buyModalBody').innerHTML = `
    <div style="font-size: 1.1rem; font-weight: 700; color: var(--gold-100); margin-bottom: 0.5rem;">${item.title}</div>
    <div style="color: var(--text-muted); margin-bottom: 1rem;">${item.description || ''}</div>
    <div style="background: var(--bg-inner); padding: 0.85rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); display: flex; justify-content: space-between;">
      <span>Item Cost:</span>
      <strong style="color: var(--gold-300);">${item.costBones} ${currName}</strong>
    </div>
    <div style="margin-top: 0.5rem; display: flex; justify-content: space-between; font-size: 0.85rem;">
      <span>Your Spendable ${currName}:</span>
      <strong>${currentBones} ${currName}</strong>
    </div>
    ${!canAfford ? `<div style="color: var(--danger); font-size: 0.85rem; margin-top: 0.5rem;">You need ${item.costBones - currentBones} more ${currName} for this item.</div>` : ''}
  `;

  // Populate recipient character dropdown
  const charSelect = document.getElementById('buyRecipientCharSelect');
  const chars = state.user?.characters || [];
  const defaultChar = state.user?.preferences?.defaultCharacter || state.user?.primaryCharacter;

  if (chars.length) {
    charSelect.innerHTML = chars.map(c => `
      <option value="${c.name}" ${c.name === defaultChar ? 'selected' : ''}>
        ${c.name} (${c.class || 'Character'})
      </option>
    `).join('');
  } else {
    charSelect.innerHTML = `<option value="">Primary Discord Handle (@${state.user?.username || 'Member'})</option>`;
  }

  document.getElementById('btnConfirmBuyExecute').disabled = !canAfford;
  document.getElementById('modalBuy').classList.add('active');
};

function openRankPromoteModal(nextRank) {
  const currentBones = state.user?.spendableBones || 0;
  const canAfford = currentBones >= nextRank.costBones;
  const currName = state.bseState?.branding?.currencyName || 'Bones';

  document.getElementById('rankPromoteModalBody').innerHTML = `
    <p>Promote your Discord standing to <strong>${nextRank.title}</strong>!</p>
    <div style="background: var(--bg-inner); padding: 0.85rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); margin: 1rem 0;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 0.3rem;">
        <span>Promotion Cost:</span>
        <strong style="color: var(--gold-300);">${nextRank.costBones} ${currName}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
        <span>Your Spendable ${currName}:</span>
        <strong>${currentBones} ${currName}</strong>
      </div>
    </div>
    <p style="font-size: 0.8rem; color: var(--text-muted);">
      Upon purchase, your Discord server role will be updated automatically.
    </p>
  `;

  document.getElementById('btnConfirmRankPromoteExecute').disabled = !canAfford;
  document.getElementById('btnConfirmRankPromoteExecute').onclick = async () => {
    const res = await fetch('/api/exchange/award', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetId: state.user.id,
        amount: -nextRank.costBones,
        reason: `Rank Promotion to ${nextRank.title}`
      })
    });
    if (res.ok) {
      showToast(`Promoted to ${nextRank.title}!`);
      document.getElementById('modalRankPromote').classList.remove('active');
      await refreshBseState();
    }
  };

  document.getElementById('modalRankPromote').classList.add('active');
}

window.zoomImage = function(url) {
  document.getElementById('zoomImageTarget').src = url;
  document.getElementById('modalImageZoom').classList.add('active');
};

/**
 * Officer Panel Actions (Strictly verified)
 */
function setupOfficerTools() {
  // Member Autocomplete Search
  const awardTargetInput = document.getElementById('awardTargetInput');
  const awardTargetId = document.getElementById('awardTargetId');
  const searchResultsDiv = document.getElementById('memberSearchResults');

  awardTargetInput.addEventListener('input', async () => {
    const q = awardTargetInput.value.trim();
    if (q.length < 2) {
      searchResultsDiv.innerHTML = '';
      return;
    }
    const res = await fetch(`/api/exchange/members/search?q=${encodeURIComponent(q)}`);
    const members = await res.json();
    if (!members.length) {
      searchResultsDiv.innerHTML = `<div style="font-size: 0.75rem; color: var(--text-dim); padding: 0.2rem;">No members found.</div>`;
      return;
    }
    searchResultsDiv.innerHTML = members.map(m => `
      <div class="autocomplete-item" onclick="selectAwardTarget('${m.discordId}', '${m.serverNickname || m.username}')">
        <div>
          <strong>${m.serverNickname || m.username}</strong> (@${m.username})
        </div>
        <span style="font-size:0.7rem; color:var(--text-dim);">${m.discordId}</span>
      </div>
    `).join('');
  });

  window.selectAwardTarget = function(id, name) {
    awardTargetInput.value = name;
    awardTargetId.value = id;
    searchResultsDiv.innerHTML = '';
    loadMemberIntoInspector(id);
  };

  // Award Currency
  document.getElementById('btnExecuteAward').addEventListener('click', async () => {
    const targetId = awardTargetId.value || awardTargetInput.value.trim();
    const amount = parseInt(document.getElementById('awardAmountInput').value, 10);
    const reason = document.getElementById('awardReasonInput').value.trim();

    if (!targetId || !amount) {
      showToast('Please specify target member and amount.');
      return;
    }

    const res = await fetch('/api/exchange/award', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId, amount, reason })
    });
    if (res.ok) {
      showToast(`Awarded +${amount}.`);
      document.getElementById('awardAmountInput').value = '';
      document.getElementById('awardReasonInput').value = '';
      await refreshBseState();
      loadMemberIntoInspector(targetId);
    } else {
      showToast('Award failed.');
    }
  });

  // Deduct Currency
  document.getElementById('btnExecuteDeduct').addEventListener('click', async () => {
    const targetId = awardTargetId.value || awardTargetInput.value.trim();
    const amount = parseInt(document.getElementById('awardAmountInput').value, 10);
    const reason = document.getElementById('awardReasonInput').value.trim();

    if (!targetId || !amount) {
      showToast('Please specify target member and amount.');
      return;
    }

    const res = await fetch('/api/exchange/deduct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId, amount, reason })
    });
    if (res.ok) {
      showToast(`Deducted -${amount}.`);
      await refreshBseState();
      loadMemberIntoInspector(targetId);
    } else {
      showToast('Deduct failed.');
    }
  });

  // Save Member Ledger Correction
  document.getElementById('btnSaveMemberAdjust').addEventListener('click', async () => {
    if (!state.inspectedMemberId) return;
    const spendable = parseInt(document.getElementById('inspectorSpendable').value, 10);
    const score = parseInt(document.getElementById('inspectorScore').value, 10);
    const reason = document.getElementById('inspectorReason').value.trim();
    const officerHidden = inspectorOfficerHidden ? inspectorOfficerHidden.checked : false;

    const res = await fetch('/api/exchange/member/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetId: state.inspectedMemberId,
        spendableBones: spendable,
        boneScore: score,
        officerHidden,
        reason
      })
    });
    if (res.ok) {
      showToast('Member ledger corrected successfully.');
      await refreshBseState();
      loadMemberIntoInspector(state.inspectedMemberId);
    } else {
      showToast('Failed to update ledger.');
    }
  });

  // Create Bounty
  document.getElementById('btnCreateBounty').addEventListener('click', async () => {
    const title = document.getElementById('newBountyTitle').value.trim();
    const rewardBones = document.getElementById('newBountyReward').value;
    const category = document.getElementById('newBountyCategory').value;
    const description = document.getElementById('newBountyDesc').value.trim();

    if (!title || !rewardBones) {
      showToast('Please enter bounty title and reward.');
      return;
    }

    const res = await fetch('/api/exchange/bounty/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, rewardBones, category, description })
    });
    if (res.ok) {
      showToast('Bounty created.');
      document.getElementById('newBountyTitle').value = '';
      document.getElementById('newBountyReward').value = '';
      document.getElementById('newBountyDesc').value = '';
      await refreshBseState();
    }
  });

  // Create Shop Item
  document.getElementById('btnCreateShopItem').addEventListener('click', async () => {
    const title = document.getElementById('newItemTitle').value.trim();
    const costBones = document.getElementById('newItemCost').value;
    const category = document.getElementById('newItemCategory').value;
    const stock = document.getElementById('newItemStock').value;
    const unlimitedStock = document.getElementById('newItemUnlimited').checked;
    const fulfillmentNotes = document.getElementById('newItemFulfillment').value.trim();

    if (!title || !costBones) {
      showToast('Please enter item title and cost.');
      return;
    }

    const res = await fetch('/api/exchange/shop/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, costBones, category, stock, unlimitedStock, fulfillmentNotes })
    });
    if (res.ok) {
      showToast('Shop item added.');
      document.getElementById('newItemTitle').value = '';
      document.getElementById('newItemCost').value = '';
      await refreshBseState();
    }
  });

  // Push Standings to Discord
  if (btnSyncDiscordStandings) {
    btnSyncDiscordStandings.addEventListener('click', async () => {
      const orig = btnSyncDiscordStandings.textContent;
      btnSyncDiscordStandings.textContent = 'Pushing...';
      btnSyncDiscordStandings.disabled = true;
      try {
        const res = await fetch('/api/exchange/push-discord-standings', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
          showToast('Standings embeds successfully updated in Discord.');
        } else {
          showToast(`Push failed: ${data.error || 'Server error'}`);
        }
      } catch (err) {
        showToast('Network error pushing standings to Discord.');
      } finally {
        btnSyncDiscordStandings.textContent = orig;
        btnSyncDiscordStandings.disabled = false;
      }
    });
  }

  // Sync Guild Roster from Discord
  if (btnSyncDiscordRoster) {
    btnSyncDiscordRoster.addEventListener('click', async () => {
      if (!confirm('Synchronize the guild roster from the Discord server?\nThis will import any newly joined members and refresh nicknames/avatars.')) return;
      const orig = btnSyncDiscordRoster.textContent;
      btnSyncDiscordRoster.textContent = 'Syncing...';
      btnSyncDiscordRoster.disabled = true;
      try {
        const res = await fetch('/api/exchange/sync-discord-roster', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast(`Synced ${data.totalMembers} Discord members (${data.importedCount} new, ${data.updatedCount} refreshed).`);
          await refreshBseState();
        } else {
          showToast(`Sync failed: ${data.error || 'Server error'}`);
        }
      } catch (err) {
        showToast('Network error syncing Discord roster.');
      } finally {
        btnSyncDiscordRoster.textContent = orig;
        btnSyncDiscordRoster.disabled = false;
      }
    });
  }

  // Export Guild Ledger to CSV
  if (btnExportLedgerCsv) {
    btnExportLedgerCsv.addEventListener('click', () => {
      if (!state.bseState?.wallets) {
        showToast('No roster data to export.');
        return;
      }
      const wallets = Object.values(state.bseState.wallets);
      wallets.sort((a, b) => (b.boneScore || 0) - (a.boneScore || 0));

      const rows = [
        ['Rank', 'Discord ID', 'Username', 'Server Nickname', 'Primary Character', 'Class', 'Role', 'Spendable Bones', 'Lifetime Bones', 'Status', 'Guild Note']
      ];

      wallets.forEach((w, idx) => {
        const chars = w.characters || [];
        const prim = chars.find(c => c.isPrimary) || (w.primaryCharacter ? chars.find(c => c.name === w.primaryCharacter) : chars[0]);
        const charName = prim ? prim.name : (w.primaryCharacter || '');
        const charClass = prim ? prim.class : '';
        const charRole = prim ? prim.role : '';
        const status = w.officerHidden ? 'Officer Hidden' : ((w.boneScore || 0) === 0 && (w.spendableBones || 0) === 0 ? '0 Bones' : 'Active');

        rows.push([
          idx + 1,
          `"${w.discordId}"`,
          `"${(w.username || '').replace(/"/g, '""')}"`,
          `"${(w.serverNickname || w.globalName || '').replace(/"/g, '""')}"`,
          `"${charName.replace(/"/g, '""')}"`,
          `"${charClass.replace(/"/g, '""')}"`,
          `"${charRole.replace(/"/g, '""')}"`,
          w.spendableBones || 0,
          w.boneScore || 0,
          `"${status}"`,
          `"${(w.guildNote || '').replace(/"/g, '""')}"`
        ]);
      });

      const csvContent = rows.map(r => r.join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `Black_Sands_Exchange_Ledger_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast(`Exported ${wallets.length} members to CSV.`);
    });
  }
}

function loadMemberIntoInspector(userId) {
  state.inspectedMemberId = userId;
  const wallet = state.bseState?.wallets?.[userId];
  const card = document.getElementById('memberInspectorCard');
  const form = document.getElementById('memberInspectorForm');
  const currName = state.bseState?.branding?.currencyName || 'Bones';

  if (!wallet) {
    card.innerHTML = `<p style="color:var(--text-muted);">Member ID <code>${userId}</code> has no ledger records yet. (Awarding currency will create profile).</p>`;
    form.style.display = 'none';
    return;
  }

  const name = wallet.serverNickname || wallet.globalName || wallet.username || 'Member';
  const charPart = wallet.primaryCharacter ? `Primary: <strong>${wallet.primaryCharacter}</strong>` : 'No primary character';

  card.innerHTML = `
    <div style="background: var(--bg-primary); padding: 0.85rem; border-radius: var(--radius-sm); border: 1px solid var(--border-gold);">
      <div style="font-size: 1.1rem; font-weight: 700; color: var(--gold-100);">${name} (@${wallet.username || ''})</div>
      <div style="font-size: 0.8rem; color: var(--text-muted); margin: 0.2rem 0;">${charPart}</div>
      <div style="display: flex; gap: 1rem; margin-top: 0.5rem;">
        <div>Spendable: <strong style="color:var(--gold-300);">${wallet.spendableBones || 0} ${currName}</strong></div>
        <div>Score: <strong style="color:var(--amber);">${wallet.boneScore || 0} Pts</strong></div>
      </div>
    </div>
  `;

  document.getElementById('inspectorSpendable').value = wallet.spendableBones || 0;
  document.getElementById('inspectorScore').value = wallet.boneScore || 0;
  if (inspectorOfficerHidden) {
    inspectorOfficerHidden.checked = Boolean(wallet.officerHidden);
  }
  form.style.display = 'block';
}

/**
 * Setup Officer Leaderboard Filter Pills
 */
function setupOfficerLeaderboardFilters() {
  const filterButtons = [
    { btn: btnFilterActive, filter: 'active' },
    { btn: btnFilterZero, filter: 'zero' },
    { btn: btnFilterHidden, filter: 'hidden' },
    { btn: btnFilterAll, filter: 'all' }
  ];

  filterButtons.forEach(({ btn, filter }) => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      state.officerLeaderboardFilter = filter;
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      renderLeaderboard();
    });
  });
}

/**
 * Setup Raid & Event Multi-Award Tool
 */
function setupRaidMultiAward() {
  if (!btnOpenRaidAwardModal) return;

  const selectedIds = new Set();

  function updateRaidSummary() {
    const amount = Math.max(1, parseInt(batchAwardAmount.value, 10) || 0);
    const count = selectedIds.size;
    const total = count * amount;
    if (raidAwardSummary) {
      raidAwardSummary.textContent = `${count} member${count === 1 ? '' : 's'} selected (${total.toLocaleString()} Total Bones)`;
    }
  }

  function renderRaidChecklist(filterText = '') {
    if (!raidAwardMemberList || !state.bseState) return;
    const wallets = Object.values(state.bseState.wallets || {});
    wallets.sort((a, b) => {
      const nameA = (a.serverNickname || a.globalName || a.username || '').toLowerCase();
      const nameB = (b.serverNickname || b.globalName || b.username || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });

    const search = filterText.toLowerCase().trim();
    const filtered = wallets.filter(w => {
      if (!search) return true;
      const name = (w.serverNickname || w.globalName || w.username || '').toLowerCase();
      const handle = (w.username || '').toLowerCase();
      const char = (w.primaryCharacter || '').toLowerCase();
      return name.includes(search) || handle.includes(search) || char.includes(search);
    });

    if (!filtered.length) {
      raidAwardMemberList.innerHTML = `<div style="text-align:center; color:var(--text-dim); padding:1rem; font-size:0.85rem;">No members match filter.</div>`;
      return;
    }

    raidAwardMemberList.innerHTML = filtered.map(w => {
      const name = w.serverNickname || w.globalName || w.username || 'Guild Member';
      const handle = w.username ? `@${w.username}` : '';
      const isChecked = selectedIds.has(w.discordId);
      const chars = w.characters || [];
      const primChar = chars.find(c => c.isPrimary) || (w.primaryCharacter ? chars.find(c => c.name === w.primaryCharacter) : chars[0]);
      const charName = primChar ? primChar.name : (w.primaryCharacter || null);
      const charClass = primChar ? (primChar.class || 'Warrior') : 'Warrior';
      const classCss = `class-${charClass.toLowerCase().replace(/\s+/g, '-')}`;

      return `
        <div class="raid-member-check-row ${isChecked ? 'selected' : ''}" onclick="toggleRaidMemberCheck('${w.discordId}')">
          <div style="display:flex; align-items:center; gap:0.6rem;">
            <input type="checkbox" id="chk_raid_${w.discordId}" ${isChecked ? 'checked' : ''} onclick="event.stopPropagation(); toggleRaidMemberCheck('${w.discordId}')">
            <div>
              <strong style="color:var(--gold-100); font-size:0.85rem;">${name}</strong>
              <span style="font-size:0.75rem; color:var(--text-muted); margin-left:0.35rem;">${handle}</span>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:0.5rem;">
            ${charName ? `<span class="class-badge ${classCss}" style="padding:0.1rem 0.35rem; font-size:0.7rem;">${charName}</span>` : ''}
            <span style="font-size:0.75rem; color:var(--amber); font-weight:700;">${(w.boneScore || 0).toLocaleString()} Pts</span>
          </div>
        </div>
      `;
    }).join('');
    updateRaidSummary();
  }

  window.toggleRaidMemberCheck = function(id) {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
    } else {
      selectedIds.add(id);
    }
    const row = document.getElementById(`chk_raid_${id}`)?.closest('.raid-member-check-row');
    const chk = document.getElementById(`chk_raid_${id}`);
    if (chk) chk.checked = selectedIds.has(id);
    if (row) {
      if (selectedIds.has(id)) row.classList.add('selected');
      else row.classList.remove('selected');
    }
    updateRaidSummary();
  };

  btnOpenRaidAwardModal.addEventListener('click', () => {
    selectedIds.clear();
    if (filterRaidMembers) filterRaidMembers.value = '';
    renderRaidChecklist();
    modalRaidAward.classList.add('active');
  });

  if (filterRaidMembers) {
    filterRaidMembers.addEventListener('input', () => {
      renderRaidChecklist(filterRaidMembers.value);
    });
  }

  if (batchAwardAmount) {
    batchAwardAmount.addEventListener('input', updateRaidSummary);
  }

  if (btnSelectAllRaid) {
    btnSelectAllRaid.addEventListener('click', () => {
      const search = (filterRaidMembers?.value || '').toLowerCase().trim();
      const wallets = Object.values(state.bseState?.wallets || {});
      wallets.forEach(w => {
        if (!search) {
          selectedIds.add(w.discordId);
        } else {
          const name = (w.serverNickname || w.globalName || w.username || '').toLowerCase();
          const handle = (w.username || '').toLowerCase();
          const char = (w.primaryCharacter || '').toLowerCase();
          if (name.includes(search) || handle.includes(search) || char.includes(search)) {
            selectedIds.add(w.discordId);
          }
        }
      });
      renderRaidChecklist(search);
    });
  }

  if (btnDeselectAllRaid) {
    btnDeselectAllRaid.addEventListener('click', () => {
      selectedIds.clear();
      renderRaidChecklist(filterRaidMembers?.value || '');
    });
  }

  if (btnExecuteBatchAward) {
    btnExecuteBatchAward.addEventListener('click', async () => {
      const amount = parseInt(batchAwardAmount.value, 10);
      const eventName = (batchEventName.value || '').trim();
      const reason = (batchAwardReason.value || '').trim();

      if (selectedIds.size === 0) {
        showToast('Please select at least one guild member.');
        return;
      }
      if (isNaN(amount) || amount < 1) {
        showToast('Please enter a valid Bones amount.');
        return;
      }

      const orig = btnExecuteBatchAward.textContent;
      btnExecuteBatchAward.textContent = 'Awarding...';
      btnExecuteBatchAward.disabled = true;

      try {
        const res = await fetch('/api/exchange/batch-award', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetIds: Array.from(selectedIds),
            amount,
            eventName,
            reason
          })
        });

        if (res.ok) {
          const data = await res.json();
          showToast(`Successfully awarded +${amount} Bones to ${data.awardedCount} members!`);
          modalRaidAward.classList.remove('active');
          await refreshBseState();
        } else {
          const err = await res.json();
          showToast(err.error || 'Batch award failed.');
        }
      } catch (err) {
        showToast('Network error during batch award.');
      } finally {
        btnExecuteBatchAward.textContent = orig;
        btnExecuteBatchAward.disabled = false;
      }
    });
  }
}

// Global officer queue handlers
window.approveClaim = async function(claimId) {
  const res = await fetch('/api/exchange/claim/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claimId })
  });
  if (res.ok) {
    showToast('Bounty claim approved.');
    await refreshBseState();
  }
};

window.approveClaimCustom = async function(claimId, currentReward) {
  const custom = prompt(`Enter custom reward amount to award for this claim:`, currentReward);
  if (custom === null) return;
  const num = parseInt(custom, 10);
  if (isNaN(num) || num < 1) {
    showToast('Invalid amount entered.');
    return;
  }

  const res = await fetch('/api/exchange/claim/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claimId, customReward: num })
  });
  if (res.ok) {
    showToast(`Approved with custom reward of +${num}.`);
    await refreshBseState();
  }
};

window.denyClaim = async function(claimId) {
  const reason = prompt('Enter reason for denying this bounty claim (optional):', 'Requirements not satisfied');
  if (reason === null) return;

  const res = await fetch('/api/exchange/claim/deny', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claimId, denyReason: reason })
  });
  if (res.ok) {
    showToast('Claim denied.');
    await refreshBseState();
  }
};

window.fulfillDelivery = async function(orderId) {
  const res = await fetch('/api/exchange/deliver', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId })
  });
  if (res.ok) {
    showToast('Order marked delivered.');
    await refreshBseState();
  }
};

window.refundDelivery = async function(orderId) {
  const confirmRefund = confirm('Refund this purchase? The spent currency will be returned to the member and stock will be restored.');
  if (!confirmRefund) return;

  const res = await fetch('/api/exchange/deliver/refund', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId })
  });
  if (res.ok) {
    showToast('Order refunded to member.');
    await refreshBseState();
  }
};

window.toggleBountyStatus = async function(bountyId, newStatus) {
  await fetch('/api/exchange/bounty/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bountyId, status: newStatus })
  });
  showToast(`Bounty status updated to ${newStatus}`);
  await refreshBseState();
};

window.deleteBounty = async function(bountyId) {
  if (!confirm('Are you sure you want to delete this bounty?')) return;
  await fetch('/api/exchange/bounty/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bountyId })
  });
  showToast('Bounty deleted.');
  await refreshBseState();
};

window.adjustShopStock = async function(itemId, delta) {
  const item = (state.bseState?.shop || []).find(i => i.id === itemId);
  if (!item) return;
  await fetch('/api/exchange/shop/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, stock: (item.stock || 0) + delta })
  });
  showToast('Stock updated.');
  await refreshBseState();
};

window.deleteShopItem = async function(itemId) {
  if (!confirm('Are you sure you want to remove this shop item?')) return;
  await fetch('/api/exchange/shop/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId })
  });
  showToast('Shop item deleted.');
  await refreshBseState();
};

/**
 * Tab & Subtab Navigation (Desktop + Mobile Bottom Bar)
 */
function setupNavigation() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const targetView = tab.getAttribute('data-tab');
      switchTab(targetView);
    });
  });

  document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetView = btn.getAttribute('data-tab');
      switchTab(targetView);
    });
  });
}

function switchTab(targetView) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));

  const tab = document.querySelector(`.nav-tab[data-tab="${targetView}"]`);
  if (tab) tab.classList.add('active');

  const mobBtn = document.querySelector(`.mobile-nav-btn[data-tab="${targetView}"]`);
  if (mobBtn) mobBtn.classList.add('active');

  document.getElementById(`view-${targetView}`)?.classList.add('active');
  state.activeTab = targetView;

  if (targetView === 'leaderboard') {
    renderLeaderboard();
  }
  if (targetView === 'history') {
    renderMemberHistory();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setupOfficerSubtabs() {
  document.querySelectorAll('.officer-subtab').forEach(subtab => {
    subtab.addEventListener('click', () => {
      const target = subtab.getAttribute('data-subtab');
      document.querySelectorAll('.officer-subtab').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.officer-subview').forEach(v => v.classList.remove('active'));

      subtab.classList.add('active');
      document.getElementById(`subview-${target}`)?.classList.add('active');
      state.activeOfficerSubtab = target;
    });
  });
}

/**
 * Toast Notification Helper (Clean Warcraft Notification)
 */
function showToast(message) {
  if (state.user?.preferences?.notifyToasts === false) return;
  const container = document.getElementById('toastContainer');
  if (!container) return;

  // Clean any residual emojis from message
  const cleanMsg = message.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = cleanMsg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3500);
}
