# Black Sands Exchange (BSE) Platform

A cloud-native community & guild economy platform featuring **Bones currency**, an interactive **Bounty Board**, an **Exchange Shop**, and **Prestige Rank roles**, powered by a central **Web Portal** and a **100% Serverless 2-Way Discord Bot**.

---

## 🏗️ Architectural Overview

- **Central Web Portal (`https://bse.teasy2ez.win`)**:
  - Hosted serverlessly on **Cloudflare Workers** with Static Assets (`web/`).
  - Backed by **Google Cloud Firestore** (`exchange/bse_state`).
  - **Discord OAuth 2.0 Login** (Client ID: `1568455199113084950`).
  - **Member Features**: "My Discord Wallet" banner (`@username`, Spendable Bones, Career Bone Score, Prestige Rank Progress), Leaderboard with real-time search, interactive Bounty Board, and Exchange Shop.
  - **Officer Command Center**: Auto-unlocked via Discord Server Roles or Emergency Passcode (`blacksands2026`). Live member autocomplete, 1-click claim approvals, 1-click shop fulfillment queue, bounty/item managers, and Discord standings sync.

- **Serverless 2-Way Discord Bot (`worker.js` via `/api/discord/interactions`)**:
  - 100% Serverless on Cloudflare Workers with cryptographic **Ed25519 signature verification** (`tweetnacl`).
  - **Zero hosting cost, zero PC maintenance** (no local PowerShell or daemon script needed).
  - **Discord Channel Architecture**:
    - `#the-exchange`: Read-only channel with auto-updating live dashboard embeds (Leaderboard, Bounties, Shop Catalog) edited **in-place** (or split across dedicated channels via Officer Hall).
    - `#officer-exchange`: Private officer-only channel for bounty claim alerts with **[Approve (Award X Bones)]** / **[Deny]** buttons and shop delivery tickets with **[Mark Delivered]** buttons.

---

## ⚡ Discord Slash Commands

| Command | Permission | Description |
| :--- | :--- | :--- |
| `/bones [user]` | Public | View spendable Bones, career Bone Score, and Prestige Rank. |
| `/leaderboard` | Public | View the top 10 members by Bone Score. |
| `/bounties` | Public | Browse currently active guild bounties. |
| `/shop` | Public | Browse purchasable items and rank promotions. |
| `/buy <item_id>` | Public | Purchase an item or rank promotion with Bones. |
| `/claim <bounty_id> <proof_url> [notes]` | Public | Submit proof for a completed bounty. |
| `/award <user> <amount> <reason>` | Officer Only | Award Bones and increment career Bone Score. |
| `/deduct <user> <amount> <reason>` | Officer Only | Deduct Bones for administrative adjustments. |
| `/bounty create <title> <reward> [desc]` | Officer Only | Create a new active bounty. |
| `/bounty delete <bounty_id>` | Officer Only | Delete an active bounty. |
| `/sync-standings` | Officer Only | Forces an in-place update of all embeds in `#exchange-standings`. |

---

## 🚀 Setup & Deployment

### 1. Configure Cloudflare Worker Secrets
Copy `.dev.vars.example` to `.dev.vars` for local development:
```bash
cp .dev.vars.example .dev.vars
```

For production, set secrets using the Wrangler CLI:
```bash
npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_GUILD_ID
npx wrangler secret put DISCORD_STANDINGS_CHANNEL_ID
npx wrangler secret put DISCORD_OFFICER_CHANNEL_ID
npx wrangler secret put DISCORD_OFFICER_ROLE_ID
npx wrangler secret put GCP_SERVICE_ACCOUNT_KEY
npx wrangler secret put SESSION_SECRET
```

### 2. Configure Discord Developer Portal
1. In your [Discord Developer Portal](https://discord.com/developers/applications/1568455199113084950/):
   - Set **Interactions Endpoint URL** to:
     ```
     https://bse.teasy2ez.win/api/discord/interactions
     ```
   - Under **OAuth2 -> Redirects**, add:
     ```
     https://bse.teasy2ez.win/api/auth/discord/callback
     https://www.bse.teasy2ez.win/api/auth/discord/callback
     http://localhost:8787/api/auth/discord/callback
     ```
   - Ensure the Bot has been invited to your server with `applications.commands`, `bot`, and `Manage Roles` (if auto-assigning prestige roles).

### 3. Register Slash Commands
Run the command registration script:
```bash
npm run register:commands
```

### 4. Deploy to Cloudflare
```bash
npm run deploy
```

---

## 📜 Prestige Rank Progression & Anti-Exploit Rules

1. **Spendable Bones vs. Career Bone Score**:
   - `spendableBones`: The liquid currency spent on shop items and rank promotions.
   - `boneScore`: The anti-exploit leaderboard score. **Only increments on verified earnings** (officer awards and approved bounty claims). Member-to-member transfers and purchases do not increase this score.
2. **Promotions**:
   - Members spend Bones to purchase rank promotions in the shop/wallet.
   - Upon ranking up, the Discord Bot automatically assigns the corresponding Discord Server Role.
