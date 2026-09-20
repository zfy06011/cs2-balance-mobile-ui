// V3-PHASE-3B.1：扩大候选池并统计 gate/cap/near-miss/稳定性。
// 通过子进程调用 CLI Shadow Runner，C5_APP_KEY 只继承当前进程环境，不写入产物。
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const artifactDir = path.resolve(root, '..', 'artifacts', 'shadow');
fs.mkdirSync(artifactDir, { recursive: true });
const runner = path.join(__dirname, 'run_opportunity_shadow.cjs');

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] != null ? process.argv[index + 1] : fallback;
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function increment(map, key) { map[key] = (map[key] ?? 0) + 1; }
function rate(count, total) { return total > 0 ? count / total : 0; }
function sortedRows(rows, field, direction = 'desc') {
  return rows.slice().sort((a, b) => {
    const av = a[field] == null ? (direction === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY) : Number(a[field]);
    const bv = b[field] == null ? (direction === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY) : Number(b[field]);
    if (av !== bv) return direction === 'asc' ? av - bv : bv - av;
    const ac = Number(a.currentLiquidityCapacity ?? 0);
    const bc = Number(b.currentLiquidityCapacity ?? 0);
    if (ac !== bc) return bc - ac;
    return String(a.item).localeCompare(String(b.item));
  });
}
function topRows(rows, field, direction = 'desc', limit = 20) {
  return sortedRows(rows, field, direction).slice(0, limit).map((row) => ({
    item: row.item,
    rawScore: row.rawScore,
    rawDecision: row.rawDecision,
    finalDecision: row.opportunityDecision,
    primaryGate: row.primaryGate,
    expectedDiscount: row.expectedDiscount,
    conservativeDiscount: row.conservativeDiscount,
    listingDiscount: row.listingDiscount,
    capacity: row.currentLiquidityCapacity,
    spreadPct: row.spreadPct,
    volume24h: row.volume24h,
    marketState: row.marketState,
    marketDataQuality: row.marketDataQuality,
    forecastQuality: row.forecastQuality,
    warnings: row.warnings,
    caps: row.caps,
  }));
}
function overlap(a, b) {
  const bs = new Set(b);
  return a.filter((x) => bs.has(x)).length / Math.max(1, new Set([...a, ...b]).size);
}
function analyzeRound(data) {
  const rows = data.rows;
  const gates = {};
  const caps = {};
  const primaryGates = {};
  const pools = {};
  for (const row of rows) {
    for (const gate of row.hardGates || []) increment(gates, gate);
    for (const cap of row.caps || []) increment(caps, cap);
    increment(primaryGates, row.primaryGate || 'none');
    increment(pools, row.poolSource || 'unknown');
  }
  const nearMiss = rows.filter((row) => (row.opportunityDecision === 'avoid' || row.opportunityDecision === 'watch') && (row.rawScore >= 60 || Math.abs(70 - row.rawScore) <= 10));
  const lowDiscountAvoid = rows.filter((row) => row.opportunityDecision === 'avoid' && row.expectedDiscount != null && row.expectedDiscount < 0.90);
  const highCapacityBadDiscount = rows.filter((row) => row.currentLiquidityCapacity != null && row.currentLiquidityCapacity >= 300 && row.expectedDiscount != null && row.expectedDiscount >= 1.0);
  const highRiskRecommendations = rows.filter((row) => ['buy', 'excellent'].includes(row.opportunityDecision) && (
    (row.expectedDiscount != null && row.expectedDiscount >= 1)
    || (row.currentLiquidityCapacity != null && row.currentLiquidityCapacity < 20)
    || row.marketState === 'CHAOS'
    || row.diagnostics?.stale === true
    || (row.marketDataQuality != null && row.marketDataQuality < 0.60)
    || (row.warnings || []).includes('steam_fee_model_approximate') && row.expectedDiscount != null && row.expectedDiscount < 0
  ));
  const orderbookSuccess = rows.filter((row) => row.diagnostics.orderbookOk).length;
  const c5Success = rows.filter((row) => !row.diagnostics.missingFields.includes('c5.unitPrice')).length;
  const forecastSuccess = rows.filter((row) => !row.diagnostics.missingFields.includes('forecast')).length;
  const volumeSuccess = rows.filter((row) => !row.diagnostics.missingFields.includes('volume24h')).length;
  const c5SupplySuccess = rows.filter((row) => !row.diagnostics.missingFields.includes('c5AvailableQuantity')).length;
  return {
    universeCount: data.universeCount ?? rows.length,
    candidateCount: data.candidateCount ?? rows.length,
    attemptedCount: rows.length,
    successCount: data.summary.successItems,
    poolSource: pools,
    gateDistribution: Object.fromEntries(Object.entries(gates).map(([key, count]) => [key, { count, rate: rate(count, rows.length) }])),
    primaryGateDistribution: Object.fromEntries(Object.entries(primaryGates).map(([key, count]) => [key, { count, rate: rate(count, rows.length) }])),
    capDistribution: Object.fromEntries(Object.entries(caps).map(([key, count]) => [key, { count, rate: rate(count, rows.length) }])),
    dataCoverage: {
      orderbook: { count: orderbookSuccess, rate: rate(orderbookSuccess, rows.length) },
      c5: { count: c5Success, rate: rate(c5Success, rows.length) },
      forecast: { count: forecastSuccess, rate: rate(forecastSuccess, rows.length) },
      volume: { count: volumeSuccess, rate: rate(volumeSuccess, rows.length) },
      c5Supply: { count: c5SupplySuccess, rate: rate(c5SupplySuccess, rows.length) },
    },
    nearMiss: topRows(nearMiss, 'rawScore', 'desc', 20),
    lowDiscountAvoid: topRows(lowDiscountAvoid, 'expectedDiscount', 'asc', 20),
    highCapacityBadDiscount: topRows(highCapacityBadDiscount, 'currentLiquidityCapacity', 'desc', 20),
    topRawScore: topRows(rows, 'rawScore', 'desc', 20),
    topExpectedDiscount: topRows(rows, 'expectedDiscount', 'asc', 20),
    topCapacity: topRows(rows, 'currentLiquidityCapacity', 'desc', 20),
    decisionDistribution: { old: data.summary.oldDistribution, new: data.summary.newDistribution, disagreements: data.summary.disagreementDistribution },
    highRiskRecommendationCount: highRiskRecommendations.length,
    rows,
  };
}

