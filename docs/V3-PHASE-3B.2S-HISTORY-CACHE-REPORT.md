# V3-PHASE-3B.2S：Persistent History Cache + SSR Backfill Stabilization 报告

日期：2026-09-13  
结论：**Phase 3B.2S PASS**

## Root Cause

3B.2R 已确认旧 Runner 在 Score item 内直接触发逐项 Steam SSR，93 个任务进入全局串行 `ssrChain`，受 timeout/网络/限流影响；成功历史没有跨进程持久复用。因此第一轮和第二轮的 forecast ready 集合发生漂移。

本阶段没有修改 V4 数学、Opportunity 权重、Gate、UI 或生产 Radar。

## 新增能力

- `persistent_history_cache.cjs`：SHA-256 item 文件、schema version、checksum、TTL、UTC 日标准化、原子写、损坏隔离、容量统计；
- `prepare_opportunity_forecasts.cjs`：Persistent Cache → Cloud Batch → SSR fallback → 持久化 → Forecast Bundle；
- `forecastBundle.ts`：readiness、candidateHash、manifest、`inFlightAtFreeze=0`、冻结对象；
- `replay_opportunity_shadow.cjs`：冻结 snapshot 确定性重放；
- `verify_history_cache.cjs`：62 项持久缓存断言；
- `trace_forecast_pipeline.cjs` / `compare_forecast_traces.cjs`：根因诊断。

## Run A/B/C

固定 candidateHash：`e6dc7387`，93 个候选。

| 指标 | Run A：清空 cache | Run B：fresh process | Run C：fresh process |
|---|---:|---:|---:|
| ready | 93/93 | 93/93 | 93/93 |
| persistentHit | 0 | 93 | 93 |
| cloudHit | 47 | 0 | 0 |
| SSR fallback | 46 | 0 | 0 |
| SSR success | 46 | 0 | 0 |
| failed | 0 | 0 | 0 |
| inFlightAtFreeze | 0 | 0 | 0 |

Run A 缓存容量：93 条，2,057,980 bytes，平均约 22,129 bytes/item，最大 23,772 bytes。Run B/C 完全跨 Node 进程复用，SSR fallback 从 46 降为 0，ready-set overlap 为 100%。

## Cache 安全与完整性

entry 包含 schema version、item、来源、fetchedAt、首末时间、pointCount、points、checksum、parserVersion。

读取必须通过 schema、item、checksum、pointCount、点值、时间单调性、requiredPointCount 和 freshness 校验。JSON 损坏、checksum mismatch、schema mismatch、错误 item 会被隔离并继续 fallback；错误结果不会写入永久 negative cache。写入使用临时文件、fsync、rename。缓存不包含 C5 app-key、Steam Cookie、token 或 authorization header。

来源保持分离：`originSource=steam_first_party_web`，`retrievalSource=persistent_cache|cloud|steam_ssr`。

## Frozen Replay

93 项冻结 forecast、orderbook、C5 snapshot 连续 replay 3 次，score/decision 完全一致，expectedDiscount Top10 与 Opportunity Top10 overlap 均为 100%。

## 边界与测试

未来订单簿仍保持 `orderbookPredicted=false`、`liquidityGuaranteed=false`。Volume coverage 继续记录，不在本阶段重做。

测试：`verify:history-cache` 62/62、`verify:forecast-readiness` 28/28、`verify:forecast-pipeline` 73/73、`verify:opportunity-shadow` 66/66、typecheck 和 Phase 1/2/2.1/3A 既有回归均通过。

## 下一步

重新执行 V3-PHASE-3B.1 Gate/Near-Miss Audit，使用稳定 ForecastBundle；本阶段不进入 UI，不修改 Opportunity 权重或 Gate。

