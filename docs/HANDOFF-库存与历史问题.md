# HANDOFF 专项 —— 库存与历史两个未解决问题（2026-09-07）

> 写给下一位接手者。主文档 `docs/HANDOFF.md` 是全量状态；本文只聚焦两个**曾未解决**的问题，
> 汇总已验证事实、已试过的方案、以及按优先级排列的下一步。App 当前版本 v1.5.6（已打包，versionCode 22）。

> **2026-09-07 更新（v1.5.6 已打包，versionCode 22 —— Steam 官方库存同步根因修复）**：
> - 🔴 **「同步完成但未找到武器箱（总量 0）Steam 库存为空：该账号 CS2 库存里没有任何物品（context 2 报 ? 件、context 16 报 ? 件；昵称「言念如一」）」——根因是代码解析 bug，不是 Steam 不返回保护期物品**：
>   官方 `GetInventoryItemsWithDescriptions`（IEconService）与 `GetPlayerSummaries` 一样返回 `{"response":{...}}` 包装，
>   而 `fetchContext` 只取 `obj.result ?? obj` → `root.assets/descriptions/total_inventory_count` 全 undefined
>   → ctx2Total/ctx16Total 为 null（诊断文案显示 `?`）、assets 空、total=0 → 永远走「空库存」分支。
>   昵称「言念如一」能查到（`data.response.players` 取值）证明 **key 有效、steamId 有效、网络通**，只有库存接口的根节点解析错了。
> - ✅ **修复（v1.5.6）**：`mobile/src/data/steam.ts` 根节点改为 `obj.response ?? obj.result ?? obj` 三态兼容；
>   `parseWebApiInventory` 同步解包（覆盖 `importSteamInventoryRaw` 会话导入的原始 JSON）；ctx2Total/ctx16Total 有资产时用资产数兜底。
> - ✅ 验证：verify:core 新增 4 项断言（response/result 包装解析 + 端到端 mock），**234/234 PASS**；typecheck 零错误。
> - ⏭ 下一步：请用户用 v1.5.6 **官方接口**再同步一次，期望看到真实件数（如「context 2 报 14 件」）；若仍为空且双 context 均报 0，
>   才回到「Steam Web API 可能不返回保护期物品」假设（届时用 C5 OpenAPI `merchant/inventory/v2` 对照诊断 status=4 冷却中物品）。
> - 说明：v1.5.3 的「强证据指向 Steam Web API 不返回保护期资产」结论**疑似误判**——当时的 0/? 全部来自解析丢弃，修复后需重新实测。
> **2026-09-06 更新（v1.5.5 已打包，versionCode 21 —— 历史会话导入改走 C5 官方趋势通道）**：
> - ✅ **「导入历史成功 0 但不成功也继续跳下一个」已修复**：旧链路在 Steam 登录页内逐箱 fetch market 列表页抓 line1，内部无失败停止，且 Steam 在该环境受限实测 0 成功。
> - ✅ **C5 能查到历史（已实测）**：借鉴 C5GAME 网页趋势接口 `GET /trade-flex/order/price-trend/chart?itemId=<id>&period=<90>`（内嵌 dates/prices），
>   itemId 用 C5 app-key（`merchant/market/v2/item/stat/hash/name`）或 cookie 网页搜索（`/steamtrade/sga/item-search/v1/list`）获取；
>   新建 `engine#importC5Histories` 导入 c5_hist（约 120 点，90 天）；任一件失败即停止并询问「停止 / 跳过此箱继续」，不再静默跳过。
> - 入口：首页「🔁 会话内导入历史」改为 C5 快速导入（WebView 改开 C5 官网，一键登录自动保存凭证；无 C5 凭证时提示先登录）。
>
> **2026-09-06 更新（v1.5.4 已打包，versionCode 20 —— C5 一键登录 cookie 修复）**：
> - ✅ **C5 一键登录后 cookie 不落库 / 手动保存失败已修复**（与本专项的"历史需登录"问题相关）：
>   - 根因：Android 端 @preeternal/react-native-cookie-manager 的 `getAllAsArray()` 直接 reject `not_supported`，
>     旧自动保存依赖它 → 永远静默失败；且 C5 的 `NC5_accessToken`/`NC5_uid` 是登录回调 JS 写入，原生读取兜不住。
>   - 修复：优先 `getCookieHeader(origin)`（能拿 HttpOnly），未命中注入 `document.cookie` 兜底；
>     手动保存同双通道；设置页加 `settingsTick` 关闭弹窗即刷新方框。
>
> **2026-09-06 更新（v1.5.3 工作区 —— C5 库存来源验证 + 空库存诊断一锤定音）**：
> - 🔍 **C5GAME 登录后能看见库存的来源已实测验证**（本机直连 C5，无需 VPN）：
>   - 前端是 Nuxt/Vue SPA，JS 在 `img.zbt.com/b/static/r/`；bundle 内 API 适配器：
>     `support:"/support"`、`getInventory()` → `GET www.c5game.com/api/v1/support/steam/inventory/v4/list?steamId=&appId=730&pageIndex=&pageSize=`；
>     `getInventoryProtobuf()` → `POST /api/v1/trade/steam/merge/inventory/v1/list/protobuf`。
>   - **匿名（无 C5 登录）实测一律 `total:0`**（含 OpenAPI 文档示例账号 76561199492470448，文档显示它有 352 件）；
>     protobuf 端点匿名报 `{"errorCode":101,"errorMsg":"Not login"}` → **C5 库存只在 C5 登录态（绑定 Steam）才返回真实数据**。
>   - bundle 中**没有任何** `steamcommunity.com` / `IEconService` / `g_rgAssets` 引用 → C5 前端不直抓 Steam 页面，
>     库存全走 C5 服务端；响应里的 classid/assetid/status/tradableTime 正是 Steam 资产数据 → C5 服务端（高权限通道/服务器拉取）能看到含保护期在内的物品。
>   - 第三方接入可走 **C5 OpenAPI**：`GET openapi.c5game.com/merchant/inventory/v2/{steamId}/730?language=zh&startAssetId=0&app-key={key}`
>     （需 C5 app-key，本项目已有；响应 status 枚举 0 正常/1 在售/2 禁用/3 永久不可交易/**4 暂时不可交易（冷却中）**/5 待发货/6 中间/7 可出租）。
>   - 结论：**C5 能看到保护期物品（status=4），用户自己的 Steam Web API 双 context 却都返回 0** →
>     强证据指向 **Steam Web API 对第三方可能默认不返回交易保护期资产**（xpaw schema 有 `filters.tradable_only/marketable_only` 参数，疑似默认过滤）。
> - 🔧 **v1.5.3 空库存诊断增强（本版已实现）**：`syncSteamInventorySmart` 返回新增
>   `ctx2Total`（context 2 report 总数）/ `ctx16Total` / `playerName`（GetPlayerSummaries/v2 昵称，尽力而为）；
>   空结果 reason 现在带 `context 2 报 X 件、context 16 报 Y 件` + `该 SteamID 昵称「…」，请核对是否本人账号`；
>   纯函数 `steamSync.ts#buildEmptySyncReason`（verify_core 新增 6 项断言，230/230）。
>   用户下次同步后一发原文即可区分：**ID 填错 / Steam API 不返回保护期物品 / context 16 失败**。
> - 打包动作：**v1.5.3 已打包（versionCode 19）**，桌面副本已同步（详见 HANDOFF.md 版本记录）。

