# V3-PHASE-3A：Opportunity Engine v2 报告

日期：2026-09-13  
结论：**Phase 3A PASS**

本阶段只新增独立纯决策层与离线测试，没有接入 `radar.ts`、collector、UI、生产 API 或发版流程。

## 新增文件

| 文件 | 用途 |
|---|---|
| `mobile/src/core/opportunityV2.ts` | Opportunity Score、Decision、Hard Gates、Decision Caps、Suggested Max Budget |
| `mobile/src/core/types/opportunity.ts` | 输入、配置、输出类型 |
| `mobile/scripts/verify_opportunity_v2.cjs` | 130 项离线断言、fixture、不变量和单调性测试 |
| `mobile/scripts/fixtures/opportunity_v2/cases.json` | 机会、容量、风险、质量和缺失数据场景 |

## 实际权重

```text
discount:    0.35
liquidity:   0.25
volume:      0.10
c5Supply:    0.10
risk:        0.10
forecast:    0.05
dataQuality: 0.05
```

权重总和为 1。V4 P25/P50 只进入 Discount Score；Forecast Score 只消费 confidence/direction，不重复使用 P50 涨幅。

## Score 组成

Discount 使用：

```text
60% conservative7d.discount + 40% expected7d.discount
```

Liquidity 使用：

```text
spreadScore 35% + capacityScore 45% + coverageScore 20%
```

单件 evaluation 的 coverage 采用 neutral 50，避免把单件测试冒充大资金容量。Volume 和 C5 supply 缺失时均采用 neutral 50，并返回对应 warning。

Risk 只消费市场状态和 CV；Forecast 只消费 confidence/direction；Data Quality 使用市场质量 70%、预测质量 30%。

## Hard Gates

以下条件直接 `avoid`：

```text
missing_expected_7d
expected_discount >= 1.0
marketDataQuality < 0.60
current capacity < ¥20
```

以下条件最高封顶为 `watch`：

```text
marketDataQuality.stale
marketState = CHAOS
forecast missing
liquidationCoverage < 0.5
```

## Decision Caps

当 Steam fee 为 approximate 且当前 Steam 价格低于 ¥1.00 时，增加 `approximate_fee_low_price_cap_watch`，最高为 `watch`。

未来场景保留：

```text
futureModel.orderbookPredicted = false
futureModel.liquidityGuaranteed = false
```

并输出：

```text
future_orderbook_not_predicted
future_liquidity_not_guaranteed
```

这不会把所有机会都封顶，但 Excellent 仍必须满足折扣、容量、spread、质量、forecast 和非 CHAOS 条件。

## Excellent 额外条件

除 raw score ≥85 外，还要求：

```text
conservative7d.discount <= 0.90
expected7d.discount <= 0.85
current capacity >= ¥100
spreadPct <= 5%
marketDataQuality >= 0.80
数据未过期、forecast 可用、marketState != CHAOS
低价 approximate fee 不成立
```

## Suggested Max Budget

```text
current capacity
× riskMultiplier
× marketDataQuality.score
```

最终再受 `evaluationBudget` 限制。该金额只表示当前盘口容量下的建议规模，不代表 7 天后保证可卖金额。

## Reasons / Warnings

输出稳定 code，不直接输出中文长文案，例如：

```text
discount_attractive
liquidity_strong
spread_tight
market_stable
steam_fee_model_approximate
future_orderbook_not_predicted
volume_missing
market_data_stale
partial_fill
```

## Fixture 覆盖

已覆盖：理想机会、折扣好但容量 ¥10、预计≥10折、CHAOS、低价 approximate fee、stale、低质量、forecast 缺失、volume/C5 缺失、partial coverage，以及容量/折扣/spread/quality 单调性和 hard gate 优先级。

## 测试结果

```text
verify:opportunity-v2 130/130 PASS
typecheck PASS
verify:core 312/312 PASS
verify:storage 35/35 PASS
verify:ssr 7/7 PASS
verify:cache 11/11 PASS
verify:chart 34/34 PASS
verify:orderbook 21/21 PASS
verify:discount-v2 162/162 PASS
verify:steam-fee-audit 28/28 PASS（PASS-B）
backtest PASS
cloud npm test 8/8 PASS
```

## 生产边界

本阶段没有修改 `radar.ts`、collector、UI、生产 API、SQLite/D1，也没有改变旧 Radar 结果或升级版本。

## 下一步

只建议进入 **V3-PHASE-3B：Shadow Integration**，比较旧 Radar 与 Opportunity v2，不提前修改 UI。

