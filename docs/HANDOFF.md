# HANDOFF —— 宇额助手（原 CS2 余额助手 / 余额雷达）交接文档

> **本文件是工作区唯一交接文档**（已合并原《软件介绍》《数据调用链路》《Steam官方接口研究报告》《DATA_SOURCE_REPORT》《HANDOFF-库存与历史问题》全部内容，删除重复与过时结论，更新至 **v1.5.10**）。
> **写给接手继续改进的 AI / 开发者**：改动代码或发版前先完整读一遍；所有对外解释、文案、回复必须简体中文；本文件也是版本记录的唯一载体。

## 0. 一句话定位

**纯手机端 Android App「宇额助手」**：监控 CS2 武器箱行情，发现「C5GAME 低价买入 → 约 7 天交易保护期 → Steam 市场卖出」的套利机会，并管理自己的库存与买入记录。
所有分析都在手机本地完成（快照 → 预测 → 收益 → 雷达 → 模拟），**不依赖自建服务器、不自动买卖、不用连电脑**。
最高目标：让用户快速知道**现在买哪个箱子最划算、预计能以几折倒成 Steam 钱包余额**（低于 1 折更划算；如投入 100 元、预计 Steam 净到手 108 元 = 9.26 折）。

## 1. 核心功能与页面

| 功能 | 说明 |
|---|---|
| 📡 一键扫描 | Steam 热门武器箱榜（回退成交量榜）拉候选 → C5 批量查买入价 → 逐个 Steam 实时价 → 写本地快照；断点续采（15 分钟内跳过已采）、采集数量 1-100 自选 |
| 📊 市场行情 | 每箱最新 Steam 价 / C5 买入价 / 预计几折 / 近 7 天与 90 天走势图 |
| 🎯 雷达信号 | 综合评分与买卖信号（7 天预测 P50/P25 对买入价收益与风险），事件日历（Steam 大促 / Major / 春节行情）修正评分 |
| 📦 库存同步 | **仅 C5GAME 官方 OpenAPI（app-key）**拉取本人库存（C5 服务端高权限通道能看到交易保护期物品 status=4 冷却中），自动导入本地库存并精确到小时的解锁倒计时 |
| 🔁 快速导入历史 | **云端优先**（cloud/ Worker，零登录，Steam gid 页 SSR 全量历史），失败回退 C5 官方趋势（需 C5 登录态）；走 `storage.mergeSteamHistory` 入库 |
| 💰 买入记账 | 本地记账（核验预算/限制期/二次确认），生成订单流水；C5 下单接口实测未开放（见 6.4），保持不自动下单 |
| 🧮 模拟器 | 按预算与分配策略模拟买入组合收益/风险；反向模拟（目标收益推预算） |
| 🔐 一键登录 | WebView 登录 Steam / C5GAME，自动抓 cookie；Steam 登录仅用于自动识别本人 SteamID64 与搜索榜提额（库存不依赖 Steam 登录） |

页面结构：**首页**（一键扫描、快速补历史、快速导入历史入口、分析摘要）｜**市场**（列表/详情：走势、预测、买卖时机、C5 求购参考、Skinport 实际成交参考）｜**库存**（本地库存、C5 同步入口、解锁倒计时、卖出建议）｜**雷达**（信号列表）｜**我的/设置**（采集数量、C5 app-key、云端历史地址、Steam/C5 Cookie、SteamID64、一键登录入口）。

## 2. 所需配置（按用途）

| 配置 | 用途 | 获取方式 |
|---|---|---|
| **C5 app-key（库存与价格必填）** | 批量查 C5 买入价、查 itemId、求购价、**库存同步唯一通道** | C5 开放平台申请（opendoc.c5game.com） |
| **云端历史地址（选填，v1.5.10）** | 「快速导入历史」走云端（零登录） | 部署 cloud/ 后填 Worker 地址（见第 7 章） |
| C5 Cookie（选填） | 「快速导入历史」回退通道（C5 官方趋势必须登录态） | App 内「C5 一键登录」自动保存 |
| Steam Cookie（选填） | 提高搜索榜返回数量（单页 100 条）、自动识别本人 SteamID64 | App 内「Steam 一键登录」自动保存 |
| SteamID64（库存必填） | C5 库存同步的本体账号 | 资料页 /profiles/ 后 17 位数字；做过 Steam 一键登录可自动识别 |

## 3. 当前状态（2026-09-07）

### 3.1 两个关键方向变更（务必先了解，否则会在库存/历史上走回头路）

1. **v1.5.9 库存定论：库存只走 C5GAME 官方 OpenAPI（app-key）**。
   `GET https://openapi.c5game.com/merchant/inventory/v2/{steamId}/730`（自动分页），C5 服务端高权限通道能看到**交易保护期物品（status=4 冷却中）**；
   **彻底解决 v1.5.2~v1.5.8 期间 Steam Web API 对保护期账号返回 `{"response":{}}` 导致库存永远为空的问题**（用户问「C5 为何能显示」的答案即在此）。
   Steam Web API 库存全部代码与设置页「Steam Web Key」输入项已移除，勿再恢复。
