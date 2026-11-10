import nacl from 'tweetnacl';
import { resolveRank } from './commands.js';

/**
 * Verifies that an incoming HTTP request originated from Discord using Ed25519.
 * @param {string} rawBody - Raw text body of the request
 * @param {string} signature - Value of X-Signature-Ed25519 header
 * @param {string} timestamp - Value of X-Signature-Timestamp header
 * @param {string} publicKey - Application public key from Discord Developer Portal
 * @returns {boolean}
 */
export function verifyDiscordSignature(rawBody, signature, timestamp, publicKey) {
  if (!signature || !timestamp || !publicKey) return false;
  try {
    const isVerified = nacl.sign.detached.verify(
      Buffer.from(timestamp + rawBody),
      Buffer.from(signature, 'hex'),
      Buffer.from(publicKey, 'hex')
    );
    return isVerified;
  } catch (err) {
    console.error('Signature verification error:', err);
    return false;
  }
}

/**
 * Discord Interaction Types
 */
export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5
};

/**
 * Discord Interaction Callback Types
 */
export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
  APPLICATION_COMMAND_AUTOCOMPLETE_RESULT: 8,
  MODAL: 9
};

/**
 * Discord Component Types
 */
export const ComponentType = {
  ACTION_ROW: 1,
  BUTTON: 2,
  STRING_SELECT: 3,
  TEXT_INPUT: 4
};

/**
 * Discord Button Styles
 */
export const ButtonStyle = {
  PRIMARY: 1,   // Blurple
  SECONDARY: 2, // Grey
  SUCCESS: 3,   // Green
  DANGER: 4,    // Red
  LINK: 5       // URL
};

const DISCORD_API_BASE = 'https://discord.com/api/v10';

/**
 * Makes an authenticated request to the Discord REST API.
 */
async function discordFetch(endpoint, options = {}, botToken) {
  if (!botToken) {
    throw new Error('Missing DISCORD_BOT_TOKEN for Discord REST API call');
  }
  const url = `${DISCORD_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bot ${botToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord API error [${response.status}] ${endpoint}: ${errorText}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

/**
 * Send a message to a Discord channel
 */
export async function sendChannelMessage(channelId, payload, botToken) {
  return discordFetch(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify(payload)
  }, botToken);
}

/**
 * Edit an existing message in a Discord channel
 */
export async function editChannelMessage(channelId, messageId, payload, botToken) {
  return discordFetch(`/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  }, botToken);
}

/**
 * Fetch a guild member
 */
export async function getGuildMember(guildId, userId, botToken) {
  try {
    return await discordFetch(`/guilds/${guildId}/members/${userId}`, { method: 'GET' }, botToken);
  } catch (err) {
    console.warn(`Could not fetch guild member ${userId}:`, err.message);
    return null;
  }
}

/**
 * Assign a role to a guild member
 */
export async function addGuildMemberRole(guildId, userId, roleId, botToken) {
  if (!roleId) return false;
  try {
    await discordFetch(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
      method: 'PUT'
    }, botToken);
    return true;
  } catch (err) {
    console.error(`Failed to assign role ${roleId} to user ${userId}:`, err);
    return false;
  }
}

/**
 * Search guild members for autocomplete
 */
export async function searchGuildMembers(guildId, query = '', limit = 10, botToken) {
  try {
    const q = encodeURIComponent(query);
    return await discordFetch(`/guilds/${guildId}/members/search?query=${q}&limit=${limit}`, {
      method: 'GET'
    }, botToken);
  } catch (err) {
    console.error('Member search error:', err);
    return [];
  }
}

/**
 * Palette colors for embeds
 */
export const Colors = {
  GOLD: 0xD4AF37,
  AMBER: 0xE5A93B,
  DARK_GOLD: 0xB8860B,
  GREEN: 0x2ECC71,
  RED: 0xE74C3C,
  BLUE: 0x3498DB,
  DARK: 0x1A1815
};

/**
 * Build rich wallet profile embed
 */
