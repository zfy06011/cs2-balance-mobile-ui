# V3-PHASE-3B.3：Steam Orderbook Stability 报告

日期：2026-09-13  
结论：**Phase 3B.3 PASS**

## 实现

新增 CLI-only orderbook layer：`persistent_orderbook_cache.cjs`、`prepare_orderbook_bundle.cjs`、`run_opportunity_shadow.cjs --orderbook-bundle` 和 `verify_orderbook_stability.cjs`。

没有修改 UI、collector、旧 Radar、Opportunity 权重、Gate、V4 或生产 API。

## 覆盖验收

| 场景 | Live | Cache Fresh | Cache Stale | Failed | Fresh Coverage |
|---|---:|---:|---:|---:|---:|
| Cold Run A | 93 | 0 | 0 | 0 | 100% |
| Warm / Immediate Probe | 0 | 93 | 0 | 0 | 100% |
| Delayed Refresh（TTL 后） | 93 | 0 | 0 | 0 | 100% |
| Stale 模拟 | 0 | 0 | 93 | 0 | 0%，usable 100% |
| Expired 模拟 | 0 | 0 | 0 | 93 | 0%，usable 0% |

Cold cache 写入 93 条 orderbook entry，约 2.7 MB。Warm process 的 live request 为 0，证明 fresh process 可复用 persistent cache；Score 阶段使用 Frozen OrderbookBundle，不触发网络。

## Cache / 限流 / 失败保护

实现并测试：单 item singleflight、全局最小请求间隔 400ms、最大并发 2、live request budget、有限 retry、连续失败 circuit、stale fallback、expired 禁用、原子写与损坏隔离。

本轮未触发 429，因此不宣称外部 429 已消失；429/backoff/circuit 路径由离线测试覆盖。

## Frozen Score

使用 frozen ForecastBundle + frozen OrderbookBundle + C5 snapshot 运行 93 项 Score：93/93 完成，无 orderbook/Discount/Opportunity 计算失败；stale bundle 会显式保持 stale 质量语义。

## 测试

`verify:orderbook-stability` 56/56、`verify:history-cache` 62/62、`verify:forecast-readiness` 28/28、`verify:forecast-pipeline` 73/73、`verify:opportunity-shadow` 66/66、typecheck 与 Phase 1/2/2.1/3A 既有回归均通过。

## 下一步

重新执行稳定 ForecastBundle + OrderbookBundle 下的 V3-PHASE-3B.1R Gate/Near-Miss Audit；本阶段不进入 UI 集成。