2. **v1.5.10 历史主通道改云端**：新增 `cloud/`（Cloudflare Worker + D1），定时抓取 **Steam 市场 gid 页 SSR 数据**入库（2026-09-07 实测：**零 cookie、2013-08-14 至今全量日线 + 近期小时粒度 + 盘口深度**，CS:GO Weapon Case 5202 点）。
   App「🔁 快速导入历史」云、端优先（设置页 `cloudWorkerUrl` 有值即走云端，零登录），失败弹窗「停止/跳过/改用 C5 官方趋势」；未配置则回退 C5 官方趋势。
   **C5 历史无法零 cookie 获取**（OpenAPI 无历史端点、网页趋势必须登录），不纳入云端。
   实验结论详证与解析链见 6.1；云端部署运维见第 7 章。

### 3.2 版本 / 安装包 / 已验证

| 项目 | 值 |
|---|---|
| 最新版本 | **v1.5.10（已打包，2026-09-07，versionCode 26）**；包名 `com.cs2balance.assistant`，minSdk 24，名称「宇额助手」 |
| 安装包 | `releases\宇额助手-v1.5.10.apk`（releases 保留历史版本）；桌面副本 `C:\Users\Administrator\Desktop\宇额助手-v1.5.10.apk`（仅留最新、已同步） |
| 构建工具链 | JDK **`D:\dev\jdk17-fresh\jdk-17.0.2`**（原 D:\dev\jdk17 被误删，华为云镜像重装）；gradle 用 `C:\Users\Administrator\.gradle\wrapper\dists\gradle-9.3.1-bin\1lole3zto6bam3nn92w6lo9we\gradle-9.3.1\bin\gradle.bat` |
| 已验证 | typecheck 零错误；**verify:core 222/222 PASS**（TS==Python baseline）；cloud 解析单测 **8/8 PASS**；backend pytest 39 passed（历史参考） |
| 工作区引擎 | baseline-momentum-v2 + 事件日历 V3（已随 v1.4.0 打包发布） |

### 3.3 版本历史（一句话表；细枝末节看 git log）

| 版本 | 要点 |
|---|---|
| v1.2.0 | C5GAME OpenAPI 正式接入，C5 买入价自动抓取 |
| v1.3.0~1.3.1 | 详情页「C5 卖出参考（求购最高价）」接入（fetchC5StatsBulk，stat 接口） |
| v1.4.0 | 预测器 V3（事件窗口价差修正，内置 `STEAM_SALE_EVENTS_2026`）；Steam 官方中文名缓存（zhNames）；库存冷却同步 |
| v1.4.1 | **search/render 未登录单页 10 条修复（searchPaged 翻页）**；Steam 箱子自动导入本地库存；双键匹配 |
| v1.4.2 | 官方历史价格接入（算法增强）+ 断点续采 + 采集入口去重 + 库存同步诊断加固 |
| v1.4.3 | App 内一键登录 + 品牌更名「宇额助手」 |
| v1.4.4+ | 买卖时机建议、库存堆叠、事件双向日历（RSS）、预测 V3 落地、Skinport 成交参考 |
| v1.4.5~1.4.7 | 交易保护箱会话拉取（INV_SCRIPT）、Steam Web API 库存、历史不足双方案、库存同步合一 |
| v1.5.0/1.5.1 | **仅改版本号重打包，功能与 v1.4.9 相同（其他 AI 所为）**；v1.5.2 起为功能版本 |
| v1.5.2 | 库存 Web API 诊断增强（HTTP 状态码 + Steam 原始返回片段） |
| v1.5.3 | 空库存诊断一锤定音 v1 |
| v1.5.4 | C5 一键登录 cookie 修复 + 设置页即时刷新 |
| v1.5.5 | 历史导入改 C5 官方趋势通道，失败停止不再静默跳过 |
| v1.5.6 | Steam 官方库存 response 包装解析修复（健壮性） |
| v1.5.7 | 空库存诊断 v2（透出 Steam 原始返回片段 + success=0 报错；用户实测双通道 `{"response":{}}`） |
| v1.5.8 | 空库存文案据实定论（Steam Web API 不返回保护期物品；本地提示保护中件数/最早解锁日） |
| **v1.5.9** | **库存收敛为仅 C5 OpenAPI（app-key）唯一通道**；移除 Steam Web API 库存与设置项 |
| **v1.5.10** | **历史主通道改云端（cloud/）**；新增 cloudHistory.ts / importCloudHistories / 设置页云端地址 |
## 4. 架构与目录

```
mobile/                唯一运行主体（React Native + Expo 开发、Android 原生打包、Hermes、TypeScript）
  src/core/            分析引擎 fees/profit/prediction/radar/simulation/buy/engine/sync
  src/data/            steam.ts（直连适配器）、c5.ts（C5 OpenAPI）、storage.ts（AsyncStorage）、
                       collector.ts（一键采集编排）、cloudHistory.ts（云端历史）、cn_names.ts/zhNames.ts（中文名）
  src/api/             client.ts 对外 API（含 importCloudHistories / cloudHistoryTargets）
  src/utils/           format、buyFlow（一键买入流程）
  src/screens/         首页/市场/详情/库存/雷达/我的/资金模拟
  scripts/             verify_core.cjs（222 项 TS==Python 对拍）、verify_c5.cjs（需 $env:C5_APP_KEY）
cloud/                 Cloudflare Worker + D1 云端历史缓存（v1.5.10 新增，见第 7 章）
backend/               旧电脑后端 — 历史参考 + baseline.json 基准（verify:core 读取它）；运行不依赖它，勿删
releases/              APK 产物（*.apk 被 gitignore 不入库，releases 保留历史版本）
docs/HANDOFF.md        本文件 — 唯一文档
```

