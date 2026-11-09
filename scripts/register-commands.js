import dotenv from 'dotenv';
dotenv.config({ path: '.dev.vars' });

/**
 * Script to register all Black Sands Exchange Slash Commands with Discord.
 * Uses DISCORD_CLIENT_ID, DISCORD_BOT_TOKEN, and DISCORD_GUILD_ID.
 */

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1568455199113084950';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!BOT_TOKEN) {
  console.error('❌ Error: DISCORD_BOT_TOKEN environment variable is required to register commands.');
  process.exit(1);
}

// 32 is Discord MANAGE_GUILD permission bit
const MANAGE_GUILD_PERMISSION = '32';

const commands = [
  {
    name: 'bones',
    description: 'Check your spendable Bones, Bone Score, and Prestige Rank',
    options: [
      {
        name: 'user',
        description: 'Guild member to look up (defaults to yourself)',
        type: 6, // USER
        required: false
      }
    ]
  },
  {
    name: 'leaderboard',
    description: 'View the top 10 members by Bone Score'
  },
  {
    name: 'bounties',
    description: 'Browse currently active guild bounties'
  },
  {
    name: 'shop',
    description: 'Browse the Exchange Shop catalog and rank promotions'
  },
  {
    name: 'buy',
    description: 'Purchase an item or rank promotion with your Bones',
    options: [
      {
        name: 'item_id',
        description: 'The unique ID of the shop item to purchase (see /shop)',
        type: 3, // STRING
        required: true
      }
    ]
  },
  {
    name: 'claim',
    description: 'Submit proof to claim a completed bounty',
    options: [
      {
        name: 'bounty_id',
        description: 'The ID of the bounty you completed (see /bounties)',
        type: 3, // STRING
        required: true
      },
      {
        name: 'proof_url',
        description: 'Link to screenshot, image, or Warcraft Logs proof',
        type: 3, // STRING
        required: true
      },
      {
        name: 'notes',
        description: 'Optional details or notes regarding completion',
        type: 3, // STRING
        required: false
      }
    ]
  },
  {
    name: 'award',
    description: 'Award Bones to a guild member (Officers Only)',
    default_member_permissions: MANAGE_GUILD_PERMISSION,
    options: [
      {
        name: 'user',
        description: 'The member to award Bones to',
        type: 6, // USER
        required: true
      },
      {
        name: 'amount',
        description: 'Amount of Bones to award',
        type: 4, // INTEGER
        required: true
      },
      {
        name: 'reason',
        description: 'Reason for the award',
        type: 3, // STRING
        required: true
      }
    ]
  },
  {
    name: 'deduct',
    description: 'Deduct Bones from a guild member (Officers Only)',
    default_member_permissions: MANAGE_GUILD_PERMISSION,
    options: [
      {
        name: 'user',
        description: 'The member to deduct Bones from',
        type: 6, // USER
        required: true
      },
      {
        name: 'amount',
        description: 'Amount of Bones to deduct',
        type: 4, // INTEGER
        required: true
      },
      {
        name: 'reason',
        description: 'Reason for the deduction',
        type: 3, // STRING
        required: true
      }
    ]
  },
  {
    name: 'bounty',
    description: 'Manage guild bounties (Officers Only)',
    default_member_permissions: MANAGE_GUILD_PERMISSION,
    options: [
      {
        name: 'create',
        description: 'Create a new bounty',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'title',
            description: 'Title of the bounty',
            type: 3,
            required: true
          },
          {
            name: 'reward',
            description: 'Reward in Bones',
            type: 4,
            required: true
          },
          {
            name: 'description',
            description: 'Full description and requirements',
            type: 3,
            required: false
          },
          {
            name: 'category',
            description: 'Category (Raid, Dungeon, Economy, PvP, Fun)',
            type: 3,
            required: false
          }
        ]
      },
      {
        name: 'delete',
        description: 'Delete an active bounty',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'bounty_id',
            description: 'ID of the bounty to delete',
            type: 3,
            required: true
          }
        ]
      }
    ]
  },
  {
    name: 'sync-standings',
    description: 'Force refresh all pinned dashboard embeds in #exchange-standings (Officers Only)',
    default_member_permissions: MANAGE_GUILD_PERMISSION
  }
];

async function registerCommands() {
  const url = GUILD_ID
    ? `https://discord.com/api/v10/applications/${CLIENT_ID}/guilds/${GUILD_ID}/commands`
    : `https://discord.com/api/v10/applications/${CLIENT_ID}/commands`;

  console.log(`📡 Registering ${commands.length} slash commands to ${GUILD_ID ? `Guild ${GUILD_ID}` : 'Global'}...`);

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bot ${BOT_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(commands)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Failed to register commands [${response.status}]:`, errorText);
    process.exit(1);
  }

  const result = await response.json();
  console.log(`✅ Successfully registered ${result.length} commands!`);
  for (const cmd of result) {
    console.log(`   - /${cmd.name} (ID: ${cmd.id})`);
  }
}

registerCommands().catch(err => {
  console.error('Fatal error registering commands:', err);
  process.exit(1);
});
