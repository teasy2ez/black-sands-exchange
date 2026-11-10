import {
  InteractionResponseType,
  Colors,
  sendChannelMessage,
  addGuildMemberRole,
  recordAuditLogAndSync
} from './discord.js';
import { isOfficer, resolveRank } from './commands.js';

/**
 * Handle Discord Message Component Interactions (Button clicks)
 */
export async function handleMessageComponent(interaction, env, firestore) {
  const customId = interaction.data?.custom_id || '';

  if (customId.startsWith('bounty_approve:')) {
    const claimId = customId.replace('bounty_approve:', '');
    return handleBountyApprove(interaction, claimId, env, firestore);
  }

  if (customId.startsWith('bounty_deny:')) {
    const claimId = customId.replace('bounty_deny:', '');
    return handleBountyDeny(interaction, claimId, env, firestore);
  }

  if (customId.startsWith('shop_deliver:')) {
    const deliveryId = customId.replace('shop_deliver:', '');
    return handleShopDeliver(interaction, deliveryId, env, firestore);
  }

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: 'Unknown button interaction.', flags: 64 }
  };
}

/**
 * Handle 1-Click Bounty Approval Button
 */
async function handleBountyApprove(interaction, claimId, env, firestore) {
  if (!isOfficer(interaction, env)) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: '⛔ Only Black Sands Officers can approve bounty claims.', flags: 64 }
    };
  }

  const officer = interaction.member?.user || interaction.user;
  const officerName = interaction.member?.nick || officer.global_name || officer.username;

  const state = await firestore.getBseState();
  const claim = state.claims?.[claimId];

  if (!claim) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `Claim \`${claimId}\` was not found.`, flags: 64 }
    };
  }

  if (claim.status === 'approved') {
    return {
      type: InteractionResponseType.UPDATE_MESSAGE,
      data: {
        content: `⚠️ Claim \`${claimId}\` was already approved by **${claim.reviewedBy || 'an officer'}**.`,
        components: []
      }
    };
  }

  // Update claim
  claim.status = 'approved';
  claim.reviewedBy = officerName;
  claim.reviewedById = officer.id;
  claim.reviewedAt = new Date().toISOString();

  // Award Bones and increment Bone Score
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
  wallet.boneScore = (wallet.boneScore || 0) + reward; // Verified bounty adds to Career Bone Score
  wallet.bountiesCompleted = (wallet.bountiesCompleted || 0) + 1; // Track member bounties completed
  wallet.updatedAt = new Date().toISOString();
  state.wallets[claim.discordId] = wallet;

  // If bounty was requested/sponsored by a member, increment their postedBountiesCompleted
  const relatedBounty = (state.bounties || []).find(b => b.id === claim.bountyId);
  if (relatedBounty?.creatorId && state.wallets[relatedBounty.creatorId]) {
    const creatorWallet = state.wallets[relatedBounty.creatorId];
    creatorWallet.postedBountiesCompleted = (creatorWallet.postedBountiesCompleted || 0) + 1;
    creatorWallet.updatedAt = new Date().toISOString();
  }

  await recordAuditLogAndSync(state, env, firestore, {
    action: 'BOUNTY_REWARD',
    officerId: officer.id,
    officerName,
    targetId: claim.discordId,
    targetName: claim.serverNickname || claim.discordUsername,
    amount: reward,
    spendableBones: wallet.spendableBones,
    boneScore: wallet.boneScore,
    reason: `Approved Bounty: ${claim.bountyTitle} (${claimId})`,
    notifyFeed: false
  });

  // Post to #exchange-feed
  if (env.DISCORD_FEED_CHANNEL_ID && env.DISCORD_BOT_TOKEN) {
    try {
      await sendChannelMessage(env.DISCORD_FEED_CHANNEL_ID, {
        embeds: [{
          title: '⚔️ Bounty Claim Approved!',
          description: `<@${claim.discordId}> completed **${claim.bountyTitle}** and earned **+${reward} Bones**!\n> Verified by **${officerName}**`,
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

  // Update existing Discord message in-place
  const originalEmbed = interaction.message?.embeds?.[0] || {};
  return {
    type: InteractionResponseType.UPDATE_MESSAGE,
    data: {
      content: `✅ **APPROVED** by <@${officer.id}> (+${reward} Bones awarded to <@${claim.discordId}>)`,
      embeds: [{
        ...originalEmbed,
        color: Colors.GREEN,
        footer: { text: `Approved by ${officerName} on ${new Date().toLocaleDateString()}` }
      }],
      components: [] // Disable buttons
    }
  };
}

/**
 * Handle 1-Click Bounty Denial Button
 */
async function handleBountyDeny(interaction, claimId, env, firestore) {
  if (!isOfficer(interaction, env)) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: '⛔ Only Black Sands Officers can deny bounty claims.', flags: 64 }
    };
  }

  const officer = interaction.member?.user || interaction.user;
  const officerName = interaction.member?.nick || officer.global_name || officer.username;

  const state = await firestore.getBseState();
  const claim = state.claims?.[claimId];

  if (!claim) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `Claim \`${claimId}\` was not found.`, flags: 64 }
    };
  }

  claim.status = 'denied';
  claim.reviewedBy = officerName;
  claim.reviewedById = officer.id;
  claim.reviewedAt = new Date().toISOString();

  await firestore.saveBseState(state);

  // Audit log
  await firestore.logAuditEvent({
    action: 'BOUNTY_CLAIM_DENIED',
    officerId: officer.id,
    officerName,
    targetId: claim.discordId,
    targetName: claim.serverNickname || claim.discordUsername,
    reason: `Denied Bounty Claim: ${claim.bountyTitle} (${claimId})`,
    timestamp: new Date().toISOString()
  });

  const originalEmbed = interaction.message?.embeds?.[0] || {};
  return {
    type: InteractionResponseType.UPDATE_MESSAGE,
    data: {
      content: `❌ **DENIED** by <@${officer.id}>`,
      embeds: [{
        ...originalEmbed,
        color: Colors.RED,
        footer: { text: `Denied by ${officerName} on ${new Date().toLocaleDateString()}` }
      }],
      components: []
    }
  };
}