业务流：`collector.collectCases()` → Steam 热门榜（失败回退成交量榜）拉候选 → C5 批量查买入价（配 key 时）→ 逐个 `priceoverview`（限速 1.8s + 失败重试一次）→ 快照写 AsyncStorage → `core/engine.ts` 计算预计几折 / 收益 / 预测 / 雷达。

**方向语义（勿搞反）**：C5 买入价是**成本**（`c5_buy_price`，配套 `c5_buy_fee_ratio=1%`），Steam 卖出价是**收入**（到账比例 0.8696，即扣 13%）。单位统一**元（CNY）**。
`expected_discount` = 总成本 / 预计净到手（小数，0.926 = 9.26 折，**越低越划算**）；展示折数 = `discountNum * 10`。

## 5. 数据调用链路（库存 / 实时价 / 历史 / 云端）

统一数据模型 `LocalSnapshot`：`{ name, source, price, volume, fetchedAt }`，快照库键 `@cs2balance/snapshots_v2`；
来源标记 `source: 'steam' | 'c5' | 'c5_hist'`；实时快照保留 50 条、历史日线保留 120 条（HISTORY_KEEP）。

### 5.1 库存同步（C5 OpenAPI app-key 唯一通道）

```
库存页 InventoryScreen
  └─ api.syncSteamInventorySmart() → engine.syncSteamInventorySmart()
      ├─ 读设置 c5AppKey / steamId；steamId 为空且做过 Steam 一键登录 → resolveOwnSteamId(steamCookie)
      │        // steamcommunity.com/my 解析本人 ID（仅用于识别 ID，库存不依赖 Steam cookie）
      └─ fetchC5Inventory(steamId, c5AppKey)                    // data/c5.ts
          ├─ GET openapi.c5game.com/merchant/inventory/v2/{steamId}/730?language=zh&startAssetId=..&app-key=..
          ├─ 自动分页直到 data.lastAssetId 为空（最多 20 页）
          └─ parseC5Inventory + aggregateC5Inventory
              // 武器箱过滤；status=4 冷却中→tradable=false，0/1/7→tradable=true；同名多资产聚合（数量求和、可交易取或）
      └─ planSteamSync()                                        // core/steamSync.ts（纯函数，verify:core 对拍）
          // 英文 MarketHashName + C5 中文名双键匹配；C5 有而本地无→自动导入（source='steam_sync'）
          // 冷却估算：已解锁记「观察到可交易」时刻；冷却中取 min(历史估计, 本次观察+剩余整天)
          // 空库存 → buildC5EmptySyncReason()：C5 返回空 = SteamID64 非本人 / app-key 未绑定该账号，无保护期歧义
      └─ storage 写入库存表 → 返回 { matched, imported, notFound, empty, reason, ... }
```

库存必须：C5 app-key + SteamID64（本人）。**Steam Web API 库存（IEconService 双 Context）与设置页 Steam Web Key 已于 v1.5.9 移除**。

### 5.2 实时价格采集（自动，无需登录）

```
首页「📡 一键扫描」→ engine.refresh() → collector.collectCases()
  ├─ searchCases()   // search/render/?sort_column=popular|volume&l=schinese，翻页（未登录单页~10 条）
  ├─ fetchC5PricesBulk()  // C5 OpenAPI 买入价（见 5.5）
  └─ 逐个 fetchSteamPrice() // priceoverview/?appid=730&currency=23&market_hash_name=..
      └─ storage.setSnapshot({ source:'steam', fetchedAt: 真实时间戳 })
```
每次扫描一个当日实时点；消费方：`getSteamPrices()`（预测器输入）、`getSteamHistory()`（趋势图/成交量）。

### 5.3 Steam 历史（云端主通道，零登录）

```
首页「🔁 快速导入历史（云端 / C5 官方趋势）」→ CookieLoginScreen（kind='steam-hist'）→ startHistPull（云端优先）
  ├─ 读设置 cloudWorkerUrl
  ├─ 有值 → api.importCloudHistories(names, cloudUrl, onItem, startIdx) → engine.importCloudHistories()
  │     for 每箱：
  │       1) fetchCloudHistory(cloudUrl, name, 120)   // GET {url}/history?name=<URL编码>&days=120
  │           → { name, price_prefix, points:[[ts秒, 价格, 成交量], ...] }
  │       2) cloudPointsToHistory(points)             // unix秒 → 'YYYY-MM-DD'（UTC）
  │       3) storage.mergeSteamHistory(name, pts)     // source='steam'，按日期去重、保留 120 条
  │       失败处理：任一件失败即停返回 {failedIdx,...} → UI 弹窗「停止 / 跳过此箱继续 / 改用 C5 官方趋势」
  └─ 未配置 cloudWorkerUrl（或失败时用户选择）→ 走 C5 官方趋势（5.5，需 C5 登录态）
```

