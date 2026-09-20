// 3C-3 release candidate static/safety audit。
// 不构建 release、不修改版本；只审计默认 flag、runtime imports、synthetic isolation 和 secrets。
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceFiles = [
  path.join(root, 'src', 'config', 'featureFlags.ts'),
  path.join(root, 'src', 'data', 'opportunitySnapshot.ts'),
  path.join(root, 'src', 'data', 'opportunityLiveFeed.ts'),
  path.join(root, 'src', 'data', 'opportunityProduction.ts'),
  path.join(root, 'src', 'data', 'orderbookRuntimeCache.ts'),
  path.join(root, 'src', 'data', 'orderbookRuntimeLimiter.ts'),
];

let passed = 0;
let failed = 0;
function assert(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail ? ` got=${detail}` : ''}`);
  }
}

const flags = fs.readFileSync(sourceFiles[0], 'utf8');
const buildChannel = fs.readFileSync(path.join(root, 'src', 'config', 'buildChannel.ts'), 'utf8');
const snapshot = fs.readFileSync(sourceFiles[1], 'utf8');
const liveFeed = fs.readFileSync(sourceFiles[2], 'utf8');
const production = fs.readFileSync(sourceFiles[3], 'utf8');
const runtime = sourceFiles.slice(4).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const mobileRuntime = fs.readdirSync(path.join(root, 'src'), { recursive: true })
  .filter((file) => String(file).endsWith('.ts') || String(file).endsWith('.tsx'))
  .map((file) => fs.readFileSync(path.join(root, 'src', file), 'utf8'))
  .join('\n');

assert('default opportunity mode is qualified v2', /opportunityMode:\s*'v2'/.test(flags));
assert('formal source channel remains production', /BUILD_CHANNEL:\s*BuildChannel\s*=\s*'production'/.test(buildChannel));
assert('feature flag accepts only known modes', /'legacy' \| 'shadow' \| 'v2'/.test(flags));
assert('dev mode override checks __DEV__', /isDevRuntime/.test(flags) && /__DEV__/.test(flags));
assert('dev override uses global flag only', /__YU_E_OPPORTUNITY_MODE__/.test(flags));
assert('synthetic demo uses explicit opt-in', /__YU_E_OPPORTUNITY_DEMO__/.test(snapshot));
assert('synthetic demo is dev guarded', /demoEnabled/.test(snapshot) && /isDevRuntime\(\)/.test(snapshot));
assert('live path is selected outside demo', /refreshProductionOpportunityFromLiveSources/.test(snapshot));
assert('live feed has tracked candidate universe', /DEFAULT_MAX_CANDIDATES = 93/.test(liveFeed));
assert('live feed records candidate hash', /candidateHash/.test(liveFeed) && /hashOf/.test(liveFeed));
assert('live feed marks Steam provenance', /steam_first_party_web/.test(liveFeed));
assert('live feed marks C5 provenance', /c5_openapi/.test(liveFeed));
assert('live feed uses production orderbook provider', /SteamOrderbookProvider/.test(liveFeed));
assert('live feed uses RN runtime cache', /OrderbookRuntimeCache/.test(liveFeed));
assert('live feed uses RN runtime limiter', /OrderbookRuntimeLimiter/.test(liveFeed));
assert('live feed uses existing storage', /from ['"]\.\/storage['"]/.test(liveFeed));
assert('live feed uses existing C5 adapter', /from ['"]\.\/c5['"]/.test(liveFeed));
assert('live feed builds Discount v2', /buildDiscountV2/.test(liveFeed));
assert('live feed builds Opportunity input', /OpportunityInput/.test(liveFeed));
assert('live feed does not import scripts', !/from ['"].*scripts\//.test(liveFeed));
assert('live feed does not import artifacts', !/from ['"].*artifacts\//.test(liveFeed));
assert('live feed does not import fs/path/child_process', !/from ['"](?:fs|path|child_process)['"]/.test(liveFeed));
assert('live feed does not read process env', !/process\.env/.test(liveFeed));
assert('production runtime has input kind', /inputKind/.test(production));
assert('production runtime remains RN safe', !/from ['"](?:fs|path|child_process)['"]/.test(production));
assert('runtime cache remains RN safe', !/from ['"](?:fs|path|child_process)['"]/.test(runtime));
assert('runtime limiter remains RN safe', !/from ['"](?:fs|path|child_process)['"]/.test(runtime));
assert('runtime files do not contain C5 key literals', !/(C5_APP_KEY\s*=|app-key=[A-Za-z0-9]{12,})/i.test(flags + snapshot + liveFeed + production + runtime));
assert('runtime files do not contain cookie literals', !/steamCookie\s*[:=]\s*['"][^'"]+['"]/.test(flags + snapshot + liveFeed + production + runtime));
assert('runtime files do not serialize authorization', !/authorization|bearer\s+[A-Za-z0-9._-]{12,}/i.test(snapshot + liveFeed + production));
const buildSnapshotBody = snapshot.slice(snapshot.indexOf('async function buildSnapshot'));
assert('ordinary non-legacy path stays local-first', /if \(mode !== 'legacy'\)\s*\{/.test(buildSnapshotBody) && /legacyCandidates\(\)/.test(buildSnapshotBody));
assert('explicit force path is the only live entry', /if \(mode !== 'legacy' && force\)[\s\S]*?refreshProductionOpportunityFromLiveSources/.test(buildSnapshotBody));
assert('live C5 timestamp uses fresh result time', /hasFreshC5[\s\S]*?c5FetchedAt = hasFreshC5 \? Date\.now\(\)/.test(liveFeed));
assert('v2 item carries current C5 price', /c5BuyPrice: prepared\.c5BuyPrice/.test(production));
assert('mobile runtime has no cloud references', !/workers\.dev|cloudWorkerUrl|ingestToken|from ['"][^'"]*cloud[^'"]*['"]|\bcloud\b/i.test(mobileRuntime));
assert('obsolete mobile cloud modules are absent', !['cloudConfig.ts', 'cloudHistory.ts', 'cloudCache.ts', 'cloudIngest.ts'].some((file) => fs.existsSync(path.join(root, 'src', 'data', file))));
assert('synthetic requires explicit dev condition', /mode !== 'legacy' && isDevRuntime\(\) && demoEnabled/.test(buildSnapshotBody));
assert('release version is 1.9.5', JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version === '1.9.5');
assert('Expo version is 1.9.5', JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo.version === '1.9.5');
const gradle = fs.readFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'utf8');
assert('version code is 43', /versionCode\s+43/.test(gradle));
assert('Android version is 1.9.5', /versionName\s*[=:]?\s*["']1\.9\.5["']/.test(gradle));
assert('live refresh entry exists', /refreshProductionOpportunityFromLiveSources/.test(liveFeed));
assert('live snapshot is atomic through orchestrator', /\.refresh\(candidates/.test(liveFeed));
assert('live feed exposes diagnostics', /getLiveFeedDiagnostics/.test(liveFeed));

console.log('');
console.log(`PASS ${passed} / ${passed + failed}`);
if (failed > 0) process.exitCode = 1;
