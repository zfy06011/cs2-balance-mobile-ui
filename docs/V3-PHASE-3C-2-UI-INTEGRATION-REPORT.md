# V3-PHASE-3C-2：UI Integration over Production Opportunity Snapshot 报告

日期：2026-09-13  
结论：**PASS**

本阶段已经完成 UI 数据接线、selector/view-model、Radar/Market/Home/Detail 的 snapshot 消费、Web bundle 构建、Web 可视巡检和 Android 真机交互回归。legacy 与 v2 dev mode 均已验证，默认源码最终恢复为 `legacy`。

## UI Data Flow

Opportunity UI 数据流现在是：

```text
api.productionOpportunity()
  -> getProductionOpportunitySnapshot()
  -> ProductionOpportunitySnapshot
  -> opportunitySelectors
  -> OpportunityCardViewModel
  -> Radar / Market / Home / Detail render
```

新增：

- `src/data/opportunitySnapshot.ts`：集中入口，负责 legacy 兼容包装与 dev-only synthetic fixture；
- `src/ui/opportunity/opportunitySelectors.ts` 的等价实现位于 `opportunityViewModel.ts`；
- `opportunityLabels.ts`：machine code → 中文文案；
- `opportunityFormatters.ts`：折扣、金额、容量、freshness、market state 统一格式化；
- `OpportunityCard.tsx`：v2 卡片；
- `useOpportunitySnapshot.ts`：页面统一加载/刷新 hook。

四个页面不再直接调用 `api.radar()` / `api.markets()`，也不在 render 中调用 `buildDiscountV2()`、`buildOpportunityV2()` 或 Steam orderbook provider。

## Legacy Isolation

- `DEFAULT_FEATURE_FLAGS.opportunityMode` 仍为 `legacy`；
- dev override 只读取 `globalThis.__YU_E_OPPORTUNITY_MODE__`，且仅在 `globalThis.__DEV__ === true` 时生效；
- 没有新增普通用户可见算法切换；
- legacy 结果中的 signal、score、预计折扣、C5/Steam 价格、风险、流动性、成交量等字段由 snapshot 兼容透传；
- legacy/shadow 页面仍以旧 signal 为主状态；shadow 不把 v2 decision 提升为正式 UI 状态。

本阶段没有生成截图 diff；因此“视觉零差异”仍需在浏览器/设备可用后补做人工确认。

## Radar v2

v2 dev mode 的 Radar 使用 `OpportunityCardViewModel`：

- 中文箱名；
- final decision；
- 预计几折第一视觉；
- 保守折扣、当前容量、主因；
- stale/fallback/missing 状态；
- 低价近似手续费与未来流动性警告。

selector 排序不重新计算业务分数；需要排序时使用 decision rank → score → expected discount → capacity → item 的稳定规则。

当前 v2 dev mode 使用明确标记的 `DEMO / synthetic` fixture，用于展示 excellent/buy/watch/avoid 和警告状态；不会注入默认 legacy 或正常 live 列表。真实 production v2 仍需由上游提供完整 Prepared Candidate Snapshot。

## Detail v2

Detail 的余额转换主卡从 Production Snapshot 读取：

- final decision；
- 预计/保守/当前折扣；
- 当前可执行容量；
- spread；
- market state；
- gate/cap/warning 的中文说明。

既有历史曲线、持仓、C5 时机参考等辅助数据仍走原有详情数据入口；Opportunity 结论不从这些页面数据重新计算。

`listing7d` 只显示为“理想挂单参考”，没有写成“预计到账”。

## Market v2

Market 在 v2 dev mode 使用 compact Opportunity Card；legacy mode 继续显示原有市场列表字段。Market 仍可展示 `avoid`，不会把浏览市场误称为推荐页。

## Home Integration

Home 的摘要、数量统计、Top 3 和详情入口均从 snapshot view-model 读取。legacy mode 保留旧 signal/价格/预计折扣展示；v2 mode 显示 synthetic 标记和 v2 卡片，不改变默认模式。

## Loading / Refresh / Failure / Stale

`useOpportunitySnapshot` 统一处理：

- 首次无合法 snapshot：显示“正在获取市场分析…”；
- 已有 snapshot 刷新：保留旧内容，使用 RefreshControl 的轻量 refreshing；
- refresh failure：保留旧内容并显示错误；
- stale：显示“数据已过期”；
- fallback：显示“使用最近有效数据”；
- missing：显示“数据暂不可用”。

页面没有再实现第二套业务 debounce；singleflight/cooldown 由 3C-1 orchestrator 负责。

## Discount Formatting

统一 formatter：

```text
0.75  -> 7.50 折
0.926 -> 9.26 折
1.00  -> 10.00 折
undefined / null / NaN / Infinity -> --
```

不会在普通 UI 显示 `0.926`、`92.6%` 或 `NaN 折`。

