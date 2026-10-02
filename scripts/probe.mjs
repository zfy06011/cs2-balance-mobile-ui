import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { Client, ProbeError, now, quote, compare, rank, parseSteam, parseC5, feeTotal } from './core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'artifacts');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const save = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(temporary, file);
};

export function validateFeeObservations(input) {
  if (input?.evidenceType !== 'manual_steam_cny_sell_dialog' || input?.attestedRealObservations !== true ||
      !input.observedAt || !Number.isFinite(Date.parse(input.observedAt)) ||
      !Array.isArray(input.observations) || input.observations.length < 6)
    throw new ProbeError('fee_observations_missing');
  if (!input.wallet || !input.walletParametersConfirmed) throw new ProbeError('wallet_unconfirmed');
  const values = input.observations;
  if (new Set(values.map(x => x.sellerReceivesCents)).size < 6 ||
      !values.some(x => x.sellerReceivesCents <= 20) ||
      !values.some(x => x.sellerReceivesCents >= 10000)) throw new ProbeError('fee_coverage');
  for (const entry of values) {
    const actual = feeTotal(entry.sellerReceivesCents, input.wallet);
    if (actual.netCents !== entry.sellerReceivesCents || actual.grossCents !== entry.buyerPaysCents ||
        actual.steamFeeCents !== entry.steamFeeCents ||
        actual.publisherFeeCents !== entry.publisherFeeCents) throw new ProbeError('fee_mismatch');
  }
  return { verified: true, evidenceType: input.evidenceType, observedAt: input.observedAt,
    wallet: input.wallet, count: values.length,
    observationsSha256: createHash('sha256').update(JSON.stringify(input)).digest('hex') };
}

export function validatePageObservations(report, input) {
  if (report.evidenceType !== 'live_network' || report.itemsRequested !== 6 || !report.stagePassed ||
      input?.evidenceType !== 'manual_market_page_comparison' || input.attestedRealObservations !== true ||
      input.batchId !== report.batchId || !Array.isArray(input.items) || input.items.length !== 6)
    throw new ProbeError('page_evidence_missing');
  if (new Set(input.items.map(i => i.itemId)).size !== 6) throw new ProbeError('duplicate_page_evidence');
  for (const row of report.rows) {
    const entry = input.items.find(i => i.itemId === row.item.id);
    if (!entry || entry.c5ItemId !== row.item.c5ItemId || entry.steamHashName !== row.item.steamHashName ||
        entry.currency !== 'CNY' || entry.c5PagePriceCents !== row.c5.amountCents ||
        entry.steamPageBuyerTotalCents !== row.steam.amountCents ||
        !Number.isFinite(Date.parse(entry.observedAt)) ||
        Math.abs(Date.parse(entry.observedAt) - Date.parse(row.steam.collectedAt)) > 120000)
      throw new ProbeError('page_quote_mismatch_or_time_gap');
  }
  return true;
}

export async function scan(items, { client, c5Key = null, feeProfile = null, previous = {}, steamOnly = false,
  progress = () => {} } = {}) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50 ||
      items.some(i => !i || typeof i.id !== 'string' || !i.id.trim() ||
        typeof i.steamHashName !== 'string' || !i.steamHashName.trim()) ||
      new Set(items.map(i => i.id)).size !== items.length ||
      new Set(items.map(i => i.steamHashName)).size !== items.length)
    throw new ProbeError('invalid_pool');
  // Freeze the batch before the first await; candidate edits apply to the next scan.
  items = structuredClone(items);
  const initialMetrics = { ...client.metrics };
  const batchId = randomUUID(), started = performance.now();
  let c5Values = {}, c5Failure = c5Key ? null : 'credential_missing', c5CollectedAt = null;
  if (c5Key && !steamOnly) {
    const url = new URL('https://openapi.c5game.com/merchant/product/price/batch');
    url.searchParams.set('app-key', c5Key);
    try {
      const text = await client.request('c5', batchId, url,
        { body: JSON.stringify({ appId: '730', marketHashNames: items.map(i => i.steamHashName) }) });
      c5Values = parseC5(text, items.map(i => i.steamHashName));
      c5CollectedAt = now();
    } catch (error) { c5Failure = error.code ?? 'network'; }
  }
  const rows = [], failures = [];
  let firstResultMs = null, firstSteamQuoteMs = null;
  for (const seed of items) {
    const v = c5Values[seed.steamHashName];
    const item = v && !v.failure ? { ...seed, c5ItemId: v.itemId,
      mappingStatus: 'verified', mappingEvidence: 'c5_batch_exact_hash_and_item_id' } : seed;
    const c5 = quote('c5', batchId, v?.amountCents ?? null, steamOnly ? 'not_requested' :
      (c5Failure ?? v?.failure ?? (v ? null : 'empty_quote')),
      { itemId: v?.itemId ?? null, collectedAt: c5CollectedAt });
    let steam;
    try {
      const url = new URL('https://steamcommunity.com/market/priceoverview/');
      url.search = new URLSearchParams({ appid: '730', currency: '23', market_hash_name: seed.steamHashName });
      const amount = parseSteam(await client.request('steam', seed.steamHashName, url));
      steam = quote('steam', batchId, amount);
      firstSteamQuoteMs ??= Math.round(performance.now() - started);
    } catch (error) { steam = quote('steam', batchId, null, error.code ?? 'network'); }
    const result = compare(item, batchId, c5, steam, feeProfile);
    rows.push(result);
    if (result.rankable) firstResultMs ??= Math.round(performance.now() - started);
    else failures.push({ itemId: item.id, reason: result.reason,
      previousCompleteResult: previous[item.id] ?? null });
    progress({ itemId: item.id, c5Status: c5.status, steamStatus: steam.status,
      rankable: result.rankable, reason: result.reason });
  }
  const rankings = rank(rows);
  return { schemaVersion: 1, evidenceType: 'live_network', device: 'desktop_node', batchId,
    completedAt: now(), itemsRequested: items.length, firstResultMs, firstSteamQuoteMs,
    elapsedMs: Math.round(performance.now() - started), metrics: Object.fromEntries(
      Object.entries(client.metrics).map(([key, value]) => [key, value - (initialMetrics[key] ?? 0)])),
    pairedQuotes: rows.filter(r => r.c5.status === 'success' && r.steam.status === 'success').length,
    rankableCount: rankings.length, rows, rankings, failures,
    stagePassed: !steamOnly && rankings.length === items.length,
    mobilePerformanceVerified: false };
}

