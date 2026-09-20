# V3-PHASE-3B.1：Shadow Coverage + Gate Audit 报告

日期：2026-09-13  
结论：**FAIL（基础数据覆盖达标，但 forecast 覆盖和 expectedDiscount 排名稳定性未达标）**

本阶段没有调权重、放宽 gate、修改 UI、替换 Radar 或发版。

## Universe / Candidate Coverage

两轮短周期 Shadow 使用同一类 CLI 候选池：

```text
universeCount = 93
candidateCount = 93
attemptedCount = 93 / round
poolSource = manual_fallback 20 + steam_popular 73
```

候选已从原先 20 个扩展到 93 个，并通过 `isTrackedCase` 过滤；本阶段没有重构 ItemCatalog。

## Data Coverage

| 数据 | Round 1 | Round 2 |
|---|---:|---:|
| orderbook | 93/93 = 100% | 93/93 = 100% |
| C5 price | 93/93 = 100% | 93/93 = 100% |
| forecast | 0/93 = 0% | 50/93 = 53.8% |
| volume24h | 20/93 = 21.5% | 30/93 = 32.3% |
| C5 supply | 93/93 = 100% | 93/93 = 100% |

Forecast coverage 明显不足且两轮变化很大；这是当前排序稳定性问题的主要嫌疑，不能把缺少 forecast 的 raw score 当成真实机会排序。

## Hard Gate Distribution

### Round 1

| Gate | Count | Rate |
|---|---:|---:|
| `missing_expected_7d` | 93 | 100% |
| `current_capacity_too_small` | 53 | 57.0% |

### Round 2

| Gate | Count | Rate |
|---|---:|---:|
| `missing_expected_7d` | 43 | 46.2% |
| `expected_discount_not_viable` | 50 | 53.8% |
| `current_capacity_too_small` | 26 | 28.0% |

### Primary Gate

Primary gate 按固定优先级统计：

- Round 1：`missing_expected_7d` 93/93；
- Round 2：`missing_expected_7d` 43、`expected_discount_not_viable` 50。

这解释了“全 avoid”：主要不是容量 gate，而是 forecast 缺失或预计折扣不成立。

## Decision Cap Distribution

| Cap | Round 1 | Round 2 |
|---|---:|---:|
| `forecast_missing_cap_watch` | 93 | 43 |
| `approximate_fee_low_price_cap_watch` | 49 | 49 |
| `chaos_cap_watch` | 0 | 17 |
| `excellent_requirements_not_met` | 1 | 1 |

低价 approximate fee cap 只作用于低价且 approximate fee 的样本；没有看到它单独制造 buy/excellent。

## Raw Score vs Final Decision

### Round 1 分布

```text
raw excellent: 1
raw buy:       52
raw watch:     40
final avoid:   93
```

### Round 2 分布

```text
raw excellent: 1
raw buy:       32
raw watch:     10
raw avoid:     50
final avoid:   93
```

高 raw score 被 `missing_expected_7d` 或 `expected_discount_not_viable` 拦截，说明 hard gate 优先级生效；但由于 forecast coverage 不稳定，不能据此判断 raw 排序质量。

## Near-Miss / Top Raw Score

Round 2 Top Raw Score 示例：

| Item | Raw Score | Raw Decision | Final | Primary Gate | Capacity |
|---|---:|---|---|---|---:|
| Glove Case | 86.83 | excellent | avoid | missing_expected_7d | ¥2419.80 |
| Operation Wildfire Case | 82.90 | buy | avoid | missing_expected_7d | ¥874.58 |
| Kilowatt Case | 82.64 | buy | avoid | missing_expected_7d | ¥206.98 |
| Chroma 3 Case | 81.43 | buy | avoid | missing_expected_7d | ¥133.74 |
| Gamma 2 Case | 81.25 | buy | avoid | missing_expected_7d | ¥2632.10 |

Round 2 Near-Miss 共 20 个；其中主要是 raw buy/excellent 但 forecast 缺失，不能视为真实正向机会。

`expectedDiscount < 0.90 AND final avoid`：未发现。  
`capacity >= ¥300 AND expectedDiscount >= 1.0`：Round 2 发现 5 个，均保持 avoid，说明大容量没有绕过折扣 gate。

## 多轮稳定性

```text
rawScore Top10 overlap：81.8%
expectedDiscount Top10 overlap：0%
```

rawScore 稳定性尚可，但 expectedDiscount Top10 完全不重叠；结合 forecast coverage 从 0% 变为 53.8%，当前不能进入 UI 集成。需要先解决历史/V4 forecast 的缓存、获取成功率或候选池数据完整性问题，再重新做稳定性审计。

## 安全审查

```text
高危误推荐：0
```

没有发现以下情况：

- expectedDiscount ≥ 1 仍 buy/excellent；
- capacity < ¥20 仍 buy/excellent；
- CHAOS 仍 buy/excellent；
- stale 仍 buy/excellent；
- 低价 approximate fee 仍 buy/excellent；
- marketDataQuality < 0.60 仍 buy/excellent。

## 测试结果

```text
verify:opportunity-shadow 66/66 PASS
typecheck PASS
Phase 1/2/2.1/3A 全部既有测试继续 PASS
```

Coverage artifact 保存在本地 `artifacts/shadow/`，该目录已加入 `.gitignore`，不进入仓库。

## 结论与下一步

Phase 3B.1 暂定 FAIL，原因是：

1. forecast coverage 0%～53.8%，未达到稳定审查要求；
2. expectedDiscount Top10 overlap 为 0%；
3. 当前 raw 高分主要来自缺 forecast 的样本，不能解释为真实正向机会。

本阶段不调权重、不放宽 gate、不进入 Phase 3C。下一步应先修复或提高历史/V4 forecast 数据覆盖，再重新运行 80~150 个候选的多轮 Shadow 审计。

