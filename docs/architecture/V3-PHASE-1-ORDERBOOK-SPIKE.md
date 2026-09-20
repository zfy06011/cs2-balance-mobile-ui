# V3-PHASE-1：Steam 订单簿 Spike 报告

日期：2026-09-13  
范围：只验证 Steam 订单簿 Provider，不改主采集链、不改 UI、不实现三种“几折”。

## 结论

当前 Steam Community Market 可稳定验证的主路径是：

```text
marketHashName
  → GET /market/orderbook?q=Load&qp=[730,marketHashName]
  → highestBuy / lowestSell / compact buy-sell depth
```

旧路径：

```text
marketHashName
  → listings HTML 中的 Market_LoadOrderSpread(item_nameid)
  → GET /market/itemordershistogram?item_nameid=...
```

仍保留兼容解析器，但本轮实测当前 SSR listings 页面未稳定暴露 `Market_LoadOrderSpread(...)`，因此不能把旧 ID 链称为当前稳定生产路径。当前 Provider 对该情况返回 `missing_item_nameid`，并明确提示使用 name-based orderbook。

Steam Community Market Web 接口属于第一方网页数据源，不是 Steamworks 官方公开 Market API。第三方项目只作为请求和字段形状的研究参考：

- [aiosteampy](https://github.com/somespecialone/aiosteampy)：展示匿名客户端通过 `item_nameid` 获取 orders histogram 的调用方式。
- [steam-market-api-v2-original](https://github.com/dmirell/steam-market-api-v2-original)：记录 `itemordershistogram` 参数及 `highest_buy_order`、`lowest_sell_order`、买卖 graph 字段。
- [Steamworks IEconMarketService](https://partner.steamgames.com/doc/webapi/ieconmarketservice)：官方文档边界；该接口是 partner restricted，不能作为普通项目的公开 Market API 结论。

## 新增实现

| 文件 | 用途 |
|---|---|
| `mobile/src/providers/steam/steamOrderbook.ts` | 隔离的 Steam 订单簿 Provider；当前 name-based 主路径 + legacy 兼容解析 |
| `mobile/scripts/verify_steam_orderbook.cjs` | 离线 fixture、异常/429/重试/特殊字符验证；`--live` 执行在线验证 |
| `mobile/scripts/fixtures/steam_orderbook_response.json` | 脱敏的 compact orderbook fixture |
| `mobile/package.json` | 增加 `verify:orderbook` 与 `verify:orderbook:live` |

Provider 输出：

- `highestBuy`、`lowestSell`；
- `spread`（绝对价差）与 `spreadPct`（相对价差）；
- `buyLevels`、`sellLevels`，每档含 `price`、`quantity`、`cumulativeQuantity`；
- `fetchedAt`、`sourceKind: steam_first_party_web`、`requestVersion`；
- `health()`：成功时间、失败时间、连续失败数、延迟、HTTP 状态和诊断原因。

异常保护：

- timeout、网络错误、408/425/429/5xx 重试与指数退避；
- 429 保留 HTTP 状态诊断；
- JSON、compact pair、盘口价量非法时返回 `malformed_response`；
- Steam 主动拒绝时返回 `steam_rejected`；
- 旧链路找不到 `item_nameid` 时返回 `missing_item_nameid`。

## 离线验证

```text
npm run verify:orderbook
PASS 21 / 21
```

覆盖：

- 当前 name-based 响应 envelope；
- compact 买卖盘逐档数量和累计数量；
- CNY/小数转换；
- 旧 histogram graph 兼容解析；
- `Market_LoadOrderSpread` 解析与当前 SSR 缺失诊断；
- 中文、空格、`&` 等特殊名称的 `qp` 编码；
- 429 重试；
- malformed response / malformed JSON；
- ProviderHealth 成功与失败状态。

## 在线验证

命令：

```powershell
cd D:\Codex\cs2-balance-mobile\mobile
npm run verify:orderbook:live
```

串行验证 6 个目标物品，结果为 **6/6 = 100.0%**：

| 物品 | 最高买单（CNY） | 最低卖单（CNY） | 买档 | 卖档 |
|---|---:|---:|---:|---:|
| CS:GO Weapon Case | 142.74 | 158.12 | 841 | 283 |
| Dreams & Nightmares Case | 1.65 | 1.68 | 134 | 1885 |
| Kilowatt Case | 0.18 | 0.19 | 16 | 1952 |
| Revolution Case | 0.29 | 0.30 | 26 | 1808 |
| Fracture Case | 0.71 | 0.72 | 61 | 808 |
| Sealed Dead Hand Terminal | 0.65 | 0.66 | 58 | 2431 |

在线结果是 2026-09-13 的一次快照，不代表固定价格。Provider 最后状态：`ok=true`、`consecutiveFailures=0`。

## 与现有代码的差异

当前 `mobile/src/data/steam.ts` 只负责 `priceoverview`、`search/render`；当前 `mobile/src/data/collector.ts` 仍按原逻辑采集实时价。已有 `cloud/src/steam.ts` 能从 listing SSR 解析历史页面内嵌盘口，但没有移动端实时 orderbook Provider 和独立的限流/健康模型。

本轮没有把 Provider 接入 `collector`、`engine`、市场页或雷达页，也没有删除/替换现有 C5、Steam SSR、V4 逻辑。

## Phase 1 判定

Spike 验收通过：在线目标物品成功率达到 100%，高于要求的 90%；离线解析和失败诊断均通过。下一步可以在独立分支/提交中进入 Phase 2 的 Discount Engine，但本轮不提前实现。

