# V3-PHASE-3B.1R：Stable Forecast Gate / Near-Miss Re-Audit 报告

日期：2026-09-13  
结论：**FAIL，原因是实时 orderbook 覆盖/稳定性不足；Opportunity Gate 本身未发现高危误推荐**

## 输入

使用 3B.2S 的固定 ForecastBundle：

```text
candidateHash = e6dc7387
candidateCount = 93
forecast ready = 93/93
frozen replay = 100% deterministic
```

## Gate / Cap 分布

成功的 frozen-score A/B 审计结果：

| Gate | Round A | Round B |
|---|---:|---:|
| `expected_discount_not_viable` | 93 | 90 |
| `current_capacity_too_small` | 48 | 48 |
| `missing_expected_7d` | 0 | 3 |
| `market_quality_low` | 0 | 3 |

Primary gate 以固定优先级统计，主要是 `expected_discount_not_viable`。所有有效 expectedDiscount 样本均 ≥1：

```text
Round A expected distribution: 93/93 in >=1.00
Round B expected distribution: 90/90 in >=1.00
```

这说明当前稳定 forecast 输入下，当前市场快照没有余额转换机会，而不是因为 forecast 缺失把机会全部过滤掉。

Cap 主要分布：

- CHAOS：约 22/93；
- low-price approximate fee：约 47~48/93；
- stale/coverage cap：只出现在 orderbook 失败样本。

## Raw vs Final

Round A：`avoid -> avoid` 为 88 条，其余为 `watch -> avoid`；  
Round B：`avoid -> avoid` 为 84 条，`watch -> avoid` 6 条，`buy -> avoid` 3 条。

Round B 的 raw buy→avoid 主要由 `expected_discount_not_viable` 或 orderbook 失败造成，没有出现 expectedDiscount≥1 的 buy/excellent 最终推荐。

## Near-Miss / Discount 分布

Near-Miss 主要来自 raw score 较高但 expectedDiscount 不成立，或 forecast/orderbook 失败后的保护性结果。未发现：

```text
expectedDiscount < 0.90 AND final avoid
```

容量较大的样本也仍保持 avoid，因为折扣不成立；容量没有绕过 expected gate。

Expected / Conservative 的有效样本分布均远高于 1.00，未出现可进入 buy/excellent 的折扣区间。低价 approximate fee cap 规则实际生效，未造成 buy/excellent。

## Opportunity / Radar 分布

在成功的 A/B frozen-score 样本中：

```text
old Radar：全部 avoid
Opportunity v2：全部 avoid
```

没有正向候选，因此不存在可以人工审查的 live buy/excellent 样本；不能把本轮结果表述为正向排序质量已经被验证。

## 实时稳定性问题

两次正常间隔运行的固定 bundle Shadow：

```text
Round A orderbook coverage = 89/93
Round B orderbook coverage = 90/93
```

紧接着立即重复请求时，Steam orderbook 可出现 0/93，证明当前实时 orderbook provider 受到外部限流/连接状态影响。该问题独立于 Forecast：ForecastBundle 已固定，frozen replay 仍 100% 一致。

因此本阶段 FAIL 的直接原因是：

```text
实时 orderbook coverage 未稳定达到 90%+ 的多轮要求
```

不是 Opportunity 权重、Gate 或 V4 预测错误。

## 安全审查

高危误推荐：0。

未发现：

- expectedDiscount ≥1 仍 buy/excellent；
- capacity < ¥20 仍 buy/excellent；
- CHAOS 仍 buy/excellent；
- stale 仍 buy/excellent；
- 低价 approximate fee 仍 buy/excellent；
- marketDataQuality <0.60 仍 buy/excellent。

## 测试

```text
verify:opportunity-gate-audit 89/89 PASS
verify:history-cache 62/62 PASS
verify:forecast-readiness 28/28 PASS
verify:forecast-pipeline 73/73 PASS
verify:opportunity-shadow 66/66 PASS
typecheck PASS
Phase 1/2/2.1/3A 既有回归 PASS
```

## 结论与下一步

3B.1R 不通过，暂不进入 Phase 3C。下一步应单独稳定 Steam orderbook 的多轮采集/限流/重试窗口，不能通过调 Opportunity 权重或放宽 Gate 解决。