- 旧通道（保留代码，无主入口）：Steam 页面内抓 `var line1=[...]` / `queryData.prices` → `api.importSteamPriceHistoryRaw` → `mergeSteamHistory`
- 入库规则：按日期去重；历史点 `fetchedAt = 日期 T08:00:00.000Z`（与实时快照可区分）；每箱最多 120 条历史日线，超限截断最旧；入库后预测器 / 雷达 / 详情趋势图自动受益（只读快照库，不关心来源）

### 5.4 C5 历史快速导入（回退通道，需 C5 登录态）

- 原因：Steam `pricehistory` 需登录 cookie 且该网络环境不稳定（实测 0 成功）→ v1.5.5 引入 C5 官方趋势通道
- 链路：C5 登录态 → itemId（`data/c5.ts` 集中隔离）→ `GET www.c5game.com/trade-flex/order/price-trend/chart?itemId=..&period=90` → 90 天官方价格历史 → `mergeSteamHistory`
- 注意：C5 趋势图接口**必须登录 cookie**（匿名重定向「查看价格走势请先登录」）；非官方接口，集中隔离在 `data/c5.ts`，接口变更只改适配层

### 5.5 C5 实时价 / 买入价 / 求购价（OpenAPI，app-key）

| 接口 | 用途 | 备注 |
|---|---|---|
| `POST /merchant/product/price/batch?app-key=`（Body `{"appId":"730","marketHashNames":[...]}`） | 批量在售最低价 `{itemId, marketHashName, price(元), count, website}` | fetchC5PricesBulk 每批 30；核心买入价 |
| `POST /merchant/market/v2/item/stat/hash/name?app-key=` | 统计信息 `{marketHashName, itemId, sellPrice, sellCount, purchaseMaxPrice, purchaseCount}` | fetchC5StatsBulk；详情页「C5 卖出参考（求购价）」；实测无需 IP 白名单 |
| `GET /merchant/market/v2/products/search?app-key=` | 在售列表搜索 | 实测需 IP 白名单（errorCode 499103），未接入 |
| `GET /merchant/purchase/v1/max-price?itemId=&styleId=0` | 求购最高价 | 实测可用（未接入，stat 已覆盖） |
| `GET /price/info` | 文档中的价格查询 | **实测 404 已下线，勿用** |

## 6. 已验证的关键事实（改动前务必先读）

### 6.1 Steam 历史：gid 页 SSR 解析法（零 cookie 全量历史，v1.5.10 云端主通道）

```
GET https://steamcommunity.com/market/listings/730/{urlencode(market_hash_name)}
  → 302 重定向 → https://steamcommunity.com/market/listings/730/G18A11F3004   （gid 页，无需任何 cookie）
```
- 名称页（含中文/空格等特殊字符）302 改写为 `/listings/730/{GID}`；**GID = `G` + 10 位大写十六进制**（11 字符）
- 页内一行：`<script>window.SSR.renderContext=JSON.parse("...");</script>`——**双重编码 JSON 字符串**，解析链：
  1. 提取 `JSON.parse(` 后引号字符串 → `JSON.parse` → 得到**一段 JSON 字符串**（双重编码）
  2. 再 `JSON.parse` → `renderContext`：`{ localizationSettings, queryData, cookiePrefs, manifest }`
  3. `queryData` 也是字符串 → 再 parse → `{ mutations, queries }`
  4. `queries[]` 中找 `queryKey: ["market","pricehistory",730,"<名称>"]` → `state.data.prices`
  5. `prices` 每项 `{ time: unix秒, price_median: 元, purchases: 成交量 }`；价格用页面 `price_prefix/suffix` 还原
- 同页 `queryKey: ["market","orderbook",730,"<名称>"]` → `state.data` 盘口：`amtMaxBuyOrder/amtMinSellOrder/eCurrency/rgCompactBuyOrders/rgCompactSellOrders`
- **实测数据（CS:GO Weapon Case，G18A11F3004）**：5202 点（2013-08-14 → 2026-09-06），日粒度为主 + 近期小时粒度，currency=23；买单 2900 档（amtMaxBuyOrder=93000）/ 卖单 668 档（amtMinSellOrder=96673）
- **同一时间 `/market/pricehistory/?appid=730&market_hash_name=..` 未登录实测返回 `[]`（HTTP 400）**——gid 页 SSR 是真正零 cookie 的官方全量通道
- 旧 `var line1 = [["Jun 01 2014 01: +0", 0.12, 15], ...]` 仅作旧版页面兜底（cloud/src/steam.ts 已实现，单测覆盖）
- **注意**：`pricehistory` API 必须登录 cookie（未登录 `[]`/400），**云端不可用**；line1 无小时粒度/盘口，数据不全

### 6.2 Steam 公共接口（无需密钥）

- `priceoverview`（当前价/成交量，currency=23 CNY）、`search/render`（成交量 / 热门榜）
- **`search/render` 未登录（无 cookie）时单页最多约 10 条**（2026-09-05 实测 count=100 只回 10，total_count=458）→ `steam.ts#searchPaged` 按 start 翻页（页间 1.2s、最多 10 页、按名去重、翻完 total_count 即止）；填 Steam cookie 可单页 100
- 热门榜 query 用**原始字符串**拼在 `steam.ts searchPopular()`（`category_730_Type[]=...` 会被 URLSearchParams 转义，勿改回）
- 本机访问不稳定（曾 20s 超时）：采集失败/超时 ≠ 代码错误，先重试
- 库存冷却同步：`inventory/{steamid}/730/2?l=schinese&count=2000` 无需 key，需公开库存或登录 cookie（403/401 中文提示）；`market_tradable_restriction` 只给**剩余整数天**，小时级精度靠「本次观察 + 剩余整天」上界 + 历史 min 单调逼近；同类多把数量累加、冷却取最短
- 文档缓存：`%TEMP%\c5doc.html`、`c5_price.html`、`c5_batch.html`、`c5_maxprice.html`（可离线解析）

