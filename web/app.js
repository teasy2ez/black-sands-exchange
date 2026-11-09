/**
 * Black Sands Exchange (BSE) - Full Application Client
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
  pollTimer: null
};

// DOM Elements
const authContainer = document.getElementById('authContainer');
const discordLoginBtn = document.getElementById('discordLoginBtn');
const userProfileBadge = document.getElementById('userProfileBadge');
const headerAvatar = document.getElementById('headerAvatar');
const headerDisplayName = document.getElementById('headerDisplayName');
const headerRoleBadge = document.getElementById('headerRoleBadge');
const logoutBtn = document.getElementById('logoutBtn');

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

const tabOfficer = document.getElementById('tabOfficer');
const officerActionBadge = document.getElementById('officerActionBadge');
const subtabClaimCount = document.getElementById('subtabClaimCount');
const subtabDeliveryCount = document.getElementById('subtabDeliveryCount');

const leaderboardTbody = document.getElementById('leaderboardTbody');
const searchLeaderboard = document.getElementById('searchLeaderboard');
const bountiesGrid = document.getElementById('bountiesGrid');
const shopGrid = document.getElementById('shopGrid');

// Officer views
const pendingClaimsList = document.getElementById('pendingClaimsList');
const pendingDeliveriesList = document.getElementById('pendingDeliveriesList');
const officerBountiesList = document.getElementById('officerBountiesList');
const officerShopList = document.getElementById('officerShopList');
const auditTrailTbody = document.getElementById('auditTrailTbody');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupOfficerSubtabs();
  setupModals();
  setupCharacterManagement();
  setupOfficerTools();

  await checkAuthSession();
  await refreshBseState();

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
  headerRoleBadge.textContent = user.isOfficer ? '🛡️ Guild Officer' : 'Guild Member';

  walletAvatar.src = avatarUrl;
  walletName.textContent = user.serverNickname || user.globalName || user.username;
  walletHandle.textContent = `@${user.username}`;
  walletSpendable.textContent = (user.spendableBones || 0).toLocaleString();
  walletScore.textContent = (user.boneScore || 0).toLocaleString();

  // Primary Character Pill in Wallet
  walletCharContainer.style.display = 'flex';
  if (user.primaryCharacter) {
    walletPrimaryCharName.textContent = user.primaryCharacter;
  } else {
    walletPrimaryCharName.textContent = 'None (Click to link)';
  }

  updatePrestigeBanner(user.boneScore || 0, user.spendableBones || 0);

  // STRICT OFFICER PERMISSION CHECK: Show or Hide Officer Command Center tab
  if (user.isOfficer) {
    tabOfficer.style.display = 'inline-flex';
  } else {
    tabOfficer.style.display = 'none';
    if (state.activeTab === 'officer') {
      switchTab('leaderboard');
    }
  }
}

function renderUnauthenticatedUser() {
  discordLoginBtn.style.display = 'inline-flex';
  userProfileBadge.style.display = 'none';
  walletName.textContent = 'Welcome, Traveler';
  walletHandle.textContent = 'Sign in with Discord to access your wallet';
  walletSpendable.textContent = '0';
  walletScore.textContent = '0';
  walletCharContainer.style.display = 'none';
  tabOfficer.style.display = 'none';
  if (state.activeTab === 'officer') {
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
    renderBounties();
    renderShop();

    if (state.user?.isOfficer) {
      renderOfficerQueues();
      renderOfficerBountiesList();
      renderOfficerShopList();
      renderAuditTrail();
    }
  } catch (err) {
    console.error('State refresh error:', err);
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

  walletRankTitle.textContent = `${currentRank.icon || '🪙'} ${currentRank.title}`;

  if (!nextRank) {
    nextRankTitle.textContent = 'Max Prestige Achieved!';
    rankProgressText.textContent = `${boneScore} Bones`;
    rankProgressBar.style.width = '100%';
    btnPromoteRank.style.display = 'none';
  } else {
    nextRankTitle.textContent = `Next Rank: ${nextRank.title}`;
    const required = nextRank.costBones;
    const progress = Math.min(100, Math.floor((spendableBones / required) * 100));
    rankProgressText.textContent = `${spendableBones} / ${required} Bones`;
    rankProgressBar.style.width = `${progress}%`;

    btnPromoteRank.style.display = 'block';
    btnPromoteRank.textContent = `⚡ Promote to ${nextRank.title} (${required} Bones)`;
    btnPromoteRank.onclick = () => openRankPromoteModal(nextRank);
  }
}

/**
 * Render Leaderboard with Main Character Column
 */
