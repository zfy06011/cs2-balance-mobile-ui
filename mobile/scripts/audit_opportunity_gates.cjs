// Stable ForecastBundle 下的 Gate/Cap/Near-Miss 审计；不联网、不修改生产结果。
const fs = require('fs');
const path = require('path');
function argValue(name, fallback) { const i = process.argv.indexOf(name); return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : fallback; }
function inc(map, key) { map[key] = (map[key] || 0) + 1; }
function rate(count, total) { return total ? count / total : 0; }
function quantile(values, p) { if (!values.length) return null; const a = values.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.ceil(a.length * p) - 1))]; }
function distribution(values) { return { count: values.length, min: quantile(values, 0), p10: quantile(values, .1), p25: quantile(values, .25), median: quantile(values, .5), p75: quantile(values, .75), p90: quantile(values, .9), max: quantile(values, 1) }; }
function audit(data) {
  const rows = data.rows || [];
  const gates = {}, primaryGates = {}, caps = {}, rawFinal = {}, lowPriceApprox = [];
  for (const row of rows) {
    for (const gate of row.hardGates || []) inc(gates, gate);
    for (const cap of row.caps || []) inc(caps, cap);
    inc(primaryGates, row.primaryGate || 'none');
    const key = `${row.rawDecision || 'unknown'}->${row.opportunityDecision || 'unknown'}`;
    inc(rawFinal, key);
    if ((row.warnings || []).includes('steam_fee_model_approximate') && (row.marketDataQuality ?? 1) >= 0) lowPriceApprox.push(row.item);
  }
  const expected = rows.map((x) => x.expectedDiscount).filter((x) => Number.isFinite(x));
  const conservative = rows.map((x) => x.conservativeDiscount).filter((x) => Number.isFinite(x));
  const gaps = rows.filter((x) => Number.isFinite(x.expectedDiscount) && Number.isFinite(x.conservativeDiscount)).map((x) => ({ item: x.item, gap: x.conservativeDiscount - x.expectedDiscount, expected: x.expectedDiscount, conservative: x.conservativeDiscount })).sort((a, b) => b.gap - a.gap).slice(0, 20);
  const nearMiss = rows.filter((x) => ['avoid', 'watch'].includes(x.opportunityDecision) && (x.rawScore >= 60 || Math.abs(70 - x.rawScore) <= 10)).sort((a, b) => b.rawScore - a.rawScore).slice(0, 20);
  const rank = (field, direction = 'desc') => rows.slice().sort((a, b) => {
    const av = Number.isFinite(a[field]) ? a[field] : direction === 'asc' ? Infinity : -Infinity;
    const bv = Number.isFinite(b[field]) ? b[field] : direction === 'asc' ? Infinity : -Infinity;
    return (direction === 'asc' ? av - bv : bv - av) || String(a.item).localeCompare(String(b.item));
  }).slice(0, 20);
  return {
    total: rows.length,
    gateDistribution: Object.fromEntries(Object.entries(gates).map(([key, count]) => [key, { count, rate: rate(count, rows.length) }])),
    primaryGateDistribution: Object.fromEntries(Object.entries(primaryGates).map(([key, count]) => [key, { count, rate: rate(count, rows.length) }])),
    capDistribution: Object.fromEntries(Object.entries(caps).map(([key, count]) => [key, { count, rate: rate(count, rows.length) }])),
    rawFinalDistribution: rawFinal,
    expectedDistribution: distribution(expected),
    conservativeDistribution: distribution(conservative),
    expectedBands: { lt075: expected.filter((x) => x < .75).length, b075_080: expected.filter((x) => x >= .75 && x < .80).length, b080_085: expected.filter((x) => x >= .80 && x < .85).length, b085_090: expected.filter((x) => x >= .85 && x < .90).length, b090_095: expected.filter((x) => x >= .90 && x < .95).length, b095_100: expected.filter((x) => x >= .95 && x < 1).length, ge100: expected.filter((x) => x >= 1).length },
    discountGapTop20: gaps,
    nearMissTop20: nearMiss,
    topRawScore: rank('rawScore'),
    topExpectedDiscount: rank('expectedDiscount', 'asc'),
    topConservativeDiscount: rank('conservativeDiscount', 'asc'),
    topCapacity: rank('currentLiquidityCapacity'),
    lowPriceApproxItems: lowPriceApprox,
    highRiskRecommendations: rows.filter((x) => ['buy', 'excellent'].includes(x.opportunityDecision) && (x.expectedDiscount >= 1 || x.currentLiquidityCapacity < 20 || x.marketState === 'CHAOS' || x.diagnostics?.stale || x.marketDataQuality < .6)).map((x) => x.item),
  };
}
if (require.main === module) {
  const file = argValue('--json', 'artifacts/shadow/frozen-score-a.json');
  const result = audit(JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')));
  const out = argValue('--out', null);
  if (out) fs.writeFileSync(path.resolve(process.cwd(), out), JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result, null, 2));
}
module.exports = { audit };
