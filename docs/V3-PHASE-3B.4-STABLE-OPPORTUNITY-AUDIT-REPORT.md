# V3-PHASE-3B.4：Stable End-to-End Opportunity Audit 报告

日期：2026-09-13  
结论：**Phase 3B.4 PASS**

## 输入覆盖

固定 candidateHash：`e6dc7387`，93 个候选。ForecastBundle、OrderbookBundle、C5 snapshot 均完整，Score 阶段不联网。

## Gate / Cap

主要 Gate 是 `expected_discount_not_viable`，其次是 `current_capacity_too_small`；CHAOS、低价 approximate fee、stale/coverage cap 均按既有规则生效，没有调权重或放宽阈值。

## 折扣结论

93 个稳定输入样本的有效 expected/conservative 折扣全部处于 `>= 1.00` 区间，没有满足“预计 Steam 净到账高于 C5 总成本”的真实机会。这是当前市场快照结论，不是 Opportunity Engine 失败。Listing/current 不绕过 expected/conservative Gate。

## Raw / Final / Near-Miss

所有 live 样本最终均为 `avoid`，没有 live buy 或 excellent。Near-Miss 主要是 raw score 较高但 expected/conservative 仍大于 1 的样本；它们只能作为观察对象。

## Positive Candidate Review

live excellent=0、live buy=0、live watch=0、live avoid=93。没有正向 live candidate，因此没有伪造人工 buy/excellent 样本。

## Synthetic Counterfactual

对真实样本只降低 C5 unitPrice、标记为 synthetic，不混入 live 排名：expected/conservative 单调改善，Discount Score 不下降；低价 approximate fee 仍最高 watch，CHAOS 仍最高 watch/avoid，capacity 增加时 liquidity/budget 不下降。

`verify:stable-opportunity-audit`：77/77 PASS。

## Frozen Replay / 稳定性

Frozen Forecast/Orderbook/C5 输入 replay 3 次，expectedDiscount Top10、conservativeDiscount Top10、Opportunity Top10 均 100% overlap，score/decision/gate/cap 完全一致。实时变化只来自市场输入，不来自 forecast 或 Score 非确定性。

## Safety Audit

高危误推荐为 0：没有 expected≥1、capacity<¥20、CHAOS、stale、低价 approximate fee 或低质量数据仍然 buy/excellent 的情况。

## 测试

`verify:stable-opportunity-audit` 77/77、`verify:orderbook-stability` 56/56、`verify:history-cache` 62/62、`verify:forecast-readiness` 28/28、`verify:forecast-pipeline` 73/73、`verify:opportunity-shadow` 66/66、typecheck 与 Phase 1/2/2.1/3A 既有回归均通过。

## 是否进入 Phase 3C-1

Phase 3B.4 通过，可以进入 **V3-PHASE-3C-1：Production Integration Behind Feature Flag**。本阶段仍未修改 UI、旧 Radar 或生产 API；生产接线和 UI redesign 必须继续拆开。

