import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Client, ProbeError, cents, steamCny, feeTotal, sellerNet, quote, compare, rank,
  retryAfter, parseC5, parseSteam } from '../scripts/core.mjs';
import { scan, validateFeeObservations, validatePageObservations } from '../scripts/probe.mjs';

const wallet = { minimumCents: 7, incrementCents: 1, steamBasisPoints: 500, publisherBasisPoints: 1000 };
const item = { id: 'test', c5ItemId: '100', mappingStatus: 'verified', steamHashName: 'Test' };
const profile = { verified: true, wallet };
const pair = (id = 'b', cost = 100, gross = 115) => [quote('c5', id, cost, null, { itemId: '100' }), quote('steam', id, gross)];

// The same literal scenarios can be consumed by Android tests after stack selection.
// Verification flags here exist only inside controlled tests; no live profile is written.
const contract = JSON.parse(fs.readFileSync(new URL('../fixtures/comparison-contract.json', import.meta.url)));
test('cross-platform contract fixes net amounts, exclusion reasons and exact ranking', () => {
  assert.equal(contract.evidenceType, 'controlled_fixture');
  assert.equal(contract.schemaVersion, 1);
  const profile = { verified: true, wallet: contract.wallet };
  const calculate = (entry, id) => compare({ id, steamHashName: 'Fixture', c5ItemId: '100', mappingStatus: 'verified' },
    'current', quote('c5', 'current', entry.c5Cents, null, { itemId: '100' }),
    quote('steam', entry.steamBatchId ?? 'current', entry.steamBuyerCents, entry.steamFailure ?? null,
      { currency: entry.steamCurrency ?? 'CNY' }), entry.feeVerified === false ? null : profile);
  for (const entry of contract.comparisonCases) {
    const row = calculate(entry, entry.name), expected = entry.expected;
    assert.equal(row.rankable, expected.rankable, entry.name);
    if (!expected.rankable) assert.equal(row.reason, expected.reason, entry.name);
    else {
      assert.deepEqual(row.cashPer100Cny, { numeratorCents: expected.numeratorCents,
        denominator: expected.denominator, displayCents: expected.displayCents }, entry.name);
      assert.equal(row.fee.netCents, expected.netCents, entry.name);
      assert.equal(row.fee.steamFeeCents, expected.steamFeeCents, entry.name);
      assert.equal(row.fee.publisherFeeCents, expected.publisherFeeCents, entry.name);
    }
  }
  for (const entry of contract.rankingCases) {
    const rows = entry.items.map(i => calculate(i, i.id));
    assert.ok(rows.every(r => r.rankable), entry.name);
    const ranked = rank(rows);
    assert.deepEqual(ranked.map(r => r.item.id), entry.expectedIds, entry.name);
    assert.deepEqual(ranked.map(r => r.cashPer100Cny.displayCents), entry.expectedDisplayCents, entry.name);
    for (const row of ranked) assert.ok(rows.includes(row), 'detail and ranking share the same result object');
  }
});

test('cross-platform contract keeps previous complete result separate from a failed current scan', async () => {
  const input = contract.partialScan, previousInput = input.previous;
  const profile = { verified: true, wallet: contract.wallet };
  const prior = compare({ id: previousInput.id, c5ItemId: previousInput.c5ItemId,
    steamHashName: previousInput.steamHashName, mappingStatus: 'verified' }, 'previous',
    quote('c5', 'previous', previousInput.c5Cents, null, { itemId: previousInput.c5ItemId }),
    quote('steam', 'previous', previousInput.steamBuyerCents), profile);
  assert.equal(prior.rankable, true);
  const f = fake([ok(JSON.stringify(input.c5)), ...input.steam.map(value =>
    value.failure ? new ProbeError(value.failure) : ok(JSON.stringify(value)))]);
  const report = await scan(input.items, { client: f.client, c5Key: 'controlled-fixture-key',
    feeProfile: profile, previous: { [prior.item.id]: prior } });
  const expected = input.expected, failed = report.rows.find(r => r.item.id === expected.failedItemId);
  assert.deepEqual(report.rankings.map(r => r.item.id), expected.rankingIds);
  assert.equal(report.stagePassed, expected.stagePassed);
  assert.equal(failed.c5.amountCents, expected.currentC5Cents);
  assert.equal(failed.steam.amountCents, expected.currentSteamCents);
  const old = report.failures.find(r => r.itemId === expected.failedItemId).previousCompleteResult;
  assert.equal(old.batchId, 'previous');
  assert.equal(old.c5.amountCents, expected.previousC5Cents);
  assert.equal(old.steam.amountCents, expected.previousSteamCents);
  assert.equal(JSON.stringify(report).includes('controlled-fixture-key'), false);
});