async function main() {
  const limit = Math.max(80, Number(argValue('--limit', 100)) || 100);
  const rounds = Math.max(1, Math.min(3, Number(argValue('--rounds', 2)) || 2));
  const concurrency = Math.max(1, Math.min(4, Number(argValue('--concurrency', 3)) || 3));
  const intervalMs = Math.max(0, (Number(argValue('--interval-sec', 0)) || 0) * 1000);
  const forecastBundle = argValue('--forecast-bundle', null);
  const roundsOut = [];
  const reuse = process.argv.includes('--reuse');
  for (let round = 0; round < rounds; round++) {
    const jsonPath = path.join(artifactDir, `opportunity-shadow-coverage-round-${round + 1}.json`);
    if (!reuse) {
      const runnerArgs = ['--use-env-proxy', '--use-system-ca', runner, '--limit', String(limit), '--concurrency', String(concurrency), '--json-out', jsonPath];
      if (forecastBundle) runnerArgs.push('--forecast-bundle', forecastBundle);
      execFileSync(process.execPath, runnerArgs, {
        cwd: root,
        env: process.env,
        stdio: ['ignore', 'ignore', 'inherit'],
        maxBuffer: 20 * 1024 * 1024,
      });
    }
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    roundsOut.push({ round: round + 1, analyzed: analyzeRound(data), summary: data.summary });
    if (round + 1 < rounds && intervalMs > 0) await sleep(intervalMs);
  }
  const first = roundsOut[0].analyzed;
  const top10Raw = roundsOut.map((round) => round.analyzed.topRawScore.slice(0, 10).map((row) => row.item));
  const top10Expected = roundsOut.map((round) => round.analyzed.topExpectedDiscount.slice(0, 10).map((row) => row.item));
  const overlapRaw = [];
  const overlapExpected = [];
  for (let i = 1; i < roundsOut.length; i++) {
    overlapRaw.push(overlap(top10Raw[i - 1], top10Raw[i]));
    overlapExpected.push(overlap(top10Expected[i - 1], top10Expected[i]));
  }
  const output = {
    generatedAt: new Date().toISOString(),
    rounds: roundsOut.map(({ round, analyzed, summary }) => ({ round, summary, ...analyzed, rows: undefined })),
    stability: { rounds, rawTop10Overlap: overlapRaw, expectedTop10Overlap: overlapExpected },
    acceptance: {
      attemptedAtLeast80: first.attemptedCount >= 80,
      overallSuccessAtLeast90: roundsOut.every((round) => round.summary.successRate >= 0.90),
      orderbookCoverageAtLeast90: roundsOut.every((round) => round.analyzed.dataCoverage.orderbook.rate >= 0.90),
      c5CoverageAtLeast90: roundsOut.every((round) => round.analyzed.dataCoverage.c5.rate >= 0.90),
      highRiskRecommendations: roundsOut.reduce((sum, round) => sum + round.analyzed.highRiskRecommendationCount, 0),
    },
  };
  const outPath = path.join(artifactDir, 'opportunity-shadow-coverage-summary.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(JSON.stringify({ acceptance: output.acceptance, stability: output.stability, rounds: output.rounds.map((round) => ({ round: round.round, attemptedCount: round.attemptedCount, successCount: round.successCount, successRate: round.summary.successRate, dataCoverage: round.dataCoverage, primaryGateDistribution: round.primaryGateDistribution, capDistribution: round.capDistribution, decisionDistribution: round.decisionDistribution })) }, null, 2));
  if (!output.acceptance.attemptedAtLeast80 || !output.acceptance.overallSuccessAtLeast90 || !output.acceptance.orderbookCoverageAtLeast90 || !output.acceptance.c5CoverageAtLeast90 || output.acceptance.highRiskRecommendations > 0) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
