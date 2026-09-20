# V3-PHASE-2.1：Discount/Liquidity Audit Patch 报告

日期：2026-09-13  
结论：**Phase 2.1 PASS-B**

本阶段只做计算语义和审计修补，没有接入 UI、collector、radar、云端采集或发版流程。

## Partial Fill 修复

### 旧语义

盘口不足时，旧实现用完整 requested quantity 计算 C5 成本，却只用已成交部分 Steam 净到账计算 `current.discount`，会把未成交部分隐式当成零价值。

### 新语义

`current` 现在增加：

```text
filledQuantity
requestedQuantity
liquidationCoverage
filledGross
filledNet
filledDiscount
fullPositionDiscount
```

规则：

```text
liquidationCoverage = filledQuantity / requestedQuantity
filledDiscount = filledQuantity 对应的 C5 成本 / filledNet
```

只有完全成交时才设置：

```text
fullPositionDiscount = filledDiscount
current.discount = fullPositionDiscount
```

部分成交时：

```text
current.discount = undefined
fullPositionDiscount = undefined
warning = partial_fill
```

### Fixture 示例

```text
C5 成本：¥1.00 / 件，含 1% 手续费后 ¥1.01 / 件
requested：10 件
Steam 买盘：¥2.00 × 2
```

结果：

```text
filledQuantity = 2
liquidationCoverage = 0.20
filledGross = ¥4.00
filledNet = ¥3.4784
filledDiscount = 2.02 / 3.4784 = 0.58072677
fullPositionDiscount = undefined
current.discount = undefined
```

旧 `grossPerUnit`、`netPerUnit`、`totalNet` 字段继续保留；部分成交时它们只描述已成交部分。

## Steam Fee Audit

### 当前算法

现有 `ProfitCalculator.steamNetReceive()` 使用：

```text
estimatedSteamNetReceive = gross × 0.8696
```

它是固定比例浮点模型，不处理：

- CNY fen 整数化；
- Steam/游戏费用最低值；
- 第一方低价结算取整；
- 已确认的逐笔卖家到账规则。

因此本阶段不猜测 exact 规则，保留原模型并新增：

```text
feeModel.name = estimatedSteamNetReceive
feeModel.kind = approximate
feeModel.exact = false
warning = steam_fee_model_approximate
```

这是 PASS-B，而不是 PASS-A。

### 审计结果

审计脚本：

```powershell
npm run verify:steam-fee-audit
```

```text
gross    estimated_net    exact_net    status
0.03     0.02608800      unavailable   approximate
0.05     0.04348000      unavailable   approximate
0.10     0.08696000      unavailable   approximate
0.18     0.15652800      unavailable   approximate
0.19     0.16522400      unavailable   approximate
0.20     0.17392000      unavailable   approximate
0.50     0.43480000      unavailable   approximate
1.00     0.86960000      unavailable   approximate
2.00     1.73920000      unavailable   approximate
10.00    8.69600000      unavailable   approximate
100.00   86.96000000     unavailable   approximate
```

审计结论：当前模型与项目既有 `0.8696` 公式一致，低价输入均 finite；没有第一方逐笔结算 fixture，因此不能报告 exact_net 或误差百分比。

## Current Liquidity Capacity

新增：

```ts
currentLiquidityCapacity: {
  scope: 'current_market_structure';
  executableQuantity: number;
  executableBudget: number;
}
```

旧 `liquidity.executableQuantity` 与 `liquidity.executableBudget` 保留兼容。

它们只表示：

> 按当前 Steam 买盘、当前价格冲击阈值、最大市场参与比例和 C5 当前可买数量估算的当前流动性容量。

它们不表示：

- 7 天后保证能卖掉的金额；
- 未来订单簿容量；
- 用户总预算建议；
- 自动交易承诺。

## Future Scenario Boundary

未来三种场景仍使用：

```text
currentBuySellRatio = current highestBuy / current lowestSell
```

该 ratio 现在显式标记为：

```text
ratioKind = current_market_heuristic
```

未来结果增加：

```ts
futureModel: {
  orderbookPredicted: false;
  liquidityGuaranteed: false;
  usesCurrentBuySellRatio: true;
}
```

并增加 warnings：

```text
future_orderbook_not_predicted
future_liquidity_not_guaranteed
```

因此 `conservative7d`、`expected7d`、`listing7d` 不能被解释为未来真实买盘或未来可保证容量。

## Quality

新增拆分字段：

```ts
marketDataQuality: {
  score: number;
  stale: boolean;
  reasons: string[];
}

forecastQuality: {
  available: boolean;
  score?: number;
  reasons: string[];
}
```

旧 `quality.score/stale/reasons` 保留，映射为：

```text
quality.marketData = marketDataQuality
quality.forecast = forecastQuality
quality.overall = marketDataScore × forecastScore（无 forecast 时不额外扣分）
```

市场质量覆盖 Steam/C5 freshness、C5 数据存在、空/非法盘口、crossed book、partial fill 和 Provider quality。预测质量当前只区分 available/missing，并透传 V4 confidence，不新增复杂预测评分。

## 测试结果

```text
typecheck PASS
verify:discount-v2 162/162 PASS
verify:steam-fee-audit 28/28 PASS（PASS-B）
verify:core 312/312 PASS
verify:storage 35/35 PASS
verify:ssr 7/7 PASS
verify:cache 11/11 PASS
verify:chart 34/34 PASS
verify:orderbook 21/21 PASS
backtest PASS
cloud npm test 8/8 PASS
```

新增文件：

- `mobile/scripts/verify_steam_fee_audit.cjs`；
- `mobile/scripts/fixtures/steam_fee/cases.json`；
- `docs/V3-PHASE-2.1-AUDIT-REPORT.md`。

## 下一步

等待人工确认后进入 V3-PHASE-3：Opportunity Engine v2。当前不实现 Opportunity Score、Radar v2、UI 或推荐权重。