## Partial Fill Handling

当 `filledQuantity < requestedQuantity` 时，当前字段显示为：

```text
当前盘口仅可成交 30%
已成交部分约 8.80 折
```

不会把 partial fill 的 `filledDiscount` 冒充为完整仓位 current discount。

## Suggested Budget / Capacity Wording

统一使用：

```text
当前可执行容量 ¥xxx
```

Detail 额外说明：该数值只描述当前 Steam 买盘深度、价格影响阈值与参与率估算，不代表 7 天后仍有相同流动性。

## Fee Warning

只有 core 已生成 `approximate_fee_low_price_cap_watch` 时，UI 才突出：

```text
低价手续费为近似估算
```

高价样本不会因为普通 approximate metadata 被误标为低价风险。

## Future Liquidity Warning

`future_orderbook_not_predicted` / `future_liquidity_not_guaranteed` 在 view-model 中合并为：

```text
7 天后盘口和流动性不保证
```

页面不会出现“7 天后可卖 ¥xxx”的保证式文案。

## Web Debug

已执行：

```text
npm run web -- --non-interactive
```

结果：

- Expo Metro Web bundle 成功；
- SQLite Web worker 成功 bundle；
- `http://localhost:8081` 返回 HTTP 200；
- HTML title 为“宇额助手”；
- bundle 日志没有项目 JS 编译/运行错误。

可视结果：

- legacy Web：Home、Market、Radar、Detail 均可打开，旧版预计折扣/价格/信号显示正常；
- v2 Web dev mode：Home、Market、Radar、Detail 均可打开，`DEMO / synthetic`、强机会、预计/保守/当前折扣、当前容量、未来流动性警告均显示正常；
- v2 检查完成后已恢复默认 `legacy`，重新加载 Web 首页不再出现 synthetic 标记。

## Android Debug

已执行：

```text
JAVA_HOME=D:\dev\jdk17-fresh\jdk-17.0.2
gradlew.bat :app:assembleDebug --no-daemon
```

结果：

- `BUILD SUCCESSFUL`；
- debug APK：`mobile/android/app/build/outputs/apk/debug/app-debug.apk`；
- 真机 `babf1ac5`（Android 设备 `houji`）安装成功并启动；
- `adb reverse tcp:8081 tcp:8081` 后 Metro bundle 成功；
- legacy 模式 Home 首屏截图/UI tree 通过：显示“宇额助手”“数据正常”、预计折扣、旧版摘要与底部 Tab；
- legacy 模式 Market、Radar、Detail、详情滚动、下拉刷新、后台→前台均通过；
- v2 dev mode Home、Market、Radar、Detail、详情滚动、下拉刷新、后台→前台均通过；
- v2 UI 正确显示 `DEMO / synthetic`、强机会、预计/保守/当前折扣、当前容量、未来流动性警告与 v2 详情入口；
- 真机 logcat 未发现 React Native JS exception 或 redbox；
- 未构建 release APK，未签正式包。

未完成：

- 未执行真实断网/Provider failure 注入；stale/fallback/offline 逻辑由 `verify:opportunity-ui` 与 3C-1 production tests 覆盖；
- 主机没有可用 Android emulator/AVD，但已完成连接真机回归。

## Performance

- Radar/Market 继续使用 `FlatList` virtualization；
- selector 使用 memoized hook / `useMemo`；
- render 不 stringify 全量 snapshot；
- v2 卡片只消费 view-model，不重复计算业务引擎；
- 真机列表、详情滚动未出现白屏、明显 freeze 或 JS crash；未做精确 FPS 采样。

## UI Tests

`npm run verify:opportunity-ui`：**125/125 PASS**。

覆盖：

- legacy / shadow / v2 isolation；
- excellent / buy / watch / avoid final decision；
- high raw score 不得恢复 avoid；
- stale / fallback / missing；
- partial fill；
- low-price approximate fee；
- unknown reason code；
- 折扣/金额/容量 formatter；
- no NaN / no credential / no raw machine code；
- 四页不直接调用 legacy radar/markets、Discount/Opportunity 或 Steam provider。

3C-1 production regression 仍为 **573/573 PASS**。

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
backtest                             PASS
cloud npm test                         8/8
```

没有升级 `version` / `versionCode`，没有构建 release APK，没有切换默认模式。

## 是否建议进入 3C-3

**建议进入 V3-PHASE-3C-3 Release Candidate / Default-Mode Decision。**

3C-2 已满足：

1. 默认模式仍为 legacy；
2. Web legacy/v2 可视巡检通过；
3. Android 真机 legacy/v2 交互通过；
4. UI 与 production 自动化回归全部通过。

3C-3 仍需单独讨论默认模式、版本号、release APK 和 release checklist；本阶段没有提前切换或发版。