test('integer money, large values, CNY parser rejects other currencies and malformed grouping', () => {
  assert.equal(cents('217.25'), 21725); assert.equal(steamCny('¥ 1,234.56'), 123456);
  for (const v of [null, '', '-1', '1.001', 'NaN', '900719925474099.99']) assert.throws(() => cents(v));
  for (const v of ['$ 1.00', 'HK$ 1.00', '¥ 1,23.00', '¥ 1.0']) assert.throws(() => steamCny(v));
});
test('parameterised fee boundaries and ambiguous inverse are explicit', () => {
  assert.deepEqual(feeTotal(7, wallet), { netCents: 7, steamFeeCents: 7, publisherFeeCents: 7, grossCents: 21 });
  assert.equal(feeTotal(100, wallet).grossCents, 117);
  assert.equal(feeTotal(10000, wallet).grossCents, 11500);
  assert.equal(sellerNet(117, wallet).netCents, 100);
  assert.throws(() => sellerNet(20, wallet));
  assert.equal(sellerNet(160, wallet).unrepresentableRemainderCents, 1);
  for (let net = 7; net < 2000; net++) assert.equal(sellerNet(feeTotal(net, wallet).grossCents, wallet).netCents, net);
});

test('fee arithmetic rejects overflow and validates wallet before inverse search', () => {
  assert.throws(() => feeTotal(Number.MAX_SAFE_INTEGER, wallet), { code: 'invalid_money' });
  assert.throws(() => sellerNet(117, null), { code: 'unsupported_fee_parameters' });
  const gross = Number.MAX_SAFE_INTEGER;
  const result = sellerNet(gross, wallet);
  assert.ok(Number.isSafeInteger(result.netCents));
  assert.equal(result.grossCents + result.unrepresentableRemainderCents, gross);
});