function renderLeaderboard() {
  if (!state.bseState) return;
  const wallets = Object.values(state.bseState.wallets || {});
  const query = (searchLeaderboard.value || '').toLowerCase().trim();

  wallets.sort((a, b) => (b.boneScore || b.spendableBones || 0) - (a.boneScore || a.spendableBones || 0));

  const filtered = wallets.filter(w => {
    const name = (w.serverNickname || w.globalName || w.username || '').toLowerCase();
    const handle = (w.username || '').toLowerCase();
    const char = (w.primaryCharacter || '').toLowerCase();
    return name.includes(query) || handle.includes(query) || char.includes(query);
  });

  if (!filtered.length) {
    leaderboardTbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 2rem;">No members match the search query.</td></tr>`;
    return;
  }

  leaderboardTbody.innerHTML = filtered.map((w, idx) => {
    const rankMedal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
    const name = w.serverNickname || w.globalName || w.username || 'Guild Member';
    const handle = w.username ? `@${w.username}` : '';
    const avatarUrl = w.avatarHash
      ? `https://cdn.discordapp.com/avatars/${w.discordId}/${w.avatarHash}.png?size=32`
      : 'assets/favicon.svg';

    const rankTitle = resolveRankTitle(w.boneScore);
    const charDisplay = w.primaryCharacter
      ? `<span class="char-pill" style="font-size:0.75rem;">⚔️ ${w.primaryCharacter}</span>`
      : `<span style="color:var(--text-dim); font-size:0.8rem;">—</span>`;

    return `
      <tr>
        <td class="table-rank-cell">${rankMedal}</td>
        <td>
          <div class="member-cell">
            <img src="${avatarUrl}" class="table-avatar" alt="${name}">
            <div>
              <div style="font-weight: 700; color: var(--gold-100);">${name}</div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">${handle}</div>
            </div>
          </div>
        </td>
        <td>${charDisplay}</td>
        <td><span class="card-badge economy">${rankTitle}</span></td>
        <td style="font-weight: 700; color: var(--gold-300);">${(w.spendableBones || 0).toLocaleString()}</td>
        <td style="font-weight: 700; color: var(--amber);">${(w.boneScore || 0).toLocaleString()}</td>
      </tr>
    `;
  }).join('');
}