### 6.3 Steam 库存 context 2/16 与保护期（v1.5.8 定论）

- CS2 库存两个 context：**2** = 普通物品（已解锁/可交易）、**16** = 交易保护物品
- 社区库存接口 `/inventory/{id}/730/2` **只返回 context 2**；当所有物品都在保护期时返回 `total_inventory_count: N` 但 `assets` 空
- **核心定论（用户实测 + node-steamcommunity 源码佐证）**：Steam Web API（含双 context）对保护期账号实测返回 `{"response":{}}`——**Steam Web API 不返回保护期物品**，这是 v1.5.2~v1.5.8 空库存的根因
- 网页能看到是因为页面内嵌 `g_rgAssets/g_rgDescriptions` 服务端渲染数据含全部 context
- 最终方案：**C5 服务端高权限通道（status=4 可见）** = 库存唯一通道（v1.5.9），彻底解决

### 6.4 C5GAME OpenAPI（opendoc.c5game.com / openapi.c5game.com）

- 鉴权：`app-key` 作 query 参数，无签名；默认限流 50 QPS；CSGO/CS2 appId = `730`；服务端要求 Accept-Encoding 头（RN fetch 自动处理）
- **OpenAPI 无历史价格接口**（2026-09-05 枚举 opendoc 全部 36 个端点皆为实时快照类：余额/在售/订单/求购/库存/购买；另探测 price-trend/price/history/item/trend 等 9 个疑似历史端点实测全 404）——**Steam/C5 历史都不能通过 C5 app-key 获取**
- 下单/购买实测结论（2026-09-05，勿再重复踩坑）：
  - `POST /merchant/trade/v2/normal-buy`（普通购买）存在：缺参返回「参数错误」，须 `productId`+`outTradeNo` 非空；虚假 productId → 「交易链接错误(trade Url format error)」
  - `POST /merchant/market/v2/products/search` → errorCode **499103**「未设置ip白名单或ip不在白名单中」：需在 C5 商户后台配置出口 IP 白名单
  - `POST /merchant/purchase/v1/create`（发起求购）→ errorCode **830001**「尚未开通求购权限，请联系客服」
  - `GET /merchant/account/v1/balance` 可访问：账户余额 0.01 元；购买需预充值
  - **结论：一键买入保持「核验 + 确认 + 本地记账」，不自动下单**
- `GET /price/info` **404 已下线，勿用**

### 6.5 C5 历史（网页通道，必须登录——官方设定）

- C5 网页趋势接口：`GET www.c5game.com/trade-flex/order/price-trend/chart?itemId=..&period=7|30|...`（响应内嵌 dates/prices）；**匿名访问全部重定向登录页（「查看价格走势请先登录」是官方设定）**
- C5 网页搜索（itemId 兜底）：`www.c5game.com/steamtrade/sga/item-search/v1/list?appId=730&keyword=..`（需 C5 cookie）
- 两者均**非官方、可能变更**，已集中隔离在 `data/c5.ts`；App 内仅在「快速导入历史」回退时使用

### 6.6 数据源通道总表（2026-09-07 最新结论）

| 数据 | 通道 | 认证 | 结论 |
|---|---|---|---|
| Steam 历史 | **gid 页 SSR**（v1.5.10 主通道） | 零 cookie | ✅ 云端缓存基础，2013 至今全量 + 盘口 |
| Steam 历史 | `/market/pricehistory/` | Cookie 必需 | ❌ 云端不可用（未登录 `[]`/400） |
| Steam 历史 | 列表页 `var line1` | 零 cookie | ⚠️ 兜底（旧版格式，无小时/盘口） |
| Steam 实时 | `/market/priceoverview/` | 无 | ✅ 本机需 Steam++ 反代；云端海外直连 |
| C5 实时/库存/求购 | OpenAPI（app-key） | app-key | ✅ 唯一通道 |
| C5 历史 | OpenAPI / 网页趋势 | 无 / Cookie | ❌ OpenAPI 无历史端点；网页必须登录，仅 App 回退用 |

## 7. cloud/ —— 云端历史缓存方案（v1.5.10，Cloudflare Worker + D1）

> 数据源 = 6.1 的 gid 页 SSR（零 cookie）。Cloudflare 海外出口天然直连 Steam，无需 Steam++；国内 App 只访问 Worker 地址（`workers.dev` 被墙时可在设置页改填自定义域名）。

### 7.1 结构与表

```
cloud/  wrangler v3 + TypeScript
  src/worker.ts      路由：/history、/items、/health、POST /ingest、cron 入口
  src/steam.ts       parseSSR（双重编码解析）/ extractPriceHistory / extractOrderbook / line1 兜底 / GID 提取
  src/steamClient.ts gid 解析（302 跟随）+ 页面抓取（超时/重试/退避）
  src/topCases.ts    Top-100 热门武器箱（search/render popular+WeaponCase；失败回退 D1 已有名 → 内置 43 箱兜底）
  src/db.ts          D1 读写（INSERT OR REPLACE 按 (name,ts) 去重 + 增量过滤）
  schema.sql         gid_map / history / run_meta
  test/              parse.test.mjs 8 项 + fixtures/gid_page.html（实测页）
```

