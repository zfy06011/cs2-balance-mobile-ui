# V3-PHASE-3C-1：Production Integration Behind Feature Flag 报告

日期：2026-09-13  
结论：**PASS**

本阶段完成了 Opportunity v2 的 RN-compatible 生产数据层接线，但没有接入 UI、旧 Radar、主 API，也没有发 APK。默认生产模式仍为 `legacy`。

## Feature Flag

新增 `mobile/src/config/featureFlags.ts`：

- `OpportunityMode = legacy | shadow | v2`；
- 默认值为 `legacy`；
- 非法值归一化为 `legacy`；
- 仅作为 build/dev config 使用，没有新增用户可见 toggle，也没有远程未鉴权开关。

三种语义已在 `ProductionOpportunityOrchestrator` 中隔离：

- `legacy`：只保留旧 Radar 输出，不调用 Opportunity v2；
- `shadow`：保留 legacy 输出，同时生成 v2 诊断字段，不改变 legacy 结果；
- `v2`：完整快照通过后提供 v2 结果；单项输入缺失时保留该项 legacy fallback。

## Runtime Architecture

新增 `mobile/src/data/opportunityProduction.ts`。

调用方先准备 Forecast、Steam orderbook、C5 与 Discount v2 输入，编排器只负责：

```text
Prepared Candidate Set
  -> buildOpportunityV2（每项一次）
  -> 计算 coverage / failure / stale / provenance
  -> 校验最低完整度
  -> 原子替换 current snapshot
```

生产层复用既有 `buildOpportunityV2`，没有复制权重、Gate、fee 或 Discount 数学。页面未来应只读取 snapshot；本阶段没有修改任何页面，因此没有页面 mount 直连 Steam 的新路径。

## RN-Compatible Cache

新增 `mobile/src/data/orderbookRuntimeCache.ts`：

- 仅使用 TypeScript memory cache，不依赖 `fs`、`path`、`process`；
- 支持 `fresh / stale / expired / missing`；
- 支持 `schemaVersion`，schema 不匹配不会返回可用盘口；
- 默认 fresh TTL 为 2 分钟、stale TTL 为 10 分钟，可由调用方注入；
- 没有新增第二套 SQLite 表或 migration。现有 SQLite/KV hydration 由上层数据准备入口负责，避免把 CLI filesystem cache 带入 Android。

## Orderbook Runtime Limiter

新增 `mobile/src/data/orderbookRuntimeLimiter.ts`，只移植 3B.3 的行为语义，不照抄 Node API：

- 按 item key singleflight；
- 全局最大并发，默认 2；
- 全局最小请求间隔，默认 400ms；
- 429/5xx/timeout/network error 有限重试；
- 识别 `Retry-After`，并使用 backoff+jitter；
- 连续失败达到阈值后进入 `OPEN`，冷却后 `HALF_OPEN` 探测；
- 诊断输出 active、queued、in-flight keys、circuit state、retry/live attempt 计数。

## Snapshot Atomicity

编排器始终先构建局部 `nextItems`，再计算完整度，最后一次性替换 `currentSnapshot`，不会暴露前半轮新数据、后半轮旧数据的混合快照。

默认最低完整度：

```text
forecast coverage       >= 90%
orderbook fresh coverage >= 90%
C5 coverage             >= 90%
```

当前已有合法快照时，低于门槛的新轮次只记录 diagnostics 并保留旧快照。首次没有合法快照时，不暴露半成品 v2，而是生成 legacy fallback 快照并保留失败原因。快照超过 stale TTL 后，`current()` 会显式标记 `diagnostics.stale = true`。

## Refresh Singleflight

`refresh()` 支持：

- 同一轮并发调用复用同一个 Promise；
- 默认 2 分钟 cooldown，fresh snapshot 直接返回；
- `force = true` 才绕过 cooldown；
- refresh 期间不会启动第二轮构建。

## Legacy Isolation

本阶段没有修改：

- `RadarScreen`、`MarketScreen`、`HomeScreen`、`DetailScreen`；
- `radar.ts`；
- collector、主 API、版本号、APK 配置。

`legacy` 模式即使 candidate 缺少 v2 input 也不会进入 v2 fallback 分支，旧 signal/score 原样保留。`shadow` 模式中 v2 只作为并行诊断字段，legacy 仍是生产输出。

## Shadow Dry Run

生产验证脚本对固定 93 项候选执行 shadow dry run：

- snapshot valid：PASS；
- forecast coverage：100%；
- orderbook fresh coverage：100%（满足 >=95% 验收要求）；
- C5 coverage：100%（满足 >=95% 验收要求）；
- failure/fallback：0；
- legacy distribution：93/93；
- v2 diagnostic distribution：93/93。

该 dry run 使用冻结形状的离线 prepared candidates，不产生联网请求。3B.4 的真实 frozen audit 仍保持 93 项全部 `avoid` 的原结论，没有人为制造 buy/excellent 样本。

## v2 Dry Run

v2 模式完整生成 `ProductionOpportunitySnapshot`：

- 20 项基础冻结 fixture；
- 5 项 synthetic counterfactual；
- 每项均有 score、decision、budget、discount、quality、reason、warning、gate、cap；
- 完整输入下不保留 legacy 字段；
- 缺 input 时按项记录 `v2_input_missing` 并保留 legacy 输出。

## Audit vs Production Parity

验证脚本从 3B.4 冻结产物 `mobile/artifacts/shadow/frozen-score-a.json` 读取 20 个真实样本，并追加 5 个 synthetic 样本。

逐项比较：

- score；
- decision；
- hard gates；
- caps；
- current/expected discount。

20 个真实样本与 5 个 synthetic 样本均 **100% identical**。真实样本同时与冻结 audit row 的 `opportunityScore` / `opportunityDecision` 对拍通过。

## Failure / Fallback Tests

已覆盖：

- coverage 80%：保留上一份合法 snapshot，不暴露部分新轮次；
- 首轮 coverage 不足：生成 legacy fallback，不生成半成品 v2；
- 单项 v2 input 缺失：该项 `fallbackUsed = true`、reason 为 `v2_input_missing`；
- stale orderbook：保留 stale 状态，不冒充 fresh；
- snapshot 超时：current snapshot 标记 stale；
- limiter 连续 5xx：熔断 OPEN，冷却后 probe 恢复；
- cache：fresh/stale/expired/schema mismatch/missing 状态均正确。

## Credential Safety

生产 runtime 文件没有 Node runtime import，也没有 `process.env` 访问。Snapshot 只保存计算结果、状态、时间戳和来源，不保存 C5 app key、Cookie、token 或 authorization。验证脚本同时对 snapshot JSON 和四个 RN runtime 源文件执行敏感字段检查，均通过。

## Full Regression

全部通过：

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
backtest                             PASS
cloud npm test                         8/8
```

没有构建 APK，没有升级 `version` / `versionCode`，没有改 UI、Radar、V4、Discount v2、Steam fee 或 Opportunity 权重/Gate。

## 是否建议进入 3C-2

**建议进入 V3-PHASE-3C-2 UI Integration。**

进入下一阶段时仍应保持当前边界：先让 UI 只读 Production Snapshot，再做 Web debug 与真机回归；在 3C-2 完成前不要把默认模式从 `legacy` 改为 `shadow` 或 `v2`，也不要发版。