> **2026-09-06 更新（v1.5.2 工作区，库存方案按用户拍板收敛）**：
> - ✅ **库存方案定为：仅 Steam Web API（官方 `IEconService`，双 Context 2+16）**。
>   用户明确「库存只使用 SteamWebAPI」。本版已完成：
>   - **错误诊断增强**：`fetchSteamInventoryWebApi` 的错误消息一律带 HTTP 状态码 +
>     Steam 原始返回片段（≤200 字符）——403=key 无效 / 429=限流 / 网络错误 /
>     非 JSON / success=false 都能直接看到 Steam 原文（上次失败原因未留存的根因已解决）
>   - **context 16 失败显形**：用户库存全在保护期时 context 2 天然为空，
>     context 16（交易保护箱）决定成败——它失败不再静默，返回 `ctx16Error` 并在库存页显示；
>     空结果且 context 16 失败时优先展示该原因
>   - `syncSteamInventorySmart` 返回 `source: 'steam_webapi'` + `ctx16Error`，
>     库存页同步消息显示「来源：Steam Web API（官方）」
> - ❎ **C5 官方库存通道不采用**（用户决策）：C5 仅保留价格采集
>   （批量价 / 求购参考 / c5_hist 趋势），不再作为库存通道
> - ⚠ **P3 已验证：cs2.sh**（`api.cs2.sh`，OpenAPI 公开）——`/v1` 全部需要 Bearer Key，
>   免费档（Demo/Developer）**只有 latest 快照端点**；`/v1/archive/steam`（Steam 原生 median
>   sale price 日线、2013 年起，正是我们要的）需要 **Scale/Enterprise 付费档**；
>   `/v1/prices/history` OHLC 同为 Scale+ 且数据仅从 2025-12-24 起。
>   结论：免费拿不到历史；若愿意付费（Scale 档）可一次 POST 批量 100 items 拉全历史
>   （ArchiveSteamRequest，interval 1h/1d，USD；同 Key 同 schema 还覆盖 BUFF/Youpin/CSFloat/Skinport/C5Game）
>   ——**「付费可选项」首选，等用户决策**