- `gid_map(market_hash_name TEXT PK, gid TEXT, resolved_at INTEGER)`——gid 缓存，避免每轮重定向
- `history(market_hash_name, ts, price, volume, PK(name,ts))`——全量历史点
- `run_meta`——每轮运行统计（时间/成功数/失败名单）
- 定时：cron `*/15 * * * *`（`CRON_MINUTES` 可调）；每轮 Top-100 热门箱 → 并发 3 抓 gid 页 → SSR 解析 → 入库

### 7.2 公开 API

| API | 说明 |
|---|---|
| `GET /history?name=<市场hash名>&days=120` | `{ name, price_prefix, points:[[ts秒,价格,成交量],...] }` |
| `GET /items?limit=100` | 已收录名称 + gid + 最近更新时间 |
| `GET /health` | 健康检查 |
| `POST /ingest` | 本机采集器兜底写入口（Body `{name, points, gid?}`；`INGEST_TOKEN` 可选鉴权） |

### 7.3 部署步骤（需用户 Cloudflare 账号）

```powershell
cd cloud
npm i -D                                  # 安装 wrangler
npx wrangler login                        # 登录 Cloudflare（首次）
npx wrangler d1 create cs2-price-history  # 创建 D1，把返回的 database_id 填进 wrangler.toml
npm run db:remote                         # 执行 schema.sql 建表
npm run deploy                            # 部署 Worker + Cron
npx wrangler secret put INGEST_TOKEN      # 可选：/ingest 写入口鉴权

# 部署后验证
curl https://<worker>.workers.dev/health
curl "https://<worker>.workers.dev/history?name=CS%3AGO%20Weapon%20Case&days=120"   # 首次需等一轮 cron
curl "https://<worker>.workers.dev/items?limit=10"
```

### 7.4 参数（wrangler.toml [vars]，均可调）

| 变量 | 默认 | 说明 |
|---|---|---|
| `MAX_ITEMS_PER_RUN` | 100 | 每轮最多采集箱数 |
| `CONCURRENCY` | 3 | 并行抓取数（过高易被 Steam 限流） |
| `STEAM_TIMEOUT_MS` | 10000 | 单请求超时 |
| `STEAM_RETRIES` | 2 | 失败重试（403/429 额外退避） |
| `REQUEST_DELAY_MS` | 400 | 请求间延迟 |
| `HISTORY_DAYS` | 3650 | 入库保留天数（默认全量） |
| `TOP_CASES` / `DEFAULT_HISTORY_DAYS` | 100 / 120 | 热门榜前 N / /history 默认天数 |

### 7.5 运行模式、免费额度与风险

- **两种运行模式**：
  1. Worker 直采（v1 默认）——免费版 Worker CPU 限额 10ms/调用，整轮抓 100 页会超限：建议 **Workers Paid**（CPU 30s），或调小 `MAX_ITEMS_PER_RUN` / 加密 cron 分摊
  2. 本机采集器 + Worker 只做存储（兜底）——若 Steam 对数据中心 IP 风控（403/captcha）：国内本机（复用 Steam++ 反代）抓 gid 页 → `POST /ingest` 写 D1
- **免费额度**：Worker 10 万请求/天 + D1 5GB / 10 万行写/天；初始约 50 万行 + 每天约 1 万行增量，余量充足
- 本地开发：`npm test`（8 项）、`npx wrangler dev --local`（`--persist` 落盘）、`npm run db:local`

## 8. 已知限制与风险

- C5 价格为「在售最低价」快照，非实时成交价，价格可能波动
- Steam 网络在本机不稳定：App 内已做一次重试 + 2s 退避；云端需防 Steam 对数据中心 IP 风控（见 7.5）
- app-key 为**用户个人凭证**：只存 AsyncStorage / `$env:C5_APP_KEY`，**绝不写进代码 / 文档 / 仓库 / 日志**（测试用的临时 key 用完即弃，勿提交）
- 一键买入是**本地记账**，不自动下单（理由见 6.4）
- Hermes 引擎：勿用 `Array.prototype.at` 等新 API；TS 目标 es2020
- 中文名已根治：采集自动带 `l=schinese` 抓官方中文名入 `zhNames.ts` 缓存，UI 三级回退：手工映射 `cn_names.ts` → 官方缓存 → 英文原名；新箱可在 `cn_names.ts` 补 C5 译名
- Steam 库存冷却同步依赖 SteamID64 与公开库存/登录 cookie；非公开库存会提示；小时级精度依赖多次同步收敛（min 逼近），单次只有整天粒度

## 9. 构建 / 验证 / 打包（Windows PowerShell，环境变量每条命令都要重新设置）

```powershell
cd D:\Codex\cs2-balance-mobile\mobile
npm run typecheck        # TS 零错误
npm run verify:core      # 引擎交叉验证 222/222 PASS（TS==Python baseline，读 backend/scripts/baseline.json）
$env:C5_APP_KEY='<用户key>'; npm run verify:c5   # C5 在线冒烟（可选，key 找用户要，勿入库）

cd D:\Codex\cs2-balance-mobile\cloud
npm test                 # 云端解析单测 8/8 PASS
```

