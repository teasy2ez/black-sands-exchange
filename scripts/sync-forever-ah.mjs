#!/usr/bin/env node
/**
 * WoW: Forever US Auction House Aggregator & Snapshot Publisher
 *
 * Downloads Live Forever AH dumps (~9 MB JSON) in Node.js (avoiding Cloudflare Worker
 * 128 MB RAM / CPU limits), computes outlier-trimmed min buyout + weighted median per item,
 * compresses into a <300 KB tuple map (`[minCopper, medianCopper, totalQty]`), and
 * POSTs to `/api/exchange/armory/ah-ingest` secured by `ARMORY_INGEST_SECRET`.
 *
 * Usage:
 *   node scripts/sync-forever-ah.mjs [--dry-run] [--ruleset=1] [--house=110]
 */

import { pathToFileURL } from 'node:url';
import { FOREVER_AH_WATCHLIST_IDS, FEATURED_FOREVER_ITEMS } from '../src/armory.js';

const BLIZZARD_OAUTH_URL = 'https://oauth.battle.net/token';
const BLIZZARD_API_BASE = 'https://us.api.blizzard.com';
const FOREVER_DYNAMIC_NS = 'dynamic-forever-us';
const DEFAULT_MAX_PAYLOAD_BYTES = 280_000; // Strictly < 300 KB

const PRIORITY_ITEM_IDS = new Set([
  ...FOREVER_AH_WATCHLIST_IDS,
  ...FEATURED_FOREVER_ITEMS.map(item => Number(item.id)).filter(Boolean)
]);

/**
 * Pure, deterministic aggregator for Blizzard AH gear + commodity dumps.
 * Produces compact tuple map `itemId -> [minBuyoutCopper, medianBuyoutCopper, totalQty]`
 * strictly bounded below `maxPayloadBytes` (< 300 KB default).
 */
