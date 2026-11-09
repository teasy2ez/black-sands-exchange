/**
 * Lightweight Google Cloud Firestore REST Client for Cloudflare Workers
 * Supports reading/writing documents with standard JSON serialization.
 */

// Helper: Convert JS object to Firestore Value format
export function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: val.toString() } : { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

// Helper: Convert Firestore Value format to standard JS object
export function fromFirestoreValue(val) {
  if (!val || typeof val !== 'object') return val;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return parseInt(val.integerValue, 10);
  if ('doubleValue' in val) return val.doubleValue;
  if ('stringValue' in val) return val.stringValue;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map(fromFirestoreValue);
  }
  if ('mapValue' in val) {
    const obj = {};
    const fields = val.mapValue.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      obj[k] = fromFirestoreValue(v);
    }
    return obj;
  }
  return null;
}

// Helper: Convert Firestore document to JS object
export function fromFirestoreDoc(doc) {
  if (!doc || !doc.fields) return null;
  const obj = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    obj[k] = fromFirestoreValue(v);
  }
  if (doc.name) {
    obj._documentPath = doc.name;
    obj._id = doc.name.split('/').pop();
  }
  return obj;
}

// Helper: Convert JS object to Firestore document fields
export function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('_')) continue;
    fields[k] = toFirestoreValue(v);
  }
  return { fields };
}

/**
 * Generate Google OAuth2 Access Token from Service Account JSON using Web Crypto
 */
async function getGoogleAccessToken(serviceAccountJson) {
  if (!serviceAccountJson) return null;
  let sa = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;
  if (!sa.client_email || !sa.private_key) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const encode = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsignedToken = `${encode(header)}.${encode(claim)}`;

  // Convert PKCS8 private key string to ArrayBuffer
  const pem = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binaryDer = Buffer.from(pem, 'base64');

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    Buffer.from(unsignedToken)
  );

  const signedJwt = `${unsignedToken}.${Buffer.from(signature).toString('base64url')}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedJwt
    })
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Google OAuth2 Token Error: ${err}`);
  }
  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

/**
 * BSE Firestore Client
 */
