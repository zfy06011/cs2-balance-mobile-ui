import https from 'node:https';
import { gunzipSync, inflateSync, brotliDecompressSync, zstdDecompressSync } from 'node:zlib';

export const now = () => new Date().toISOString();
export class ProbeError extends Error {
  constructor(code, status = null, retryAfterMs = null) {
    super(code); this.code = code; this.status = status; this.retryAfterMs = retryAfterMs;
  }
}
export function cents(value) {
  const s = String(value);
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(s)) throw new ProbeError('invalid_money');
  const [whole, fraction = ''] = s.split('.');
  const n = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new ProbeError('invalid_money');
  return Number(n);
}
export function steamCny(value) {
  if (typeof value !== 'string' || !/^(¥|￥)\s*(\d{1,3}(,\d{3})*|\d+)\.\d{2}$/.test(value))
    throw new ProbeError('currency_or_price_format');
  return cents(value.replace(/^[¥￥]\s*/, '').replaceAll(',', ''));
}
function positiveInt(n) { return Number.isSafeInteger(n) && n > 0; }
// Independent integer model of the observed Steam forward-fee behaviour.
// Wallet parameters and seller-dialog observations must be verified separately.
function feeParts(net, wallet) {
  if (!positiveInt(net) || !wallet || !positiveInt(wallet.minimumCents) || wallet.incrementCents !== 1 ||
      wallet.steamBasisPoints !== 500 || wallet.publisherBasisPoints !== 1000)
    throw new ProbeError('unsupported_fee_parameters');
  const base = BigInt(Math.max(net, wallet.minimumCents));
  const minimum = BigInt(wallet.minimumCents);
  const fee = rate => {
    const amount = BigInt(net) * BigInt(rate) / 10000n;
    return amount < minimum ? minimum : amount;
  };
  const steamFee = fee(wallet.steamBasisPoints), publisherFee = fee(wallet.publisherBasisPoints);
  return { base, steamFee, publisherFee, gross: base + steamFee + publisherFee };
}
export function feeTotal(net, wallet) {
  const parts = feeParts(net, wallet);
  if (parts.gross > BigInt(Number.MAX_SAFE_INTEGER)) throw new ProbeError('invalid_money');
  return { netCents: Number(parts.base), steamFeeCents: Number(parts.steamFee),
    publisherFeeCents: Number(parts.publisherFee), grossCents: Number(parts.gross) };
}
export function sellerNet(gross, wallet) {
  if (!positiveInt(gross)) throw new ProbeError('invalid_money');
  feeParts(1, wallet);
  let lo = wallet.minimumCents, hi = gross, best = null;
  while (lo <= hi) {
    const mid = lo + Math.floor((hi - lo) / 2), parts = feeParts(mid, wallet);
    if (parts.gross <= BigInt(gross)) { best = feeTotal(mid, wallet); lo = mid + 1; } else hi = mid - 1;
  }
  if (!best) throw new ProbeError('below_market_minimum');
  return { ...best, unrepresentableRemainderCents: gross - best.grossCents };
}
export function quote(source, batchId, amountCents = null, failure = null, extra = {}) {
  return { source, batchId, collectedAt: now(), currency: 'CNY', amountCents,
    basis: source === 'steam' ? 'lowest_listing_buyer_total' : 'lowest_on_sale_single_item',
    status: failure ? 'failed' : 'success', failure, ...extra };
}
export function compare(item, batchId, c5, steam, feeProfile) {
  const row = { item, batchId, c5, steam, rankable: false, reason: null };
  if (!c5 || !steam || c5.status !== 'success' || steam.status !== 'success')
    return { ...row, reason: 'missing_current_quote' };
  if (c5.batchId !== batchId || steam.batchId !== batchId)
    return { ...row, reason: 'mixed_batches' };
  if (c5.currency !== 'CNY' || steam.currency !== 'CNY')
    return { ...row, reason: 'currency_mismatch' };
  if (!positiveInt(c5.amountCents) || !positiveInt(steam.amountCents))
    return { ...row, reason: 'nonpositive_or_invalid_quote' };
  if (item.mappingStatus !== 'verified' || !item.c5ItemId ||
      !c5.itemId || item.c5ItemId !== c5.itemId)
    return { ...row, reason: 'mapping_unverified' };
  if (feeProfile?.verified !== true) return { ...row, reason: 'fee_unverified' };
  try {
    const fee = sellerNet(steam.amountCents, feeProfile.wallet);
    // A buyer total between representable prices cannot prove an exact seller payout.
    if (fee.unrepresentableRemainderCents !== 0)
      return { ...row, fee, reason: 'fee_inverse_ambiguous' };
    const numerator = BigInt(c5.amountCents) * 10000n, denominator = BigInt(fee.netCents);
    const display = (numerator + denominator / 2n) / denominator;
    if (display > BigInt(Number.MAX_SAFE_INTEGER)) return { ...row, reason: 'invalid_money' };
    return { ...row, rankable: true, fee,
      cashPer100Cny: { numeratorCents: numerator.toString(), denominator: denominator.toString(),
        displayCents: Number(display) } };
  } catch (error) { return { ...row, reason: error.code ?? 'fee_error' }; }
}
export function rank(rows) {
  return rows.filter(r => r.rankable).sort((a, b) => {
    const left = BigInt(a.c5.amountCents) * BigInt(b.fee.netCents);
    const right = BigInt(b.c5.amountCents) * BigInt(a.fee.netCents);
    return left < right ? -1 : left > right ? 1 : a.item.id.localeCompare(b.item.id);
  });
}
export function retryAfter(value, time = Date.now()) {
  if (value == null) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const d = Date.parse(value);
  return Number.isFinite(d) ? Math.max(0, d - time) : null;
}
export function transport(url, { body = null, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: body ? 'POST' : 'GET', headers: {
      'User-Agent': 'CS2BalanceValidation/0.0.0', 'Accept': 'application/json,text/html',
      'Accept-Encoding': 'gzip, br, zstd, deflate',
      ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {})
    } }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length;
        if (size > 3000000) { req.destroy(); reject(new ProbeError('response_too_large')); }
        else chunks.push(chunk);
      });
      response.on('error', () => reject(new ProbeError('network')));
      response.on('end', () => {
        try {
          let bytes = Buffer.concat(chunks);
          const encoding = response.headers['content-encoding'];
          if (encoding === 'gzip') bytes = gunzipSync(bytes, { maxOutputLength: 6000000 });
          else if (encoding === 'br') bytes = brotliDecompressSync(bytes, { maxOutputLength: 6000000 });
          else if (encoding === 'zstd') bytes = zstdDecompressSync(bytes, { maxOutputLength: 6000000 });
          else if (encoding === 'deflate') bytes = inflateSync(bytes, { maxOutputLength: 6000000 });
          else if (encoding && encoding !== 'identity') throw new ProbeError('encoding');
          resolve({ status: response.statusCode, headers: response.headers, text: bytes.toString('utf8') });
        } catch { reject(new ProbeError('decode')); }
      });
    });
    const timer = setTimeout(() => req.destroy(new ProbeError('timeout')), timeoutMs);
    req.on('close', () => clearTimeout(timer));
    req.on('error', error => reject(new ProbeError(error.code === 'timeout' ? 'timeout' : 'network')));
    if (body) req.write(body);
    req.end();
  });
}
export class Client {
  constructor({ send = transport, sleep = ms => new Promise(r => setTimeout(r, ms)),
    clock = Date.now, intervalMs = 3000, onCooldown = () => {} } = {}) {
    this.send = send; this.sleep = sleep; this.clock = clock; this.intervalMs = intervalMs;
    this.onCooldown = onCooldown; this.inflight = new Map(); this.last = new Map();
    this.cooldowns = new Map(); this.metrics = { requests: 0, retries: 0, rateLimits: 0 };
    this.queue = Promise.resolve();
  }
  request(source, key, url, options = {}) {
    const cacheKey = source + ':' + key;
    if (this.inflight.has(cacheKey)) return this.inflight.get(cacheKey);
    const p = this.queue.then(() => this.run(source, url, options));
    this.queue = p.catch(() => {}); this.inflight.set(cacheKey, p);
    p.then(() => this.inflight.delete(cacheKey), () => this.inflight.delete(cacheKey));
    return p;
  }
  async run(source, url, options) {
    if ((this.cooldowns.get(source) ?? 0) > this.clock()) throw new ProbeError('cooldown');
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = this.intervalMs - (this.clock() - (this.last.get(source) ?? -Infinity));
      if (wait > 0) await this.sleep(wait);
      this.last.set(source, this.clock()); this.metrics.requests++;
      let response;
      try { response = await this.send(url, options); }
      catch (error) { throw new ProbeError(error.code ?? 'network'); }
      if (response.status === 429) {
        this.metrics.rateLimits++;
        const duration = Math.max(retryAfter(response.headers['retry-after'], this.clock()) ?? 900000, 1000);
        const until = this.clock() + duration; this.cooldowns.set(source, until);
        this.onCooldown(source, until); throw new ProbeError('rate_limited', 429, duration);
      }
      if (response.status >= 500 && response.status <= 599 && attempt < 2) {
        const wait = Math.max(retryAfter(response.headers['retry-after'], this.clock()) ?? 0, 2000 * 2 ** attempt);
        if (wait > 60000) {
          const until = this.clock() + wait; this.cooldowns.set(source, until);
          this.onCooldown(source, until); throw new ProbeError('server_cooldown', response.status, wait);
        }
        this.metrics.retries++; await this.sleep(wait); continue;
      }
      if (response.status < 200 || response.status >= 300)
        throw new ProbeError(response.status === 401 || response.status === 403 ? 'auth_or_access' : 'http', response.status);
      return response.text;
    }
  }
}
export function parseSteam(text) {
  let data; try { data = JSON.parse(text); } catch { throw new ProbeError('schema'); }
  if (data?.success !== true) throw new ProbeError('unavailable');
  if (!data.lowest_price) throw new ProbeError('empty_quote');
  return steamCny(data.lowest_price);
}
export function parseC5(text, hashNames) {
  let data; try { data = JSON.parse(text); } catch { throw new ProbeError('schema'); }
  if (data?.success !== true) throw new ProbeError(data?.errorCode === 400001 ? 'credential_invalid' : 'c5_rejected');
  if (!data.data || typeof data.data !== 'object' || Array.isArray(data.data)) throw new ProbeError('schema');
  return Object.fromEntries(hashNames.map(hash => {
    try {
      const value = data.data[hash];
      if (!value) throw new ProbeError('empty_quote');
      if (value.marketHashName !== hash ||
          !(typeof value.itemId === 'string' || Number.isSafeInteger(value.itemId)) ||
          !/^[1-9]\d*$/.test(String(value.itemId ?? '')) ||
          !Number.isSafeInteger(value.count) || value.count <= 0) throw new ProbeError('mapping_or_availability');
      const amountCents = cents(value.price);
      if (!amountCents) throw new ProbeError('empty_quote');
      return [hash, { amountCents, itemId: String(value.itemId), count: value.count }];
    } catch (error) { return [hash, { failure: error.code ?? 'schema' }]; }
  }));
}
