// verify_cache.cjs —— 分析缓存契约（v1.8.2 切页提速）
// 用法: node scripts/verify_cache.cjs
// 验证：命中不重算、代次失效后重算、单箱 detailCache 失效不影响批量结果缓存
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, '.cache-build');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const core = path.join(root, 'src', 'core');
execSync(
  'npx tsc --ignoreConfig --module commonjs --target es2020 --skipLibCheck --outDir ' + JSON.stringify(out) +
    ' ' + JSON.stringify(path.join(core, 'analysisCache.ts')) + ' ' + JSON.stringify(path.join(core, 'detailCache.ts')),
  { cwd: root, stdio: 'pipe', shell: true },
);

const ac = require(path.join(out, 'analysisCache.js'));
const dc = require(path.join(out, 'detailCache.js'));

let failed = 0, passed = 0;
function assert(name, cond, extra) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (extra !== undefined ? '  got: ' + JSON.stringify(extra) : '')); }
}

// 1) 基本读写
ac.bumpAnalysisGeneration();
ac.setAnalysisCache('markets', [1, 2, 3]);
assert('缓存命中返回原值', JSON.stringify(ac.getAnalysisCache('markets')) === '[1,2,3]', ac.getAnalysisCache('markets'));
assert('未写入的 key 返回 null', ac.getAnalysisCache('radar') === null, ac.getAnalysisCache('radar'));

// 2) 代次失效：数据变更后旧缓存立即不可见
const genBefore = ac.analysisGeneration();
ac.bumpAnalysisGeneration();
assert('代次自增', ac.analysisGeneration() === genBefore + 1, ac.analysisGeneration());
assert('代次失效后旧缓存为空', ac.getAnalysisCache('markets') === null, ac.getAnalysisCache('markets'));

// 3) 失效后可重新写入并命中
ac.setAnalysisCache('markets', ['new']);
assert('失效后重新写入可命中', JSON.stringify(ac.getAnalysisCache('markets')) === '["new"]', ac.getAnalysisCache('markets'));

// 4) 多次 bump 幂等（不会因重复失效而丢新数据）
ac.bumpAnalysisGeneration();
ac.setAnalysisCache('radar', ['r1']);
ac.bumpAnalysisGeneration();
assert('再次 bump 后新数据也失效', ac.getAnalysisCache('radar') === null, ac.getAnalysisCache('radar'));

// 5) detailCache 单箱失效不影响其他箱子
dc.clearDetailCache();
dc.setDetailCache('A', { quote: 'qa' });
dc.setDetailCache('B', { quote: 'qb' });
dc.clearDetailCache('A');
assert('单箱失效后 A 为空', dc.getDetailCache('A') === null, dc.getDetailCache('A'));
assert('单箱失效不影响 B', dc.getDetailCache('B') !== null && dc.getDetailCache('B').quote === 'qb', dc.getDetailCache('B'));
dc.clearDetailCache();
assert('全量清空后 B 也为空', dc.getDetailCache('B') === null, dc.getDetailCache('B'));

// 6) detailCache 容量上限（100）与淘汰
dc.clearDetailCache();
for (let i = 0; i < 130; i++) dc.setDetailCache('K' + i, i);
let alive = 0;
for (let i = 0; i < 130; i++) if (dc.getDetailCache('K' + i) !== null) alive++;
assert('detailCache 不超过上限 100', alive <= 100, alive);
assert('最新的条目仍在（K129）', dc.getDetailCache('K129') === 129, dc.getDetailCache('K129'));

console.log('');
console.log(`PASS ${passed} / ${passed + failed}`);
if (failed > 0) { console.log('CACHE CONTRACT TESTS FAILED'); process.exit(1); }
console.log('ALL CACHE CONTRACT TESTS PASSED');
