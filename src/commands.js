import {
  InteractionResponseType,
  Colors,
  buildWalletEmbed,
  buildLeaderboardEmbed,
  buildBountiesEmbed,
  buildShopEmbed,
  buildBountyClaimReviewMessage,
  buildShopDeliveryReviewMessage,
  sendChannelMessage,
  editChannelMessage,
  addGuildMemberRole,
  recordAuditLogAndSync
} from './discord.js';

/**
 * Check if the member calling the command is an authorized Officer
 */
export function isOfficer(interaction, env) {
  const member = interaction.member;
  if (!member) return false;

  // Check Discord Permission bitfield: ADMINISTRATOR (0x8) or MANAGE_GUILD (0x20)
  const permissions = BigInt(member.permissions || '0');
  const ADMINISTRATOR = 0x8n;
  const MANAGE_GUILD = 0x20n;
  if ((permissions & ADMINISTRATOR) === ADMINISTRATOR || (permissions & MANAGE_GUILD) === MANAGE_GUILD) {
    return true;
  }

  // Check Officer Role ID match
  if (env.DISCORD_OFFICER_ROLE_ID && Array.isArray(member.roles)) {
    if (member.roles.includes(env.DISCORD_OFFICER_ROLE_ID)) {
      return true;
    }
  }

  return false;
}

/**
 * Resolve rank metadata from Bone Score or Rank Tier
 */
export function resolveRank(boneScore = 0, ranks = []) {
  if (!ranks.length) {
    return { tier: 0, title: 'Initiate', icon: '🪙' };
  }
  // Sort ranks ascending by cost/tier
  const sorted = [...ranks].sort((a, b) => (a.tier || 0) - (b.tier || 0));
  let currentRank = sorted[0];
  for (const r of sorted) {
    if (boneScore >= (r.costBones || 0)) {
      currentRank = r;
    }
  }
  return currentRank;
}

/**
 * Main Slash Commands Router
 */
export async function handleApplicationCommand(interaction, env, firestore) {
  const { name, options } = interaction.data;
  const opts = {};
  if (Array.isArray(options)) {
    for (const opt of options) {
      opts[opt.name] = opt.value;
    }
  }

  switch (name) {
    case 'bones':
      return handleBonesCommand(interaction, opts, env, firestore);

    case 'leaderboard':
      return handleLeaderboardCommand(interaction, env, firestore);

    case 'bounties':
      return handleBountiesCommand(interaction, env, firestore);

    case 'shop':
      return handleShopCommand(interaction, env, firestore);

    case 'buy':
      return handleBuyCommand(interaction, opts, env, firestore);

    case 'claim':
      return handleClaimCommand(interaction, opts, env, firestore);

    case 'award':
      return handleAwardCommand(interaction, opts, env, firestore);

    case 'deduct':
      return handleDeductCommand(interaction, opts, env, firestore);

    case 'sync-standings':
      return handleSyncStandingsCommand(interaction, env, firestore);

    case 'bounty':
      return handleBountySubcommands(interaction, interaction.data.options, env, firestore);

    default:
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: `Unknown command \`/${name}\``, flags: 64 }
      };
  }
}

/**
 * /bones [user]
 */
async function handleBonesCommand(interaction, opts, env, firestore) {
  const targetUserId = opts.user || interaction.member?.user?.id || interaction.user?.id;
  const state = await firestore.getBseState();
  const wallet = state.wallets?.[targetUserId] || {
    discordId: targetUserId,
    username: targetUserId === interaction.member?.user?.id ? interaction.member?.user?.username : 'Unknown Member',
    serverNickname: targetUserId === interaction.member?.user?.id ? (interaction.member?.nick || interaction.member?.user?.global_name) : null,
    spendableBones: 0,
    boneScore: 0
  };

  const rank = resolveRank(wallet.boneScore, state.ranks);
  const embed = buildWalletEmbed(wallet, rank);

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { embeds: [embed] }
  };
}

/**
 * /leaderboard
 */
async function handleLeaderboardCommand(interaction, env, firestore) {
  const state = await firestore.getBseState();
  const members = Object.values(state.wallets || {});
  members.sort((a, b) => (b.boneScore || b.spendableBones || 0) - (a.boneScore || a.spendableBones || 0));
  const top10 = members.slice(0, 10).map(m => ({
    ...m,
    rankTitle: resolveRank(m.boneScore, state.ranks).title
  }));

  const embed = buildLeaderboardEmbed(top10);
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { embeds: [embed] }
  };
}

/**
 * /bounties
 */
async function handleBountiesCommand(interaction, env, firestore) {
  const state = await firestore.getBseState();
  const embed = buildBountiesEmbed(state.bounties || []);
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { embeds: [embed] }
  };
}

