# V3-PHASE-3C-3R：Live Burn-In Completion + Release Qualification 报告

日期：2026-09-13  
最终结论：**PASS-LEGACY**

本阶段补齐了 live diagnostics recorder、candidate accounting、release qualification gate 和 RN live feed 的真实 Android smoke。真实 live v2 链路可以工作且没有高危推荐，但尚未完成 12 轮 burn-in、5 轮连续 live v2 refresh、真实断网恢复及 internal release live v2 smoke，因此不切默认 v2、不升级版本、不发 release APK。

## Candidate Accounting

3C-3R 新增 `mobile/src/data/opportunityBurnInRecorder.ts`，复用既有 `kv` 表，key 为：

```text
dev:opportunity-burnin:v1
```

最多保存最近 30 轮，并对每轮执行：

```text
excellent + buy + watch + avoid + fallbackLegacy + missing
  == candidateCount
```

此前 UI 显示 `13 watch + 77 avoid = 90`，而 3B universe 上限为 93。原因是 live feed 的实际候选集合先经过 `isTrackedCase` 过滤，再取最多 93 项；本次设备 SQLite 中实际进入 feed 的 eligible universe 为 90 项，未计入项不是 UI 分页静默丢失。Recorder 以 snapshot 实际 `candidateCount` 和 item key 去重结果记录 accounting；未计入项不允许通过 qualification gate。

## 12-Round Burn-In

**未完成。**

当前真实证据为 1 次 Android live v2 smoke。该轮使用真实 RN live feed，没有 synthetic 标记；但没有达到 handoff 要求的 12 轮、至少 11 轮 coverage 合格，也没有 60 分钟以上间隔采样。

## Coverage Summary

Recorder 已支持记录：

- forecast ready/missing/coverage；
- orderbook live/cache fresh/cache stale/failed；
- fresh/usable coverage；
- C5 ready/failed/coverage；
- candidate hash、universe version、inputKind；
- snapshot valid/stale/fallback；
- decisions 与 accounting。

本次 smoke 的 UI 分布为：

```text
excellent = 0
buy       = 0
watch     = 13
avoid     = 77
synthetic = 0
```

这与之前 3B.4 的真实市场结论一致：没有强行制造买入机会。

## Provider Stats

Live feed 已接入：

- Steam name-based orderbook provider；
- orderbook memory TTL cache；
- runtime limiter/singleflight/retry/circuit；
- C5 OpenAPI price/stat adapter；
- local history/forecast source。

Recorder 字段已经覆盖 429、timeout、retry、circuit、stale fallback；本次未把完整 12 轮统计提交为正式 burn-in 汇总，因此不宣称 coverage 门槛已通过。

## 5-Round Live v2 Refresh

**未完成。**

真实 Android 已完成 1 次 live v2 smoke；尚未连续完成 5 个真实 refresh cycle。

## Refresh Singleflight

3C-1/3C-2 自动化已验证 refresh singleflight/cooldown；本阶段没有新增 UI debounce。Live refresh 仍统一进入 `refreshProductionOpportunityFromLiveSources()` 和 `ProductionOpportunityOrchestrator.refresh()`。

## Network Loss / Recovery

**未完成真实网络 loss/recovery。**

没有通过 ADB 修改用户手机网络状态。stale/expired/fallback/C5 failure 的状态机已有自动化覆盖，但这不能替代真实断网恢复证据。因此该门槛阻止 PASS-V2。

## Steam / C5 Failure Injection

已完成静态和自动化安全路径：

- stale orderbook 不伪装 fresh；
- expired/missing orderbook 不生成错误 buy/excellent；
- C5 缺失不构造错误 expected discount；
- snapshot fallback 保留旧合法数据。

真实设备逐项 provider 注入尚未完成。

## Process Restart

3C-2 已完成 debug app cold/warm/background smoke；本阶段 live feed 的 orderbook runtime cache 仍是 memory cache，process restart 后会重新 live fetch，并继续受 limiter/circuit 控制。没有虚构跨进程 orderbook persistence。

## Background / Foreground

Android debug 已验证：

- live v2 页面启动；
- 后台后回前台；
- snapshot/UI 没有红屏或空白崩溃。

但尚未完成 5 分钟 live burn-in 周期。

## Internal RC Release Smoke

**未完成。**

已成功构建 debug APK；由于 12 轮 live burn-in、5 轮 live v2、网络恢复和 release qualification 未达标，没有构建 internal release APK，避免把不完整证据包装为 release ready。

## Synthetic Isolation

`verify:release-candidate`：**36/36 PASS**。确认：

- default flag 为 `legacy`；
- synthetic 需要显式 dev demo global；
- release/非 dev runtime 不读取 dev override；
- live mode 走 `refreshProductionOpportunityFromLiveSources()`；
- live feed 不导入 scripts/artifacts/Node-only cache；
- 没有凭证写入 snapshot。

## High-Risk Audit

本次真实 live v2 smoke：

- excellent = 0；
- buy = 0；
- high-risk violation = 0；
- 没有出现 stale/failed orderbook 仍为 buy/excellent 的情况；
- 没有调权重、Gate、Cap、fee 或预测数学。

## Qualification Gate

`verify:release-qualification`：**30/30 PASS**，覆盖：

- 12 轮全合格 → PASS-V2；
- 允许 1 轮外部故障；
- 2 轮故障 → PASS-LEGACY；
- accounting gap → FAIL；
- high-risk violation → FAIL；
- synthetic/fixture input → FAIL；
- version/default mode guard。

## Default Mode Decision

最终：**PASS-LEGACY**。

原因：App 稳定、live feed 已接通、单轮真实 v2 安全，但以下硬门槛尚未完成：

1. 12 轮真实 burn-in；
2. 至少 11/12 轮 coverage 达标；
3. 5 个连续 live v2 refresh；
4. 真实网络 loss/recovery；
5. internal release live v2 smoke。

默认继续：

```text
opportunityMode = legacy
```

## Version Decision

保持：

```text
versionName = 1.8.6
versionCode = 37
```

不升级，不构建最终 release APK。

## Final Regression

已通过：

```text
typecheck
verify:core                         312/312
verify:storage                       35/35
verify:ssr                            7/7
verify:cache                         11/11
verify:chart                         34/34
verify:orderbook                     21/21
verify:discount-v2                  162/162
verify:steam-fee-audit               28/28
verify:opportunity-v2               130/130
verify:opportunity-shadow            66/66
verify:forecast-readiness            28/28
verify:forecast-pipeline             73/73
verify:history-cache                 62/62
verify:orderbook-stability           56/56
verify:opportunity-gate-audit        89/89
verify:stable-opportunity-audit      77/77
verify:production-opportunity       573/573
verify:opportunity-ui               125/125
verify:release-candidate             36/36
verify:release-qualification         30/30
backtest                             PASS
cloud npm test                         8/8
```

## Final Statement

**PASS-LEGACY：真实 RN live v2 已接通且单轮安全，但证据量不足以切默认或发版。**

下一次若要争取 PASS-V2，应只补 burn-in、failure/recovery 和 internal release smoke，不再修改模型、Gate、UI 或默认安全边界。

