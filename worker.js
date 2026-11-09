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
  Colors
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
      if ((permissions & ADMINISTRATOR) === ADMINISTRATOR || (permissions & MANAGE_GUILD) === MANAGE_GUILD) {
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
    boneScore: 0
  };

  const rank = resolveRank(wallet.boneScore, state.ranks);

  return jsonResponse({
    authenticated: true,
    user: {
      ...session,
      spendableBones: wallet.spendableBones || 0,
      boneScore: wallet.boneScore || 0,
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
      // Fallback search local wallets
      const state = await firestore.getBseState();
      const results = Object.values(state.wallets || {})
        .filter(w => (w.username || '').toLowerCase().includes(query.toLowerCase()) ||
                     (w.serverNickname || '').toLowerCase().includes(query.toLowerCase()))
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
  const officerKeyValid = body.officerKey && body.officerKey === (env.OFFICER_PASSCODE || 'blacksands2026');
  const isAuthorizedOfficer = (session && session.isOfficer) || officerKeyValid;

  // POST Submit Bounty Claim (Member or Officer)
  if (path === 'claim' && request.method === 'POST') {
    const { bountyId, proofUrl, notes, discordId, discordUsername } = body;
    const targetId = session?.id || discordId;
    const targetUsername = session?.username || discordUsername || 'Anonymous';

    if (!targetId || !bountyId) {
      return jsonResponse({ error: 'Missing bountyId or discord identity' }, 400);
    }

    const state = await firestore.getBseState();
    const bounty = (state.bounties || []).find(b => b.id === bountyId);
    if (!bounty) return jsonResponse({ error: 'Bounty not found' }, 404);

    const claimId = `claim_${Date.now()}_${targetId.slice(-4)}`;
    const claim = {
      id: claimId,
      bountyId: bounty.id,
      bountyTitle: bounty.title,
      rewardBones: bounty.rewardBones,
      discordId: targetId,
      discordUsername: targetUsername,
      serverNickname: session?.serverNickname || targetUsername,
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
        const reviewMsg = buildBountyClaimReviewMessage(claim, bounty, claim);
        await sendChannelMessage(env.DISCORD_OFFICER_CHANNEL_ID, reviewMsg, env.DISCORD_BOT_TOKEN);
      } catch (err) {
        console.error('Failed to notify #officer-exchange:', err);
      }
    }

    return jsonResponse({ success: true, claim });
  }

  // POST Purchase Item or Rank Promotion
  if (path === 'buy' && request.method === 'POST') {
    const { itemId, discordId } = body;
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

    const orderId = `order_${Date.now()}_${targetId.slice(-4)}`;
    const delivery = {
      id: orderId,
      itemId: item.id,
      itemTitle: item.title,
      costBones: item.costBones,
      discordId: targetId,
      discordUsername: session?.username || wallet.username || 'Member',
      serverNickname: session?.serverNickname || wallet.serverNickname || wallet.username,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    state.deliveries = state.deliveries || {};
    state.deliveries[orderId] = delivery;

    await firestore.saveBseState(state);

    // Audit log
    await firestore.logAuditEvent({
      action: 'SHOP_PURCHASE',
      targetId,
      targetName: delivery.serverNickname,
      amount: -item.costBones,
      reason: `Purchased ${item.title} (Order: ${orderId})`,
      timestamp: new Date().toISOString()
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
        await sendChannelMessage(env.DISCORD_FEED_CHANNEL_ID, {
          embeds: [{
            title: '🛒 Shop Purchase Receipt',
            description: `**${delivery.serverNickname}** purchased **${item.title}** for **${item.costBones}** Bones!`,
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

  // --- Officer Protected Endpoints ---
  if (!isAuthorizedOfficer) {
    return jsonResponse({ error: 'Unauthorized: Officer permissions required' }, 403);
  }

  const officerName = session?.serverNickname || session?.username || 'Officer (Web)';
  const officerId = session?.id || 'officer_key';

  // POST Approve Claim
  if (path === 'claim/approve' && request.method === 'POST') {
    const { claimId } = body;
    const state = await firestore.getBseState();
    const claim = state.claims?.[claimId];
    if (!claim) return jsonResponse({ error: 'Claim not found' }, 404);

    claim.status = 'approved';
    claim.reviewedBy = officerName;
    claim.reviewedAt = new Date().toISOString();

    const reward = claim.rewardBones || 0;
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

    await firestore.saveBseState(state);

    // Audit log
    await firestore.logAuditEvent({
      action: 'BOUNTY_CLAIM_APPROVED_WEB',
      officerId,
      officerName,
      targetId: claim.discordId,
      targetName: claim.serverNickname,
      amount: reward,
      reason: `Approved claim ${claimId} (${claim.bountyTitle})`,
      timestamp: new Date().toISOString()
    });

    return jsonResponse({ success: true, claim, wallet });
  }

  // POST Deny Claim
  if (path === 'claim/deny' && request.method === 'POST') {
    const { claimId } = body;
    const state = await firestore.getBseState();
    const claim = state.claims?.[claimId];
    if (!claim) return jsonResponse({ error: 'Claim not found' }, 404);

    claim.status = 'denied';
    claim.reviewedBy = officerName;
    claim.reviewedAt = new Date().toISOString();
    await firestore.saveBseState(state);

    return jsonResponse({ success: true, claim });
  }

  // POST Mark Order Delivered
  if (path === 'deliver' && request.method === 'POST') {
    const { orderId } = body;
    const state = await firestore.getBseState();
    const delivery = state.deliveries?.[orderId];
    if (!delivery) return jsonResponse({ error: 'Delivery order not found' }, 404);

    delivery.status = 'fulfilled';
    delivery.fulfilledBy = officerName;
    delivery.fulfilledAt = new Date().toISOString();
    await firestore.saveBseState(state);

    return jsonResponse({ success: true, delivery });
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

    await firestore.saveBseState(state);

    // Audit log
    await firestore.logAuditEvent({
      action: 'OFFICER_AWARD_WEB',
      officerId,
      officerName,
      targetId,
      amount: numAmount,
      reason: reason || 'Guild contribution',
      timestamp: new Date().toISOString()
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

    await firestore.saveBseState(state);

    return jsonResponse({ success: true, wallet });
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

  // POST Delete Shop Item
  if (path === 'shop/delete' && request.method === 'POST') {
    const { itemId } = body;
    const state = await firestore.getBseState();
    state.shop = (state.shop || []).filter(i => i.id !== itemId);
    await firestore.saveBseState(state);
    return jsonResponse({ success: true });
  }

  return jsonResponse({ error: 'Endpoint not found' }, 404);
}

/**
 * Handle sync-standings triggered from Web Officer Panel
 */
async function handleSyncStandingsApi(request, env, firestore) {
  const session = await getSessionFromRequest(request, env);
  let body = {};
  try { body = await request.json(); } catch {}
  const officerKeyValid = body.officerKey && body.officerKey === (env.OFFICER_PASSCODE || 'blacksands2026');
  if (!session?.isOfficer && !officerKeyValid) {
    return jsonResponse({ error: 'Unauthorized' }, 403);
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