/**
 * /shop
 */
async function handleShopCommand(interaction, env, firestore) {
  const state = await firestore.getBseState();
  const embed = buildShopEmbed(state.shop || []);
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { embeds: [embed] }
  };
}

/**
 * /claim <bounty_id> <proof_url> [notes]
 */
async function handleClaimCommand(interaction, opts, env, firestore) {
  const caller = interaction.member?.user || interaction.user;
  const bountyId = opts.bounty_id;
  const proofUrl = opts.proof_url;
  const notes = opts.notes || '';

  const state = await firestore.getBseState();
  const bounty = (state.bounties || []).find(b => b.id.toLowerCase() === bountyId.toLowerCase());

  if (!bounty || bounty.status === 'archived') {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `❌ Bounty with ID \`${bountyId}\` was not found or is no longer active.`, flags: 64 }
    };
  }

  const wallet = state.wallets?.[caller.id];

  // Create claim entry
  const claimId = `claim_${Date.now()}_${caller.id.slice(-4)}`;
  const claim = {
    id: claimId,
    bountyId: bounty.id,
    bountyTitle: bounty.title,
    rewardBones: bounty.rewardBones,
    discordId: caller.id,
    discordUsername: caller.username,
    serverNickname: interaction.member?.nick || caller.global_name || caller.username,
    characterName: wallet?.primaryCharacter || null,
    proofUrl,
    notes,
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  state.claims = state.claims || {};
  state.claims[claimId] = claim;
  await firestore.saveBseState(state);

  // Send interactive review card to #officer-exchange
  if (env.DISCORD_OFFICER_CHANNEL_ID && env.DISCORD_BOT_TOKEN) {
    try {
      const reviewPayload = buildBountyClaimReviewMessage(claim, bounty, claim);
      await sendChannelMessage(env.DISCORD_OFFICER_CHANNEL_ID, reviewPayload, env.DISCORD_BOT_TOKEN);
    } catch (err) {
      console.error('Failed to notify #officer-exchange:', err);
    }
  }

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: `✅ **Bounty Claim Submitted!** Your proof for **${bounty.title}** has been sent to the Officers for 1-click review. You will receive **+${bounty.rewardBones} Bones** once approved!`,
      flags: 64
    }
  };
}

/**
 * /buy <item_id>
 */
async function handleBuyCommand(interaction, opts, env, firestore) {
  const caller = interaction.member?.user || interaction.user;
  const itemId = opts.item_id;

  const state = await firestore.getBseState();
  const item = (state.shop || []).find(i => i.id.toLowerCase() === itemId.toLowerCase());

  if (!item || item.enabled === false) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `❌ Item \`${itemId}\` was not found in the Exchange Shop.`, flags: 64 }
    };
  }

  // Stock check
  if (!item.unlimitedStock && (item.stock <= 0)) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `❌ **Sold Out:** ${item.title} has no remaining inventory.`, flags: 64 }
    };
  }

  // Balance check
  const wallet = state.wallets?.[caller.id] || { spendableBones: 0, boneScore: 0 };
  if ((wallet.spendableBones || 0) < item.costBones) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: `❌ **Insufficient Bones:** You have **${wallet.spendableBones || 0}** Bones, but **${item.title}** costs **${item.costBones}** Bones.`,
        flags: 64
      }
    };
  }

  // Deduct spendable bones (Bone Score remains untouched)
  wallet.spendableBones -= item.costBones;
  wallet.discordId = caller.id;
  wallet.username = caller.username;
  wallet.serverNickname = interaction.member?.nick || caller.global_name || caller.username;
  wallet.updatedAt = new Date().toISOString();
  state.wallets = state.wallets || {};
  state.wallets[caller.id] = wallet;

  // Reduce stock if limited
  if (!item.unlimitedStock) {
    item.stock = Math.max(0, item.stock - 1);
  }

  // Create pending delivery order
  const orderId = `order_${Date.now()}_${caller.id.slice(-4)}`;
  const delivery = {
    id: orderId,
    itemId: item.id,
    itemTitle: item.title,
    costBones: item.costBones,
    discordId: caller.id,
    discordUsername: caller.username,
    serverNickname: wallet.serverNickname,
    characterName: wallet.primaryCharacter || null,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  state.deliveries = state.deliveries || {};
  state.deliveries[orderId] = delivery;

  await firestore.saveBseState(state);

  // Audit log
  await firestore.logAuditEvent({
    action: 'SHOP_PURCHASE',
    targetId: caller.id,
    targetName: wallet.serverNickname || caller.username,
    amount: -item.costBones,
    reason: `Purchased ${item.title} (Order: ${orderId})`,
    timestamp: new Date().toISOString()
  });

  // Post to #officer-exchange for fulfillment
  if (env.DISCORD_OFFICER_CHANNEL_ID && env.DISCORD_BOT_TOKEN) {
    try {
      const ticket = buildShopDeliveryReviewMessage(delivery, item, wallet);
      await sendChannelMessage(env.DISCORD_OFFICER_CHANNEL_ID, ticket, env.DISCORD_BOT_TOKEN);
    } catch (err) {
      console.error('Failed to notify #officer-exchange of purchase:', err);
    }
  }

  // Post receipt to #exchange-feed
  if (env.DISCORD_FEED_CHANNEL_ID && env.DISCORD_BOT_TOKEN) {
    try {
      await sendChannelMessage(env.DISCORD_FEED_CHANNEL_ID, {
        embeds: [{
          title: '🛒 Shop Purchase Receipt',
          description: `**${wallet.serverNickname}** (@${caller.username}) purchased **${item.title}** for **${item.costBones}** Bones!`,
          color: Colors.GOLD,
          timestamp: new Date().toISOString()
        }]
      }, env.DISCORD_BOT_TOKEN);
    } catch (err) {
      console.error('Failed to post to #exchange-feed:', err);
    }
  }

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: `🎉 **Purchase Successful!** You bought **${item.title}** for **${item.costBones}** Bones. Remaining balance: **${wallet.spendableBones}** Bones. Officers have received your delivery ticket!`,
      flags: 64
    }
  };
}

