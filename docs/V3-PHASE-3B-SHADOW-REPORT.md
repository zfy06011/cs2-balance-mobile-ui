# V3-PHASE-3B：Opportunity v2 Shadow Integration 报告

日期：2026-09-13  
结论：**Phase 3B PASS**

本阶段没有接入 UI、collector、生产 API 或旧 Radar 输出。旧 Radar 只作为旁路比较输入。

## 新增文件

| 文件 | 用途 |
|---|---|
| `mobile/src/core/opportunityShadow.ts` | 旧 Radar 映射、分歧分类、Shadow 行、统计、排序、有界并发纯函数 |
| `mobile/scripts/run_opportunity_shadow.cjs` | CLI-only 真实 Steam/C5/V4/旧 Radar Shadow Runner |
| `mobile/scripts/verify_opportunity_shadow.cjs` | 66 项离线诊断和隔离测试 |
| `mobile/scripts/fixtures/opportunity_shadow/cases.json` | 分歧分类 fixture |

## Runner 行为

命令：

```powershell
cd D:\Codex\cs2-balance-mobile\mobile
$env:C5_APP_KEY='<用户自己的 key>'
npm run shadow:opportunity -- --limit 20 --concurrency 3 --json-out artifacts/shadow/opportunity-shadow.json --csv-out artifacts/shadow/opportunity-shadow.csv
```

Runner 使用：

- Steam orderbook Provider；
- Steam `priceoverview`；
- Steam SSR 历史与 V4；
- C5 批量价格/统计（需要环境变量 `C5_APP_KEY`）；
- 旧 `evaluateRadar`；
- Opportunity v2 shadow 计算。

网络请求具备有界并发、6 秒超时、单次重试、失败隔离和 429 诊断。不会在页面 mount 时触发，也不会序列化 app-key、Cookie 或 token。

## 真实 Shadow 结果

使用用户临时提供的 C5 app-key 运行 20 个真实物品；凭证只存在于本次进程环境，没有写入文件、日志或报告。

结果：

```text
totalItems = 20
完整 C5/Discount/Opportunity 数据成功 = 20/20
successRate = 100%
totalDurationMs = 17053
avgLatencyMs = 2449
p50LatencyMs = 2305
p95LatencyMs = 2892
orderbookFailureCount = 0
c5FailureCount = 0
discountFailureCount = 0
opportunityFailureCount = 0
http429Count = 0
staleCount = 0
missingForecastCount = 0
missingVolumeCount = 0
missingC5SupplyCount = 0
```

旧 Radar 分布：20 个 `avoid`。Opportunity shadow 分布：20 个 `avoid`，分歧分类为 `AGREE_NEGATIVE`。

这批样本没有出现旧 Radar positive、Opportunity buy/excellent 等正向机会，因此没有伪造正向分歧样本。当前结果证明数据链和安全 gate 正常，但不能单独证明正向机会排序质量。

## 离线验证

```text
npm run verify:opportunity-shadow
PASS 66 / 66
```

覆盖：

- old Radar `buy/wait/avoid` 显式映射；
- 新旧 positive/neutral/negative 分歧分类；
- CHAOS、stale、approximate fee、低容量 gate 分类；
- Shadow 行字段组合；
- 429、失败、缺失字段、stale 统计；
- Top N、稳定排序、p50/p95；
- 有界并发；
- budget 不超过 current capacity；
- credential 不进入 JSON 输出。

## 3B 验收状态

已满足首轮门槛：20 个完整样本，successRate 100%。本阶段不计算“准确率”；没有真实收益标签，只报告 agreement、disagreement、reason coverage、data completeness 和性能指标。

## 生产隔离

本阶段没有修改：

- `radar.ts`；
- `RadarScreen`；
- `collector.ts`；
- `engine.radar()` / `api.radar()`；
- Home/Market/Detail UI；
- SQLite/D1；
- version/versionCode/APK。

## 下一步

可进入 V3-PHASE-3C 前的人工审查。由于本批 20 个样本全部为负向机会，建议 UI 集成前再用更广候选池补充正向/边界样本；本阶段不自动调参、不改变生产推荐。