searchLeaderboard.addEventListener('input', renderLeaderboard);

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
            <div class="card-reward">+${(b.rewardBones || 0).toLocaleString()} Bones</div>
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

  if (!items.length) {
    shopGrid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--text-dim); padding: 3rem;">The Exchange Shop is currently restocking.</div>`;
    return;
  }

  shopGrid.innerHTML = items.map(item => {
    const stockText = item.unlimitedStock
      ? '∞ Unlimited'
      : (item.stock > 0 ? `${item.stock} in stock` : '<strong style="color:var(--danger)">Sold Out</strong>');
    const isSoldOut = !item.unlimitedStock && item.stock <= 0;

    return `
      <div class="exchange-card">
        <div>
          <div class="card-top">
            <span class="card-badge perk">${item.category || 'Perk'}</span>
            <div class="card-reward">🪙 ${(item.costBones || 0).toLocaleString()} Bones</div>
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
 * Elaborate Officer Queues & Subtabs
 */
function renderOfficerQueues() {
  if (!state.bseState) return;

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
        ? `<span class="char-pill" style="font-size:0.75rem;">⚔️ Character: <strong>${c.characterName}</strong></span>`
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
              <span style="color: var(--gold-300); font-weight: 800; font-size: 1.1rem;">+${c.rewardBones} Bones</span>
              <div style="font-size: 0.7rem; color: var(--text-dim);">Claim ID: <code>${c.id}</code></div>
            </div>
          </div>

          <div style="display: flex; gap: 1rem; align-items: center; margin: 0.75rem 0; background: var(--bg-primary); padding: 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); flex-wrap: wrap;">
            ${isImg ? `<img src="${c.proofUrl}" class="proof-thumbnail" alt="Proof" onclick="zoomImage('${c.proofUrl}')">` : ''}
            <div style="flex: 1; min-width: 200px;">
              ${c.proofUrl ? `<div style="font-size: 0.85rem; margin-bottom: 0.25rem;"><a href="${c.proofUrl}" target="_blank" rel="noopener" style="color: var(--blue); font-weight: 600;">🔗 Open Full Proof Link</a></div>` : '<div style="color: var(--text-dim); font-size: 0.8rem;">No link provided</div>'}
              ${c.notes ? `<div style="font-size: 0.85rem; color: var(--text-main); font-style: italic;">"${c.notes}"</div>` : '<div style="color: var(--text-dim); font-size: 0.8rem;">No notes provided</div>'}
            </div>
          </div>

          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <button class="btn-success" onclick="approveClaim('${c.id}')" style="flex: 1; min-width: 140px;">✓ Approve (+${c.rewardBones} Bones)</button>
            <button class="btn-secondary" onclick="approveClaimCustom('${c.id}', ${c.rewardBones})" style="min-width: 140px;">⚡ Custom Amount</button>
            <button class="btn-danger" onclick="denyClaim('${c.id}')" style="min-width: 100px;">✕ Deny</button>
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
        ? `<strong style="color: var(--gold-300);">⚔️ ${d.characterName}</strong>`
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
              <span style="color: var(--amber); font-weight: 700;">${d.costBones} Bones Paid</span>
              <div style="font-size: 0.7rem; color: var(--text-dim);">${new Date(d.createdAt).toLocaleDateString()}</div>
            </div>
          </div>

          <div style="background: var(--bg-primary); padding: 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); margin: 0.5rem 0; font-size: 0.85rem;">
            <div>📬 <strong>Send In-Game Delivery To:</strong> ${charPart}</div>
          </div>

          <div style="display: flex; gap: 0.5rem;">
            <button class="btn-success" onclick="fulfillDelivery('${d.id}')" style="flex: 2;">📦 Mark Delivered</button>
            <button class="btn-danger" onclick="refundDelivery('${d.id}')" style="flex: 1;">↩️ Refund Bones</button>
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
  } else {
    officerActionBadge.style.display = 'none';
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
        <span style="color: var(--gold-300); font-weight: 700;">+${b.rewardBones} Bones</span>
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
        <span style="color: var(--gold-300); font-weight: 700;">🪙 ${i.costBones} Bones</span>
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
  const auditEntries = (state.bseState?.auditLog || []).slice(-20).reverse();
  if (!auditEntries.length) {
    auditTrailTbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 1.5rem;">Audit events will appear as actions occur.</td></tr>`;
    return;
  }

  auditTrailTbody.innerHTML = auditEntries.map(e => `
    <tr>
      <td style="font-size: 0.75rem; color: var(--text-dim);">${new Date(e.timestamp).toLocaleTimeString()}</td>
      <td><span class="card-badge raid" style="font-size:0.65rem;">${e.action}</span></td>
      <td style="font-weight: 600;">${e.officerName || 'System'}</td>
      <td>${e.targetName || '—'}</td>
      <td style="font-weight: 700; color: ${e.amount >= 0 ? 'var(--success)' : 'var(--danger)'};">
        ${e.amount !== undefined ? (e.amount >= 0 ? `+${e.amount}` : e.amount) : '—'}
      </td>
      <td style="font-size: 0.8rem; color: var(--text-muted);">${e.reason || '—'}</td>
    </tr>
  `).join('');
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
    const realm = document.getElementById('newCharRealm').value.trim();
    const charClass = document.getElementById('newCharClass').value;

    if (!name) {
      showToast('⚠️ Please enter a character name.');
      return;
    }

    const isFirst = state.userCharacters.length === 0;
    state.userCharacters.push({
      name,
      realm: realm || 'Area 52',
      class: charClass,
      isPrimary: isFirst
    });

    document.getElementById('newCharName').value = '';
    document.getElementById('newCharRealm').value = '';
    renderCharacterModalList();
    showToast(`Added ${name}! Click "Save Changes" to store.`);
  });

  document.getElementById('btnSaveCharacters').addEventListener('click', async () => {
    const primary = state.userCharacters.find(c => c.isPrimary)?.name || state.userCharacters[0]?.name || null;
    try {
      const res = await fetch('/api/exchange/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characters: state.userCharacters,
          primaryCharacter: primary
        })
      });
      const data = await res.json();
      if (res.ok) {
        showToast('✅ Characters updated successfully!');
        state.user.characters = data.characters;
        state.user.primaryCharacter = data.primaryCharacter;
        walletPrimaryCharName.textContent = data.primaryCharacter || 'None (Click to link)';
        document.getElementById('modalCharacters').classList.remove('active');
        await refreshBseState();
      } else {
        showToast(`❌ ${data.error || 'Failed to save characters'}`);
      }
    } catch (err) {
      showToast(`❌ Error: ${err.message}`);
    }
  });
}