/**
 * /award <user> <amount> <reason> (Officer only)
 */
async function handleAwardCommand(interaction, opts, env, firestore) {
  if (!isOfficer(interaction, env)) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: '⛔ **Access Denied:** Only Black Sands Officers can award Bones.', flags: 64 }
    };
  }

  const officer = interaction.member?.user || interaction.user;
  const officerName = interaction.member?.nick || officer.global_name || officer.username;
  const targetId = opts.user;
  const amount = Math.max(1, parseInt(opts.amount, 10) || 0);
  const reason = opts.reason || 'Guild contribution';

  const state = await firestore.getBseState();
  state.wallets = state.wallets || {};
  const wallet = state.wallets[targetId] || {
    discordId: targetId,
    spendableBones: 0,
    boneScore: 0
  };

  wallet.spendableBones = (wallet.spendableBones || 0) + amount;
  wallet.boneScore = (wallet.boneScore || 0) + amount; // Verified award increments Bone Score
  wallet.updatedAt = new Date().toISOString();
  await recordAuditLogAndSync(state, env, firestore, {
    action: 'AWARD',
    officerId: officer.id,
    officerName,
    targetId,
    targetName: wallet.serverNickname || wallet.globalName || wallet.username || targetId,
    amount,
    spendableBones: wallet.spendableBones,
    boneScore: wallet.boneScore,
    reason,
    notifyFeed: false
  });

  // Post to #exchange-feed
  if (env.DISCORD_FEED_CHANNEL_ID && env.DISCORD_BOT_TOKEN) {
    try {
      await sendChannelMessage(env.DISCORD_FEED_CHANNEL_ID, {
        embeds: [{
          title: '🪙 Bones Awarded!',
          description: `<@${targetId}> was awarded **+${amount} Bones** by **${officerName}**!\n> *${reason}*`,
          color: Colors.GREEN,
          fields: [
            { name: '💰 Spendable Balance', value: `${wallet.spendableBones} Bones`, inline: true },
            { name: '🏆 Bone Score', value: `${wallet.boneScore} Pts`, inline: true }
          ],
          timestamp: new Date().toISOString()
        }]
      }, env.DISCORD_BOT_TOKEN);
    } catch (err) {
      console.error('Failed to post to #exchange-feed:', err);
    }
  }

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: `✅ Successfully awarded **+${amount} Bones** to <@${targetId}> for: *${reason}* (Total Score: **${wallet.boneScore}**)`,
      flags: 64
    }
  };
}

/**
 * /deduct <user> <amount> <reason> (Officer only)
 */
