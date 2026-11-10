import {
  verifyDiscordSignature,
  InteractionType,
  InteractionResponseType,
  getGuildMember,
  searchGuildMembers,
  sendChannelMessage,
  editChannelMessage,
  addGuildMemberRole,
  buildLeaderboardEmbed,
  buildBountiesEmbed,
  buildShopEmbed,
  buildBountyClaimReviewMessage,
  buildShopDeliveryReviewMessage,
  Colors,
  recordTransaction,
  pushStandingsToDiscord,
  recordAuditLogAndSync
} from './src/discord.js';
import { FirestoreClient } from './src/firestore.js';
import { handleApplicationCommand, resolveRank } from './src/commands.js';
import { handleMessageComponent } from './src/components.js';

/**
 * Cloudflare Worker Export
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const firestore = new FirestoreClient(env);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCors();
    }

    // 1. Discord Interactions Endpoint
    if (url.pathname === '/api/discord/interactions' && request.method === 'POST') {
      return handleDiscordInteractions(request, env, firestore);
    }

    // 2. Discord OAuth 2.0 Auth Flow
    if (url.pathname === '/api/auth/discord' && request.method === 'GET') {
      return handleDiscordAuthRedirect(url, env);
    }
    if (url.pathname === '/api/auth/discord/callback' && request.method === 'GET') {
      return handleDiscordAuthCallback(url, env, firestore);
    }
    if (url.pathname === '/api/auth/discord/me' && request.method === 'GET') {
      return handleDiscordAuthMe(request, env, firestore);
    }
    if (url.pathname === '/api/auth/logout') {
      return handleLogout();
    }

    // 3. Central Web Portal API
    if (url.pathname.startsWith('/api/exchange/')) {
      return handleExchangeApi(url, request, env, firestore);
    }

    if (url.pathname === '/api/discord/sync-standings' && request.method === 'POST') {
      return handleSyncStandingsApi(request, env, firestore);
    }

    // 4. Static Assets fallback (Serves web/ folder)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Black Sands Exchange API Running', { status: 200 });
  }
};

/**
 * Handle Discord HTTP Interactions
 */
async function handleDiscordInteractions(request, env, firestore) {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  const rawBody = await request.text();

  // Signature verification
  const isValid = verifyDiscordSignature(rawBody, signature, timestamp, env.DISCORD_PUBLIC_KEY);
  if (!isValid) {
    return new Response('Invalid request signature', { status: 401 });
  }

  const interaction = JSON.parse(rawBody);

  // Interaction type 1: PING
  if (interaction.type === InteractionType.PING) {
    return jsonResponse({ type: InteractionResponseType.PONG });
  }

  // Interaction type 2: Slash Commands
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const result = await handleApplicationCommand(interaction, env, firestore);
    return jsonResponse(result);
  }

  // Interaction type 3: Message Components (Buttons)
  if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
    const result = await handleMessageComponent(interaction, env, firestore);
    return jsonResponse(result);
  }

  return jsonResponse({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: 'Unsupported interaction type', flags: 64 }
  });
}

/**
 * Discord OAuth Redirect
 */
function handleDiscordAuthRedirect(url, env) {
  const clientId = env.DISCORD_CLIENT_ID || '1568455199113084950';
  const redirectUri = `${url.origin}/api/auth/discord/callback`;
  const scopes = encodeURIComponent('identify guilds guilds.members.read');
  const authUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scopes}`;
  return Response.redirect(authUrl, 302);
}

/**
 * Discord OAuth Callback
 */
async function handleDiscordAuthCallback(url, env, firestore) {
  const code = url.searchParams.get('code');
  if (!code) {
    return new Response('Missing authorization code', { status: 400 });
  }

  const redirectUri = `${url.origin}/api/auth/discord/callback`;

  // Exchange code for access token
  const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID || '1568455199113084950',
      client_secret: env.DISCORD_CLIENT_SECRET || '',
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    })
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return new Response(`OAuth token exchange failed: ${err}`, { status: 400 });
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;

  // Fetch user profile from Discord
  const userRes = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!userRes.ok) {
    return new Response('Failed to fetch Discord user profile', { status: 400 });
  }
  const user = await userRes.json();

  // Fetch guild member profile if GUILD_ID is configured
  let isOfficer = false;
  let serverNickname = user.global_name || user.username;
  if (env.DISCORD_GUILD_ID && env.DISCORD_BOT_TOKEN) {
    const member = await getGuildMember(env.DISCORD_GUILD_ID, user.id, env.DISCORD_BOT_TOKEN);
    if (member) {
      if (member.nick) serverNickname = member.nick;
      const permissions = BigInt(member.permissions || '0');
      const ADMINISTRATOR = 0x8n;
      const MANAGE_GUILD = 0x20n;
      const MANAGE_ROLES = 0x10000000n;
      const BAN_MEMBERS = 0x4n;
      if (
        (permissions & ADMINISTRATOR) === ADMINISTRATOR ||
        (permissions & MANAGE_GUILD) === MANAGE_GUILD ||
        (permissions & MANAGE_ROLES) === MANAGE_ROLES ||
        (permissions & BAN_MEMBERS) === BAN_MEMBERS
      ) {
        isOfficer = true;
      }
      if (env.DISCORD_OFFICER_ROLE_ID && member.roles?.includes(env.DISCORD_OFFICER_ROLE_ID)) {
        isOfficer = true;
      }
    }
  }

  // Create session payload
  const sessionUser = {
    id: user.id,
    username: user.username,
    globalName: user.global_name,
    serverNickname,
    avatar: user.avatar,
    isOfficer,
    issuedAt: Date.now()
  };

  const sessionToken = await signSessionToken(sessionUser, env.SESSION_SECRET || 'bse_secret_key');

  // Update or initialize wallet record in Firestore
  const state = await firestore.getBseState();
  state.wallets = state.wallets || {};
  if (!state.wallets[user.id]) {
    state.wallets[user.id] = {
      discordId: user.id,
      username: user.username,
      globalName: user.global_name,
      serverNickname,
      avatarHash: user.avatar,
      spendableBones: 0,
      boneScore: 0,
      createdAt: new Date().toISOString()
    };
  } else {
    // Keep username and nickname cached
    state.wallets[user.id].username = user.username;
    state.wallets[user.id].globalName = user.global_name;
    state.wallets[user.id].serverNickname = serverNickname;
    state.wallets[user.id].avatarHash = user.avatar;
  }
  await firestore.saveBseState(state);

  // Set secure cookie and redirect to portal root
  const headers = new Headers();
  headers.append('Location', `${url.origin}/`);
  headers.append('Set-Cookie', `bse_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);

  return new Response(null, { status: 302, headers });
}