export function buildWalletEmbed(userData, rankInfo) {
  const name = userData.serverNickname || userData.globalName || userData.username || 'Unknown Member';
  const handle = userData.username ? `@${userData.username}` : '';
  const spendable = userData.spendableBones ?? 0;
  const boneScore = userData.boneScore ?? spendable;
  const rankTitle = rankInfo?.title || 'Initiate';
  const rankIcon = rankInfo?.icon || '🪙';
  const charDisplay = userData.primaryCharacter ? `\n⚔️ **Primary Character:** \`${userData.primaryCharacter}\`` : '';

  const fields = [
    { name: '💰 Spendable Bones', value: `**${spendable.toLocaleString()}** Bones`, inline: true },
    { name: '🏆 Bone Score', value: `**${boneScore.toLocaleString()}** Pts`, inline: true },
    { name: '🎖️ Prestige Rank', value: `**${rankTitle}** (Tier ${rankInfo?.tier ?? 0})`, inline: true }
  ];

  if (userData.primaryCharacter) {
    fields.push({ name: '⚔️ Primary Character', value: `**${userData.primaryCharacter}**`, inline: true });
  }

  if (userData.guildNote) {
    fields.push({ name: '📜 Guild Note', value: userData.guildNote, inline: false });
  }

  return {
    title: `${rankIcon} Black Sands Wallet — ${name}`,
    description: `${handle ? `*${handle}*` : ''}${charDisplay}`,
    color: Colors.GOLD,
    fields,
    footer: { text: 'Black Sands Exchange • bse.teasy2ez.win' },
    timestamp: new Date().toISOString()
  };
}

/**
 * Build Leaderboard embed (Top 10)
 */
export function buildLeaderboardEmbed(topMembers = []) {
  let description = '';
  if (!topMembers.length) {
    description = '*No member records found yet. Complete bounties to get on the board!*';
  } else {
    description = topMembers.map((m, idx) => {
      const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `\`#${idx + 1}\``;
      const name = m.serverNickname || m.globalName || m.username || 'Unknown';
      const handle = m.username ? `(@${m.username})` : '';
      const charPart = m.primaryCharacter ? ` [${m.primaryCharacter}]` : '';
      const spendable = (m.spendableBones || 0).toLocaleString();
      const score = (m.boneScore || 0).toLocaleString();
      const rank = m.rankTitle || 'Initiate';
      return `${medal} **${name}**${charPart} ${handle} — **${spendable}** Spendable Bones (${score} Score) • *${rank}*`;
    }).join('\n');
  }

  return {
    title: '🏆 Black Sands Exchange — Top Roster Standings',
    description,
    color: Colors.GOLD,
    footer: { text: 'Live standings updated in real time • bse.teasy2ez.win' },
    timestamp: new Date().toISOString()
  };
}

/**
 * Build Active Bounties embed
 */
export function buildBountiesEmbed(bounties = []) {
  const active = bounties.filter(b => b.status !== 'archived' && b.status !== 'completed');
  let description = '';

  if (!active.length) {
    description = '*No active bounties posted right now. Check back soon for new guild tasks!*';
  } else {
    description = active.map(b => {
      const reward = (b.rewardBones || 0).toLocaleString();
      const desc = b.description ? `\n> ${b.description}` : '';
      return `📜 **${b.title}** (ID: \`${b.id}\`)\n💰 **+${reward} Bones**${desc}`;
    }).join('\n\n');
  }

  return {
    title: '📜 Black Sands Bounty Board',
    description: `${description}\n\n*Submit claims via \`/claim <bounty_id> <proof_url>\` or on the web portal!*`,
    color: Colors.AMBER,
    footer: { text: 'Black Sands Exchange • bse.teasy2ez.win' },
    timestamp: new Date().toISOString()
  };
}

/**
 * Build Shop Catalog embed
 */
export function buildShopEmbed(items = []) {
  const available = items.filter(i => i.enabled !== false);
  let description = '';

  if (!available.length) {
    description = '*The Exchange Shop is currently restocking. Check back soon!*';
  } else {
    description = available.map(item => {
      const cost = (item.costBones || 0).toLocaleString();
      const stock = item.unlimitedStock ? '∞ In Stock' : (item.stock > 0 ? `${item.stock} Remaining` : '**Sold Out**');
      const desc = item.description ? `\n> ${item.description}` : '';
      return `🏷️ **${item.title}** (ID: \`${item.id}\`)\n🪙 **${cost} Bones** • *${stock}*${desc}`;
    }).join('\n\n');
  }

  return {
    title: '⚖️ Black Sands Exchange Shop',
    description: `${description}\n\n*Purchase items using \`/buy <item_id>\` or at bse.teasy2ez.win*`,
    color: Colors.DARK_GOLD,
    footer: { text: 'Black Sands Exchange • bse.teasy2ez.win' },
    timestamp: new Date().toISOString()
  };
}

/**
 * Build Interactive Officer Claim Review Card
 */
