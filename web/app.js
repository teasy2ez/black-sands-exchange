/**
 * Black Sands Exchange (BSE) - Web Client
 */

// Application State
const state = {
  user: null,
  bseState: null,
  activeTab: 'leaderboard',
  officerUnlocked: false,
  officerKey: localStorage.getItem('bse_officer_key') || '',
  selectedBountyForClaim: null,
  selectedItemForBuy: null,
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

const leaderboardTbody = document.getElementById('leaderboardTbody');
const searchLeaderboard = document.getElementById('searchLeaderboard');
const bountiesGrid = document.getElementById('bountiesGrid');
const shopGrid = document.getElementById('shopGrid');

const officerLockedBox = document.getElementById('officerLockedBox');
const officerUnlockedDashboard = document.getElementById('officerUnlockedDashboard');
const officerPasscodeInput = document.getElementById('officerPasscodeInput');
const btnUnlockOfficer = document.getElementById('btnUnlockOfficer');
const pendingClaimsList = document.getElementById('pendingClaimsList');
const pendingDeliveriesList = document.getElementById('pendingDeliveriesList');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupModals();
  setupOfficerTools();

  await checkAuthSession();
  await refreshBseState();

  // Real-time polling every 5 seconds
  state.pollTimer = setInterval(refreshBseState, 5000);
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
      renderAuthenticatedUser(data.user);
      if (data.user.isOfficer) {
        state.officerUnlocked = true;
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
  headerRoleBadge.textContent = user.isOfficer ? '🛡️ Guild Officer' : 'Guild Member';

  walletAvatar.src = avatarUrl;
  walletName.textContent = user.serverNickname || user.globalName || user.username;
  walletHandle.textContent = `@${user.username}`;
  walletSpendable.textContent = (user.spendableBones || 0).toLocaleString();
  walletScore.textContent = (user.boneScore || 0).toLocaleString();

  updatePrestigeBanner(user.boneScore || 0, user.spendableBones || 0);

  if (state.officerUnlocked) {
    officerLockedBox.style.display = 'none';
    officerUnlockedDashboard.style.display = 'block';
  }
}

function renderUnauthenticatedUser() {
  discordLoginBtn.style.display = 'inline-flex';
  userProfileBadge.style.display = 'none';
  walletName.textContent = 'Welcome, Traveler';
  walletHandle.textContent = 'Sign in with Discord to access your wallet';
  walletSpendable.textContent = '0';
  walletScore.textContent = '0';
}

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  state.user = null;
  state.officerUnlocked = false;
  localStorage.removeItem('bse_officer_key');
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
      walletSpendable.textContent = state.user.spendableBones.toLocaleString();
      walletScore.textContent = state.user.boneScore.toLocaleString();
      updatePrestigeBanner(state.user.boneScore, state.user.spendableBones);
    }

    renderLeaderboard();
    renderBounties();
    renderShop();
    if (state.officerUnlocked) {
      renderOfficerQueues();
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
 * Render Leaderboard
 */
function renderLeaderboard() {
  if (!state.bseState) return;
  const wallets = Object.values(state.bseState.wallets || {});
  const query = (searchLeaderboard.value || '').toLowerCase().trim();

  wallets.sort((a, b) => (b.boneScore || b.spendableBones || 0) - (a.boneScore || a.spendableBones || 0));

  const filtered = wallets.filter(w => {
    const name = (w.serverNickname || w.globalName || w.username || '').toLowerCase();
    const handle = (w.username || '').toLowerCase();
    return name.includes(query) || handle.includes(query);
  });

  if (!filtered.length) {
    leaderboardTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-dim); padding: 2rem;">No members match the search query.</td></tr>`;
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
 * Render Officer Queues
 */
function renderOfficerQueues() {
  if (!state.bseState) return;

  // 1. Pending Claims
  const claims = Object.values(state.bseState.claims || {}).filter(c => c.status === 'pending');
  if (!claims.length) {
    pendingClaimsList.innerHTML = `<p style="color: var(--text-dim); font-size: 0.85rem;">No pending claims awaiting review.</p>`;
  } else {
    pendingClaimsList.innerHTML = claims.map(c => `
      <div style="background: var(--bg-primary); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 0.85rem; margin-bottom: 0.75rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
          <strong style="color: var(--gold-100);">${c.bountyTitle}</strong>
          <span style="color: var(--gold-300); font-weight: 700;">+${c.rewardBones} Bones</span>
        </div>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.4rem;">
          Submitted by: <strong>${c.serverNickname || c.discordUsername}</strong>
        </div>
        ${c.proofUrl ? `<div style="font-size: 0.8rem; margin-bottom: 0.4rem;"><a href="${c.proofUrl}" target="_blank" rel="noopener" style="color: var(--blue);">🔗 View Proof Submission</a></div>` : ''}
        ${c.notes ? `<div style="font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.5rem; font-style: italic;">"${c.notes}"</div>` : ''}
        <div style="display: flex; gap: 0.5rem;">
          <button class="btn-success" onclick="approveClaim('${c.id}')" style="flex: 1;">✓ Approve (+${c.rewardBones})</button>
          <button class="btn-danger" onclick="denyClaim('${c.id}')" style="flex: 1;">✕ Deny</button>
        </div>
      </div>
    `).join('');
  }

  // 2. Pending Deliveries
  const deliveries = Object.values(state.bseState.deliveries || {}).filter(d => d.status === 'pending');
  if (!deliveries.length) {
    pendingDeliveriesList.innerHTML = `<p style="color: var(--text-dim); font-size: 0.85rem;">No shop orders pending fulfillment.</p>`;
  } else {
    pendingDeliveriesList.innerHTML = deliveries.map(d => `
      <div style="background: var(--bg-primary); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 0.85rem; margin-bottom: 0.75rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
          <strong style="color: var(--gold-100);">${d.itemTitle}</strong>
          <span style="color: var(--amber); font-size: 0.8rem;">${d.costBones} Bones Paid</span>
        </div>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">
          Ordered by: <strong>${d.serverNickname || d.discordUsername}</strong>
        </div>
        <button class="btn-success" onclick="fulfillDelivery('${d.id}')" style="width: 100%;">📦 Mark Delivered</button>
      </div>
    `).join('');
  }
}

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

  // General Claim button
  document.getElementById('btnSubmitGeneralClaim').addEventListener('click', () => {
    openClaimModal();
  });

  // Submit Claim Execute
  document.getElementById('btnSubmitClaimExecute').addEventListener('click', async () => {
    const bountyId = document.getElementById('claimBountySelect').value;
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
          proofUrl,
          notes,
          discordId: state.user?.id || 'web_guest',
          discordUsername: state.user?.username || 'Guest Traveler'
        })
      });
      const data = await res.json();
      if (res.ok) {
        showToast('✅ Claim submitted! Sent to Discord Officers for 1-click review.');
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
    try {
      const res = await fetch('/api/exchange/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: state.selectedItemForBuy.id,
          discordId: state.user?.id
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
    // Treat promotion as shop purchase or custom rank promotion endpoint
    const res = await fetch('/api/exchange/award', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetId: state.user.id,
        amount: -nextRank.costBones,
        reason: `Rank Promotion to ${nextRank.title}`,
        officerKey: state.officerKey || 'blacksands2026'
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

/**
 * Officer Panel Actions
 */
function setupOfficerTools() {
  btnUnlockOfficer.addEventListener('click', () => {
    const key = officerPasscodeInput.value.trim();
    if (key === 'blacksands2026') {
      state.officerUnlocked = true;
      state.officerKey = key;
      localStorage.setItem('bse_officer_key', key);
      officerLockedBox.style.display = 'none';
      officerUnlockedDashboard.style.display = 'block';
      renderOfficerQueues();
      showToast('🛡️ Officer Command Center Unlocked!');
    } else {
      showToast('❌ Invalid Officer Key');
    }
  });

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
      <div style="background: var(--bg-accent); padding: 0.35rem 0.6rem; border-radius: 4px; margin-top: 2px; cursor: pointer; font-size: 0.8rem;" onclick="selectAwardTarget('${m.discordId}', '${m.serverNickname || m.username}')">
        <strong>${m.serverNickname || m.username}</strong> (@${m.username})
      </div>
    `).join('');
  });

  window.selectAwardTarget = function(id, name) {
    awardTargetInput.value = name;
    awardTargetId.value = id;
    searchResultsDiv.innerHTML = '';
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
      body: JSON.stringify({
        targetId,
        amount,
        reason,
        officerKey: state.officerKey
      })
    });
    if (res.ok) {
      showToast(`✅ Awarded +${amount} Bones!`);
      document.getElementById('awardAmountInput').value = '';
      document.getElementById('awardReasonInput').value = '';
      await refreshBseState();
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
      body: JSON.stringify({
        targetId,
        amount,
        reason,
        officerKey: state.officerKey
      })
    });
    if (res.ok) {
      showToast(`✅ Deducted -${amount} Bones.`);
      await refreshBseState();
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
      body: JSON.stringify({ title, rewardBones, category, description, officerKey: state.officerKey })
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
      body: JSON.stringify({ title, costBones, category, stock, unlimitedStock, fulfillmentNotes, officerKey: state.officerKey })
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
    const res = await fetch('/api/discord/sync-standings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ officerKey: state.officerKey })
    });
    const data = await res.json();
    if (res.ok) {
      showToast('✨ Standings embeds updated in Discord in-place!');
    } else {
      showToast(`❌ Sync failed: ${data.error || 'Server error'}`);
    }
  });
}

// Global officer queue handlers
window.approveClaim = async function(claimId) {
  const res = await fetch('/api/exchange/claim/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claimId, officerKey: state.officerKey })
  });
  if (res.ok) {
    showToast('✅ Bounty Claim Approved!');
    await refreshBseState();
  }
};

window.denyClaim = async function(claimId) {
  const res = await fetch('/api/exchange/claim/deny', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claimId, officerKey: state.officerKey })
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
    body: JSON.stringify({ orderId, officerKey: state.officerKey })
  });
  if (res.ok) {
    showToast('📦 Order Marked Delivered!');
    await refreshBseState();
  }
};

/**
 * Tab Navigation
 */
function setupNavigation() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const targetView = tab.getAttribute('data-tab');
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById(`view-${targetView}`)?.classList.add('active');
      state.activeTab = targetView;
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
