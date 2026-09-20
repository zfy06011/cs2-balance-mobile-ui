# V3-PHASE-2：Discount Engine v2 + Liquidity Engine 报告

日期：2026-09-13  
结论：**Phase 2 PASS**

本阶段只新增纯计算层、fixture 和离线测试；没有接入 UI、collector、radar、云端采集或发版流程。

## 新增文件

| 文件 | 用途 |
|---|---|
| `mobile/src/core/liquidity.ts` | 盘口归一化、重复档位合并、卖入买盘撮合、VWAP、滑点、spread、可执行容量与资金 |
| `mobile/src/core/marketQuality.ts` | Steam/C5 freshness、盘口完整性、交叉盘口、部分成交和源质量评分 |
| `mobile/src/core/discountV2.ts` | 当前兑现、7 天保守、7 天预计、7 天理想挂单四套折扣 |
| `mobile/scripts/verify_discount_v2.cjs` | 纯函数离线验证，包含边界和不变量测试 |
| `mobile/scripts/fixtures/discount_v2/cases.json` | 单档、多档滑点和容量 fixture |
| `mobile/package.json` | 增加 `verify:discount-v2` |

## 算法口径

### 当前立即兑现

`simulateSellIntoBuyBook()` 会先忽略上游 `cumulativeQuantity`，按 buy 价格降序、合并重复价格档位，再逐档撮合指定数量。

输出：

- `filledQuantity` / `unfilledQuantity`；
- `grossProceeds`；
- `averageSellPrice` 作为真实 VWAP；
- `worstFillPrice`；
- `slippagePct = (bestPrice - averageSellPrice) / bestPrice`。

当前折扣：

```text
totalCost = c5.unitPrice × (1 + c5.feeRatio) × quantity
totalNet = grossProceeds × 0.8696
current.discount = totalCost / totalNet
```

盘口不足时只返回已成交金额，并增加 `partial_fill`，不会伪装成完整成交。

### Spread

```text
spread = lowestSell - highestBuy
spreadPct = spread / lowestSell
```

当 `highestBuy > lowestSell` 时返回 `crossed_book`，不抛异常，并降低质量分数。

### 可执行数量与资金

默认配置集中在 `DEFAULT_DISCOUNT_V2_CONFIG`：

```text
maxBookImpactPct = 1%
maxBookParticipationPct = 20%
staleAfterMs = 10 分钟
minQuality = 0.60
```

先统计 `price >= highestBuy × (1 - 1%)` 的买盘数量，再取：

```text
floor(depthQty × 20%)
```

最后受 `c5.availableQuantity` 限制。可执行资金为：

```text
executableQuantity × c5.unitPrice × (1 + c5.feeRatio)
```

### 7 天场景

```text
buySellRatio = highestBuy / lowestSell
conservative7d.grossPerUnit = p25 × buySellRatio
expected7d.grossPerUnit = p50 × buySellRatio
listing7d.grossPerUnit = p50
```

当 ratio 不在 `(0, 1]` 内时，不生成未来场景并返回 warning。

未来场景只模拟预测单位价格 × quantity，并明确返回：

```text
future_book_depth_not_modeled
```

不能把它解释为已知道 7 天后的真实订单簿容量。

## 手续费核验

新引擎复用了现有 `ProfitCalculator`：

- C5：`c5TotalCost()`；
- Steam：`steamNetReceive()`；
- 默认费率来自 `DEFAULT_FEES`：C5 `1%`，Steam 到账比例 `0.8696`。

没有修改旧 fee 逻辑。低价边界已覆盖：`0.03、0.05、0.10、0.18、0.19、0.20、0.50、1.00、10.00、100.00`，C5 和 Steam 两套公式均通过。

## Fixture 示例

以 `C5=¥1.00`、数量 1、Steam 买单 `¥9.00`、卖单 `¥10.00`、V4 `P25=¥8、P50=¥10、P75=¥12` 为例：

| 场景 | 毛价 | Steam 净到手 | 折扣小数 | 展示折数 |
|---|---:|---:|---:|---:|
| 当前买盘 | ¥9.00 | ¥7.8264 | 0.129050 | 1.29 折 |
| 7 天保守 | ¥7.20 | ¥6.26112 | 0.161313 | 1.61 折 |
| 7 天预计 | ¥9.00 | ¥7.8264 | 0.129050 | 1.29 折 |
| 7 天理想挂单 | ¥10.00 | ¥8.696 | 0.116145 | 1.16 折 |

多档盘口 fixture：

```text
10.00 × 1
 9.80 × 2
  9.50 × 100
```

卖出 10 件时 VWAP 为 `9.61`，滑点为 `3.9%`。容量 fixture 在 1% 价格影响范围内有 370 件买盘，20% 参与比例后可执行数量为 74 件；若 C5 只有 20 件，则最终为 20 件、可执行资金 ¥20.20（C5 单价 ¥1.00）。

## 测试结果

```text
npm run verify:discount-v2
PASS 143 / 143
```

覆盖：

- 单档完整成交；
- 多档滑点与 VWAP 单调性；
- 盘口不足与部分成交；
- spread / crossed book；
- 低价手续费边界；
- 1% impact、20% participation、C5 数量限制；
- P25/P50/P75 三种未来场景；
- 无 forecast；
- stale、低 source quality、空盘口；
- 0、负数、NaN、Infinity、重复档位、乱序档位、错误 cumulative；
- 结果 finite、不变量和 quality `[0,1]`。

本阶段完成后，原有验证继续通过：

```text
typecheck
verify:core 312/312
verify:storage 35/35
verify:ssr 7/7
verify:cache 11/11
verify:chart 34/34
verify:orderbook 21/21
cloud npm test 8/8
npm run backtest
```

## 已知限制

- 未来 7 天没有真实未来订单簿，因此未来三种场景不建模未来深度和未来滑点。
- `quality` 只描述数据质量，不决定 buy/watch/avoid；推荐决策留给 Phase 3。
- 新 Engine 尚未接入 UI、collector、旧 `expected_discount`、SQLite 或云端。
- 未删除 V4、`priceoverview`、legacy `item_nameid` 兼容逻辑，也没有改变现有字段含义。

## 下一步

等待人工审查本阶段计算口径；确认后再进入 Phase 3：Opportunity Score v2 + Radar 重构。本阶段不自动继续实现 Phase 3。