export function buildBountyClaimReviewMessage(claim, bounty, user) {
  const memberName = user?.serverNickname || user?.globalName || user?.username || claim.discordUsername || 'Member';
  const handle = user?.username ? `@${user.username}` : (claim.discordUsername ? `@${claim.discordUsername}` : '');
  const reward = bounty?.rewardBones || claim.rewardBones || 0;
  const character = claim.characterName || user?.primaryCharacter || 'Unspecified';

  const embed = {
    title: `🛡️ Bounty Claim Submitted: ${bounty?.title || 'Unknown Bounty'}`,
    description: `Submitted by **${memberName}** ${handle ? `(${handle})` : ''}\nClaim ID: \`${claim.id}\``,
    color: Colors.BLUE,
    fields: [
      { name: '⚔️ In-Game Character', value: `**${character}**`, inline: true },
      { name: '💰 Reward', value: `**+${reward.toLocaleString()}** Bones`, inline: true },
      { name: '🔗 Proof Link', value: claim.proofUrl ? `[View Proof](${claim.proofUrl})` : '*No link provided*', inline: true },
      { name: '📝 Member Note', value: claim.notes || '*No additional notes provided*', inline: false }
    ],
    footer: { text: 'Officer Review • 1-Click Approval' },
    timestamp: new Date().toISOString()
  };

  if (claim.proofUrl && /\.(png|jpe?g|webp|gif)$/i.test(claim.proofUrl.split('?')[0])) {
    embed.image = { url: claim.proofUrl };
  }

  const components = [
    {
      type: ComponentType.ACTION_ROW,
      components: [
        {
          type: ComponentType.BUTTON,
          custom_id: `bounty_approve:${claim.id}`,
          label: `Approve (+${reward} Bones)`,
          style: ButtonStyle.SUCCESS,
          emoji: { name: '✅' }
        },
        {
          type: ComponentType.BUTTON,
          custom_id: `bounty_deny:${claim.id}`,
          label: 'Deny Claim',
          style: ButtonStyle.DANGER,
          emoji: { name: '❌' }
        }
      ]
    }
  ];

  return { embeds: [embed], components };
}

/**
 * Build Interactive Officer Shop Delivery Ticket
 */
export function buildShopDeliveryReviewMessage(delivery, item, user) {
  const memberName = user?.serverNickname || user?.globalName || user?.username || delivery.discordUsername || 'Member';
  const handle = user?.username ? `@${user.username}` : '';
  const cost = item?.costBones || delivery.costBones || 0;
  const targetChar = delivery.characterName || user?.primaryCharacter || 'Check with member';

  const embed = {
    title: `📦 Shop Purchase Delivery Required: ${item?.title || 'Unknown Item'}`,
    description: `Purchased by **${memberName}** ${handle ? `(${handle})` : ''}\nOrder ID: \`${delivery.id}\``,
    color: Colors.AMBER,
    fields: [
      { name: '🏷️ Item', value: item?.title || 'Item', inline: true },
      { name: '🪙 Cost Paid', value: `${cost.toLocaleString()} Bones`, inline: true },
      { name: '📬 Send In-Game To', value: `**${targetChar}**`, inline: true },
      { name: '📅 Order Date', value: new Date(delivery.createdAt || Date.now()).toLocaleDateString(), inline: true },
      { name: '📝 Delivery Instructions', value: item?.fulfillmentNotes || 'Deliver item/perk in-game or assign guild rank.' }
    ],
    footer: { text: 'Officer Delivery Backlog' },
    timestamp: new Date().toISOString()
  };

  const components = [
    {
      type: ComponentType.ACTION_ROW,
      components: [
        {
          type: ComponentType.BUTTON,
          custom_id: `shop_deliver:${delivery.id}`,
          label: 'Mark Delivered',
          style: ButtonStyle.SUCCESS,
          emoji: { name: '📦' }
        }
      ]
    }
  ];

  return { embeds: [embed], components };
}

/**
 * Record a transaction entry onto bseState.auditLog (preserving last 300)
 */
export function recordTransaction(state, entry) {
  state.auditLog = state.auditLog || [];
  const logItem = {
    id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    action: entry.action,
    officerId: entry.officerId || null,
    officerName: entry.officerName || 'System',
    targetId: entry.targetId || null,
    targetName: entry.targetName || 'Member',
    amount: entry.amount !== undefined ? entry.amount : 0,
    spendableBones: entry.spendableBones !== undefined ? entry.spendableBones : null,
    boneScore: entry.boneScore !== undefined ? entry.boneScore : null,
    reason: entry.reason || '—'
  };

  state.auditLog.push(logItem);
  if (state.auditLog.length > 300) {
    state.auditLog = state.auditLog.slice(-300);
  }
  return logItem;
}

/**
 * Automatically update in-place leaderboard, bounties, and shop embeds in Discord
 */