/**
 * Handle 1-Click Shop Delivery Fulfillment Button
 */
async function handleShopDeliver(interaction, deliveryId, env, firestore) {
  if (!isOfficer(interaction, env)) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: '⛔ Only Black Sands Officers can mark shop orders delivered.', flags: 64 }
    };
  }

  const officer = interaction.member?.user || interaction.user;
  const officerName = interaction.member?.nick || officer.global_name || officer.username;

  const state = await firestore.getBseState();
  const delivery = state.deliveries?.[deliveryId];

  if (!delivery) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `Order \`${deliveryId}\` was not found.`, flags: 64 }
    };
  }

  delivery.status = 'fulfilled';
  delivery.fulfilledBy = officerName;
  delivery.fulfilledById = officer.id;
  delivery.fulfilledAt = new Date().toISOString();

  await firestore.saveBseState(state);

  // Audit log
  await firestore.logAuditEvent({
    action: 'SHOP_ORDER_DELIVERED',
    officerId: officer.id,
    officerName,
    targetId: delivery.discordId,
    targetName: delivery.serverNickname || delivery.discordUsername,
    reason: `Delivered ${delivery.itemTitle} (Order: ${deliveryId})`,
    timestamp: new Date().toISOString()
  });

  const originalEmbed = interaction.message?.embeds?.[0] || {};
  return {
    type: InteractionResponseType.UPDATE_MESSAGE,
    data: {
      content: `📦 **DELIVERED** by <@${officer.id}> (Delivered to <@${delivery.discordId}>)`,
      embeds: [{
        ...originalEmbed,
        color: Colors.GREEN,
        footer: { text: `Fulfilled by ${officerName} on ${new Date().toLocaleDateString()}` }
      }],
      components: []
    }
  };
}