## 0. 用户环境（关键背景）

- 中国大陆网络 + VPN（steamcommunity 必须走 VPN），VPN 节点可切换
- Steam 账号「言念如一」，库存 14 件（3× Dreams & Nightmares Case + 11× CS:GO Weapon Case）
- **全部 14 件带交易保护盾**（2025 Steam 新机制：交易 received 7 天内受保护）——箱子来自 C5GAME 发货
- 库存隐私已设为公开；Steam 一键登录（steamLoginSecure）有效（网页登录态可见）
- 已申请 Steam Web API Key 并填入 App
- 测试机型：Android 手机，App 版本随迭代升级至 v1.4.7

## 1. 问题一：库存同步始终为空（未解决）

### 现象
Steam 手机 App / 网页正常显示 14 件箱子，但 App 所有库存同步方式均返回「空」
（社区接口 200 + `total_inventory_count: 0`）。

### 已验证事实（按通道）
| 通道 | 结果 | 备注 |
|---|---|---|
| 社区接口 `steamcommunity.com/inventory/{id}/730/2`（匿名） | 200 + 空 | 非错误，是空数据 |
| 同上 + 登录 cookie（RN fetch） | 200 + 空 | cookie 有效（网页登录态可证） |
| 同上 + **登录会话内注入 fetch**（WebView 页面内发起，credentials include） | 200 + 空（total 0） | v1.4.6 实测，见用户截图 |
| Web API `IEconService/GetInventoryItemsWithDescriptions`（用户自己的 Key，双 Context 2+16） | 用户报「试了也不行」（具体报错未提供） | **v1.5.2 已增强：错误带 Steam 原始返回片段 + context 16 失败显形** |
| 页面直抓 `g_rgAssets`（v1.4.7 新增） | 未实测 | **v1.5.x 已移除**（INV_SCRIPT 合并格式 bug，会话拉取改走 Web API 双 Context） |

### 关键判断
- Steam 的库存 **JSON 服务**对该账号/网络环境返回空，但**页面渲染正常**（走源码内嵌
  `g_rgAssets`，与 JSON 接口是两条链路）→ 与隐私设置/cookie 无关，疑似 Steam 侧
  数据同步/缓存问题或地区限制
- 交易保护箱「社区接口漏掉」的社区共识（r/SteamBot、SteamWebAPI 专门产品）只解释部分；
  本例是**整个 730 库存 JSON 为空**，更极端

### 下一步（按优先级，2026-09-06 更新）
1. **✅ 已完成：库存通道收敛为 Steam Web API 双 Context**（用户拍板「库存只用 SteamWebAPI」）
2. **✅ v1.5.3 已加空库存诊断**：同步消息带 `context 2 报 X 件、context 16 报 Y 件` + SteamID 昵称。
   用户装 v1.5.3 后点「⟳ 同步 Steam 库存」，把完成消息**原文**发回来：
   - 昵称不是「言念如一」→ SteamID 填错，直接换 ID
   - 昵称正确且双 context 仍 0 → Valve 侧对第三方不返回保护期资产（与 C5 对比已确认 C5 服务端可见 status=4），
     库存双通道方案需要与用户重新对齐（会话登录态同步 / C5 OpenAPI 库存 / 手动录入三选一）
   - context 16 报错误 → 按错误原文排查（403 key 无效 / 429 限流 / 网络）