export async function pushStandingsToDiscord(env, firestore, state) {
  if (!env.DISCORD_STANDINGS_CHANNEL_ID || !env.DISCORD_BOT_TOKEN) return false;
  try {
    const channelId = env.DISCORD_STANDINGS_CHANNEL_ID;
    const token = env.DISCORD_BOT_TOKEN;

    const activeMembers = Object.values(state.wallets || {}).filter(m => {
      if (m.officerHidden) return false;
      const total = (m.boneScore || 0) + (m.spendableBones || 0);
      return total > 0;
    });
    activeMembers.sort((a, b) => {
      const diffSpendable = (b.spendableBones || 0) - (a.spendableBones || 0);
      if (diffSpendable !== 0) return diffSpendable;
      return (b.boneScore || 0) - (a.boneScore || 0);
    });
    const top10 = activeMembers.slice(0, 10).map(m => ({
      ...m,
      rankTitle: resolveRank(m.boneScore, state.ranks, m.rankTier).title
    }));

    const lbEmbed = buildLeaderboardEmbed(top10);
    const bountiesEmbed = buildBountiesEmbed(state.bounties || []);
    const shopEmbed = buildShopEmbed(state.shop || []);
    const config = state.config || {};

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
    return true;
  } catch (err) {
    console.error('Error auto-syncing standings to Discord:', err);
    return false;
  }
}

/**
 * Log transaction to central state, immutable Firestore log, and push sync to Discord
 */
export async function recordAuditLogAndSync(state, env, firestore, entry) {
  const logItem = recordTransaction(state, entry);
  await firestore.saveBseState(state);

  try {
    await firestore.logAuditEvent(logItem);
  } catch (err) {
    console.error('Failed to log audit event to Firestore:', err);
  }

  try {
    await pushStandingsToDiscord(env, firestore, state);
  } catch (err) {
    console.error('Failed auto-syncing standings to Discord:', err);
  }

  // Optional feed notification
  if (entry.notifyFeed !== false && env.DISCORD_FEED_CHANNEL_ID && env.DISCORD_BOT_TOKEN) {
    try {
      if (entry.action === 'AWARD') {
        await sendChannelMessage(env.DISCORD_FEED_CHANNEL_ID, {
          embeds: [{
            title: 'Bones Awarded',
            description: `**${entry.targetName}** was awarded **+${entry.amount} Bones** by **${entry.officerName}**!\n> *${entry.reason}*`,
            color: Colors.GREEN,
            fields: [
              { name: 'Spendable Balance', value: `${entry.spendableBones ?? '—'} Bones`, inline: true },
              { name: 'Bone Score', value: `${entry.boneScore ?? '—'} Pts`, inline: true }
            ],
            timestamp: new Date().toISOString()
          }]
        }, env.DISCORD_BOT_TOKEN);
      } else if (entry.action === 'DEDUCT') {
        await sendChannelMessage(env.DISCORD_FEED_CHANNEL_ID, {
          embeds: [{
            title: 'Bones Deducted',
            description: `**${entry.targetName}** had **${entry.amount} Bones** deducted by **${entry.officerName}**.\n> *${entry.reason}*`,
            color: Colors.RED,
            fields: [
              { name: 'Remaining Balance', value: `${entry.spendableBones ?? '—'} Bones`, inline: true }
            ],
            timestamp: new Date().toISOString()
          }]
        }, env.DISCORD_BOT_TOKEN);
      } else if (entry.action === 'LEDGER_CORRECTION') {
        await sendChannelMessage(env.DISCORD_FEED_CHANNEL_ID, {
          embeds: [{
            title: 'Ledger Balance Corrected',
            description: `Officer **${entry.officerName}** adjusted ledger for **${entry.targetName}**.\n> *${entry.reason}*`,
            color: Colors.AMBER,
            fields: [
              { name: 'New Spendable', value: `${entry.spendableBones ?? '—'} Bones`, inline: true },
              { name: 'New Career Score', value: `${entry.boneScore ?? '—'} Pts`, inline: true }
            ],
            timestamp: new Date().toISOString()
          }]
        }, env.DISCORD_BOT_TOKEN);
      } else if (entry.action === 'MEMBER_DELETE') {
        await sendChannelMessage(env.DISCORD_FEED_CHANNEL_ID, {
          embeds: [{
            title: 'Member Purged from Roster',
            description: `Officer **${entry.officerName}** removed **${entry.targetName}** from the guild roster.\n> *${entry.reason}*`,
            color: Colors.DARK_RED,
            timestamp: new Date().toISOString()
          }]
        }, env.DISCORD_BOT_TOKEN);
      }
    } catch (err) {
      console.error('Feed broadcast error:', err);
    }
  }

  return logItem;
}
