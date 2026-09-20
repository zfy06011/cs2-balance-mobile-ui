const fs = require('node:fs');
const path = require('node:path');

const sourceDir = path.resolve(__dirname, '../artifacts/history-cache/items');
const output = path.resolve(__dirname, '../src/data/historySeed.generated.ts');
const filterSource = fs.readFileSync(path.resolve(__dirname, '../src/data/caseFilter.ts'), 'utf8');
const filterBlock = filterSource.match(/const TRACKED_KEYS = new Set\(\[([\s\S]*?)\]\);/);
if (!filterBlock) throw new Error('tracked case whitelist is missing');
const seedNames = new Set([...filterBlock[1].matchAll(/'([^']+)'/g)].map((match) => match[1]));
const entries = fs.readdirSync(sourceDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
  .map((entry) => JSON.parse(fs.readFileSync(path.join(sourceDir, entry.name), 'utf8')))
  .filter((entry) => seedNames.has(entry.item) && entry.originSource === 'steam_first_party_web' && Array.isArray(entry.points) && entry.points.length >= 15)
  .map((entry) => ({
    name: entry.item,
    points: entry.points.slice(-365).map((point) => [point.ts, point.price, point.volume]),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const content = `export const HISTORY_SEED_VERSION = '2026-09-15' as const;\n\nexport const HISTORY_SEED = ${JSON.stringify(entries)} as const;\n`;
fs.writeFileSync(output, content, 'utf8');
console.log(`history seed: ${entries.length} items -> ${output}`);