async function handleDeductCommand(interaction, opts, env, firestore) {
  if (!isOfficer(interaction, env)) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: '⛔ **Access Denied:** Only Black Sands Officers can deduct Bones.', flags: 64 }
    };
  }

  const officer = interaction.member?.user || interaction.user;
  const officerName = interaction.member?.nick || officer.global_name || officer.username;
  const targetId = opts.user;
  const amount = Math.max(1, parseInt(opts.amount, 10) || 0);
  const reason = opts.reason || 'Administrative adjustment';

  const state = await firestore.getBseState();
  state.wallets = state.wallets || {};
  const wallet = state.wallets[targetId] || {
    discordId: targetId,
    spendableBones: 0,
    boneScore: 0
  };

  wallet.spendableBones = Math.max(0, (wallet.spendableBones || 0) - amount);
  // Note: Bone Score is not reduced on penalties unless explicitly requested
  wallet.updatedAt = new Date().toISOString();
  state.wallets[targetId] = wallet;

  await recordAuditLogAndSync(state, env, firestore, {
    action: 'DEDUCT',
    officerId: officer.id,
    officerName,
    targetId,
    targetName: wallet.serverNickname || wallet.globalName || wallet.username || targetId,
    amount: -amount,
    spendableBones: wallet.spendableBones,
    boneScore: wallet.boneScore,
    reason,
    notifyFeed: false
  });

  // Post to #exchange-feed
  if (env.DISCORD_FEED_CHANNEL_ID && env.DISCORD_BOT_TOKEN) {
    try {
      await sendChannelMessage(env.DISCORD_FEED_CHANNEL_ID, {
        embeds: [{
          title: '⚖️ Bones Deducted',
          description: `<@${targetId}> had **-${amount} Bones** deducted by **${officerName}**.\n> *${reason}*`,
          color: Colors.RED,
          fields: [
            { name: '💰 Spendable Balance', value: `${wallet.spendableBones} Bones`, inline: true }
          ],
          timestamp: new Date().toISOString()
        }]
      }, env.DISCORD_BOT_TOKEN);
    } catch (err) {
      console.error('Failed to post to #exchange-feed:', err);
    }
  }

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: `✅ Deducted **-${amount} Bones** from <@${targetId}>. New balance: **${wallet.spendableBones}** Bones.`,
      flags: 64
    }
  };
}

/**
 * /sync-standings (Officer only) - Edit pinned embeds in #exchange-standings in place
 */
async function handleSyncStandingsCommand(interaction, env, firestore) {
  if (!isOfficer(interaction, env)) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: '⛔ **Access Denied:** Only Black Sands Officers can trigger standings sync.', flags: 64 }
    };
  }

  if (!env.DISCORD_STANDINGS_CHANNEL_ID || !env.DISCORD_BOT_TOKEN) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: '❌ DISCORD_STANDINGS_CHANNEL_ID or DISCORD_BOT_TOKEN is not configured.', flags: 64 }
    };
  }

  const state = await firestore.getBseState();
  const channelId = env.DISCORD_STANDINGS_CHANNEL_ID;
  const token = env.DISCORD_BOT_TOKEN;

  // Build Leaderboard top 10
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

  // Edit in-place or send new pinned message
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

    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `✨ **Standings Synced!** Pinned dashboard embeds in <#${channelId}> updated in-place.`, flags: 64 }
    };
  } catch (err) {
    console.error('Failed to sync standings messages:', err);
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `❌ Error syncing standings: ${err.message}`, flags: 64 }
    };
  }
}

/**
 * /bounty subcommands (create, delete)
 */
async function handleBountySubcommands(interaction, subOptions, env, firestore) {
  if (!isOfficer(interaction, env)) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: '⛔ **Access Denied:** Only Black Sands Officers can manage bounties.', flags: 64 }
    };
  }

  const sub = Array.isArray(subOptions) ? subOptions[0] : null;
  if (!sub) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: 'Invalid bounty subcommand.', flags: 64 }
    };
  }

  const subOpts = {};
  if (Array.isArray(sub.options)) {
    for (const o of sub.options) subOpts[o.name] = o.value;
  }

  const state = await firestore.getBseState();

  if (sub.name === 'create') {
    const bountyId = `bounty_${Date.now()}`;
    const newBounty = {
      id: bountyId,
      title: subOpts.title,
      rewardBones: Math.max(1, parseInt(subOpts.reward, 10) || 10),
      description: subOpts.description || '',
      category: subOpts.category || 'General',
      status: 'active',
      createdAt: new Date().toISOString()
    };
    state.bounties = state.bounties || [];
    state.bounties.push(newBounty);
    await firestore.saveBseState(state);

    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: `✅ Created Bounty **${newBounty.title}** (ID: \`${newBounty.id}\`) with reward **+${newBounty.rewardBones} Bones**!`,
        flags: 64
      }
    };
  }

  if (sub.name === 'delete') {
    const targetId = subOpts.bounty_id;
    state.bounties = (state.bounties || []).filter(b => b.id.toLowerCase() !== targetId.toLowerCase());
    await firestore.saveBseState(state);

    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `🗑️ Bounty \`${targetId}\` removed.`, flags: 64 }
    };
  }

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: 'Unknown bounty subcommand.', flags: 64 }
  };
}