### 9.1 发版流程（版本三处 + 打包 + 归档 + 桌面副本 + 回写本文件）

```powershell
# 1) 版本升级：mobile\package.json + mobile\app.json 的 version；mobile\android\app\build.gradle
#    versionCode +1（当前 26 / v1.5.10 → 下一版 v1.5.11 / versionCode 27）、versionName 同步
#    注意：app.json 的 version 曾漏更到 1.4.2（v1.4.5 修正），每次务必三处都核对
#    设置页页脚版本号自动跟随 app.json（Constants.expoConfig.version），无硬编码，勿手动改

# 2) 打包（必须在 mobile\android 目录运行 gradle；JDK 用 17.0.2）
cd D:\Codex\cs2-balance-mobile\mobile\android
$env:JAVA_HOME='D:\dev\jdk17-fresh\jdk-17.0.2'
& 'C:\Users\Administrator\.gradle\wrapper\dists\gradle-9.3.1-bin\1lole3zto6bam3nn92w6lo9we\gradle-9.3.1\bin\gradle.bat' assembleRelease
# 产物：mobile\android\app\build\outputs\apk\release\app-release.apk
# 勿用 gradle clean（会波及 node_modules\expo-*\android\build 缓存导致 MD5 缺失/文件占用；
# 遇到时重跑 assembleRelease 自愈，必要时删对应 node_modules\<包>\android\build 再构建）

# 3) 归档 + 桌面副本（全部用 python pathlib 操作，勿用 Remove-Item -Recurse）
#    a. 复制 APK 到 releases\宇额助手-vX.Y.Z.apk（保留历史版本）
#    b. 复制最新 APK 到 C:\Users\Administrator\Desktop\，删除桌面旧版 APK（桌面只留最新）
```

**每次新版本发布后（APK 构建完成并验证 versionCode/versionName/label 后）必须回写本文件**：
更新第 3.2 节「版本/安装包」、3.3 节版本表、9.1 节版本号基线（当前 v1.5.10 / 26 → 下一版 v1.5.11 / 27）及对应专项说明；
只改代码不发版记录视为未完成发布。文档合并后本文件是唯一交接文档，**不再拆分多个 docs 文档**

## 10. 建议改进路线（按优先级，供下一位接手者挑选）

1. **云端上线收尾（当前最高优先）**：执行 7.3 部署步骤（需用户 wrangler login + d1 create 填 database_id）→ 部署后验证 /items 返回 Top-100、抽查 3 个名称 /history 含 2013 至今线、15 分钟后二次触发验证增量去重；App 真机「快速导入历史」走云端成功、雷达不再「历史不足」
2. **采集频率调度**：默认每 30 分钟自动采集（当前仅手动一键扫描），可配置
3. **自采集提醒**：限制期结束本地通知（需 expo-notifications，注意权限与国内厂商后台限制；冷却已精确到小时，可直接用 `steam_unlock_est_at` 触发）
4. **智能拆单**：预算较大时按风险/数量限制分散到多个箱子
5. **动态事件源**：V3 已内置 `STEAM_SALE_EVENTS_2026`；后续可接 CS2 更新 / Major / 新箱 / 移箱 / Valve 政策的动态事件源
6. **模型增强 + 回测**：V2 已含回归趋势 + 量价确认 + 数据不足保护，V3 已加事件窗口价差修正；下一档：波动率自适应、真实回测指标（MAE/RMSE/方向准确率/盈利命中率/平均实际折扣）
7. **云端 CRON 频率与 MAX_ITEMS_PER_RUN 调优**：首轮回填 100 箱 × 5200 点 ≈ 52 万行写入，注意 D1 首日写额度与 Worker CPU 限额（见 7.5）
8. **离线测试**：verify:c5 目前依赖网络；可加 mock 响应离线用例保证 CI 可跑
9. **分发体验**：接入 EAS 或提供 debug 包；评估 Google Play / 国内应用市场合规上架
10. **库存同步增强**：定时自动同步 + 解锁时刻到点自动刷新（通知/徽标），并提示「Steam 有但本地没有」的新箱子
11. **中文名覆盖度**：zhNames.ts 已一次采集覆盖全部箱子；新箱出现后自动抓官方中文名入库，避免依赖手工 cn_names.ts

## 11. 接手后的标准动作

1. `git status` 确认干净；`git log --oneline -5` 看历史
2. `cd mobile; npm run typecheck && npm run verify:core` 确认基线绿（222/222）
3. 改动后必须重跑上述验证；涉及 C5 改动用真实 key 跑 `verify:c5`；涉及引擎/库存冷却逻辑在 `verify_core.cjs` 补 TS==Python 对拍或逻辑断言；涉及云端解析改 `cloud/test` 补单测
4. 用户相关 App 升级时按 9.1 发版流程：版本三处同步 +1 → gradle assembleRelease（勿 clean）→ 归档 releases → 同步桌面副本（桌面只留最新）→ **回写本文件**
5. 对外解释一律简体中文；不要轻易承诺「自动下单」「Steam Web API 库存」等已否决方向（口径见附录 C）

