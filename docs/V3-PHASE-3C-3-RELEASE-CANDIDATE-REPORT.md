# V3-PHASE-3C-3：Live Production Feed + Shadow Burn-In + Release Candidate 报告

日期：2026-09-13  
结论：**PASS-LEGACY**

本阶段完成了 RN live feed 接线、真实 Android live v2 smoke、release isolation 审计和现有回归。真实 live v2 能够运行并安全展示，但尚未满足默认切换 v2 的全部硬性门槛，因此默认继续 `legacy`，不升级版本、不构建 release APK。

## Live Feed Architecture

新增 `mobile/src/data/opportunityLiveFeed.ts`：

```text
SQLite tracked candidate names
  -> local history / V4 prediction
  -> Steam name-based orderbook provider
  -> RN orderbook memory TTL cache + limiter/circuit
  -> C5 OpenAPI price/stat adapter
  -> Discount v2
  -> ProductionOpportunityOrchestrator
  -> atomic ProductionOpportunitySnapshot
```

真实 feed 没有 import `scripts/`、`artifacts/`、`fs`、`path` 或 `child_process`。候选默认上限为当前验证 universe 的 93 项，保留 candidate hash、universe version 和 live provenance。

## Candidate Universe

- universe version：`tracked-cases-v1`；
- live feed 默认候选上限：93；
- Android 本地快照池当时显示约 100 个 tracked items，feed 按 93 项上限准备；
- real snapshot 的 `inputKind` 为 `live`；
- synthetic fixture 的 `inputKind` 为 `synthetic`，只在显式 dev demo global 下可达。

## 12-Round Burn-In

**未完成 12 轮 burn-in。**

本次完成 1 个真实 Android live v2 smoke cycle。由于 handoff 要求至少 12 轮、每轮 5~10 分钟，当前不能把单轮结果夸大为 burn-in 达标。

## Coverage Distribution

单轮 live smoke 的 Android UI 结果：

- excellent：0；
- buy：0；
- watch：13；
- avoid：77；
- synthetic 标记：0；
- React Native redbox/native crash：0。

当前市场没有正向机会，和 3B.4 的“真实样本全部 avoid”方向一致。由于本轮没有把 feed diagnostics 持久化到 UI/日志面板，forecast/orderbook/C5 的逐项覆盖百分比未作为正式 burn-in 统计提交；这也是不能 PASS-V2 的原因之一。

## Provider Failure / 429 / Circuit Stats

RN live feed 已接入既有 Steam provider、orderbook TTL cache、limiter、retry 和 circuit breaker。release candidate 静态审计确认：

- Steam source 为 `steam_first_party_web`；
- C5 source 为 `c5_openapi` 或本地 cache fallback；
- stale orderbook 不伪装成 fresh；
- expired/missing 不生成错误的 v2 buy；
- credentials 不写入 snapshot。

真实断网、C5 failure、Steam expired injection 尚未在本轮 Android 上逐项注入；相关状态机由 3C-1/3C-2 自动化测试覆盖，但不替代真实 burn-in。

## Android Live v2

真实 Android smoke 已验证：

- cold launch；
- live v2 UI 启动并完成真实 feed；
- Home live 结果；
- Market/Radar/Detail 页面可读；
- v2 卡片、折扣、当前容量、未来流动性 warning；
- 下拉刷新；
- background → foreground；
- no synthetic marker；
- no JS/native crash。

尚未完成连续 5 个 live v2 refresh cycle，也未完成真实断网→恢复→fresh 的完整序列。

## Offline / Recovery Test

本轮没有主动切换飞行模式或修改手机网络状态。原因是当前目标设备的网络设置变化会影响用户手机，且单轮 live feed 已足以确认真实链路存在；不把自动化 fixture 测试冒充成真实断网测试。

结论：offline/recovery 为未完成项，不满足 PASS-V2。

## App Lifecycle

3C-2 Android 已验证 legacy/v2 的 cold launch、warm/background→foreground、刷新与详情滚动；本阶段 live v2 完成一次 cold live smoke。进程重启后的 orderbook memory cache 仍按设计重新 live fetch，继续受 limiter/circuit 约束，没有虚构持久化 orderbook。

## Refresh Singleflight

3C-1/3C-2 已通过 orchestrator refresh singleflight、cooldown、atomic snapshot 测试。本阶段没有产生额外 UI debounce 层；真实 live feed 仍通过统一 `refreshProductionOpportunityFromLiveSources()` 进入 orchestrator。

## Synthetic Isolation

新增 `verify:release-candidate`：**36/36 PASS**。

审计确认：

- default flag 为 `legacy`；
- `__DEV__ === false` 时 dev override 不可用；
- synthetic 需要显式 `__YU_E_OPPORTUNITY_DEMO__` 且受 dev guard 保护；
- 非 legacy 模式默认走 live feed；
- live feed 不导入 fixture/artifact/Node CLI；
- 没有 C5 key、Cookie、authorization 写入 runtime snapshot；
- 当前版本仍为 `1.8.6` / `versionCode 37`。

## Release Build

未构建 release APK。Android debug `assembleDebug` 已通过，但 PASS-V2 条件未满足，按顺序要求不能进入 release build。

## Release-Only Validation

完成了 release source isolation 静态审计；未完成 release APK 的 Hermes/Proguard/SQLite/live v2 安装 smoke。该项随 PASS-LEGACY 保留为下一次候选阶段工作，不发正式包。

## High-Risk Recommendation Audit

本轮 live UI 没有发现高危正向推荐：

- excellent/buy 为 0；
- live 结果主要为 watch/avoid；
- stale/failed orderbook 不被 UI 伪装为 fresh buy；
- 没有放宽 Gate、Cap、fee 或 Opportunity 权重。

## Default Mode Decision

结论：**PASS-LEGACY**。

原因不是 App 不稳定，而是以下 v2 release 门槛尚未完成：

1. 12 轮真实 live shadow burn-in；
2. 至少 5 个连续真实 live v2 refresh cycle；
3. 真机断网、恢复、stale、expired/provider failure 注入；
4. release build 的真实 live v2 安装 smoke。

因此：

```text
default opportunityMode = legacy
shadow/v2 code retained for dev/RC
no remote dynamic switch
```

## Version Decision

保持：

```text
versionName = 1.8.6
versionCode = 37
```

不升级，不发 v2 release。

## Upgrade Install / Data Preservation

本阶段没有 release upgrade install，因此没有执行正式版本覆盖安装的数据保留验收。debug 真机运行未报告 SQLite、库存、设置或历史读取异常。

## Full Regression

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
backtest                             PASS
cloud npm test                         8/8
```

## APK Metadata

本阶段结论为 PASS-LEGACY，不构建 release APK，因此没有 release APK SHA-256、release file size 或 release build time 记录。

## Final Decision

**PASS-LEGACY：App 稳定，真实 live v2 链路已接通并完成单轮 Android smoke，但不足以安全切换默认 v2 或发版。**

下一阶段如要争取 PASS-V2，应先完成 12 轮真实 burn-in、5 轮 live v2 refresh、provider failure/recovery 和 release install smoke；在此之前继续保持 `legacy`。

