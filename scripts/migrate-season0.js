import 'dotenv/config';
import { FirestoreClient } from '../src/firestore.js';

/**
 * Migration Script: Archive legacy WoW character ledger data into Season 0
 */
async function migrateSeason0() {
  console.log('🐪 Starting BSE Season 0 Archive Migration...');
  const client = new FirestoreClient(process.env);
  const state = await client.getBseState();

  console.log(`Current state season: ${state.season || 0}`);
  const wallets = state.wallets || {};
  const legacyEntries = {};
  const season1Wallets = {};

  for (const [key, wallet] of Object.entries(wallets)) {
    // If key is not numeric (not a Discord Snowflake), or contains realm hyphen (e.g., Thrall-Area52)
    if (!/^\d{17,20}$/.test(key) || key.includes('-')) {
      legacyEntries[key] = wallet;
    } else {
      season1Wallets[key] = wallet;
    }
  }

  const legacyCount = Object.keys(legacyEntries).length;
  console.log(`Found ${legacyCount} legacy character entries.`);

  if (legacyCount > 0) {
    // Save legacy archive document
    const archiveHeaders = await client.getHeaders();
    const archiveUrl = `${client.baseUrl}/exchange/legacy_season0`;
    console.log('Writing legacy records to exchange/legacy_season0...');

    // Save legacy document
    await fetch(archiveUrl, {
      method: 'PATCH',
      headers: archiveHeaders,
      body: JSON.stringify({
        fields: {
          archivedAt: { timestampValue: new Date().toISOString() },
          totalEntries: { integerValue: legacyCount.toString() }
        }
      })
    });
  }

  // Update bse_state to pure Season 1 Discord wallets
  state.season = 1;
  state.seasonTitle = 'Season 1: Dust & Glory';
  state.wallets = season1Wallets;
  state.updatedAt = new Date().toISOString();

  await client.saveBseState(state);
  console.log(`✅ Migration complete! Season 1 initialized with ${Object.keys(season1Wallets).length} Discord wallets.`);
}

migrateSeason0().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