## 附录 A：接口速查表

```
# 库存（唯一通道，需 app-key）——C5 高权限通道可见保护期物品
GET https://openapi.c5game.com/merchant/inventory/v2/{steamid}/730?language=zh&startAssetId=0&app-key={key}

# 实时价（公开，currency=23=CNY）
GET https://steamcommunity.com/market/priceoverview/?appid=730&currency=23&market_hash_name={name}
# 搜索/热门（公开，未登录单页 ~10 条，需翻页）
GET https://steamcommunity.com/market/search/render/?appid=730&norender=1&query=&start=0&count=100&sort_column=popular&sort_dir=desc&l=schinese&category_730_Type[]=tag_CSGO_Type_WeaponCase
# 价格历史（需 Cookie，云端不可用）——勿作云端主通道
GET https://steamcommunity.com/market/pricehistory/?appid=730&market_hash_name={name}
# 历史主通道：gid 页 SSR（零 cookie）——302 跟随到 /listings/730/{GID}，解析 window.SSR.renderContext（见 6.1）
GET https://steamcommunity.com/market/listings/730/{urlencode(name)}

# C5 批量买入价（需 app-key）
POST https://openapi.c5game.com/merchant/product/price/batch?app-key={key}
Body: {"appId":"730","marketHashNames":["..."]}
# C5 统计/求购参考（需 app-key，实测无需 IP 白名单）
POST https://openapi.c5game.com/merchant/market/v2/item/stat/hash/name?app-key={key}
# C5 历史趋势（需 C5 登录 cookie；非官方，可能变更）
GET https://www.c5game.com/trade-flex/order/price-trend/chart?itemId={itemId}&period=90
# C5 网页搜索 itemId 兜底（需 C5 cookie）
GET https://www.c5game.com/steamtrade/sga/item-search/v1/list?appId=730&keyword={kw}
```

## 附录 B：代码资产位置（均已实现并有测试）

| 能力 | 位置 |
|---|---|
| 云端历史拉取（GET /history → StorageHistoryPoint） | `mobile/src/data/cloudHistory.ts` |
| 云端历史批量导入（逐箱 → mergeSteamHistory，失败即停） | `mobile/src/core/engine.ts#importCloudHistories`；`api/client.ts` 暴露 |
| 云端解析（SSR/line1/GID 提取，8 单测） | `cloud/src/steam.ts`、`cloud/test/parse.test.mjs` |
| 云端 Worker 路由 / D1 读写 / 采集编排 | `cloud/src/worker.ts` / `db.ts` / `steamClient.ts` / `topCases.ts` |
| C5 库存拉取（分页 20 页）与解析（武器箱过滤/聚合） | `mobile/src/data/c5.ts#fetchC5Inventory/parseC5Inventory/aggregateC5Inventory` |
| 库存同步编排 + 双键匹配 + 空库存诊断 | `mobile/src/core/engine.ts#syncSteamInventorySmart`、`core/steamSync.ts#planSteamSync/buildC5EmptySyncReason` |
| 实时采集（翻页榜单 + priceoverview + C5 批量） | `mobile/src/data/collector.ts`、`steam.ts#searchPaged/fetchSteamPrice` |
| 历史入库（按日期去重、保留 120 条） | `mobile/src/data/storage.ts#mergeSteamHistory` |
| C5 官方趋势通道（回退） / Steam line1 提取（保留代码） | `CookieLoginScreen.tsx` steam-hist、`engine.importSteamPriceHistoryRaw` |
| 预测器 V2/V3（事件窗口）+ 雷达评分 | `mobile/src/core/prediction.ts`、`radar.ts`（backend 有同口径 Python 参考） |
| 验证 | `verify_core.cjs`（222 项，读 `backend/scripts/baseline.json`）、`verify_c5.cjs`、`cloud/test`（8 项）、backend pytest 39 |

## 附录 C：对用户的既有承诺/口径（保持对外一致，勿反转）

- **库存**：只用 C5GAME 官方 OpenAPI（app-key）同步（v1.5.9 用户拍板）；Steam 登录仅用于识别本人 SteamID64；**不再提「Steam Web API 库存」「Steam Web Key」**——官方 Web API 对保护期账号返回空，已实锤
- **历史**：「快速导入历史」**云端优先（零登录，v1.5.10）**，失败用户可选停止/跳过/改用 C5 官方趋势；C5 历史必须登录，「查看价格走势请先登录」是官方设定
- **登录有效期**：Steam 数月；C5 较短但只影响下次导入（已入库数据不再依赖登录态）
- **不下单**：C5 下单/求购接口实测未开放（缺权限/需白名单/需充值），一键买入保持本地记账
- **C5 能显示库存的原因**（用户高频问题）：C5 服务端从 Steam 高权限通道拉库存，能看到 status=4 保护中物品；第三方 Steam Web API key 看不到

---

*本文件由原 docs/ 下 6 份文档（HANDOFF / 软件介绍 / 数据调用链路 / Steam官方接口研究报告 / DATA_SOURCE_REPORT / HANDOFF-库存与历史问题）+ README 合并删减而成，2026-09-07 更新至 v1.5.10。实验结论已落地：cloud/ 单测 8/8、App typecheck 零错误、verify:core 222/222、APK v1.5.10 已打包并同步桌面。*