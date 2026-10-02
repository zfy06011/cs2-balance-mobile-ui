import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { Client, now } from './core.mjs';

const sources = [
  ['c5_access', 'https://opendoc.c5game.com/', ['50qps', 'app-key']],
  ['c5_batch', 'https://opendoc.c5game.com/api-125914570', ['merchant/product/price/batch', 'marketHashNames']],
  ['c5_search', 'https://opendoc.c5game.com/api-414954214', ['merchant/market/v2/products/search']],
  ['steam_fee_code', 'https://steamcommunity.com/public/javascript/economy_common.js',
    ['GetTotalWithFees', 'GetItemPriceFromTotal', 'wallet_market_minimum']]
];
const client = new Client({ intervalMs: 3000 });
const records = [];
for (const [id, url, markers] of sources) {
  try {
    const text = await client.request('public_docs', id, url);
    records.push({ id, url, retrievedAt: now(), status: 'retrieved',
      sha256: createHash('sha256').update(text).digest('hex'),
      bytes: Buffer.byteLength(text), markers: Object.fromEntries(markers.map(m => [m, text.includes(m)])) });
  } catch (error) { records.push({ id, url, retrievedAt: now(), status: 'failed', reason: error.code }); }
}
const file = new URL('../artifacts/official-sources.json', import.meta.url);
fs.mkdirSync(new URL('../artifacts/', import.meta.url), { recursive: true });
fs.writeFileSync(file, JSON.stringify({ evidenceType: 'official_public_source_retrieval', records }, null, 2) + '\n');
console.log(JSON.stringify(records));