test('scan rejects empty or duplicate pools before network and freezes inputs during requests', async () => {
  const f = fake([]);
  for (const items of [[], [{ id: 'a' }], [{ id: 'a', steamHashName: 'A' }, { id: 'a', steamHashName: 'B' }],
    [{ id: 'a', steamHashName: 'A' }, { id: 'b', steamHashName: 'A' }]])
    await assert.rejects(scan(items, { client: f.client }), { code: 'invalid_pool' });
  assert.equal(f.calls(), 0);
  const items = [{ id: 'a', steamHashName: 'A' }];
  const client = new Client({ send: async () => {
    items[0].id = 'edited'; items.push({ id: 'b', steamHashName: 'B' });
    return ok('{"success":true,"lowest_price":"¥ 1.17"}');
  } });
  const report = await scan(items, { client, steamOnly: true });
  assert.equal(report.itemsRequested, 1); assert.equal(report.rows[0].item.id, 'a');
  const next = await scan([{ id: 'b', steamHashName: 'B' }], { client, steamOnly: true });
  assert.equal(next.metrics.requests, 1);
});
test('ranking excludes unverified fees, mixed batches, failed prices, mapping mismatch and currency mismatch', () => {
  const [c5, steam] = pair('b', 70, 117);
  const r = compare(item, 'b', c5, steam, profile);
  assert.equal(r.rankable, true); assert.equal(r.cashPer100Cny.displayCents, 7000);
  assert.equal(compare(item, 'b', c5, steam, null).reason, 'fee_unverified');
  assert.equal(compare(item, 'new', c5, steam, profile).reason, 'mixed_batches');
  assert.equal(compare(item, 'b', { ...c5, status: 'failed' }, steam, profile).reason, 'missing_current_quote');
  assert.equal(compare(item, 'b', { ...c5, currency: 'USD' }, steam, profile).reason, 'currency_mismatch');
  assert.equal(compare(item, 'b', { ...c5, amountCents: 0 }, steam, profile).rankable, false);
  assert.equal(compare({ ...item, c5ItemId: '101' }, 'b', c5, steam, profile).reason, 'mapping_unverified');
  assert.equal(compare(item, 'b', c5, { ...steam, amountCents: 160 }, profile).reason, 'fee_inverse_ambiguous');
  assert.equal(rank([{ ...r, item: { ...item, id: 'expensive' }, c5: { ...c5, amountCents: 80 } }, r])[0], r);
});
test('strict provider schemas, missing, delisted and renamed goods', () => {
  assert.equal(parseSteam('{"success":true,"lowest_price":"¥ 1.67"}'), 167);
  for (const value of ['{}', 'not-json', '{"success":true}', '{"success":false}']) assert.throws(() => parseSteam(value));
  const good = { itemId: '1098192327056363520', marketHashName: 'Test', price: 1.23, count: 2 };
  const data = v => JSON.stringify({ success: true, data: { Test: v } });
  assert.equal(parseC5(data(good), ['Test']).Test.amountCents, 123);
  assert.equal(parseC5(data(good), ['Missing']).Missing.failure, 'empty_quote');
  assert.equal(parseC5(data({ ...good, count: 0 }), ['Test']).Test.failure, 'mapping_or_availability');
  assert.equal(parseC5(data({ ...good, itemId: 1098192327056363520 }), ['Test']).Test.failure, 'mapping_or_availability');
  assert.equal(parseC5(data({ ...good, marketHashName: 'Other' }), ['Test']).Test.failure, 'mapping_or_availability');
  assert.throws(() => parseC5('{"success":false,"errorCode":400001}', ['Test']), { code: 'credential_invalid' });
});
function fake(responses) {
  let clock = 0, calls = 0; const sleeps = [];
  const client = new Client({ clock: () => clock, sleep: async ms => { sleeps.push(ms); clock += ms; },
    send: async () => { calls++; const v = responses.shift(); if (v instanceof Error) throw v; return v; } });
  return { client, calls: () => calls, sleeps };
}
const ok = text => ({ status: 200, headers: {}, text });
test('same-key requests merge and serial requests respect minimum interval', async () => {
  const f = fake([ok('a'), ok('b')]);
  const a = f.client.request('steam', 'a', 'https://example.com');
  const b = f.client.request('steam', 'a', 'https://example.com');
  assert.equal(a, b); await a;
  await f.client.request('steam', 'b', 'https://example.com');
  assert.equal(f.calls(), 2); assert.deepEqual(f.sleeps, [3000]);
});
test('429 stops source, persists cooldown callback and sends no further request', async () => {
  const f = fake([{ status: 429, headers: { 'retry-after': '120' }, text: 'secret-must-not-escape' }]);
  const events = []; f.client.onCooldown = (...args) => events.push(args);
  await assert.rejects(f.client.request('steam', 'a', 'https://example.com'), { code: 'rate_limited', retryAfterMs: 120000 });
  await assert.rejects(f.client.request('steam', 'b', 'https://example.com'), { code: 'cooldown' });
  assert.equal(f.calls(), 1); assert.deepEqual(events, [['steam', 120000]]);
  assert.equal(retryAfter('Thu, 01 Jan 1970 00:02:00 GMT', 0), 120000);
});
test('bounded 5xx retry, long Retry-After stops, credentials never appear in errors', async () => {
  const f = fake([{ status: 503, headers: {}, text: '' }, ok('recovered')]);
  assert.equal(await f.client.request('c5', 'a', 'https://example.com?app-key=sentinel'), 'recovered');
  assert.equal(f.calls(), 2); assert.equal(f.client.metrics.retries, 1);
  const exhaust = fake(Array(3).fill({ status: 500, headers: {}, text: '' }));
  await assert.rejects(exhaust.client.request('c5', 'a', 'https://example.com'), { code: 'http', status: 500 });
  assert.equal(exhaust.calls(), 3);
  const wait = fake([{ status: 503, headers: { 'retry-after': '121' }, text: '' }]);
  await assert.rejects(wait.client.request('c5', 'a', 'https://example.com'), { code: 'server_cooldown' });
  assert.equal(wait.calls(), 1);
  const bad = fake([{ status: 401, headers: {}, text: 'sentinel' }]);
  try { await bad.client.request('c5', 'a', 'https://example.com?app-key=sentinel'); assert.fail(); }
  catch (e) { assert.equal(e.code, 'auth_or_access'); assert.equal(JSON.stringify(e).includes('sentinel'), false); }
});
test('partial failure retains previous complete result and successful current item, never combines quotes', async () => {
  const c5 = JSON.stringify({ success: true, data: {
    A: { itemId: '1', marketHashName: 'A', price: 0.70, count: 1 },
    B: { itemId: '2', marketHashName: 'B', price: 0.80, count: 1 }
  } });
  const f = fake([ok(c5), ok('{"success":true,"lowest_price":"¥ 1.17"}'), new ProbeError('timeout')]);
  const items = [{ id: 'a', steamHashName: 'A' }, { id: 'b', steamHashName: 'B' }];
  const prior = { batchId: 'old', c5: { amountCents: 123 }, steam: { amountCents: 234 } };
  const result = await scan(items, { client: f.client, c5Key: 'sentinel', feeProfile: profile, previous: { b: prior } });
  assert.equal(result.rankableCount, 1); assert.equal(result.stagePassed, false);
  assert.equal(result.failures[0].previousCompleteResult, prior);
  assert.equal(result.rows[1].steam.amountCents, null);
  assert.equal(result.rows[1].c5.amountCents, 80);
  assert.equal(result.rows[0].c5.collectedAt, result.rows[1].c5.collectedAt);
  assert.equal(JSON.stringify(result).includes('sentinel'), false);
});
test('offline and empty quotes do not erase other results or qualify a stage', async () => {
  const f = fake([new ProbeError('network')]);
  const result = await scan([{ id: 'a', steamHashName: 'A' }], { client: f.client, steamOnly: true });
  assert.equal(result.rankableCount, 0); assert.equal(result.stagePassed, false);
  assert.equal(result.rows[0].steam.failure, 'network');
});
test('observation template cannot verify fees; synthetic examples remain unit tests', () => {
  const template = JSON.parse(fs.readFileSync(new URL('../fixtures/fee-observations.example.json', import.meta.url)));
  assert.throws(() => validateFeeObservations(template));
  const values = [7, 20, 69, 70, 139, 140, 10000].map(net => {
    const f = feeTotal(net, wallet);
    return { sellerReceivesCents: net, buyerPaysCents: f.grossCents,
      steamFeeCents: f.steamFeeCents, publisherFeeCents: f.publisherFeeCents };
  });
  // Test-only attestation exercises validation; never writes a verified live profile.
  const input = { evidenceType: 'manual_steam_cny_sell_dialog', attestedRealObservations: true,
    observedAt: '2026-10-02T00:00:00Z', walletParametersConfirmed: true, wallet, observations: values };
  assert.equal(validateFeeObservations(input).count, 7);
  const belowMinimum = structuredClone(input);
  belowMinimum.observations[0].sellerReceivesCents = 1;
  assert.throws(() => validateFeeObservations(belowMinimum), { code: 'fee_mismatch' });
  values[0].buyerPaysCents++;
  assert.throws(() => validateFeeObservations(input), { code: 'fee_mismatch' });
});
test('candidate pool has 50 unique identities and first six cover all categories', () => {
  const pool = JSON.parse(fs.readFileSync(new URL('../fixtures/candidate-pool.json', import.meta.url)));
  assert.equal(pool.length, 50); assert.equal(new Set(pool.map(i => i.steamHashName)).size, 50);
  assert.deepEqual(pool.slice(0, 6).map(i => i.category), ['case', 'case', 'capsule', 'capsule', 'sticker', 'sticker']);
  assert.ok(pool.every(i => i.c5ItemId === null && i.mappingStatus === 'pending'));
});
test('manual page verification rejects wrong currencies, identities, batches, prices and time gaps', () => {
  const observedAt = '2026-10-02T00:00:00Z';
  const report = { evidenceType: 'live_network', itemsRequested: 6, stagePassed: true, batchId: 'test',
    rows: Array.from({ length: 6 }, (_, i) => ({ item: { id: String(i), c5ItemId: String(i + 100), steamHashName: 'H' + i },
      c5: { amountCents: 100 }, steam: { amountCents: 117, collectedAt: observedAt } })) };
  const input = { evidenceType: 'manual_market_page_comparison', attestedRealObservations: true, batchId: 'test',
    items: report.rows.map(r => ({ itemId: r.item.id, c5ItemId: r.item.c5ItemId, steamHashName: r.item.steamHashName,
      currency: 'CNY', c5PagePriceCents: 100, steamPageBuyerTotalCents: 117, observedAt })) };
  assert.equal(validatePageObservations(report, input), true);
  for (const change of [{ currency: 'HKD' }, { c5ItemId: 'wrong' }, { c5PagePriceCents: 101 },
    { observedAt: '2026-10-02T01:00:00Z' }]) {
    const copy = structuredClone(input); Object.assign(copy.items[0], change);
    assert.throws(() => validatePageObservations(report, copy));
  }
  assert.throws(() => validatePageObservations(report, { ...input, batchId: 'other' }));
  assert.throws(() => validatePageObservations(report, { ...input, items: Array(6).fill(input.items[0]) }));
});
test('CLI blocks missing credentials, invalid scale and untouched fee template without network calls', () => {
  const env = { ...process.env }; delete env.C5_VALIDATION_APP_KEY;
  const run = args => spawnSync(process.execPath, ['scripts/probe.mjs', ...args], { env, encoding: 'utf8' });
  assert.match(run(['scan', '--stage', '6']).stderr, /credential_missing_use_hidden_prompt/);
  assert.match(run(['scan', '--stage', '20', '--steam-only']).stderr, /invalid_stage/);
  assert.match(run(['scan', '--stage', '50']).stderr, /previous_stage_not_passed_or_page_unchecked/);
  assert.match(run(['fees', '--observations', 'fixtures/fee-observations.example.json']).stderr, /fee_observations_missing/);
});