/**
 * Return current logged-in user info
 */
async function handleDiscordAuthMe(request, env, firestore) {
  const session = await getSessionFromRequest(request, env);
  if (!session) {
    return jsonResponse({ authenticated: false });
  }

  const state = await firestore.getBseState();
  const wallet = state.wallets?.[session.id] || {
    discordId: session.id,
    spendableBones: 0,
    boneScore: 0,
    primaryCharacter: null,
    characters: []
  };

  const rank = resolveRank(wallet.boneScore, state.ranks);

  return jsonResponse({
    authenticated: true,
    user: {
      ...session,
      spendableBones: wallet.spendableBones || 0,
      boneScore: wallet.boneScore || 0,
      primaryCharacter: wallet.primaryCharacter || null,
      characters: wallet.characters || [],
      guildNote: wallet.guildNote || '',
      preferences: wallet.preferences || {
        theme: 'default',
        density: 'expanded',
        defaultCharacter: null,
        notifyToasts: true
      },
      rank
    }
  });
}

/**
 * Logout
 */
function handleLogout() {
  const headers = new Headers();
  headers.append('Set-Cookie', 'bse_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  return jsonResponse({ success: true }, 200, headers);
}

/**
 * Handle Central BSE Web API Calls
 */
async function handleExchangeApi(url, request, env, firestore) {
  const path = url.pathname.replace('/api/exchange/', '');

  // GET State
  if (path === 'state' && request.method === 'GET') {
    const state = await firestore.getBseState();
    return jsonResponse(state);
  }

  // GET Member Autocomplete Search
  if (path === 'members/search' && request.method === 'GET') {
    const query = url.searchParams.get('q') || '';
    if (!env.DISCORD_GUILD_ID || !env.DISCORD_BOT_TOKEN) {
      const state = await firestore.getBseState();
      const results = Object.values(state.wallets || {})
        .filter(w => (w.username || '').toLowerCase().includes(query.toLowerCase()) ||
                     (w.serverNickname || '').toLowerCase().includes(query.toLowerCase()) ||
                     (w.primaryCharacter || '').toLowerCase().includes(query.toLowerCase()))
        .slice(0, 10);
      return jsonResponse(results);
    }
    const members = await searchGuildMembers(env.DISCORD_GUILD_ID, query, 10, env.DISCORD_BOT_TOKEN);
    const mapped = (members || []).map(m => ({
      discordId: m.user?.id,
      username: m.user?.username,
      serverNickname: m.nick || m.user?.global_name || m.user?.username,
      avatar: m.user?.avatar
    }));
    return jsonResponse(mapped);
  }

  // Require JSON body for mutations
  let body = {};
  if (request.method === 'POST') {
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }
  }

  const session = await getSessionFromRequest(request, env);
  const isAuthorizedOfficer = Boolean(session && session.isOfficer);

  // POST Manage Character Name(s), Classic Classes, Professions, & Public Guild Note
  if (path === 'characters' && request.method === 'POST') {
    if (!session) {
      return jsonResponse({ error: 'Unauthorized: Discord login required' }, 401);
    }
    const { characters, primaryCharacter, guildNote } = body;
    if (!Array.isArray(characters)) {
      return jsonResponse({ error: 'characters must be an array' }, 400);
    }

    const state = await firestore.getBseState();
    state.wallets = state.wallets || {};
    const wallet = state.wallets[session.id] || {
      discordId: session.id,
      username: session.username,
      serverNickname: session.serverNickname,
      spendableBones: 0,
      boneScore: 0
    };

    wallet.characters = characters.map(c => ({
      name: String(c.name || '').trim(),
      class: String(c.class || 'Warrior').trim(),
      role: String(c.role || 'DPS').trim(),
      professions: String(c.professions || '').trim(),
      isPrimary: Boolean(c.isPrimary)
    })).filter(c => c.name.length > 0);

    // Save expanded public guild note if provided
    if (typeof guildNote === 'string') {
      wallet.guildNote = guildNote.trim();
    }

    // Determine primary character
    const primaryObj = wallet.characters.find(c => c.isPrimary);
    wallet.primaryCharacter = primaryCharacter || (primaryObj ? primaryObj.name : (wallet.characters[0]?.name || null));
    wallet.updatedAt = new Date().toISOString();
    state.wallets[session.id] = wallet;

    await firestore.saveBseState(state);

    return jsonResponse({
      success: true,
      characters: wallet.characters,
      primaryCharacter: wallet.primaryCharacter,
      guildNote: wallet.guildNote || ''
    });
  }

  // POST Member Personal Preferences
  if (path === 'settings/member' && request.method === 'POST') {
    if (!session) {
      return jsonResponse({ error: 'Unauthorized: Discord login required' }, 401);
    }
    const { preferences } = body;
    if (!preferences || typeof preferences !== 'object') {
      return jsonResponse({ error: 'Invalid preferences object' }, 400);
    }

    const state = await firestore.getBseState();
    state.wallets = state.wallets || {};
    const wallet = state.wallets[session.id] || {
      discordId: session.id,
      username: session.username,
      serverNickname: session.serverNickname,
      spendableBones: 0,
      boneScore: 0
    };

    wallet.preferences = {
      theme: String(preferences.theme || 'default'),
      density: String(preferences.density || 'expanded'),
      defaultCharacter: preferences.defaultCharacter ? String(preferences.defaultCharacter) : null,
      notifyToasts: preferences.notifyToasts !== false
    };
    wallet.updatedAt = new Date().toISOString();
    state.wallets[session.id] = wallet;

    await firestore.saveBseState(state);
    return jsonResponse({ success: true, preferences: wallet.preferences });
  }

  // POST Submit Bounty Claim (Member or Officer)
  if (path === 'claim' && request.method === 'POST') {
    const { bountyId, proofUrl, notes, discordId, discordUsername, characterName } = body;
    const targetId = session?.id || discordId;
    const targetUsername = session?.username || discordUsername || 'Anonymous';

    if (!targetId || !bountyId) {
      return jsonResponse({ error: 'Missing bountyId or discord identity' }, 400);
    }

    const state = await firestore.getBseState();
    const bounty = (state.bounties || []).find(b => b.id === bountyId);
    if (!bounty) return jsonResponse({ error: 'Bounty not found' }, 404);

    const userWallet = state.wallets?.[targetId];
    const resolvedChar = characterName || userWallet?.primaryCharacter || null;

    const claimId = `claim_${Date.now()}_${targetId.slice(-4)}`;
    const claim = {
      id: claimId,
      bountyId: bounty.id,
      bountyTitle: bounty.title,
      rewardBones: bounty.rewardBones,
      discordId: targetId,
      discordUsername: targetUsername,
      serverNickname: session?.serverNickname || targetUsername,
      characterName: resolvedChar,
      proofUrl: proofUrl || '',
      notes: notes || '',
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    state.claims = state.claims || {};
    state.claims[claimId] = claim;
    await firestore.saveBseState(state);

    // Notify #officer-exchange with interactive buttons
    if (env.DISCORD_OFFICER_CHANNEL_ID && env.DISCORD_BOT_TOKEN) {
      try {
        const reviewMsg = buildBountyClaimReviewMessage(claim, bounty, userWallet || claim);
        await sendChannelMessage(env.DISCORD_OFFICER_CHANNEL_ID, reviewMsg, env.DISCORD_BOT_TOKEN);
      } catch (err) {
        console.error('Failed to notify #officer-exchange:', err);
      }
    }

    return jsonResponse({ success: true, claim });
  }

  // POST Purchase Item or Rank Promotion
  if (path === 'buy' && request.method === 'POST') {
    const { itemId, discordId, characterName } = body;
    const targetId = session?.id || discordId;

    if (!targetId || !itemId) {
      return jsonResponse({ error: 'Missing itemId or user identity' }, 400);
    }

    const state = await firestore.getBseState();
    const item = (state.shop || []).find(i => i.id === itemId);
    if (!item || item.enabled === false) {
      return jsonResponse({ error: 'Item not available' }, 404);
    }

    if (!item.unlimitedStock && item.stock <= 0) {
      return jsonResponse({ error: 'Item is sold out' }, 400);
    }

    const wallet = state.wallets?.[targetId] || { spendableBones: 0, boneScore: 0 };
    if ((wallet.spendableBones || 0) < item.costBones) {
      return jsonResponse({ error: 'Insufficient Bones' }, 400);
    }

    // Deduct bones
    wallet.spendableBones -= item.costBones;
    wallet.updatedAt = new Date().toISOString();
    state.wallets[targetId] = wallet;

    if (!item.unlimitedStock) {
      item.stock = Math.max(0, item.stock - 1);
    }

    const resolvedChar = characterName || wallet.primaryCharacter || null;
    const orderId = `order_${Date.now()}_${targetId.slice(-4)}`;
    const delivery = {
      id: orderId,
      itemId: item.id,
      itemTitle: item.title,
      costBones: item.costBones,
      discordId: targetId,
      discordUsername: session?.username || wallet.username || 'Member',
      serverNickname: session?.serverNickname || wallet.serverNickname || wallet.username,
      characterName: resolvedChar,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    state.deliveries = state.deliveries || {};
    state.deliveries[orderId] = delivery;

    await recordAuditLogAndSync(state, env, firestore, {
      action: 'SHOP_PURCHASE',
      officerId: null,
      officerName: 'System',
      targetId,
      targetName: delivery.serverNickname,
      amount: -item.costBones,
      spendableBones: wallet.spendableBones,
      boneScore: wallet.boneScore,
      reason: `Purchased ${item.title} (Order: ${orderId}${resolvedChar ? ` for ${resolvedChar}` : ''})`
    });

    // Notify #officer-exchange
    if (env.DISCORD_OFFICER_CHANNEL_ID && env.DISCORD_BOT_TOKEN) {
      try {
        const ticket = buildShopDeliveryReviewMessage(delivery, item, wallet);
        await sendChannelMessage(env.DISCORD_OFFICER_CHANNEL_ID, ticket, env.DISCORD_BOT_TOKEN);
      } catch (err) {
        console.error('Failed to notify #officer-exchange of purchase:', err);
      }
    }

    // Notify #exchange-feed
    if (env.DISCORD_FEED_CHANNEL_ID && env.DISCORD_BOT_TOKEN) {
      try {
        const charSuffix = resolvedChar ? ` for **${resolvedChar}**` : '';
        await sendChannelMessage(env.DISCORD_FEED_CHANNEL_ID, {
          embeds: [{
            title: 'Shop Purchase Receipt',
            description: `**${delivery.serverNickname}** purchased **${item.title}**${charSuffix} for **${item.costBones}** Bones!`,
            color: Colors.GOLD,
            timestamp: new Date().toISOString()
          }]
        }, env.DISCORD_BOT_TOKEN);
      } catch (err) {
        console.error('Feed broadcast error:', err);
      }
    }

    return jsonResponse({ success: true, remainingBones: wallet.spendableBones, delivery });
  }

  // =========================================================================
  // OFFICER EXCLUSIVE API ENDPOINTS (Strictly requires session.isOfficer)
  // =========================================================================
  if (!isAuthorizedOfficer) {
    return jsonResponse({ error: 'Forbidden: Officer role required' }, 403);
  }

  const officerName = session.serverNickname || session.username || 'Officer';
  const officerId = session.id;

  // POST Approve Claim with optional custom reward override and notes
  if (path === 'claim/approve' && request.method === 'POST') {
    const { claimId, customReward, officerNote } = body;
    const state = await firestore.getBseState();
    const claim = state.claims?.[claimId];
    if (!claim) return jsonResponse({ error: 'Claim not found' }, 404);

    claim.status = 'approved';
    claim.reviewedBy = officerName;
    claim.reviewedById = officerId;
    claim.reviewedAt = new Date().toISOString();
    if (officerNote) claim.officerNote = officerNote;

    const reward = customReward !== undefined && Number.isInteger(customReward)
      ? Math.max(1, customReward)
      : (claim.rewardBones || 0);
    claim.rewardBones = reward;

    state.wallets = state.wallets || {};
    const wallet = state.wallets[claim.discordId] || {
      discordId: claim.discordId,
      username: claim.discordUsername,
      serverNickname: claim.serverNickname,
      spendableBones: 0,
      boneScore: 0
    };

    wallet.spendableBones = (wallet.spendableBones || 0) + reward;
    wallet.boneScore = (wallet.boneScore || 0) + reward;
    wallet.updatedAt = new Date().toISOString();
    state.wallets[claim.discordId] = wallet;

    await recordAuditLogAndSync(state, env, firestore, {
      action: 'BOUNTY_REWARD',
      officerId,
      officerName,
      targetId: claim.discordId,
      targetName: claim.serverNickname || claim.discordUsername,
      amount: reward,
      spendableBones: wallet.spendableBones,
      boneScore: wallet.boneScore,
      reason: `Approved claim ${claimId} (${claim.bountyTitle})${officerNote ? ` - Note: ${officerNote}` : ''}`
    });

    return jsonResponse({ success: true, claim, wallet });
  }

  // POST Deny Claim with reason
  if (path === 'claim/deny' && request.method === 'POST') {
    const { claimId, denyReason } = body;
    const state = await firestore.getBseState();
    const claim = state.claims?.[claimId];
    if (!claim) return jsonResponse({ error: 'Claim not found' }, 404);

    claim.status = 'denied';
    claim.reviewedBy = officerName;
    claim.reviewedById = officerId;
    claim.reviewedAt = new Date().toISOString();
    claim.denyReason = denyReason || 'Does not meet bounty verification criteria';
    await firestore.saveBseState(state);

    // Audit log
    await firestore.logAuditEvent({
      action: 'BOUNTY_CLAIM_DENIED_WEB',
      officerId,
      officerName,
      targetId: claim.discordId,
      targetName: claim.serverNickname,
      reason: `Denied claim ${claimId} (${claim.bountyTitle}): ${claim.denyReason}`,
      timestamp: new Date().toISOString()
    });

    return jsonResponse({ success: true, claim });
  }

  // POST Mark Order Delivered
  if (path === 'deliver' && request.method === 'POST') {
    const { orderId, fulfillmentNote } = body;
    const state = await firestore.getBseState();
    const delivery = state.deliveries?.[orderId];
    if (!delivery) return jsonResponse({ error: 'Delivery order not found' }, 404);

    delivery.status = 'fulfilled';
    delivery.fulfilledBy = officerName;
    delivery.fulfilledById = officerId;
    delivery.fulfilledAt = new Date().toISOString();
    if (fulfillmentNote) delivery.fulfillmentNote = fulfillmentNote;
    await firestore.saveBseState(state);

    // Audit log
    await firestore.logAuditEvent({
      action: 'SHOP_ORDER_DELIVERED',
      officerId,
      officerName,
      targetId: delivery.discordId,
      targetName: delivery.serverNickname,
      reason: `Delivered ${delivery.itemTitle} to ${delivery.characterName || delivery.serverNickname}`,
      timestamp: new Date().toISOString()
    });

    return jsonResponse({ success: true, delivery });
  }

  // POST 1-Click Refund Shop Order
  if (path === 'deliver/refund' && request.method === 'POST') {
    const { orderId, refundReason } = body;
    const state = await firestore.getBseState();
    const delivery = state.deliveries?.[orderId];
    if (!delivery) return jsonResponse({ error: 'Delivery order not found' }, 404);

    if (delivery.status === 'refunded') {
      return jsonResponse({ error: 'Order was already refunded' }, 400);
    }

    delivery.status = 'refunded';
    delivery.refundedBy = officerName;
    delivery.refundedAt = new Date().toISOString();
    delivery.refundReason = refundReason || 'Refunded by officer';

    // Return Bones to member
    state.wallets = state.wallets || {};
    const wallet = state.wallets[delivery.discordId];
    if (wallet) {
      wallet.spendableBones = (wallet.spendableBones || 0) + delivery.costBones;
      wallet.updatedAt = new Date().toISOString();
    }

    // Restore item stock if limited
    const item = (state.shop || []).find(i => i.id === delivery.itemId);
    if (item && !item.unlimitedStock) {
      item.stock = (item.stock || 0) + 1;
    }

    await recordAuditLogAndSync(state, env, firestore, {
      action: 'SHOP_REFUND',
      officerId,
      officerName,
      targetId: delivery.discordId,
      targetName: delivery.serverNickname,
      amount: delivery.costBones,
      spendableBones: wallet ? wallet.spendableBones : null,
      reason: `Refunded ${delivery.itemTitle} (${orderId}): ${delivery.refundReason}`
    });

    return jsonResponse({ success: true, delivery, refundedBones: delivery.costBones });
  }

  // POST Award Bones
  if (path === 'award' && request.method === 'POST') {
    const { targetId, amount, reason } = body;
    const numAmount = Math.max(1, parseInt(amount, 10) || 0);

    const state = await firestore.getBseState();
    state.wallets = state.wallets || {};
    const wallet = state.wallets[targetId] || {
      discordId: targetId,
      spendableBones: 0,
      boneScore: 0
    };

    wallet.spendableBones = (wallet.spendableBones || 0) + numAmount;
    wallet.boneScore = (wallet.boneScore || 0) + numAmount;
    wallet.updatedAt = new Date().toISOString();
    state.wallets[targetId] = wallet;

    const targetName = wallet.serverNickname || wallet.globalName || wallet.username || targetId;

    await recordAuditLogAndSync(state, env, firestore, {
      action: 'AWARD',
      officerId,
      officerName,
      targetId,
      targetName,
      amount: numAmount,
      spendableBones: wallet.spendableBones,
      boneScore: wallet.boneScore,
      reason: reason || 'Guild contribution'
    });

    return jsonResponse({ success: true, wallet });
  }

  // POST Deduct Bones
  if (path === 'deduct' && request.method === 'POST') {
    const { targetId, amount, reason } = body;
    const numAmount = Math.max(1, parseInt(amount, 10) || 0);

    const state = await firestore.getBseState();
    state.wallets = state.wallets || {};
    const wallet = state.wallets[targetId] || {
      discordId: targetId,
      spendableBones: 0,
      boneScore: 0
    };

    wallet.spendableBones = Math.max(0, (wallet.spendableBones || 0) - numAmount);
    wallet.updatedAt = new Date().toISOString();
    state.wallets[targetId] = wallet;

    const targetName = wallet.serverNickname || wallet.globalName || wallet.username || targetId;

    await recordAuditLogAndSync(state, env, firestore, {
      action: 'DEDUCT',
      officerId,
      officerName,
      targetId,
      targetName,
      amount: -numAmount,
      spendableBones: wallet.spendableBones,
      boneScore: wallet.boneScore,
      reason: reason || 'Administrative adjustment'
    });

    return jsonResponse({ success: true, wallet });
  }

  // POST Member Balance Adjust / Ledger Correction (Spendable and/or Lifetime Bones)
  if (path === 'member/adjust' && request.method === 'POST') {
    const { targetId, spendableBones, boneScore, officerHidden, reason } = body;
    const state = await firestore.getBseState();
    state.wallets = state.wallets || {};
    const wallet = state.wallets[targetId] || {
      discordId: targetId,
      spendableBones: 0,
      boneScore: 0
    };

    const oldSpendable = wallet.spendableBones || 0;
    const oldScore = wallet.boneScore || 0;

    if (spendableBones !== undefined && spendableBones !== null) {
      wallet.spendableBones = Math.max(0, parseInt(spendableBones, 10) || 0);
    }
    if (boneScore !== undefined && boneScore !== null) {
      wallet.boneScore = Math.max(0, parseInt(boneScore, 10) || 0);
    }
    if (officerHidden !== undefined) {
      wallet.officerHidden = Boolean(officerHidden);
    }
    wallet.updatedAt = new Date().toISOString();
    state.wallets[targetId] = wallet;

    const targetName = wallet.serverNickname || wallet.globalName || wallet.username || targetId;
    const diff = (wallet.spendableBones || 0) - oldSpendable;

    const action = (spendableBones === undefined && boneScore !== undefined) ? 'LIFETIME_BONES_ADJUST' : 'LEDGER_CORRECTION';
    const detailMsg = reason || `Adjusted balances: Spendable ${oldSpendable} -> ${wallet.spendableBones}, Lifetime ${oldScore} -> ${wallet.boneScore}`;

    await recordAuditLogAndSync(state, env, firestore, {
      action,
      officerId,
      officerName,
      targetId,
      targetName,
      amount: diff,
      spendableBones: wallet.spendableBones,
      boneScore: wallet.boneScore,
      reason: detailMsg
    });

    return jsonResponse({ success: true, wallet });
  }

  // POST Toggle Member Hide (Officer Override)
  if (path === 'member/toggle-hide' && request.method === 'POST') {
    const { targetId, reason } = body;
    if (!targetId) return jsonResponse({ error: 'Missing targetId' }, 400);

    const state = await firestore.getBseState();
    state.wallets = state.wallets || {};
    const wallet = state.wallets[targetId];
    if (!wallet) return jsonResponse({ error: 'Member not found' }, 404);

    wallet.officerHidden = !wallet.officerHidden;
    wallet.updatedAt = new Date().toISOString();

    const targetName = wallet.serverNickname || wallet.globalName || wallet.username || targetId;
    const action = wallet.officerHidden ? 'MEMBER_HIDE' : 'MEMBER_UNHIDE';

    await recordAuditLogAndSync(state, env, firestore, {
      action,
      officerId,
      officerName,
      targetId,
      targetName,
      amount: 0,
      spendableBones: wallet.spendableBones || 0,
      boneScore: wallet.boneScore || 0,
      reason: reason || (wallet.officerHidden ? 'Officer hid member from public leaderboard' : 'Officer restored member to public leaderboard')
    });

    return jsonResponse({ success: true, officerHidden: wallet.officerHidden, wallet });
  }

  // POST Batch Award Bones (Raid & Event Multi-Award)
  if (path === 'batch-award' && request.method === 'POST') {
    const { targetIds, amount, reason, eventName } = body;
    if (!Array.isArray(targetIds) || targetIds.length === 0) {
      return jsonResponse({ error: 'targetIds array is required' }, 400);
    }
    const numAmount = Math.max(1, parseInt(amount, 10) || 0);

    const state = await firestore.getBseState();
    state.wallets = state.wallets || {};

    const awardedNames = [];
    for (const tid of targetIds) {
      const w = state.wallets[tid] || {
        discordId: tid,
        spendableBones: 0,
        boneScore: 0
      };
      w.spendableBones = (w.spendableBones || 0) + numAmount;
      w.boneScore = (w.boneScore || 0) + numAmount;
      w.updatedAt = new Date().toISOString();
      state.wallets[tid] = w;
      awardedNames.push(w.serverNickname || w.globalName || w.username || tid);
    }

    const eventPrefix = eventName ? `[${eventName}] ` : '';
    const fullReason = `${eventPrefix}${reason || 'Raid/Event participation reward'} (${targetIds.length} members awarded)`;

    await recordAuditLogAndSync(state, env, firestore, {
      action: 'BATCH_AWARD',
      officerId,
      officerName,
      targetId: targetIds.slice(0, 5).join(',') + (targetIds.length > 5 ? ` (+${targetIds.length - 5} more)` : ''),
      targetName: `${targetIds.length} Guild Members`,
      amount: numAmount,
      spendableBones: null,
      boneScore: null,
      reason: fullReason
    });

    return jsonResponse({
      success: true,
      awardedCount: targetIds.length,
      amountPerMember: numAmount,
      members: awardedNames
    });
  }

  // POST Sync Roster from Guild Discord Server
  if (path === 'sync-discord-roster' && request.method === 'POST') {
    if (!env.DISCORD_GUILD_ID || !env.DISCORD_BOT_TOKEN) {
      return jsonResponse({ error: 'Missing Discord Guild ID or Bot Token' }, 500);
    }

    const res = await fetch(`https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/members?limit=1000`, {
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
    });
    if (!res.ok) {
      return jsonResponse({ error: `Discord API error: ${res.status}` }, 502);
    }
    const rawMembers = await res.json();
    const members = rawMembers.filter(m => !m.user?.bot);

    const state = await firestore.getBseState();
    state.wallets = state.wallets || {};

    let newlyImported = 0;
    let updatedCount = 0;

    for (const m of members) {
      const uid = m.user.id;
      const existing = state.wallets[uid];
      if (existing) {
        existing.username = m.user.username;
        existing.globalName = m.user.global_name || m.user.username;
        existing.serverNickname = m.nick || existing.serverNickname || null;
        existing.avatarHash = m.user.avatar || null;
        existing.roles = m.roles || [];
        updatedCount++;
      } else {
        state.wallets[uid] = {
          discordId: uid,
          username: m.user.username,
          globalName: m.user.global_name || m.user.username,
          serverNickname: m.nick || null,
          avatarHash: m.user.avatar || null,
          roles: m.roles || [],
          spendableBones: 0,
          boneScore: 0,
          characters: [],
          primaryCharacter: null,
          guildNote: '',
          officerHidden: false,
          createdAt: new Date().toISOString()
        };
        newlyImported++;
      }
    }

    state.updatedAt = new Date().toISOString();

    await recordAuditLogAndSync(state, env, firestore, {
      action: 'ROSTER_DISCORD_SYNC',
      officerId,
      officerName,
      targetId: 'ALL',
      targetName: 'Guild Roster',
      amount: 0,
      spendableBones: null,
      boneScore: null,
      reason: `Synchronized ${members.length} Discord members (${newlyImported} new, ${updatedCount} refreshed)`
    });

    return jsonResponse({
      success: true,
      totalMembers: members.length,
      importedCount: newlyImported,
      updatedCount
    });
  }

  // POST Push Standings to Discord
  if (path === 'push-discord-standings' && request.method === 'POST') {
    const state = await firestore.getBseState();
    const ok = await pushStandingsToDiscord(env, firestore, state);
    return jsonResponse({ success: ok !== false, message: 'Standings pushed to Discord' });
  }

  // POST Create Bounty
  if (path === 'bounty/create' && request.method === 'POST') {
    const { title, rewardBones, description, category } = body;
    const state = await firestore.getBseState();
    const bounty = {
      id: `bounty_${Date.now()}`,
      title,
      rewardBones: Math.max(1, parseInt(rewardBones, 10) || 10),
      description: description || '',
      category: category || 'General',
      status: 'active',
      createdAt: new Date().toISOString()
    };
    state.bounties = state.bounties || [];
    state.bounties.push(bounty);
    await firestore.saveBseState(state);

    return jsonResponse({ success: true, bounty });
  }

  // POST Update Existing Bounty
  if (path === 'bounty/update' && request.method === 'POST') {
    const { bountyId, title, rewardBones, description, category, status } = body;
    const state = await firestore.getBseState();
    const bounty = (state.bounties || []).find(b => b.id === bountyId);
    if (!bounty) return jsonResponse({ error: 'Bounty not found' }, 404);

    if (title) bounty.title = title;
    if (rewardBones) bounty.rewardBones = Math.max(1, parseInt(rewardBones, 10));
    if (description !== undefined) bounty.description = description;
    if (category) bounty.category = category;
    if (status) bounty.status = status;
    bounty.updatedAt = new Date().toISOString();

    await firestore.saveBseState(state);
    return jsonResponse({ success: true, bounty });
  }

  // POST Delete Bounty
  if (path === 'bounty/delete' && request.method === 'POST') {
    const { bountyId } = body;
    const state = await firestore.getBseState();
    state.bounties = (state.bounties || []).filter(b => b.id !== bountyId);
    await firestore.saveBseState(state);
    return jsonResponse({ success: true });
  }

  // POST Create Shop Item
  if (path === 'shop/create' && request.method === 'POST') {
    const { title, costBones, description, category, stock, unlimitedStock, fulfillmentNotes } = body;
    const state = await firestore.getBseState();
    const item = {
      id: `shop_${Date.now()}`,
      title,
      costBones: Math.max(1, parseInt(costBones, 10) || 10),
      description: description || '',
      category: category || 'General',
      stock: parseInt(stock, 10) || 10,
      unlimitedStock: Boolean(unlimitedStock),
      fulfillmentNotes: fulfillmentNotes || '',
      enabled: true,
      createdAt: new Date().toISOString()
    };
    state.shop = state.shop || [];
    state.shop.push(item);
    await firestore.saveBseState(state);

    return jsonResponse({ success: true, item });
  }

  // POST Update Shop Item
  if (path === 'shop/update' && request.method === 'POST') {
    const { itemId, title, costBones, description, category, stock, unlimitedStock, fulfillmentNotes, enabled } = body;
    const state = await firestore.getBseState();
    const item = (state.shop || []).find(i => i.id === itemId);
    if (!item) return jsonResponse({ error: 'Item not found' }, 404);

    if (title) item.title = title;
    if (costBones) item.costBones = Math.max(1, parseInt(costBones, 10));
    if (description !== undefined) item.description = description;
    if (category) item.category = category;
    if (stock !== undefined) item.stock = parseInt(stock, 10);
    if (unlimitedStock !== undefined) item.unlimitedStock = Boolean(unlimitedStock);
    if (fulfillmentNotes !== undefined) item.fulfillmentNotes = fulfillmentNotes;
    if (enabled !== undefined) item.enabled = Boolean(enabled);
    item.updatedAt = new Date().toISOString();

    await firestore.saveBseState(state);
    return jsonResponse({ success: true, item });
  }

  // POST Update Officer Site Branding, Themes, Modules, & Ranks
  if (path === 'settings/officer' && request.method === 'POST') {
    const { branding, siteModules, theme, ranks } = body;
    const state = await firestore.getBseState();

    if (branding && typeof branding === 'object') {
      state.branding = { ...(state.branding || {}), ...branding };
    }
    if (siteModules && typeof siteModules === 'object') {
      state.siteModules = { ...(state.siteModules || {}), ...siteModules };
    }
    if (theme && typeof theme === 'object') {
      state.theme = { ...(state.theme || {}), ...theme };
    }
    if (Array.isArray(ranks)) {
      state.ranks = ranks.map((r, idx) => ({
        tier: typeof r.tier === 'number' ? r.tier : idx,
        title: String(r.title || 'Rank'),
        costBones: Math.max(0, parseInt(r.costBones, 10) || 0),
        icon: String(r.icon || ''),
        roleId: String(r.roleId || '')
      }));
    }

    state.updatedAt = new Date().toISOString();
    await firestore.saveBseState(state);

    await firestore.logAuditEvent({
      action: 'OFFICER_SETTINGS_UPDATE',
      officerId,
      officerName,
      reason: 'Published updated guild branding, themes, modules, or ranks',
      timestamp: new Date().toISOString()
    });

    return jsonResponse({
      success: true,
      branding: state.branding,
      siteModules: state.siteModules,
      theme: state.theme,
      ranks: state.ranks
    });
  }

  // POST Update FAQ Items
  if (path === 'settings/faq' && request.method === 'POST') {
    const { items } = body;
    if (!Array.isArray(items)) {
      return jsonResponse({ error: 'items must be an array' }, 400);
    }

    const state = await firestore.getBseState();
    state.siteModules = state.siteModules || {};
    state.siteModules.faq = state.siteModules.faq || { enabled: true, title: 'Rules & FAQ', order: 4 };
    state.siteModules.faq.items = items.map(item => ({
      q: String(item.q || '').trim(),
      a: String(item.a || '').trim()
    })).filter(item => item.q.length > 0);

    state.updatedAt = new Date().toISOString();
    await firestore.saveBseState(state);

    return jsonResponse({ success: true, faq: state.siteModules.faq });
  }

  // POST Delete Shop Item
  if (path === 'shop/delete' && request.method === 'POST') {
    const { itemId } = body;
    const state = await firestore.getBseState();
    state.shop = (state.shop || []).filter(i => i.id !== itemId);
    state.updatedAt = new Date().toISOString();
    await firestore.saveBseState(state);
    return jsonResponse({ success: true });
  }

  // POST Officer Edit Member Data (Balances, Public Guild Note, Characters)
  if (path === 'member/update' && request.method === 'POST') {
    const { targetId, spendableBones, boneScore, guildNote, characters, primaryCharacter } = body;
    if (!targetId) return jsonResponse({ error: 'Missing targetId' }, 400);

    const state = await firestore.getBseState();
    state.wallets = state.wallets || {};
    const wallet = state.wallets[targetId] || {
      discordId: targetId,
      username: 'Member',
      serverNickname: 'Member',
      spendableBones: 0,
      boneScore: 0
    };

    if (spendableBones !== undefined) wallet.spendableBones = Math.max(0, parseInt(spendableBones, 10) || 0);
    if (boneScore !== undefined) wallet.boneScore = Math.max(0, parseInt(boneScore, 10) || 0);
    if (typeof guildNote === 'string') wallet.guildNote = guildNote.trim();
    if (Array.isArray(characters)) wallet.characters = characters;
    if (primaryCharacter !== undefined) wallet.primaryCharacter = primaryCharacter;
    wallet.updatedAt = new Date().toISOString();
    state.wallets[targetId] = wallet;

    await firestore.saveBseState(state);

    await firestore.logAuditEvent({
      action: 'OFFICER_MEMBER_DATA_EDIT',
      officerId,
      officerName,
      targetId,
      reason: 'Officer updated member profile and ledger in Data Editor',
      timestamp: new Date().toISOString()
    });

    return jsonResponse({ success: true, wallet });
  }

  // POST Delete Member Record from Ledger
  if (path === 'member/delete' && request.method === 'POST') {
    const { targetId, reason } = body;
    if (!targetId) return jsonResponse({ error: 'Missing targetId' }, 400);

    const state = await firestore.getBseState();
    if (state.wallets && state.wallets[targetId]) {
      const oldWallet = state.wallets[targetId];
      const memberName = oldWallet.serverNickname || oldWallet.globalName || oldWallet.username || targetId;
      const spendable = oldWallet.spendableBones || 0;
      const score = oldWallet.boneScore || 0;

      delete state.wallets[targetId];
      state.updatedAt = new Date().toISOString();

      await recordAuditLogAndSync(state, env, firestore, {
        action: 'MEMBER_DELETE',
        officerId,
        officerName,
        targetId,
        targetName: memberName,
        amount: -spendable,
        spendableBones: 0,
        boneScore: 0,
        reason: reason ? `${reason} (Purged: ${spendable} Bones, ${score} Pts)` : `Purged from roster with ${spendable} Bones and ${score} Career Pts`
      });
    }

    return jsonResponse({ success: true });
  }

  // POST Delete Bounty Claim Record
  if (path === 'claim/delete' && request.method === 'POST') {
    const { claimId } = body;
    const state = await firestore.getBseState();
    if (state.claims && state.claims[claimId]) {
      delete state.claims[claimId];
      state.updatedAt = new Date().toISOString();
      await firestore.saveBseState(state);
    }
    return jsonResponse({ success: true });
  }

  // POST Delete Delivery Order Record
  if (path === 'deliver/delete' && request.method === 'POST') {
    const { orderId } = body;
    const state = await firestore.getBseState();
    if (state.deliveries && state.deliveries[orderId]) {
      delete state.deliveries[orderId];
      state.updatedAt = new Date().toISOString();
      await firestore.saveBseState(state);
    }
    return jsonResponse({ success: true });
  }

  // POST Update Announcement Banner
  if (path === 'settings/announcement' && request.method === 'POST') {
    const { enabled, text, type } = body;
    const state = await firestore.getBseState();
    state.branding = state.branding || {};
    state.branding.announcement = {
      enabled: Boolean(enabled),
      text: String(text || '').trim(),
      type: String(type || 'gold').trim()
    };
    state.updatedAt = new Date().toISOString();
    await firestore.saveBseState(state);
    return jsonResponse({ success: true, announcement: state.branding.announcement });
  }

  // POST Raw Central State Direct Override (Full Master Data Control)
  if (path === 'state/raw' && request.method === 'POST') {
    const { rawState } = body;
    if (!rawState || typeof rawState !== 'object') {
      return jsonResponse({ error: 'rawState must be a valid JSON object' }, 400);
    }

    // Ensure core keys exist
    rawState.wallets = rawState.wallets || {};
    rawState.bounties = Array.isArray(rawState.bounties) ? rawState.bounties : [];
    rawState.shop = Array.isArray(rawState.shop) ? rawState.shop : [];
    rawState.claims = rawState.claims || {};
    rawState.deliveries = rawState.deliveries || {};
    rawState.updatedAt = new Date().toISOString();

    await firestore.saveBseState(rawState);

    await firestore.logAuditEvent({
      action: 'OFFICER_RAW_STATE_APPLIED',
      officerId,
      officerName,
      reason: 'Officer published full raw database state',
      timestamp: new Date().toISOString()
    });

    return jsonResponse({ success: true, state: rawState });
  }

  return jsonResponse({ error: 'Endpoint not found' }, 404);
}

/**
 * Handle sync-standings triggered from Web Officer Panel
 */
async function handleSyncStandingsApi(request, env, firestore) {
  const session = await getSessionFromRequest(request, env);
  if (!session?.isOfficer) {
    return jsonResponse({ error: 'Forbidden: Officer role required' }, 403);
  }

  if (!env.DISCORD_STANDINGS_CHANNEL_ID || !env.DISCORD_BOT_TOKEN) {
    return jsonResponse({ error: 'Standings channel or Bot token not configured' }, 400);
  }

  const state = await firestore.getBseState();
  const channelId = env.DISCORD_STANDINGS_CHANNEL_ID;
  const token = env.DISCORD_BOT_TOKEN;

  const members = Object.values(state.wallets || {});
  members.sort((a, b) => (b.boneScore || b.spendableBones || 0) - (a.boneScore || a.spendableBones || 0));
  const top10 = members.slice(0, 10).map(m => ({
    ...m,
    rankTitle: resolveRank(m.boneScore, state.ranks).title
  }));

  const lbEmbed = buildLeaderboardEmbed(top10);
  const bountiesEmbed = buildBountiesEmbed(state.bounties || []);
  const shopEmbed = buildShopEmbed(state.shop || []);
  const config = state.config || {};

  try {
    if (config.standingsMessageId) {
      await editChannelMessage(channelId, config.standingsMessageId, { embeds: [lbEmbed] }, token);
    } else {
      const msg = await sendChannelMessage(channelId, { embeds: [lbEmbed] }, token);
      config.standingsMessageId = msg.id;
    }

    if (config.bountiesMessageId) {
      await editChannelMessage(channelId, config.bountiesMessageId, { embeds: [bountiesEmbed] }, token);
    } else {
      const msg = await sendChannelMessage(channelId, { embeds: [bountiesEmbed] }, token);
      config.bountiesMessageId = msg.id;
    }

    if (config.shopMessageId) {
      await editChannelMessage(channelId, config.shopMessageId, { embeds: [shopEmbed] }, token);
    } else {
      const msg = await sendChannelMessage(channelId, { embeds: [shopEmbed] }, token);
      config.shopMessageId = msg.id;
    }

    state.config = config;
    await firestore.saveBseState(state);

    return jsonResponse({ success: true, message: 'Standings embeds refreshed in-place' });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

/**
 * Session Token Signing & Verification (HMAC SHA-256)
 */
async function signSessionToken(payload, secret) {
  const enc = new TextEncoder();
  const data = JSON.stringify(payload);
  const b64Data = Buffer.from(data).toString('base64url');
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(b64Data));
  const b64Sig = Buffer.from(sig).toString('base64url');
  return `${b64Data}.${b64Sig}`;
}

async function verifySessionToken(token, secret) {
  if (!token || !token.includes('.')) return null;
  const [b64Data, b64Sig] = token.split('.');
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      Buffer.from(b64Sig, 'base64url'),
      enc.encode(b64Data)
    );
    if (!valid) return null;
    const payload = JSON.parse(Buffer.from(b64Data, 'base64url').toString('utf8'));
    // Check 7-day expiration
    if (Date.now() - payload.issuedAt > 7 * 86400 * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

async function getSessionFromRequest(request, env) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(/bse_session=([^;]+)/);
  if (!match) return null;
  return verifySessionToken(match[1], env.SESSION_SECRET || 'bse_secret_key');
}

/**
 * JSON Response Helper with CORS
 */
function jsonResponse(data, status = 200, customHeaders = new Headers()) {
  customHeaders.set('Content-Type', 'application/json');
  customHeaders.set('Access-Control-Allow-Origin', '*');
  customHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  customHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return new Response(JSON.stringify(data), { status, headers: customHeaders });
}

function handleCors() {
  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return new Response(null, { status: 204, headers });
}