export function aggregateAuctionHouseDump(auctionsPayload = {}, commoditiesPayload = null, {
  houseId = 110,
  rulesetId = 1,
  priorityIds = PRIORITY_ITEM_IDS,
  maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES,
  updatedAt = new Date().toISOString()
} = {}) {
  const byItem = new Map();
  let auctionCount = 0;

  const pushEntry = (itemId, rawUnitPrice, qty) => {
    const id = Number(itemId) || 0;
    const quantity = Math.max(1, Math.round(Number(qty) || 1));
    const unitPrice = Math.max(0, Math.round(Number(rawUnitPrice) || 0));
    if (id <= 0) return;

    auctionCount++;
    if (unitPrice <= 0) return; // Ignore bid-only auctions lacking buyout

    let bucket = byItem.get(id);
    if (!bucket) {
      bucket = { totalQty: 0, lots: [] };
      byItem.set(id, bucket);
    }
    bucket.totalQty += quantity;
    bucket.lots.push({ p: unitPrice, q: quantity });
  };

  // 1. Ruleset Realm/Cluster Gear & Item Auctions
  const houseAuctions = Array.isArray(auctionsPayload?.auctions) ? auctionsPayload.auctions : [];
  for (const a of houseAuctions) {
    const qty = Math.max(1, Number(a?.quantity) || 1);
    const buyout = Number(a?.buyout) || Number(a?.unit_price) || 0;
    if (buyout > 0) {
      const unitPrice = a?.unit_price ? Number(a.unit_price) : Math.round(buyout / qty);
      pushEntry(a?.item?.id, unitPrice, qty);
    } else if (a?.item?.id) {
      auctionCount++;
    }
  }

  // 2. Commodities (when supplied cleanly as separate feed)
  const commAuctions = Array.isArray(commoditiesPayload?.auctions) ? commoditiesPayload.auctions : [];
  for (const c of commAuctions) {
    const qty = Math.max(1, Number(c?.quantity) || 1);
    const unitPrice = Number(c?.unit_price) || (Number(c?.buyout) ? Math.round(Number(c.buyout) / qty) : 0);
    if (unitPrice > 0) {
      pushEntry(c?.item?.id, unitPrice, qty);
    } else if (c?.item?.id) {
      auctionCount++;
    }
  }

  const fullPrices = {};
  const sortableRows = [];

  for (const [id, bucket] of byItem.entries()) {
    const lots = bucket.lots;
    if (!lots.length) continue;

    lots.sort((a, b) => a.p - b.p);
    const minBuyout = lots[0].p;

    // Trim top 5% extreme price outliers when sufficient lot samples exist
    let trimmedLots = lots;
    if (lots.length >= 10) {
      const trimCount = Math.max(1, Math.floor(lots.length * 0.05));
      trimmedLots = lots.slice(0, lots.length - trimCount);
    }

    let trimmedQty = 0;
    for (const l of trimmedLots) trimmedQty += l.q;
    const medianTarget = trimmedQty / 2;

    let cumQty = 0;
    let medianBuyout = trimmedLots[0].p;
    for (const l of trimmedLots) {
      cumQty += l.q;
      if (cumQty >= medianTarget) {
        medianBuyout = l.p;
        break;
      }
    }

    const tuple = [minBuyout, medianBuyout, bucket.totalQty];
    fullPrices[String(id)] = tuple;
    sortableRows.push({
      idStr: String(id),
      isPriority: priorityIds instanceof Set ? priorityIds.has(id) : Boolean(priorityIds?.[id]),
      totalQty: bucket.totalQty,
      tuple
    });
  }

  const basePayload = {
    houseId: Number(houseId) || 110,
    rulesetId: Number(rulesetId) || 1,
    auctionCount,
    updatedAt,
    prices: fullPrices
  };

  let trimmedToFit = false;
  let byteLength = Buffer.byteLength(JSON.stringify(basePayload), 'utf8');

  if (byteLength > maxPayloadBytes && sortableRows.length > 0) {
    trimmedToFit = true;
    // Prioritize Raid Consumables / Watchlist items first, then highest-volume items
    sortableRows.sort((a, b) => {
      if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
      return b.totalQty - a.totalQty;
    });

    const buildSubset = (count) => {
      const subsetPrices = {};
      for (let i = 0; i < count; i++) {
        subsetPrices[sortableRows[i].idStr] = sortableRows[i].tuple;
      }
      return {
        ...basePayload,
        prices: subsetPrices
      };
    };

    // Binary search largest prefix that stays strictly <= maxPayloadBytes
    let lo = 1;
    let hi = sortableRows.length;
    let bestCount = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const candidate = buildSubset(mid);
      const size = Buffer.byteLength(JSON.stringify(candidate), 'utf8');
      if (size <= maxPayloadBytes) {
        bestCount = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    basePayload.prices = buildSubset(bestCount).prices;
    byteLength = Buffer.byteLength(JSON.stringify(basePayload), 'utf8');
  }

  return {
    payload: basePayload,
    stats: {
      auctionCount,
      distinctBeforeTrim: sortableRows.length,
      distinctIncluded: Object.keys(basePayload.prices).length,
      trimmedToFit,
      payloadBytes: byteLength
    }
  };
}

async function fetchBlizzardToken(clientId, clientSecret) {
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(BLIZZARD_OAUTH_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) {
    throw new Error(`Blizzard OAuth error [${res.status}]: ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function blizzardGet(path, token, { allow404 = false } = {}) {
  const url = `${BLIZZARD_API_BASE}${path}${path.includes('?') ? '&' : '?'}namespace=${FOREVER_DYNAMIC_NS}&locale=en_US`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  });
  if (allow404 && res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Blizzard API error [${res.status}] ${path}: ${await res.text()}`);
  }
  return res.json();
}

function parseCliArgs(argv = []) {
  const flags = {
    dryRun: argv.includes('--dry-run'),
    rulesetId: null,
    houseId: null
  };
  for (const arg of argv) {
    if (arg.startsWith('--ruleset=')) flags.rulesetId = Number(arg.split('=')[1]) || null;
    if (arg.startsWith('--house=')) flags.houseId = Number(arg.split('=')[1]) || null;
  }
  return flags;
}

async function main() {
  try {
    const { default: dotenv } = await import('dotenv');
    dotenv.config({ path: '.dev.vars' });
  } catch {
    // dotenv not installed or running in CI with env vars directly set
  }

  const cli = parseCliArgs(process.argv.slice(2));
  const clientId = process.env.BLIZZARD_CLIENT_ID;
  const clientSecret = process.env.BLIZZARD_CLIENT_SECRET;
  const ingestSecret = process.env.ARMORY_INGEST_SECRET;
  const bseUrl = String(process.env.BSE_URL || 'https://bse.teasy2ez.win').replace(/\/+$/, '');

  if (!clientId || !clientSecret) {
    console.error('❌ BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET are required.');
    process.exit(1);
  }
  if (!cli.dryRun && !ingestSecret) {
    console.error('❌ ARMORY_INGEST_SECRET is required when publishing to BSE (or pass --dry-run).');
    process.exit(1);
  }

  // Respect Officer Hall Armory config when overrides aren't pinned
  let rulesetId = cli.rulesetId || Number(process.env.BSE_RULESET_ID) || 1;
  let houseId = cli.houseId || Number(process.env.BSE_AH_HOUSE_ID) || 110;

  try {
    const statusRes = await fetch(`${bseUrl}/api/exchange/armory/status`);
    if (statusRes.ok) {
      const statusJson = await statusRes.json();
      if (!cli.rulesetId && !process.env.BSE_RULESET_ID && statusJson?.armory?.guildRulesetId) {
        rulesetId = Number(statusJson.armory.guildRulesetId) || rulesetId;
      }
      if (!cli.houseId && !process.env.BSE_AH_HOUSE_ID && statusJson?.armory?.defaultAuctionHouseId) {
        houseId = Number(statusJson.armory.defaultAuctionHouseId) || houseId;
      }
    }
  } catch (err) {
    console.warn(`⚠️ Could not read Armory status from ${bseUrl} (${err.message}); using ruleset=${rulesetId}, house=${houseId}`);
  }

  console.log(`🔑 Authenticating with Battle.net OAuth (Ruleset ${rulesetId}, House ${houseId})...`);
  const token = await fetchBlizzardToken(clientId, clientSecret);

  console.log(`📥 Downloading Forever US auctions & commodities...`);
  const [auctionsPayload, commoditiesPayload] = await Promise.all([
    blizzardGet(`/data/wow/ruleset/${rulesetId}/auctions/${houseId}`, token),
    blizzardGet('/data/wow/auctions/commodities', token, { allow404: true })
  ]);

  const { payload, stats } = aggregateAuctionHouseDump(auctionsPayload, commoditiesPayload, {
    houseId,
    rulesetId
  });

  console.log(
    `📊 Aggregated ${stats.auctionCount.toLocaleString()} auctions -> ` +
    `${stats.distinctIncluded.toLocaleString()}/${stats.distinctBeforeTrim.toLocaleString()} distinct items ` +
    `(${(stats.payloadBytes / 1024).toFixed(1)} KB${stats.trimmedToFit ? ', prioritized/trimmed' : ''})`
  );

  if (cli.dryRun) {
    const sampleIds = Object.keys(payload.prices).slice(0, 8);
    console.log('🧪 --dry-run enabled; skipping POST. Sample entries:');
    for (const id of sampleIds) {
      console.log(`   #${id}: min=${payload.prices[id][0]}c, med=${payload.prices[id][1]}c, qty=${payload.prices[id][2]}`);
    }
    return;
  }

  console.log(`🚀 Publishing compact AH snapshot to ${bseUrl}/api/exchange/armory/ah-ingest...`);
  const ingestRes = await fetch(`${bseUrl}/api/exchange/armory/ah-ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Armory-Ingest-Secret': ingestSecret
    },
    body: JSON.stringify(payload)
  });

  const resText = await ingestRes.text();
  if (!ingestRes.ok) {
    console.error(`❌ Ingest rejected [${ingestRes.status}]: ${resText}`);
    process.exit(1);
  }

  console.log(`✅ AH ingest succeeded: ${resText}`);
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  main().catch(err => {
    console.error('Fatal AH sync error:', err);
    process.exit(1);
  });
}