async function main() {
  const args = process.argv.slice(2), command = args.shift();
  const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
  if (command === 'fees') {
    const file = option('--observations', null);
    if (!file) throw new ProbeError('observations_path_required');
    const profile = validateFeeObservations(read(file));
    save(path.join(OUT, 'fee-profile.json'), profile);
    console.log(JSON.stringify({ status: 'manual_fee_observations_passed', count: profile.count }));
    return;
  }
  if (command === 'verify-pages') {
    const file = option('--observations', null), batch = option('--batch', null);
    if (!file || !/^[0-9a-f-]{36}$/.test(batch ?? '')) throw new ProbeError('page_evidence_arguments');
    const report = read(path.join(OUT, 'scans', batch + '.json'));
    const input = read(file); validatePageObservations(report, input);
    const stateFile = path.join(OUT, 'state.json'), state = read(stateFile);
    if (state.stages[6]?.reportBatchId !== batch) throw new ProbeError('stage_report_mismatch');
    state.stages[6].pageChecked = true;
    state.stages[6].pageObservationsSha256 = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    save(stateFile, state); console.log(JSON.stringify({ status: 'manual_page_comparison_passed', batchId: batch }));
    return;
  }
  if (command !== 'scan') {
    console.log('node scripts/probe.mjs scan --stage 6 [--steam-only]\nnode scripts/probe.mjs scan --stage 20|50\nnode scripts/probe.mjs fees --observations <local-json>\nnode scripts/probe.mjs verify-pages --batch <uuid> --observations <local-json>');
    return;
  }
  const stage = Number(option('--stage', '6')), steamOnly = args.includes('--steam-only');
  if (![6, 20, 50].includes(stage) || (steamOnly && stage !== 6)) throw new ProbeError('invalid_stage');
  let c5Key = process.env.C5_VALIDATION_APP_KEY ?? null;
  delete process.env.C5_VALIDATION_APP_KEY;
  const stateFile = path.join(OUT, 'state.json');
  const state = fs.existsSync(stateFile) ? read(stateFile) : { stages: {}, completeResults: {}, cooldowns: {} };
  if (stage > 6) {
    const prerequisite = stage === 20 ? 6 : 20;
    const result = state.stages[prerequisite];
    if (!result?.passed || !state.stages[6]?.pageChecked || (stage === 50 && result.passedRuns < 3))
      throw new ProbeError('previous_stage_not_passed_or_page_unchecked');
  }
  if (!steamOnly && !c5Key) throw new ProbeError('credential_missing_use_hidden_prompt');
  if ((state.cooldowns.steam ?? 0) > Date.now() || (!steamOnly && (state.cooldowns.c5 ?? 0) > Date.now()))
    throw new ProbeError('persisted_cooldown');
  const profileFile = path.join(OUT, 'fee-profile.json');
  const feeProfile = fs.existsSync(profileFile) ? read(profileFile) : null;
  if (stage > 6 && !feeProfile?.verified) throw new ProbeError('fee_unverified');
  const seeds = read(path.join(ROOT, 'fixtures', 'candidate-pool.json')).slice(0, stage);
  if (seeds.length !== stage || new Set(seeds.map(i => i.steamHashName)).size !== stage) throw new ProbeError('invalid_pool');
  const client = new Client({ onCooldown(source, until) {
    state.cooldowns[source] = until; save(stateFile, state);
  } });
  client.cooldowns = new Map(Object.entries(state.cooldowns));
  const report = await scan(seeds, { client, c5Key, steamOnly, feeProfile,
    previous: state.completeResults, progress: entry => console.log(JSON.stringify(entry)) });
  c5Key = null;
  for (const row of report.rankings) state.completeResults[row.item.id] = row;
  const prior = state.stages[stage];
  state.stages[stage] = { passed: report.stagePassed,
    passedRuns: report.stagePassed ? (prior?.passedRuns ?? 0) + 1 : 0, reportBatchId: report.batchId };
  save(stateFile, state);
  save(path.join(OUT, 'scans', report.batchId + '.json'), report);
  console.log(JSON.stringify({ report: 'artifacts/scans/' + report.batchId + '.json',
    elapsedMs: report.elapsedMs, pairedQuotes: report.pairedQuotes,
    rankableCount: report.rankableCount, stagePassed: report.stagePassed }));
  process.exitCode = report.stagePassed || (steamOnly && report.rows.every(r => r.steam.status === 'success')) ? 0 : 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(JSON.stringify({ status: 'blocked', reason: error.code ?? 'local_error' })); process.exitCode = 2; });
