# V3-PHASE-3B.2R：Forecast Pipeline Root-Cause Recovery 报告

日期：2026-09-13  
结论：**FAIL，继续停留在数据层，不进入 Phase 3C**

## Root Cause

根因在旧 Shadow Runner 的数据编排：`run_opportunity_shadow.cjs#runItem` 对每个 item 直接触发 `fetchSteamHistorySsr()`；93 个任务同时进入 `steamHistorySsr.ts` 的全局 `ssrChain`，每个任务仍受 6 秒 timeout 与 Steam 网络/限流影响。Runner 没有 cloud `/history/batch` 优先路径，也没有先完成统一 Prepare 再冻结 ForecastBundle。历史失败后 item 立即进入 Score，变成 missing forecast；下一轮外部 SSR 状态变化，部分 item 才重新 ready，于是出现 `0/93 → 50/93`。

5 个已知老箱的 trace 证明 cold、warm、fresh-process、reverse-order 均 365 点 ready，V4 输出一致。因此没有证据支持 V4 数学随机或 item key 不稳定。

## 修复内容

- `mobile/src/core/forecastBundle.ts`：Forecast Readiness、Prepare→Freeze、candidate hash、manifest、`inFlightAtFreeze`；
- `mobile/scripts/prepare_opportunity_forecasts.cjs`：cloud batch 优先，缺失项才使用 SSR fallback；
- `mobile/scripts/trace_forecast_pipeline.cjs`：逐 item trace；
- `mobile/scripts/compare_forecast_traces.cjs`：cold/warm/fresh/reverse diff；
- `mobile/scripts/replay_opportunity_shadow.cjs`：冻结 snapshot 三次 replay；
- Shadow Score 支持 `--forecast-bundle`，ready item 不再补 fetch history。

## Trace 结果

| 实验 | Ready | 结果 |
|---|---:|---|
| 同进程 repeat round 1 | 5/5 | 365 点，Steam SSR，V4 ready |
| 同进程 repeat round 2 | 5/5 | forecast 完全一致 |
| fresh process | 5/5 | readiness/forecast 一致 |
| reverse order | 5/5 | readiness/forecast 一致 |

## Prepare / Bundle

首轮固定候选：`candidateCount=93`、`candidateHash=e6dc7387`。

第一次 cloud batch + SSR fallback：`ready=93/93`、`failed=0`、`inFlightAtFreeze=0`。

相同 candidateHash 再次 Prepare：`ready=51/93`、`failed=42`、ready-set overlap `54.8%`。

这确认 cloud batch 只覆盖部分历史，剩余 SSR fallback 在大批量运行时仍受外部网络/限流/串行队列影响。

## Frozen Replay

首轮 93 项 frozen forecast、orderbook、C5 snapshot replay 3 次：`score identical=true`、`decision identical=true`、`expectedDiscount Top10 overlap=100%`、`Opportunity Top10 overlap=100%`。问题发生在 live Prepare readiness，而不是 Score 阶段。

## Readiness 状态

Forecast 缺失现在明确区分：`ready`、`missing_history`、`insufficient_history`、`history_fetch_failed`、`history_parse_failed`、`prediction_failed`、`unsupported_item`、`warming`。缺失 forecast 不使用当前价格或 neutral forecast 填补，也不进入 expectedDiscount 排名。

## 测试结果

verify:forecast-readiness 28/28 PASS；verify:forecast-pipeline 73/73 PASS；verify:opportunity-shadow 66/66 PASS；typecheck PASS；Phase 1/2/2.1/3A 既有回归 PASS。

## PASS 判断

本阶段仍 FAIL：5 项诊断、冻结 replay 和 Score 确定性均通过，但同 candidateHash 的第二次 Prepare ready-set 只有 54.8%，未达到 90/95% 要求。

## 下一步

继续数据层修复：为 SSR fallback 增加可复用持久历史/cache 或更可靠的批量历史来源，再重新验证同 candidateHash 的 cold/warm overlap。当前不进入 UI 集成。

