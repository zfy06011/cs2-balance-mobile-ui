// V3-PHASE-3B.4：Stable frozen input end-to-end audit。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const buildDir = path.join(__dirname, '.stable-audit-build');
fs.rmSync(buildDir, { recursive: true, force: true }); fs.mkdirSync(buildDir, { recursive: true });
const source = (p) => path.join(root, 'src', p);
execSync('npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(buildDir) + ' ' + [source('core/discountV2.ts'), source('core/opportunityV2.ts'), source('core/types/opportunity.ts'), source('core/liquidity.ts'), source('core/marketQuality.ts'), source('core/fees.ts'), source('core/profit.ts')].map(JSON.stringify).join(' '), { cwd: root, stdio: 'pipe', shell: true });
const { buildDiscountV2 } = require(path.join(buildDir, 'core', 'discountV2.js'));
const { buildOpportunityV2 } = require(path.join(buildDir, 'core', 'opportunityV2.js'));
function argValue(name, fallback) { const i = process.argv.indexOf(name); return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : fallback; }
function read(file) { return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')); }
function quantile(values, p) { if (!values.length) return null; const a = values.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.ceil(a.length * p) - 1))]; }
function distribution(values) { return { count: values.length, min: quantile(values, 0), p10: quantile(values, .1), p25: quantile(values, .25), median: quantile(values, .5), p75: quantile(values, .75), p90: quantile(values, .9), max: quantile(values, 1) }; }
function rank(rows, field, direction = 'desc') { return rows.slice().sort((a, b) => { const av = Number.isFinite(a[field]) ? a[field] : direction === 'asc' ? Infinity : -Infinity; const bv = Number.isFinite(b[field]) ? b[field] : direction === 'asc' ? Infinity : -Infinity; return (direction === 'asc' ? av - bv : bv - av) || a.item.localeCompare(b.item); }).slice(0, 20); }
function overlap(a, b) { const bs = new Set(b); return a.filter((x) => bs.has(x)).length / Math.max(1, new Set([...a, ...b]).size); }
function summarize(rows) {
  const gates = {}, primary = {}, caps = {}, transitions = {};
  for (const row of rows) { for (const x of row.hardGates || []) gates[x] = (gates[x] || 0) + 1; if (row.primaryGate) primary[row.primaryGate] = (primary[row.primaryGate] || 0) + 1; for (const x of row.caps || []) caps[x] = (caps[x] || 0) + 1; const key = `${row.rawDecision}->${row.opportunityDecision}`; transitions[key] = (transitions[key] || 0) + 1; }
  const expected = rows.map((x) => x.expectedDiscount).filter(Number.isFinite);
  const conservative = rows.map((x) => x.conservativeDiscount).filter(Number.isFinite);
  const listing = rows.map((x) => x.listingDiscount).filter(Number.isFinite);
  const current = rows.map((x) => x.currentDiscount).filter(Number.isFinite);
  const gap = rows.filter((x) => Number.isFinite(x.expectedDiscount) && Number.isFinite(x.conservativeDiscount)).map((x) => ({ item: x.item, riskGap: x.conservativeDiscount - x.expectedDiscount, expected: x.expectedDiscount, conservative: x.conservativeDiscount })).sort((a, b) => b.riskGap - a.riskGap).slice(0, 20);
  const near = rows.filter((x) => ['avoid', 'watch'].includes(x.opportunityDecision) && (x.rawScore >= 60 || Math.abs(70 - x.rawScore) <= 10)).sort((a, b) => b.rawScore - a.rawScore).slice(0, 20);
  const positive = rows.filter((x) => ['buy', 'excellent'].includes(x.opportunityDecision));
  const lowPriceApprox = rows.filter((x) => (x.warnings || []).includes('steam_fee_model_approximate'));
  const dangerous = rows.filter((x) => ['buy', 'excellent'].includes(x.opportunityDecision) && (x.expectedDiscount >= 1 || x.currentLiquidityCapacity < 20 || x.marketState === 'CHAOS' || x.diagnostics?.stale || x.marketDataQuality < .6));
  return { total: rows.length, gates, primary, caps, transitions, expected: distribution(expected), conservative: distribution(conservative), listing: distribution(listing), current: distribution(current), riskGapTop20: gap, nearMissTop20: near, positive, lowPriceApproxCount: lowPriceApprox.length, dangerousCount: dangerous.length, topRaw: rank(rows, 'rawScore'), topExpected: rank(rows, 'expectedDiscount', 'asc'), topConservative: rank(rows, 'conservativeDiscount', 'asc'), topCurrent: rank(rows, 'currentDiscount', 'asc'), topCapacity: rank(rows, 'currentLiquidityCapacity') };
}
function syntheticSnapshots(data) {
  const candidates = (data.snapshots || []).filter((x) => x.discountInput?.c5?.unitPrice > 0).slice(0, 5);
  return candidates.map((snapshot) => {
    const values = [];
    for (const factor of [1, .95, .90, .85, .80]) {
      const discountInput = JSON.parse(JSON.stringify(snapshot.discountInput));
      discountInput.c5.unitPrice *= factor;
      const discount = buildDiscountV2(discountInput);
      const opportunity = buildOpportunityV2({ ...snapshot.opportunityInput, discount });
      values.push({ factor, expected: discount.expected7d?.discount, conservative: discount.conservative7d?.discount, score: opportunity.score, decision: opportunity.decision, synthetic: true });
    }
    return { item: snapshot.item, values };
  });
}
function main() {
  const a = read(argValue('--a', 'artifacts/shadow/frozen-score-a.json'));
  const b = read(argValue('--b', 'artifacts/shadow/frozen-score-b.json'));
  const sa = summarize(a.rows); const sb = summarize(b.rows);
  const top = (x, field, direction) => rank(x.rows, field, direction).slice(0, 10).map((row) => row.item);
  const output = {
    candidateCount: a.rows.length,
    roundA: sa,
    roundB: sb,
    stability: { rawTop10Overlap: overlap(top(a, 'rawScore'), top(b, 'rawScore')), expectedTop10Overlap: overlap(top(a, 'expectedDiscount', 'asc'), top(b, 'expectedDiscount', 'asc')), conservativeTop10Overlap: overlap(top(a, 'conservativeDiscount', 'asc'), top(b, 'conservativeDiscount', 'asc')), currentTop10Overlap: overlap(top(a, 'currentDiscount', 'asc'), top(b, 'currentDiscount', 'asc')) },
    synthetic: syntheticSnapshots(a),
    frozenReplayReference: 'replay_opportunity_shadow.cjs',
  };
  const out = argValue('--out', null); if (out) fs.writeFileSync(path.resolve(process.cwd(), out), JSON.stringify(output, null, 2), 'utf8');
  console.log(JSON.stringify({ candidateCount: output.candidateCount, roundA: { expected: sa.expected, conservative: sa.conservative, listing: sa.listing, current: sa.current, gates: sa.gates, primary: sa.primary, caps: sa.caps, transitions: sa.transitions, positive: sa.positive.length, dangerous: sa.dangerousCount }, roundB: { expected: sb.expected, conservative: sb.conservative, listing: sb.listing, current: sb.current, gates: sb.gates, primary: sb.primary, caps: sb.caps, transitions: sb.transitions, positive: sb.positive.length, dangerous: sb.dangerousCount }, stability: output.stability, synthetic: output.synthetic }, null, 2));
}
main();