function openCharacterModal() {
  state.userCharacters = [...(state.user?.characters || [])];
  renderCharacterModalList();
  document.getElementById('modalCharacters').classList.add('active');
}

function renderCharacterModalList() {
  const container = document.getElementById('characterListContainer');
  if (!state.userCharacters.length) {
    container.innerHTML = `<p style="color: var(--text-dim); font-size: 0.85rem; text-align: center; padding: 1rem;">No characters added yet. Add your main character below!</p>`;
    return;
  }

  container.innerHTML = state.userCharacters.map((c, idx) => `
    <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-primary); padding: 0.6rem 0.85rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); margin-bottom: 0.4rem;">
      <div style="display: flex; align-items: center; gap: 0.6rem;">
        <input type="radio" name="primaryCharRadio" ${c.isPrimary ? 'checked' : ''} onchange="setPrimaryCharacter(${idx})">
        <div>
          <strong style="color: var(--gold-100);">${c.name}</strong>
          <span style="font-size: 0.75rem; color: var(--text-muted);">(${c.class || 'Character'} &bull; ${c.realm || 'Area 52'})</span>
          ${c.isPrimary ? '<span class="char-pill" style="font-size: 0.65rem; margin-left: 0.4rem;">PRIMARY</span>' : ''}
        </div>
      </div>
      <button class="btn-danger" style="padding: 0.2rem 0.5rem; font-size: 0.7rem;" onclick="removeCharacter(${idx})">✕</button>
    </div>
  `).join('');
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
      showToast('⚠️ Please provide a proof URL (image or logs)');
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
        showToast('✅ Claim submitted! Dispatched to Discord Officers for 1-click review.');
        document.getElementById('modalClaim').classList.remove('active');
        await refreshBseState();
      } else {
        showToast(`❌ Error: ${data.error || 'Failed to submit'}`);
      }
    } catch (err) {
      showToast(`❌ Error: ${err.message}`);
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
        showToast(`🎉 Purchased ${state.selectedItemForBuy.title}! Delivery ticket dispatched to Officers.`);
        document.getElementById('modalBuy').classList.remove('active');
        await refreshBseState();
      } else {
        showToast(`❌ ${data.error || 'Purchase failed'}`);
      }
    } catch (err) {
      showToast(`❌ ${err.message}`);
    }
  });
}

