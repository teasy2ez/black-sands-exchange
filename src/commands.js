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
  recordAuditLogAndSync,
  pushStandingsToDiscord,
  syncBountiesEmbed,
  getChannelRouting
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
 * Resolve rank metadata from Rank Tier (default tier 0 Initiate)
 */
export function resolveRank(boneScore = 0, ranks = [], rankTier = null) {
  if (!ranks.length) {
    return { tier: 0, title: 'Initiate', icon: '🪙' };
  }
  const sorted = [...ranks].sort((a, b) => (a.tier || 0) - (b.tier || 0));
  if (rankTier !== null && rankTier !== undefined) {
    const byTier = sorted.find(r => r.tier === rankTier);
    if (byTier) return byTier;
  }
  return sorted[0];
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

  const rank = resolveRank(wallet.boneScore, state.ranks, wallet.rankTier);
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
  const activeMembers = Object.values(state.wallets || {}).filter(m => {
    if (m.officerHidden) return false;
    const total = (m.boneScore || 0) + (m.spendableBones || 0);
    return total > 0;
  });
  activeMembers.sort((a, b) => {
    const diffScore = (b.boneScore || b.spendableBones || 0) - (a.boneScore || a.spendableBones || 0);
    if (diffScore !== 0) return diffScore;
    const diffSpendable = (b.spendableBones || 0) - (a.spendableBones || 0);
    if (diffSpendable !== 0) return diffSpendable;
    const nameA = (a.serverNickname || a.globalName || a.username || '').toLowerCase();
    const nameB = (b.serverNickname || b.globalName || b.username || '').toLowerCase();
    const nameDiff = nameA.localeCompare(nameB);
    if (nameDiff !== 0) return nameDiff;
    return String(a.discordId || '').localeCompare(String(b.discordId || ''));
  });
  const top25 = activeMembers.slice(0, 25).map(m => ({
    ...m,
    rankTitle: resolveRank(m.boneScore, state.ranks, m.rankTier).title
  }));

  const embed = buildLeaderboardEmbed(top25);
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
 * /claim <bounty_id> [proof_url] [notes]
 */
async function handleClaimCommand(interaction, opts, env, firestore) {
  const caller = interaction.member?.user || interaction.user;
  const bountyId = opts.bounty_id;
  const proofUrl = opts.proof_url || opts.proof || '';
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
    proofUrl: proofUrl || '',
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
    reason
  });

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
    reason
  });

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: `✅ Deducted **-${amount} Bones** from <@${targetId}>. New balance: **${wallet.spendableBones}** Bones.`,
      flags: 64
    }
  };
}

/**
 * /sync-standings (Officer only) - Edit pinned embeds in #the-exchange in place
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
  const routing = getChannelRouting(env, state);

  try {
    const ok = await pushStandingsToDiscord(env, firestore, state);
    if (ok === false) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: '❌ Failed to push standings to Discord. Check channel permissions.', flags: 64 }
      };
    }

    const channelList = [
      `🏆 Leaderboard: <#${routing.leaderboardChannelId}>`,
      routing.bountiesChannelId !== routing.leaderboardChannelId ? `📜 Bounties: <#${routing.bountiesChannelId}>` : null,
      routing.shopChannelId !== routing.leaderboardChannelId ? `🛒 Shop: <#${routing.shopChannelId}>` : null
    ].filter(Boolean).join(' • ');

    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `✨ **Standings Synced!** Pinned dashboard embeds updated in-place:\n${channelList}`, flags: 64 }
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

    try {
      await syncBountiesEmbed(env, firestore, state);
    } catch (err) {
      console.error('Auto-sync bounties error:', err);
    }

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

    try {
      await syncBountiesEmbed(env, firestore, state);
    } catch (err) {
      console.error('Auto-sync bounties error:', err);
    }

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
