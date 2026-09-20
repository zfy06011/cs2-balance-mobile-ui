// Frozen Shadow Replay：只读保存的 forecast/market/C5 snapshot，不访问网络。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const outDir = path.join(__dirname, '.replay-opportunity-build');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const source = (p) => path.join(root, 'src', p);
execSync('npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(outDir) + ' ' + [source('core/discountV2.ts'), source('core/opportunityV2.ts'), source('core/types/opportunity.ts'), source('core/liquidity.ts'), source('core/marketQuality.ts'), source('core/fees.ts'), source('core/profit.ts')].map(JSON.stringify).join(' '), { cwd: root, stdio: 'pipe', shell: true });
const { buildDiscountV2 } = require(path.join(outDir, 'core', 'discountV2.js'));
const { buildOpportunityV2 } = require(path.join(outDir, 'core', 'opportunityV2.js'));
const inputPath = process.argv[2] || 'artifacts/shadow/frozen-score-a.json';
const snapshot = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), inputPath), 'utf8'));
const snapshots = snapshot.snapshots || [];
function sort(rows) {
  return rows.slice().sort((a, b) => b.score - a.score || (a.expectedDiscount ?? Infinity) - (b.expectedDiscount ?? Infinity) || a.item.localeCompare(b.item));
}
function run() {
  const rows = [];
  for (const item of snapshots) {
    const discount = buildDiscountV2(item.discountInput);
    const opportunity = buildOpportunityV2({ ...item.opportunityInput, discount });
    rows.push({ item: item.item, score: opportunity.score, decision: opportunity.decision, expectedDiscount: discount.expected7d?.discount, conservativeDiscount: discount.conservative7d?.discount, currentLiquidityCapacity: discount.currentLiquidityCapacity.executableBudget });
  }
  return sort(rows);
}
const runs = [run(), run(), run()];
const baseline = JSON.stringify(runs[0]);
const identical = runs.every((rows) => JSON.stringify(rows) === baseline);
const top = runs.map((rows) => rows.slice(0, 10).map((row) => row.item));
const overlap = (a, b) => a.filter((x) => b.includes(x)).length / Math.max(1, new Set([...a, ...b]).size);
const result = { itemCount: snapshots.length, identical, scoreDecisionDeterministic: identical, top10Overlap: [overlap(top[0], top[1]), overlap(top[1], top[2])], top10: top[0] };
console.log(JSON.stringify(result, null, 2));
if (!identical || result.top10Overlap.some((value) => value !== 1)) process.exitCode = 1;

