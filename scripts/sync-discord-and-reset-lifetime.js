import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config({ path: '.dev.vars' });
import { FirestoreClient } from '../src/firestore.js';
import { pushStandingsToDiscord } from '../src/discord.js';

async function syncDiscordAndResetLifetime() {
  console.log('🐪 Starting Discord Guild Roster Sync and Lifetime Bones Reset...');

  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!token || !guildId) {
    throw new Error('Missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID in environment');
  }

  // 1. Fetch guild members from Discord
  console.log(`Fetching members from Discord Guild ${guildId}...`);
  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`, {
    headers: { Authorization: `Bot ${token}` }
  });

  if (!res.ok) {
    throw new Error(`Discord API error: ${res.status} ${await res.text()}`);
  }

  const rawMembers = await res.json();
  const members = rawMembers.filter(m => !m.user?.bot);
  console.log(`Retrieved ${members.length} non-bot guild members from Discord.`);

  // 2. Fetch current BSE State from Firestore
  const client = new FirestoreClient(process.env);
  const state = await client.getBseState();
  state.wallets = state.wallets || {};

  console.log(`Current wallets in Firestore: ${Object.keys(state.wallets).length}`);

  // 3. Reset existing wallets and populate all Discord members
  let updatedExisting = 0;
  let newlyImported = 0;

  for (const m of members) {
    const uid = m.user.id;
    const existing = state.wallets[uid];

    if (existing) {
      existing.username = m.user.username;
      existing.globalName = m.user.global_name || m.user.username;
      existing.serverNickname = m.nick || existing.serverNickname || null;
      existing.avatarHash = m.user.avatar || null;
      existing.roles = m.roles || [];
      existing.boneScore = 0; // Reset lifetime bones to 0
      existing.spendableBones = 0; // Reset spendable bones to 0
      existing.officerHidden = Boolean(existing.officerHidden);
      existing.updatedAt = new Date().toISOString();
      updatedExisting++;
    } else {
      state.wallets[uid] = {
        discordId: uid,
        username: m.user.username,
        globalName: m.user.global_name || m.user.username,
        serverNickname: m.nick || null,
        avatarHash: m.user.avatar || null,
        roles: m.roles || [],
        spendableBones: 0,
        boneScore: 0, // Lifetime bones initialized to 0
        characters: [],
        primaryCharacter: null,
        guildNote: '',
        officerHidden: false,
        createdAt: new Date().toISOString()
      };
      newlyImported++;
    }
  }

  // Also ensure ANY other wallet in state has lifetime bones reset to 0
  for (const [wId, w] of Object.entries(state.wallets)) {
    w.boneScore = 0;
    w.spendableBones = 0;
  }

  state.updatedAt = new Date().toISOString();

  // 4. Record in Audit Log
  state.auditLog = state.auditLog || [];
  state.auditLog.push({
    id: `audit_${Date.now()}_sync`,
    action: 'ROSTER_RESET_AND_DISCORD_SYNC',
    officerId: 'SYSTEM',
    officerName: 'Admin / System',
    targetId: 'ALL',
    targetName: 'Guild Roster',
    amount: 0,
    spendableBones: 0,
    boneScore: 0,
    reason: `Reset all lifetime bones to 0 and populated ${members.length} members from Discord (${newlyImported} imported, ${updatedExisting} updated)`,
    timestamp: new Date().toISOString()
  });

  if (state.auditLog.length > 300) {
    state.auditLog = state.auditLog.slice(-300);
  }

  console.log(`Saving updated BSE state with ${Object.keys(state.wallets).length} wallets to Firestore...`);
  await client.saveBseState(state);
  console.log('✅ BSE State saved successfully!');

  // 5. Push updated standings to Discord
  console.log('Pushing updated standings to Discord...');
  try {
    await pushStandingsToDiscord(process.env, client, state);
    console.log('✅ Discord standings pushed!');
  } catch (err) {
    console.warn('Discord standings push warning:', err.message);
  }

  console.log(`🎉 Done! Total wallets: ${Object.keys(state.wallets).length}. Lifetime bones set to 0.`);
}

syncDiscordAndResetLifetime().catch(err => {
  console.error('Fatal sync error:', err);
  process.exit(1);
});