export class FirestoreClient {
  constructor(env) {
    this.env = env;
    this.projectId = env.FIRESTORE_PROJECT_ID || 'black-sands-exchange-addon';
    this.databaseId = '(default)';
    this.baseUrl = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/${this.databaseId}/documents`;
    this._cachedToken = null;
    this._tokenExpiry = 0;
  }

  async getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.env.GCP_SERVICE_ACCOUNT_KEY) {
      const now = Date.now();
      if (!this._cachedToken || now >= this._tokenExpiry - 60000) {
        this._cachedToken = await getGoogleAccessToken(this.env.GCP_SERVICE_ACCOUNT_KEY);
        this._tokenExpiry = now + 3500 * 1000;
      }
      if (this._cachedToken) {
        headers['Authorization'] = `Bearer ${this._cachedToken}`;
      }
    }
    return headers;
  }

  /**
   * Get BSE Central State Document
   */
  async getBseState() {
    try {
      const headers = await this.getHeaders();
      const res = await fetch(`${this.baseUrl}/exchange/bse_state`, { headers });
      if (res.status === 404) {
        return this.getDefaultBseState();
      }
      if (!res.ok) {
        const text = await res.text();
        console.warn(`Firestore read warning (${res.status}):`, text);
        return this.getDefaultBseState();
      }
      const doc = await res.json();
      return fromFirestoreDoc(doc) || this.getDefaultBseState();
    } catch (err) {
      console.error('Failed to get BSE state from Firestore:', err);
      return this.getDefaultBseState();
    }
  }

  /**
   * Save BSE Central State Document
   */
  async saveBseState(state) {
    try {
      const headers = await this.getHeaders();
      const body = toFirestoreFields(state);
      const res = await fetch(`${this.baseUrl}/exchange/bse_state`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Firestore write failed [${res.status}]: ${text}`);
      }
      return true;
    } catch (err) {
      console.error('Failed to save BSE state to Firestore:', err);
      throw err;
    }
  }

  /**
   * Append an entry to the immutable audit log
   */
  async logAuditEvent(event) {
    try {
      const headers = await this.getHeaders();
      const entry = {
        ...event,
        timestamp: event.timestamp || new Date().toISOString()
      };
      const res = await fetch(`${this.baseUrl}/exchange_audit_log`, {
        method: 'POST',
        headers,
        body: JSON.stringify(toFirestoreFields(entry))
      });
      return res.ok;
    } catch (err) {
      console.error('Failed to log audit event:', err);
      return false;
    }
  }

  /**
   * Default initial BSE State for Season 1
   */
  getDefaultBseState() {
    return {
      season: 1,
      seasonTitle: 'Season 1: Dust & Glory',
      updatedAt: new Date().toISOString(),
      ranks: [
        { tier: 0, title: 'Initiate', costBones: 0, icon: '🪙', roleId: '' },
        { tier: 1, title: 'Dune Scavenger', costBones: 25, icon: '🏜️', roleId: '' },
        { tier: 2, title: 'Wasteland Raider', costBones: 75, icon: '⚔️', roleId: '' },
        { tier: 3, title: 'Shadow Broker', costBones: 150, icon: '💎', roleId: '' },
        { tier: 4, title: 'Exalted Broker', costBones: 300, icon: '👑', roleId: '' }
      ],
      wallets: {},
      bounties: [
        {
          id: 'bounty_raid_full_clear',
          title: 'Heroic Raid Clean Sweep',
          description: 'Participate in a full guild clear of current heroic raid content without missing a boss.',
          rewardBones: 50,
          category: 'Raid',
          status: 'active',
          createdAt: new Date().toISOString()
        },
        {
          id: 'bounty_mythic_plus_10',
          title: 'Wasteland Keymaster (+10 In-Time)',
          description: 'Complete a Mythic +10 or higher dungeon within timer alongside at least 3 guild members.',
          rewardBones: 25,
          category: 'Dungeon',
          status: 'active',
          createdAt: new Date().toISOString()
        },
        {
          id: 'bounty_guild_supplies',
          title: 'Cartel Provisioning',
          description: 'Deposit 200x Tier 3 Herbs or 50x Feast Cauldrons into the Guild Bank Vault.',
          rewardBones: 20,
          category: 'Economy',
          status: 'active',
          createdAt: new Date().toISOString()
        }
      ],
      shop: [
        {
          id: 'shop_flask_pack',
          title: 'Raid Consumables Crate',
          description: 'A bundle of 20x Combat Flasks and 40x Combat Potions supplied directly from the Cartel Vault.',
          costBones: 15,
          category: 'Consumables',
          stock: 50,
          unlimitedStock: false,
          maxPerMemberPerWeek: 2,
          enabled: true,
          fulfillmentNotes: 'Officer mails items directly to the member in-game.'
        },
        {
          id: 'shop_weapon_enchant',
          title: 'Free Weapon Enchant Token',
          description: 'Redeem for any maximum rank weapon enchantment provided and crafted by the guild.',
          costBones: 30,
          category: 'Enhancements',
          stock: 25,
          unlimitedStock: false,
          maxPerMemberPerWeek: 1,
          enabled: true,
          fulfillmentNotes: 'Officer contacts player to craft on trade or send via Work Order.'
        },
        {
          id: 'shop_custom_discord_color',
          title: 'Custom Discord Nickname Color / Role',
          description: 'Receive a personalized cosmetic color role of your choice in the Black Sands Discord server.',
          costBones: 60,
          category: 'Discord Perks',
          stock: 999,
          unlimitedStock: true,
          enabled: true,
          fulfillmentNotes: 'Officer assigns custom HEX color role in Discord.'
        },
        {
          id: 'shop_priority_loot_token',
          title: 'Priority Bench / Loot Token',
          description: 'Gain priority roster inclusion for farm bosses or primary claim on one non-tier offspec drop.',
          costBones: 100,
          category: 'Guild Perks',
          stock: 5,
          unlimitedStock: false,
          maxPerMemberPerWeek: 1,
          enabled: true,
          fulfillmentNotes: 'Redeem during raid sign-ups or loot council distribution.'
        }
      ],
      claims: {},
      deliveries: {},
      config: {
        standingsMessageId: '',
        bountiesMessageId: '',
        shopMessageId: ''
      }
    };
  }
}