3. 若确认 context 16 也正常返回且仍空：换 VPN 节点重试（`api.steampowered.com` 与
   `steamcommunity.com` 是不同主机，需分别验证可达性）；再不行联系 Steam 客服修账号数据，
   或用户手动录入库存（现有功能）

## 2. 问题二：历史导入全通道 0 成功（部分解决）

### 现象
市场/雷达全部「历史不足」；pricehistory 各通道 0 成功。

### 已验证事实
| 通道 | 结果 | 备注 |
|---|---|---|
| `pricehistory` + cookie（RN fetch） | 0 成功 | 具体报错在 v1.4.6 后才显形，**用户未提供最新报错原文** |
| 会话内 pricehistory（WebView 注入，v1.4.6） | 用户报不行 | 同上，原始返回片段诊断已加（v1.4.7）但未收到片段 |
| **⚡ 快速补历史**（连扫 4 轮走 priceoverview，无需登录） | **通道实测可用**（扫描一直正常出数据），但用户跑完后是否清除「历史不足」未反馈 | v1.4.7 加了收尾统计「仍不足 4 点：X 个」 |
| Skinport 成交历史（免 Key） | 可用（未依赖登录） | 已接详情页「实际成交参考」，但只有聚合统计无日线序列 |

### 根因判断
pricehistory 与库存 JSON 同属 steamcommunity 的服务，**在该环境整体不可用**
（与库存问题同因）。扫描用的 `priceoverview` 通道独立且正常。

### 下一步（按优先级）
1. **拿到「⚡ 快速补历史」完成消息的三个数字**（成功 X / 失败 Y / 仍不足 Z）——一锤定音：
   - Z=0：历史问题已解决（若 UI 还显示「历史不足」则是展示 bug，修展示）
   - X>0 但 Z>0：多点几次即可（每轮 +1 点）
   - X=0、Y 大：priceoverview 也被限流 → 换 VPN 节点/时段，或调大 `STEAM_DELAY_MS`
2. pricehistory 通道恢复后（换节点/时段），保留「会话内导入历史」一次性补 120 天
3. 长期备选：接第三方带 Key 历史源（Pricempire 付费 / SteamWebAPI.com 免费额度），
   或改造 V3 让它接受 Skinport 聚合统计作为长周期锚点（聚合非序列，需算法评估）
4. C5 历史（c5_hist cookie 导入）在该环境是否可用未单独验证——可让用户试「会话拉取 C5」
   （同样思路：C5 网页登录态内调其趋势接口）

## 3. 代码资产位置（都已实现并有测试）

| 能力 | 位置 |
|---|---|
| 库存解析（Web API JSON，含 cache_expiration 保护期精算） | `steam.ts#parseWebApiInventory` |
| Web API 库存（IEconService，双 Context 2+16，需 Key） | `steam.ts#fetchSteamInventoryWebApi`（需 `settings.steamApiKey`；错误带 Steam 原始返回片段，ctx16Error 透出） |
| 市场面页 line1 提取（绕开 pricehistory API） | `CookieLoginScreen.tsx` steam-hist 模式 + `engine.importSteamPriceHistoryRaw` |
| 目标清单（点数不足优先） | `engine.listHistoryTargets` |
| 智能同步入口（自动 ID + Web API Key 强制，v1.5.3 返回 source/ctx16Error/ctx2Total/ctx16Total/playerName） | `engine.syncSteamInventorySmart` |
| 空库存诊断文案（纯函数，context 2/16 总数 + 昵称核对） | `steamSync.ts#buildEmptySyncReason` |
| 快速补历史（backfill 模式 + 剩余统计） | `scanService.quickBackfill` + `collector` mode:'backfill' |
| Skinport 成交统计 | `skinport.ts` + `engine.skinportStats`（10 分钟缓存） |
| 历史导入失败原因显形 | collector `histFailReason` + 完成消息/首页提示 |
| 验证 | verify_core **230** 项（含 webapi/skinport/rss/steam_sync/empty_reason 断言）；pytest 39 |

## 4. 对用户的既有承诺/说明（保持口径一致）

- 库存：强制要求 Steam Web API Key（官方接口含交易保护箱 context 16，双 Context 2+16）
- 历史：steam-hist 改为从市场列表页提取内嵌 line1 数据（与 pricehistory API 不同链路），不依赖 API 登录态
- 登录有效期：Steam 数月；C5 较短但只影响下次导入（数据已入库的不再需要）