window.openClaimModal = function(bountyId) {
  const select = document.getElementById('claimBountySelect');
  const bounties = (state.bseState?.bounties || []).filter(b => b.status === 'active');
  select.innerHTML = bounties.map(b => `
    <option value="${b.id}" ${b.id === bountyId ? 'selected' : ''}>
      ${b.title} (+${b.rewardBones} Bones)
    </option>
  `).join('');

  // Completing Character Select
  const charSelect = document.getElementById('claimCharacterSelect');
  const chars = state.user?.characters || [];
  if (chars.length) {
    charSelect.innerHTML = chars.map(c => `
      <option value="${c.name}" ${c.isPrimary ? 'selected' : ''}>
        ⚔️ ${c.name} (${c.class || 'Character'})
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

  document.getElementById('buyModalBody').innerHTML = `
    <div style="font-size: 1.1rem; font-weight: 700; color: var(--gold-100); margin-bottom: 0.5rem;">${item.title}</div>
    <div style="color: var(--text-muted); margin-bottom: 1rem;">${item.description || ''}</div>
    <div style="background: var(--bg-primary); padding: 0.85rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); display: flex; justify-content: space-between;">
      <span>Item Cost:</span>
      <strong style="color: var(--gold-300);">${item.costBones} Bones</strong>
    </div>
    <div style="margin-top: 0.5rem; display: flex; justify-content: space-between; font-size: 0.85rem;">
      <span>Your Spendable Bones:</span>
      <strong>${currentBones} Bones</strong>
    </div>
    ${!canAfford ? `<div style="color: var(--danger); font-size: 0.85rem; margin-top: 0.5rem;">⚠️ You need ${item.costBones - currentBones} more Bones for this item.</div>` : ''}
  `;

  // Populate recipient character dropdown
  const charSelect = document.getElementById('buyRecipientCharSelect');
  const chars = state.user?.characters || [];
  if (chars.length) {
    charSelect.innerHTML = chars.map(c => `
      <option value="${c.name}" ${c.isPrimary ? 'selected' : ''}>
        ⚔️ ${c.name} (${c.realm || 'Area 52'})
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

  document.getElementById('rankPromoteModalBody').innerHTML = `
    <p>Promote your Discord standing to <strong>${nextRank.title}</strong>!</p>
    <div style="background: var(--bg-primary); padding: 0.85rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); margin: 1rem 0;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 0.3rem;">
        <span>Promotion Cost:</span>
        <strong style="color: var(--gold-300);">${nextRank.costBones} Bones</strong>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
        <span>Your Spendable Bones:</span>
        <strong>${currentBones} Bones</strong>
      </div>
    </div>
    <p style="font-size: 0.8rem; color: var(--text-muted);">
      ✨ Upon purchase, your Discord server role will be updated automatically!
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
      showToast(`🎖️ Promoted to ${nextRank.title}!`);
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

  // Award Bones
  document.getElementById('btnExecuteAward').addEventListener('click', async () => {
    const targetId = awardTargetId.value || awardTargetInput.value.trim();
    const amount = parseInt(document.getElementById('awardAmountInput').value, 10);
    const reason = document.getElementById('awardReasonInput').value.trim();

    if (!targetId || !amount) {
      showToast('⚠️ Please specify target member and amount.');
      return;
    }

    const res = await fetch('/api/exchange/award', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId, amount, reason })
    });
    if (res.ok) {
      showToast(`✅ Awarded +${amount} Bones!`);
      document.getElementById('awardAmountInput').value = '';
      document.getElementById('awardReasonInput').value = '';
      await refreshBseState();
      loadMemberIntoInspector(targetId);
    } else {
      showToast('❌ Award failed');
    }
  });

  // Deduct Bones
  document.getElementById('btnExecuteDeduct').addEventListener('click', async () => {
    const targetId = awardTargetId.value || awardTargetInput.value.trim();
    const amount = parseInt(document.getElementById('awardAmountInput').value, 10);
    const reason = document.getElementById('awardReasonInput').value.trim();

    if (!targetId || !amount) {
      showToast('⚠️ Please specify target member and amount.');
      return;
    }

    const res = await fetch('/api/exchange/deduct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId, amount, reason })
    });
    if (res.ok) {
      showToast(`✅ Deducted -${amount} Bones.`);
      await refreshBseState();
      loadMemberIntoInspector(targetId);
    } else {
      showToast('❌ Deduct failed');
    }
  });

  // Save Member Ledger Correction
  document.getElementById('btnSaveMemberAdjust').addEventListener('click', async () => {
    if (!state.inspectedMemberId) return;
    const spendable = parseInt(document.getElementById('inspectorSpendable').value, 10);
    const score = parseInt(document.getElementById('inspectorScore').value, 10);
    const reason = document.getElementById('inspectorReason').value.trim();

    const res = await fetch('/api/exchange/member/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetId: state.inspectedMemberId,
        spendableBones: spendable,
        boneScore: score,
        reason
      })
    });
    if (res.ok) {
      showToast('✅ Member ledger corrected successfully!');
      await refreshBseState();
      loadMemberIntoInspector(state.inspectedMemberId);
    } else {
      showToast('❌ Failed to update ledger');
    }
  });

  // Create Bounty
  document.getElementById('btnCreateBounty').addEventListener('click', async () => {
    const title = document.getElementById('newBountyTitle').value.trim();
    const rewardBones = document.getElementById('newBountyReward').value;
    const category = document.getElementById('newBountyCategory').value;
    const description = document.getElementById('newBountyDesc').value.trim();

    if (!title || !rewardBones) {
      showToast('⚠️ Please enter bounty title and reward.');
      return;
    }

    const res = await fetch('/api/exchange/bounty/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, rewardBones, category, description })
    });
    if (res.ok) {
      showToast(`✅ Bounty created!`);
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
      showToast('⚠️ Please enter item title and cost.');
      return;
    }

    const res = await fetch('/api/exchange/shop/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, costBones, category, stock, unlimitedStock, fulfillmentNotes })
    });
    if (res.ok) {
      showToast(`✅ Shop item added!`);
      document.getElementById('newItemTitle').value = '';
      document.getElementById('newItemCost').value = '';
      await refreshBseState();
    }
  });

  // Push Standings to Discord
  document.getElementById('btnSyncDiscordStandings').addEventListener('click', async () => {
    showToast('🔄 Syncing in-place embeds in #exchange-standings...');
    const res = await fetch('/api/discord/sync-standings', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showToast('✨ Standings embeds updated in Discord in-place!');
    } else {
      showToast(`❌ Sync failed: ${data.error || 'Server error'}`);
    }
  });
}

function loadMemberIntoInspector(userId) {
  state.inspectedMemberId = userId;
  const wallet = state.bseState?.wallets?.[userId];
  const card = document.getElementById('memberInspectorCard');
  const form = document.getElementById('memberInspectorForm');

  if (!wallet) {
    card.innerHTML = `<p style="color:var(--text-muted);">Member ID <code>${userId}</code> has no ledger records yet. (Awarding bones will create profile).</p>`;
    form.style.display = 'none';
    return;
  }

  const name = wallet.serverNickname || wallet.globalName || wallet.username || 'Member';
  const charPart = wallet.primaryCharacter ? `⚔️ Primary: <strong>${wallet.primaryCharacter}</strong>` : 'No primary character';

  card.innerHTML = `
    <div style="background: var(--bg-primary); padding: 0.85rem; border-radius: var(--radius-sm); border: 1px solid var(--border-gold);">
      <div style="font-size: 1.1rem; font-weight: 700; color: var(--gold-100);">${name} (@${wallet.username || ''})</div>
      <div style="font-size: 0.8rem; color: var(--text-muted); margin: 0.2rem 0;">${charPart}</div>
      <div style="display: flex; gap: 1rem; margin-top: 0.5rem;">
        <div>Spendable: <strong style="color:var(--gold-300);">${wallet.spendableBones || 0}</strong></div>
        <div>Bone Score: <strong style="color:var(--amber);">${wallet.boneScore || 0}</strong></div>
      </div>
    </div>
  `;

  document.getElementById('inspectorSpendable').value = wallet.spendableBones || 0;
  document.getElementById('inspectorScore').value = wallet.boneScore || 0;
  form.style.display = 'block';
}

// Global officer queue handlers
window.approveClaim = async function(claimId) {
  const res = await fetch('/api/exchange/claim/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claimId })
  });
  if (res.ok) {
    showToast('✅ Bounty Claim Approved!');
    await refreshBseState();
  }
};

window.approveClaimCustom = async function(claimId, currentReward) {
  const custom = prompt(`Enter custom Bones reward to award for this claim:`, currentReward);
  if (custom === null) return;
  const num = parseInt(custom, 10);
  if (isNaN(num) || num < 1) {
    showToast('⚠️ Invalid amount entered');
    return;
  }

  const res = await fetch('/api/exchange/claim/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claimId, customReward: num })
  });
  if (res.ok) {
    showToast(`✅ Approved with custom reward of +${num} Bones!`);
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
    showToast('❌ Claim Denied.');
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
    showToast('📦 Order Marked Delivered!');
    await refreshBseState();
  }
};

window.refundDelivery = async function(orderId) {
  const confirmRefund = confirm('Refund this purchase? The spent Bones will be returned to the member and stock will be restored.');
  if (!confirmRefund) return;

  const res = await fetch('/api/exchange/deliver/refund', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId })
  });
  if (res.ok) {
    showToast('↩️ Order Refunded and Bones returned to member.');
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
  showToast('Stock updated!');
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
 * Tab & Subtab Navigation
 */
function setupNavigation() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const targetView = tab.getAttribute('data-tab');
      switchTab(targetView);
    });
  });
}

function switchTab(targetView) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));

  const tab = document.querySelector(`.nav-tab[data-tab="${targetView}"]`);
  if (tab) tab.classList.add('active');
  document.getElementById(`view-${targetView}`)?.classList.add('active');
  state.activeTab = targetView;
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
 * Toast Notification Helper
 */
function showToast(message) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}
