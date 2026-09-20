# HANDOFF —— 宇额助手（原 CS2 余额助手 / 余额雷达）交接文档

> **本文件是工作区唯一交接文档**。当前发布基线为 **v1.9.5 / versionCode 43**；旧版本记录仅用于追溯，不代表当前运行方式。
> **写给接手继续改进的 AI / 开发者**：改动代码或发版前先完整读一遍；所有对外解释、文案、回复必须简体中文；本文件也是版本记录的唯一载体。

## 0. 一句话定位

**纯手机端 Android App「宇额助手」**：监控 CS2 武器箱行情，发现「C5GAME 低价买入 → 约 7 天交易保护期 → Steam 市场卖出」的套利机会，并管理自己的库存与买入记录。
所有分析都在手机本地完成（快照 → 预测 → 收益 → 雷达 → 模拟），**不依赖自建服务器、不自动买卖、不用连电脑**。
最高目标：让用户快速知道**现在买哪个箱子最划算、预计能以几折倒成 Steam 钱包余额**（低于 1 折更划算；如投入 100 元、预计 Steam 净到手 108 元 = 9.26 折）。

### 0.1 当前 v1.9.5 Local-First 运行规则

- 数据顺序固定为：手机 SQLite → 安装包历史种子 → Steam 官方直连 → C5 OpenAPI。
- 页面首次打开和普通下拉刷新只读取本地快照；不会隐式请求实时盘口。
- 首页一键扫描、详情页单箱刷新、市场页“更新实时盘口 / 机会”是明确的联网动作，实时结果带 10 分钟本地有效期。
- v2 推荐只允许来自同一份新鲜机会快照：预测、C5 和 Steam 盘口齐全且没有 fallback；旧版 signal 不能覆盖 v2 最终决策。
- C5 app-key 使用手机安全存储；Steam、C5、历史和库存数据不离开手机。

## 1. 核心功能与页面

| 功能 | 说明 |
|---|---|
| 📡 一键扫描 | Steam 热门武器箱榜（回退成交量榜）拉候选 → C5 批量查买入价 → 逐个 Steam 实时价 → 写本地快照；断点续采（15 分钟内跳过已采）、采集数量 1-100 自选 |
| 📊 市场行情 | 每箱最新 Steam 价 / C5 买入价 / 预计几折 / 近 7 天与 90 天走势图 |
| 🎯 雷达信号 | 综合评分与买卖信号（7 天预测 P50/P25 对买入价收益与风险），事件日历（Steam 大促 / Major / 春节行情）修正评分；V4 起叠加 CV 稳定性 / R² 拟合度 / 365 天分位 / 市场状态 |
| 📦 库存同步 | **仅 C5GAME 官方 OpenAPI（app-key）**拉取本人库存（C5 服务端高权限通道能看到交易保护期物品 status=4 冷却中），自动导入本地库存并精确到小时的解锁倒计时 |
| 🧭 历史数据 | 安装包内置最近 365 天 Steam 日线；扫描和详情页按需直连 Steam 市场页 SSR，结果写入手机 SQLite；本地不足时逐步补齐 |
| 💰 买入记账 | 本地记账（核验预算/限制期/二次确认），生成订单流水；C5 下单接口实测未开放（见 6.4），保持不自动下单 |
| 🧮 模拟器 | 按预算与分配策略模拟买入组合收益/风险；反向模拟（目标收益推预算） |
| 🔐 一键登录 | WebView 登录 Steam，自动抓 cookie；仅用于自动识别本人 SteamID64 与搜索榜提额（库存和买入价走 C5 app-key） |

页面结构：**首页**（一键扫描、分析摘要）｜**市场**（列表、搜索、筛选、明确实时刷新、详情入口）｜**库存**（本地库存、C5 同步入口、解锁倒计时、卖出建议）｜**雷达**（信号列表）｜**我的/设置**（采集数量、C5 app-key、Steam Cookie、SteamID64、Steam 一键登录入口）。

## 2. 所需配置（按用途）

| 配置 | 用途 | 获取方式 |
|---|---|---|
| **C5 app-key（库存与价格必填）** | 批量查 C5 买入价、查 itemId、求购价、**库存同步唯一通道** | C5 开放平台申请（opendoc.c5game.com） |
| Steam Cookie（选填） | 提高搜索榜返回数量（单页 100 条）、自动识别本人 SteamID64 | App 内「Steam 一键登录」自动保存 |
| SteamID64（库存必填） | C5 库存同步的本体账号 | 资料页 /profiles/ 后 17 位数字；做过 Steam 一键登录可自动识别 |

## 3. 历史版本记录（只读，不参与当前运行）

### 3.1 旧版本演进摘要（仅供追溯；当前规则以 0.1 节为准）

1. **v1.5.9 库存定论：库存只走 C5GAME 官方 OpenAPI（app-key）**。
   `GET https://openapi.c5game.com/merchant/inventory/v2/{steamId}/730`（自动分页），C5 服务端高权限通道能看到**交易保护期物品（status=4 冷却中）**；
   **彻底解决 v1.5.2~v1.5.8 期间 Steam Web API 对保护期账号返回 `{"response":{}}` 导致库存永远为空的问题**（用户问「C5 为何能显示」的答案即在此）。
   Steam Web API 库存全部代码与设置页「Steam Web Key」输入项已移除，勿再恢复。
2. **v1.5.10 历史主通道改云端**：新增 `cloud/`（Cloudflare Worker + D1），定时抓取 **Steam 市场 gid 页 SSR 数据**入库（2026-09-07 实测：**零 cookie、2013-08-14 至今全量日线 + 近期小时粒度 + 盘口深度**，CS:GO Weapon Case 5202 点）。
   App「🔁 快速导入历史」云、端优先（设置页 `cloudWorkerUrl` 有值即走云端，零登录），失败弹窗「停止/跳过/改用 C5 官方趋势」；未配置则回退 C5 官方趋势。
   **C5 历史无法零 cookie 获取**（OpenAPI 无历史端点、网页趋势必须登录），不纳入云端。
   实验结论详证与解析链见 6.1；云端部署运维见第 7 章。
3. **v1.6.0 数据流架构升级：实时采云端、历史拉云端**。
   - 一键扫描只采**实时数据**（Steam 当前价/成交量 + C5 买价），扫描完成后 **POST /ingest 推送云端**（INGEST_TOKEN 鉴权）。
   - **历史数据统一从云端拉取**（GET /history），本地不再存 Steam 历史日线（snapshots_v2 每箱只保留最新 1 条实时快照，供离线展示用）。
   - 预测/雷达/详情页的输入改为「云端历史 + 本地最新实时点」合并，云端不可达时自动降级本地快照。
   - C5 历史也推云端（App 拉 C5 趋势后 POST /ingest source=c5），D1 新增 `c5_history` 表。
   - **修复 addSnapshot steam 分支历史清空 bug**（v1.5.10 及之前每次扫描会销毁已导入的 Steam 历史）。
   - C5 接口增加重试逻辑（fetchC5PricesBulk / fetchC5StatsBulk / fetchC5PriceTrend 各 1 次重试 + 15s 超时）。
   - 云端 Worker 新增 POST /history/batch 批量端点（雷达一次拉多箱历史）。
4. **v1.6.1 首页精简 + 云端默认地址 + 库存识别修复 + 详情页图表化**。
   - **云端地址不填也能连**：内置默认 Worker 地址（`cloudConfig.ts`），老用户升级后无需手填。
   - **扫描时自动拉云端历史**：collector 扫描完成后自动 `fetchCloudHistoryCached` + `mergeSteamHistory`，替代手动「快速补历史」。
   - **删首页历史相关按钮**：「快速补历史」「快速导入历史」两个入口删除，scanService.quickBackfill 删除。
   - **库存识别修复**：新建 `caseFilter.ts`（白名单 `CN_CASE_NAMES` + 扩充关键字），统一 `c5.ts`/`steam.ts`/`radar.ts` 三处过滤口径，解决「Sealed Dead Hand Terminal」等不含 case 字样的箱子被漏掉。
   - **详情页图表化**：引入 `react-native-svg`，新建 `PriceTrendChart`（SVG 折线 + 预测 P25~P75 扇区 + 成交量柱），替换原简陋柱状图；`engine.history` 改走云端（120 天），详情页走势图从 7 天扩展到 30 天。
   - **详情页删冗余**：删「C5 买入费用」「实际总成本」「限制期 7 天」（恒定值）；折叠区精简到 5 行（删 P10/P25/P50/P75/P90 重复数字墙、模型置信度/版本、预计可卖时点）；Skinport 保留 d7/d30（删 d90）。
5. **v1.6.2 修复 v1.6.1 引入的云端阻塞（重要教训）**。
   - **问题现象**：v1.6.1 装机后市场页/雷达页加载不出来（长时间空白）。
   - **根因（两个叠加）**：
     1. `workers.dev` 域名**国内被墙**（本机实测 HTTP 000、连接 8 秒超时），内建默认地址直连它必然失败；
     2. **v1.6.1 引入的严重性能缺陷**：`collectPredictInputs` 对每个箱子都先请求云端（15s 超时），而 `markets()` / `radar()` 是**串行循环**——20 箱 = 20×15s ≈ 5 分钟，100 箱 ≈ 25 分钟，页面被卡死。
   - **修复**：
     - `collectPredictInputs` **不再请求云端**，只读本地（扫描时已把云端历史 merge 进本地）；批量场景（市场/雷达）零云端依赖。
     - `engine.history`（详情页画图）保留云端优先，但加**熔断器**：连续失败 2 次 → 冷却 5 分钟，期间直接走本地。
     - `collector` 扫描拉云端历史也加熔断（连续失败 2 次跳过剩余箱）。
     - 云端超时 15s → **6s**；失败缓存 TTL 30s → **120s**。
   - **教训（勿重蹈）**：**绝不在批量串行循环里逐箱请求外部网络**；任何批量路径都必须本地优先 + 熔断 + 短超时。workers.dev 稳定使用需绑自定义域名。
6. **v1.7.0 存储层迁移到 SQLite（重要架构变更）**。
   - **动机**：原 AsyncStorage「单 key 全量 JSON 读改写」在数据增长后 I/O 爆炸（100 箱扫描约 700 次全量读写），且单 key 超 Android CursorWindow ~2MB 会读取失败（表现为数据突然清空）。
   - **方案**：引入 `expo-sqlite`（SDK 57 / ~57.0.2），新建 `data/db.ts`（单例惰性初始化 + WAL + 幂等建表/索引）。
   - **表结构**：`snapshots`（含 `kind` 列区分 rt/hist + 两个部分唯一索引）、`inventory`、`orders`、`settings`(KV)、`kv`(scan_state/event_feed)、`zh_names`、`meta`（迁移标记）。
   - **关键索引**：`uq_snap_rt ON snapshots(name,source) WHERE kind='rt'`（实时点每箱每源 1 条）、`uq_snap_hist ON snapshots(name,source,fetched_at) WHERE kind='hist'`（历史点去重）、`idx_snap_name_source_time`（历史查询）。
   - **签名不变**：`storage.ts` 对外方法签名与返回类型与 v1.6.x 完全一致，`engine.ts`/`collector.ts`/`screens`/`api` **零改动**；`zhNames.ts` 改用 `zh_names` 表，`zhNameOf()` 仍为同步读内存。
   - **一次性迁移**（`data/migrate.ts`）：读旧 AsyncStorage 7 个 key → 单事务写入 SQLite（`INSERT OR IGNORE` 幂等）→ 标记位 `meta.migrated_from_asyncstorage` 与数据同事务 → 成功后删除旧 key；失败则回滚、保留旧数据、下次启动重试。
   - **启动接入**：`App.tsx` 的 `useEffect` 先 `await initStorage()` 再预热中文名/恢复扫描；`storage` 每个方法内部也 `await ensureDb()`，兜底竞态。
   - **新增验证**：`npm run verify:storage`（`scripts/verify_storage.cjs`，用 Node 内置 `node:sqlite` 真实执行 SQL 语义；v1.8.1 起 **22/22 PASS**）。
   - **注意**：`expo-sqlite` 是原生模块，新增后必须重新 `gradle assembleRelease`（APK 从 68.9MB → 81.8MB，含 4 个架构的 `libexpo-sqlite.so`）；`verify:core` 不编译 storage.ts（纯 Node 无法 require RN 原生模块），故不受影响。
7. **v1.8.0 清理死代码 + 详情页提速 + V4 预测模型 + 修复「历史不足」根因（重要）**。
   - **清理（用户要求「有无用按钮/信息」）**：删除整条已无入口的历史导入链路——`CookieLoginScreen` 的 `steam-hist` 分支/`startHistPull`/`hist-*` onMessage、`engine.importCloudHistories/importC5Histories/listHistoryTargets/importSteamPriceHistoryRaw/c5HistoryTargets`、`c5.ts.fetchC5PriceTrend/parseC5Trend/fetchC5ItemIdViaWeb`、`collector` 的 backfill 分支与恒为 0 的 histImported/histFailed、`client.ts` 的 getApiBase/setApiBase/historyTargets/cloudHistoryTargets/refresh 等死导出；**C5 cookie 与 C5 一键登录整体移除**（唯一用途就是已废弃的 C5 趋势导入；库存与买入价都走 app-key）；`AppSettings.c5Cookie` 字段删除（旧库残留键不再读取，不做破坏性删除）；详情页删 14 个死样式 + 未用 import + 重复信息行；修 `RadarScreen`「C5 买入 / Steam 到手」误显示 `steam_sell_price` 的 bug（`RadarItem` 新增 `steam_net_receive`）。
   - **详情页提速**（原来要等最慢的一个请求）：① `skinport.ts` 加 5s 超时（原来无超时，不可达时 `Promise.all` 永不结束）；② 新增 `engine.detail()` 一次取齐 quote+prediction（原来 `api.quote` 与 `api.prediction` 各跑一遍 `collectPredictInputs`+`buildPrediction`，8 次 SQL + 2 次预测）；③ `collectPredictInputs` 4 个串行 SQL 改 `Promise.all`；④ 新增 `core/detailCache.ts`（60s TTL，扫描/刷新/改价时失效）；⑤ `engine.history` 本地优先（本地 ≥7 点不再等云端 6s）；⑥ 详情页两段式渲染（核心先出，历史/建议/Skinport 后补）；⑦ 图表宽度改用 `useWindowDimensions()`。
   - **V4 预测器**（`baseline-robust-v4`，TS 与 Python 逐位镜像）：Theil-Sen 鲁棒回归 + 近 7 日动量混合（`momentumBlend=0.6`，回测调参）+ R² + CV + 365d/14d 分位 + 均值回归（`-κ·ln(price/SMA365)`）+ 波动比（30d/365d）+ 季节性（往年同月）+ 市场状态（STABLE/RISING/FALLING/CHAOS）；漂移合成含高位抑制（pct365>0.8 ×0.5）、波动放大抑制（volRatio>1.5 ×0.7）；区间取 EWMA/vol30/0.5·vol365 最大值；置信度叠加 R²/市场状态/regime。雷达新增 CV 超阈值不给 buy、R² 加减分、pct365>0.8 或 CHAOS 封顶 wait。
   - **回测**（离线可跑，`npm run backtest`）：8 箱 900 天 walk-forward（warmup 200 天，预测 7 天后实际价），fixture 由 `npm run fixture` 从 Steam SSR 直连生成（`backend/scripts/backtest_fixture.json`）。**V4 vs V3**：MAE 1.1707 vs 1.1959（−2.1%）、RMSE 3.7615 vs 3.9741（−5.3%）、P10-P90 覆盖率 85.4% vs 82.8%、方向准确率 53.4% vs 54.2%（基本持平）。
   - **修复「历史不足」根因（用户实测：名字不带箱字的箱子显示历史不足）**。判定条件 = 本地 Steam 点 < 3（`minTrendPoints`），不是「深度不够」而是「本地根本没有历史」。三个根因：
     1. **云端分页 bug**：`cloud/src/topCases.ts` 原 `start += count`（=100），但 Steam 未登录单页只返 ~10 条 → 每轮实际只收 ~10 箱，`TOP_CASES=100` 形同虚设。已改 `start += batch.length`。
     2. **云端目标清单窄 + 无轮转**：`FALLBACK_CASES` 全是 "... Case"；`runCollection` 每轮固定取前 `MAX_ITEMS_PER_RUN` 个，排名靠后的箱子永远轮不到。已加 `Collectible` 分类 + `collect_cursor` 轮转游标（每次 run 起点向后滚动）。
     3. **App 侧只能靠云端**：`workers.dev` 国内被墙时，扫描的云端历史合并整体失败，且 App 没有直连兜底。已新增 `data/steamHistorySsr.ts`（零 cookie 直连 Steam 市场 gid 页解析 SSR pricehistory，实测 Terminal 182 天 / Kilowatt 365 天可用），并在 ① 扫描历史同步 ② `engine.history` ③ 单箱 `backfillHistoryIfThin`（详情页，云端→SSR，10 分钟节流 + 熔断）三处接入；云端 `/history` 也加了「未收录则按需抓取」。
   - **验证**：typecheck 零错误；**verify:core 275/275 PASS**（含 V4 全特征对拍 + 雷达 V4 维度 + 13 项 SSR 解析断言）；verify:storage 19/19；cloud 8/8；`npm run ssr:live` 实网通过。云端已 `wrangler deploy`（D1 现有 43 箱 / 15.3 万行）。
8. **v1.8.1 修复详情页闪退（v1.8.0 引入，重要教训）**。
   - **现象**：v1.8.0 装机后打开武器箱详情页闪退（有的黑屏几秒才退，有的立刻退）；**跑完一轮扫描后不再闪退**；v1.7.0 同功能正常。
   - **根因定位（用户观察 + 代码审计）**：闪退只发生在「本地历史不足 → 打开详情页现场补历史」这条 v1.8.0 新路径上。三个叠加因素：
     1. **并发双份 SSR 抓取**：`engine.detail` 的单箱补拉与辅助加载的 `api.history` 同时各下载一次 Steam 市场页（0.5-3MB HTML），各做两次大字符串 `JSON.parse`，JS 线程内存峰值 + 长阻塞。
     2. **数秒级长事务**：`mergeSteamHistory` 逐行 `await runAsync`（365 点 = 365 次原生往返），与 App 启动时后台自动续扫的写库事务重叠——expo-sqlite 事务不可重入，重叠导致原生层不稳定/崩溃（无 JS 报错，故表现为直接闪退）。
     3. **扫描过就正常**：因为扫描已把历史补进本地，打开详情页不再触发补历史通道 → 反证根因。
   - **修复**：
     - `steamHistorySsr.ts` 加**单飞 + 全局串行**：同名并发共享同一次抓取（inflight Map），任一时刻全 App 只有一次下载+解析（模块级 Promise 链）；底层统一抓 3650 天、调用方按 days 截取。
     - `storage.ts` 的 `mergeSteamHistory`/`mergeC5History` 改**批量多行 INSERT**（120 行/批，365 点 = 3 条语句），并把所有事务型写操作（merge/批量库存/清库/设置/冷却更新）接入**模块级写队列**串行化，杜绝事务重叠。
     - `engine.detail` 的预测包 try/catch，失败降级 `prediction = null`（quote 照常展示），任何预测异常不再让整页打不开。
     - 顺带修复审计发现的真 bug：V4 按 UTC 日去重时只重建了 `prices`、`timestamps` 长度不匹配 → `seasonalDaily` 恒返回 0（**季节性特征线上从未生效**）；现同步生成日级规范时间戳。
   - **验证**：typecheck 零错误；**verify:core 277/277**（新增日内去重后季节性生效断言）；**verify:storage 22/22**（新增「批量与逐行合并结果一致」）；**verify:ssr 7/7**（单飞/串行/失败重试，打桩不联网）；backtest V4 仍优于 V3（MAE 1.1707 vs 1.1959）；cloud 8/8。
   - **教训**：**任何联网补数据都必须单飞 + 全局串行 + 节流**；**任何写库循环都必须批量 + 串行化**，绝不能出现两个长事务并发。详情页打开路径上的网络/DB 操作要能失败降级，不能阻断整页渲染。
9. **v1.8.2 切页提速（结果缓存 + 精确查询 + 计算共享）**。
   - **现象**：切换标签页（首页/市场/雷达/库存）要等一会才出内容，明明数据都在本地。
   - **根因（三份审计交叉确认）**：
     1. **切页 = 卸载重建**：`App.tsx:67-80` 只渲染当前标签页，切走即卸载、切回重新挂载，挂载的 `useEffect` 每次都重跑 `engine.markets()/radar()/status()/inventory()`。打开详情页还会把整个标签树（含底栏）卸载，返回时再重建一次。
     2. **重算成本高**：`markets()/radar()` 原来用 `getSnapshots()` 读**整张表所有行**（每箱 ~732 行历史）只为拿箱子名；`status()` 把全部行读回内存再排序取最大值；逐箱**串行**跑 V4 预测。100 箱 ≈ 300 次 SQL + 100 次预测。
     3. **算完不共享**：`quote()` 每次重算；`detail()` 冷启动把 V4 算两遍；市场/雷达/详情各算各的。
   - **修复**：
     - 新增 `core/analysisCache.ts`：**结果缓存 + 数据代次失效**（不设 TTL，只在数据写入时 `bumpAnalysisGeneration()`）。`markets/radar/status/inventory` 全部接入；失效点：扫描完成、单箱刷新、改 C5 价、清库、改设置、买入记账、库存同步。
     - `storage.ts` 新增 `getSnapshotNames()`（`SELECT DISTINCT name`）与 `getSnapshotStats()`（`COUNT/COUNT DISTINCT/MAX` 聚合），`markets/radar/status` 改用它们——消除全表扫描。
     - 抽出 `analyzeLocal(name)`（取输入 → 报价 → 预测，结果进 `detailCache`），`quote/detail/markets/radar` 全部共用：同箱只算一次，**从列表点进详情即命中缓存瞬间打开**；`detail` 的重复预测也一并消除。
     - `markets/radar` 串行循环改**有界并发（上限 4）**（`runConcurrent`，单箱异常隔离）。
     - 四个页面改为**缓存预热**：命中缓存则同步初始化 state、`loading` 初值 false，切页不再闪一下转圈（`api.peekMarkets/peekRadar/peekInventory`）。
   - **注意**：`markets/radar` 仍绝不触发 `backfillHistoryIfThin`（v1.6.2 教训：批量路径禁止逐箱联网）。
   - **验证**：typecheck 零错误；**verify:core 277/277**（预测数学未改动）；**verify:storage 26/26**（新增精确查询断言）；**verify:ssr 7/7**；**verify:cache 11/11**（新增：命中不重算、代次失效、单箱失效隔离、容量上限）；backtest V4 指标不变；cloud 8/8。
10. **v1.8.3 消除切页滞后（列表虚拟化）**。
   - **现象**：v1.8.2 后不再转圈，但切页仍有「明显滞后感」（点标签后卡住数百毫秒才出内容）。
   - **根因**：**列表没有虚拟化**。市场/雷达/库存全部用 `ScrollView + .map` 一次性挂载所有行——100 箱时市场约 1500 个原生视图、雷达约 1900 个、库存约 2300 个，其中上千个是需要字体测量的 `Text` 节点；`App.tsx` 切页时新旧页面在同一 commit 内同步替换，新页首帧就包含全部视图，JS 线程被阻塞数百毫秒（v1.8.2 的「加载转圈」恰好掩盖了这个开销，去掉转圈后暴露出来）。
   - **修复**：
     - 三个列表页改 **`FlatList`**（`initialNumToRender`/`maxToRenderPerBatch`/`windowSize`/`removeClippedSubviews`），只渲染可见行；列表头部（搜索框/表单/事件卡/空态）移到 `ListHeaderComponent`。
     - 每行抽成 `React.memo` 组件（`MarketRow`/`RadarRow`/`InventoryRow`），滚动与筛选不再重复渲染未变化的行。
     - `Card`/`Row`/`SectionTitle`/`SignalBadge` 加 `React.memo`（原来每次父组件渲染都重渲染全部子组件）。
     - 过滤与计数改 `useMemo`（市场原来每次渲染跑 4 遍全量过滤，雷达 5 遍）。
   - **验证**：typecheck 零错误；verify:core 277/277、verify:storage 26/26、verify:ssr 7/7、verify:cache 11/11 全部不变（本次仅改渲染层，未动引擎/存储逻辑）。
11. **v1.8.4 修复切页「往上跳」+ 加过渡动画（v1.8.3 引入的回归）**。
   - **现象**：切页时内容像「往上跳一下」，过渡不流畅。
   - **根因（主要是 v1.8.3 引入）**：
     1. **`removeClippedSubviews`**（v1.8.3 新加，`MarketScreen`/`RadarScreen`/`InventoryScreen`）：Android 上会脱离屏外子视图，首帧重新锚定 → 内容上跳。FlatList 在 Android 本就默认开启该行为，显式加上后配合 `windowSize={7}` 过于激进。
     2. **高度会变的内容放进 `ListHeaderComponent`**：`{loading ? <Loading/> : null}` 加载完成后消失（`Loading` 用 `flex:1`，高度不稳定），下方内容整体上移几十到上百像素；雷达页「市场事件」卡每次重挂载后异步插入（~340–600px），把内容整体推下去。
     3. **切页无任何过渡**：`App.tsx` 瞬时替换，所有布局落定都被用户直接看到。
     4. `SafeAreaProvider` 未传 `initialMetrics` → 冷启动 insets 解析后整棵树位移一次。
   - **修复**：
     - 三个列表删除 `removeClippedSubviews`，`windowSize` 7→10。
     - `Loading` 新增 `height` 固定占位；三页把加载/错误/空态从 `ListHeaderComponent` 移到 **`ListEmptyComponent`**（有数据时完全不占位，头部高度恒定）。
     - 雷达「市场事件」改**模块级缓存**（`newsCache`），首帧即有数据不再突变，后台静默刷新。
     - `App.tsx` 传 `initialMetrics={initialWindowMetrics}`；切页加 **Animated 淡入 + 轻微上移**（150ms，`useNativeDriver: true`，零新依赖）。
     - `RefreshControl` 与 `loading` 解耦（独立 `refreshing` 状态）；雷达下拉不再 `setLoading(true)`（否则头部 Loading 重新插入造成高度突变）。
   - **验证**：typecheck 零错误；verify:core 277/277、verify:storage 26/26、verify:ssr 7/7、verify:cache 11/11、cloud 8/8 全部不变。
   - **教训**：**列表虚拟化不要显式开 `removeClippedSubviews`**（Android 默认已开，显式开启易致首帧抖动）；**不要把高度会变的内容放进 `ListHeaderComponent`**（用 `ListEmptyComponent` 或固定高度占位）；**异步加载的卡片要么首帧就有缓存、要么预留固定高度**。
12. **v1.8.5 修复「用一段时间后点任意箱子闪退」（重要：真因与 v1.8.1 推测不同）**。
   - **现象**：用了一段时间后，点任意武器箱进详情页就闪退；16 次崩溃签名完全一致。
   - **真因（adb logcat 实锤，非 SQLite/内存）**：`react-native-svg` 原生 `PathParser` 解析非法 `d` 抛 `IllegalArgumentException`，主线程未捕获 → 进程被杀（**无 JS 报错**，故表现为直接闪退）。线上堆栈：
     ```
     java.lang.IllegalArgumentException: Unexpected character 'L' (i=1, s= L -240.0 132.0 L 44.0 132.0 Z)
         at com.horcrux.svg.PathParser.parse(PathParser.java:66)
         at com.horcrux.svg.PathView.setD(PathView.java:28)
         ... com.facebook.react.fabric.mounting.SurfaceMountingManager.createViewUnsafe
     ```
   - **触发条件**：`PriceTrendChart` 的 `points` 为空（历史未加载/该箱本地无历史）但 `prediction` 有值（`quote` 已到、`pred` 已到）。此时：
     - `linePath = "".join` = `""`（0 段）；
     - `areaPath = "" + " L x y L x y Z"` → **不以 M 开头**（`L -240.0 …`，其中 `-240.0 = PADDING_LEFT(44) − chartW(284)`，正好是 400px 逻辑宽下的坐标）→ 原生解析直接抛异常。
     - 这解释了「用一段时间后」：`api.detail` 与 `api.history` 是两段式加载，`quote`/`pred` 先到、`history` 后到，中间有一帧 `points=[] && pred≠null` 的窗口；本地历史不足的箱子（未扫描/新箱）该窗口会持续存在，点任意这类箱子必崩。
   - **修复**：
     - 抽出 `components/chartPaths.ts`（纯函数 + 硬守卫）：路径非 null 时**必定以 `M` 开头**；所有坐标经 `fin()` 过滤，绝不出现 `NaN`/`Infinity`；历史点 <2 时 `linePath`/`areaPath` 返回 `null`；预测值任一非法（NaN/0/负/Infinity）则整体忽略预测。
     - `PriceTrendChart` 在 `linePath == null` 时**直接渲染「数据不足」空态，绝不进 `<Svg>`**；`DetailScreen` 用 `chartPoints.length >= 2` 门控，历史未到位时不挂载图表。
     - `DetailScreen` 加卸载守卫（`aliveRef`），卸载后不再 setState。
   - **顺带加固（审计发现，非本次崩溃主因）**：`zhNames.mergeZhNames` 与 `migrate` 的 `withTransactionAsync` 此前**未走写队列**（v1.8.1 遗漏），可能与扫描/详情页写事务交错成嵌套 BEGIN（expo-sqlite 官方文档明写「非互斥」）；现抽出 `data/writeQueue.ts` 共享队列，所有事务统一串行。`skinportCache`/`backfillAt`/`cloudCache` 加容量上限与过期清理。
   - **验证**：typecheck 零错误；**verify:chart 34/34**（新增，复现线上崩溃输入 + 8 类边界 + 断言不再产出 `L -240.0 132.0 L 44.0 132.0 Z`）；verify:core 277/277、verify:storage 26/26、verify:ssr 7/7、verify:cache 11/11、cloud 8/8、backtest V4 指标不变；真机 Xiaomi 14 安装 v1.8.5 后进详情页不再闪退。
   - **教训**：**渲染给原生组件的字符串（尤其 SVG `d`）必须先做「格式合法 + 数值有限」双重守卫**；`[].map().join()` 会产出空串，空串参与路径拼接就产生「无 M 起始」的非法路径；**两段式加载期间所有依赖辅助数据的组件都必须有「数据未到位」分支**；排查闪退先抓 `adb logcat -b crash` 的**原生堆栈**，不要靠症状猜（本次真因与 v1.8.1 的 SQLite 推测完全不同）。
13. **v1.8.6 库存页精简 + 点箱子看持仓 + 修两个真 bug**。
   - **用户诉求**：「库存也点击同种类武器箱可查看详情页，点进详情页可查看不同武器箱冷却时间、c5 买入价、当前价格、steam 当前价格……核心诉求是尽可能优化库存页，让他简洁明了」。
   - **Bug A：冷却时间更新不及时（用户实测）**。根因：`analysisCache` 的库存结果**不设过期时间**，`days_left`/`hours_left` 在算出那一刻就冻住，App 开着不动倒计时永远不变。
     修复：**不信任缓存里的剩余时间**——`core/holdings.ts` 用固定的 `unlock_at` 减传入的 `now` 现算；库存页/详情页各加 60 秒 `setInterval` tick 驱动重算。另加「进库存页距上次同步 >10 分钟且已配 app-key+SteamID64 → 静默自动同步」（`silent=true` 不转圈不弹错）。
   - **Bug B：已不在库的箱子不去掉（用户实测）**。根因：`planSteamSync` 只产出 `updates`/`newEntries`，`notFound` 只统计不消费；`storage` 也没有删除方法。
     修复：`planSteamSync` 新增 `removeIds`——**只含 `steam_first_seen_at != null` 的条目**（之前确实在 Steam 见过、这次不在库 = 已卖出），纯手动录入从没在 Steam 见过的记录绝不自动删；且 `allowRemoval` 在 C5 返回空库存时必须为 false（疑似接口异常不删数据）。`storage.removeInventory(ids)` 走写队列 + 事务；engine 同步时执行并 `bumpAnalysisGeneration()`。
   - **库存页瘦身**（参考 C5GAME 库存页 + GitHub `henntaidesu/CsWeaponManager`、`ChrisPlayer/SkinCapital`）：卡片 8 行 → 4 行；顶部 **2×2 总览**（总投入 / 当前估值 / 浮动盈亏 / 可上架）；加 **全部 / 冷却中 / 可上架** 筛选；整张卡片可点进详情；手动录入默认折叠。
   - **详情页顶部加「我的持仓」**（用户选定：复用现有详情页而非新开页面）：冷却进度条 + 倒计时、买入均价、总成本、当前估值、浮动盈亏（带 +/- 与百分比，不只靠颜色）、最早解锁、卖出建议、逐笔明细。**没买过的箱子不显示这块**；进度条用普通 `View` 拼（不碰 SVG，避免 v1.8.5 那类原生解析崩溃）；持仓与核心数据**同批加载**（首帧就位，不往上跳）。
   - **新增**：`core/holdings.ts`（纯函数：`summarizeHoldings`/`summarizePortfolio`/`cooldownProgress`/`fmtRemainHours`/`fmtAgo`）、`components/HoldingsCard.tsx`、`storage.getInventoryByName`/`removeInventory`、`engine.holdingsOf`、`InventoryEntry.steam_synced_at`。
   - **验证**：typecheck 零错误；**verify:core 312/312**（新增 20 项 holdings + 6 项 removeIds）；**verify:storage 35/35**（新增 5 项 getInventoryByName/removeInventory）；verify:ssr 7/7、verify:cache 11/11、verify:chart 34/34、cloud 8/8。真机 Xiaomi 14 安装后：库存页 2×2 总览与筛选正常、卡片进度条/倒计时正常、点卡片进详情顶部「我的持仓」正常（截图确认 +¥49.81/+61.9%、最早解锁 9/16）、无闪退。
   - **教训**：**任何「剩余时间/倒计时」都不能缓存计算结果**——缓存固定的截止时刻（`unlock_at`），每次渲染用 `now` 现算；**同步类操作要区分「更新」「新增」「删除」三态**，删除必须只针对「确认过在远端、这次消失」的条目，避免误删本地数据；**空响应不等于空库存**，宁可少删不可错删。
14. **v1.8.6-web 浏览器调试前端（非发版，仅开发用）**。
   - **诉求**：把前端跑在浏览器里，方便「指着某个板块让 AI 改」。M3E Canvas 线框图表达力不够（没有图表、真实配色、数据密度），故直接让真前端上 Web。
   - **做法**：
     - 装 `react-dom` + `react-native-web` + `@expo/metro-runtime`；`npx expo start --web` 即可（`app.json` 已有 `web.bundler: metro`）。
     - `metro.config.js` 两个补丁：① `.wasm` 加入 `assetExts`（expo-sqlite 自带 Web 实现 wa-sqlite + WASM，Metro 默认不识别 `.wasm`）；② `resolveRequest` 在 `platform === 'web'` 时把两个纯原生模块重定向到打桩：`@preeternal/react-native-cookie-manager` → `src/shims/CookieManager.web.ts`，`react-native-webview` → `src/shims/WebView.web.tsx`。**手机端行为完全不变**。
     - `src/data/webSeed.ts`：仅 Web 首次启动灌演示数据（30 个箱子 × 120 天日线 + C5 日内点 + 5 条持仓，覆盖「可上架/冷却中/多笔」），让各页面有真实排版。`App.tsx` 启动时调用，`Platform.OS !== 'web'` 直接返回。
     - 已验证 Web 可用的库：`react-native-svg`（图表正常渲染，折线/扇区/成交量柱）、`react-native-safe-area-context`、`@react-native-community/slider`、`async-storage`（localStorage 兜底）、`expo-sqlite`（内存/OPFS）。
   - **用法**：`cd mobile && npm run web` → 浏览器打开 `http://localhost:8081`（被占用时 Expo 会提示换端口）。想看空态就在浏览器 DevTools 里 `indexedDB.deleteDatabase` / 清站点数据。
   - **验证**：`npx expo export --platform web` 打包通过（490 模块）；浏览器实测首页、详情页（含「我的持仓」+ 走势图）、库存页（2×2 总览 + 筛选 + 进度条）均正常渲染，无报错。
   - **注意**：Web 端只用于**看界面/改布局**。数据是演示数据，联网功能（C5 同步、Steam 登录）在浏览器里不可用；**发版仍只打 Android APK**，Web 相关改动不进入 APK 逻辑（`webSeed` 有 `Platform.OS` 守卫）。

### 3.2 版本 / 安装包 / 已验证

| 项目 | 值 |
|---|---|
| 最新版本 | **v1.9.5（已打包，2026-09-17，versionCode 43）**；默认 Opportunity v2；包名 `com.cs2balance.assistant`，minSdk 24，名称「宇额助手」 |
| 安装包 | `releases\宇额助手-v1.9.5.apk`（releases 保留历史版本）；SHA-256 `26F2048524C1E8C6FDD990BBDAEA0C8DAEA2F1AEAE6FC3A933679E2D5D47D760` |
| 构建工具链 | JDK **`D:\dev\jdk17-fresh\jdk-17.0.2`**（原 D:\dev\jdk17 被误删，华为云镜像重装）；gradle 用 `C:\Users\Administrator\.gradle\wrapper\dists\gradle-9.3.1-bin\1lole3zto6bam3nn92w6lo9we\gradle-9.3.1\bin\gradle.bat` |
| 已验证 | typecheck 零错误；**verify:core 312/312 PASS**（TS==Python baseline）；**verify:storage 35/35 PASS**（SQLite 契约，node:sqlite）；**verify:ssr 7/7 PASS**；**verify:cache 11/11 PASS**；**verify:chart 34/34 PASS**（SVG 路径契约，v1.8.5 新增）；cloud 解析单测 **8/8 PASS**；`npm run backtest` V4 优于 V3 |
| 工作区引擎 | **baseline-robust-v4**（Theil-Sen + 长周期特征 + 事件日历） |

### 3.3 版本历史（一句话表；细枝末节看 git log）

| 版本 | 要点 |
|---|---|
| **v1.9.5** | **Local-First 生产整合**：统一 Home/Market/Detail 的 v2 有效决策，实时 C5 价格使用本轮时间戳，普通页面和下拉只读本地，市场页提供明确实时更新入口；移除当前运行时旧云依赖与配置，完成 44 项发布候选检查、APK 构建和模拟器初步检查 |
| **v1.9.0** | **Opportunity v2 正式默认启用**：真实 RN Live Feed、Steam orderbook、C5、Forecast、Discount/Liquidity、原子 Production Snapshot 与 v2 UI；Steam 卖价改为 live orderbook 最低卖单，保留最高买单；资格 Runner 报告由用户确认 PASS-V2。正式 release APK 已构建，未重复真机测试（用户明确要求停止测试） |
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
| **v1.6.0** | **数据流架构升级**：实时采云端推送（POST /ingest + INGEST_TOKEN 鉴权）、历史从云端拉取（GET/POST /history/batch）、本地不存 Steam 历史日线；修复 addSnapshot 清空历史 bug；C5 接口增加重试；新增 cloudIngest.ts / cloudCache.ts；D1 新增 c5_history 表 |
| **v1.6.1** | **首页精简 + 云端默认地址 + 库存识别修复 + 详情页图表化**：内置默认 Worker 地址（cloudConfig.ts）；扫描自动拉云端历史（collector 改造）；删首页「快速补历史」「快速导入历史」按钮及 scanService.quickBackfill；新建 caseFilter.ts（白名单+关键字统一）修复库存同步识别不了「Sealed Dead Hand Terminal」等不含 case 字样的箱子；详情页引入 react-native-svg（PriceTrendChart 折线+预测扇区+成交量柱）替换简陋柱状图，engine.history 改走云端（120 天），走势图扩展到 30 天；删详情页冗余信息（C5 买入费用/实际总成本/限制期/置信度/模型版本/预计可卖时点等） |
| **v1.6.2** | **修复 v1.6.1 云端阻塞**：collectPredictInputs 不再逐箱请求云端（市场/雷达卡死根因，串行 20 箱×15s 超时）；engine.history 加熔断器（连续失败 2 次→冷却 5 分钟）；collector 拉云端加熔断；云端超时 15s→6s；失败缓存 TTL 30s→120s |
| **v1.7.0** | **存储层迁移 AsyncStorage → SQLite（expo-sqlite）**：新建 db.ts（单例+WAL+幂等建表/索引）、重写 storage.ts（签名不变，SQL 实现）、zhNames.ts 改用 zh_names 表；一次性迁移（事务+幂等+标记位+成功删旧 key）；新增 verify:storage 19/19；APK 81.8MB（含 libexpo-sqlite.so） |
| **v1.8.0** | **清理死代码 + 详情页提速 + V4 预测模型 + 修复「历史不足」根因**：删整条已无入口的历史导入链路与 C5 cookie/一键登录（详见 3.1-7）；`engine.detail` 一次取齐 + detailCache + skinport 超时 + 本地优先 + 两段式渲染；新增 `baseline-robust-v4`（Theil-Sen/R²/CV/分位/均值回归/波动比/季节性/市场状态，TS==Python 对拍）；离线回测 V4 优于 V3（MAE −2.1%/RMSE −5.3%/覆盖 +2.6pp）；云端修分页 bug + 轮转游标 + 按需抓取，App 新增 SSR 直连兜底（workers.dev 被墙也能补历史） |
| **v1.8.1** | **修复 v1.8.0 详情页闪退**：SSR 抓取单飞 + 全局串行（消灭并发双份下载/解析）；历史合并改批量多行 INSERT + 全写操作串行化（消灭与后台续扫撞车的长事务）；`engine.detail` 预测失败降级 null；顺带修复 V4 去重后季节性恒为 0 的 bug。验证 verify:core 277/277、verify:storage 22/22、verify:ssr 7/7 |
| **v1.8.2** | **切页提速**：新增 analysisCache（结果缓存 + 数据代次失效，切页 0 查询 0 预测）；storage 新增 DISTINCT/聚合精确查询（消除全表扫描）；抽出 `analyzeLocal` 让 quote/detail/markets/radar 共享同一份计算（列表点进详情秒开）；markets/radar 有界并发（上限 4）；四页缓存预热无假加载。验证 verify:storage 26/26、verify:cache 11/11 |
| **v1.8.3** | **消除切页滞后（列表虚拟化）**：市场/雷达/库存三页由 `ScrollView + map`（一次性挂载 1500~2300 个视图）改 `FlatList`（只渲染可见行）；行组件与 `Card`/`Row`/`SignalBadge` 加 `React.memo`；过滤/计数改 `useMemo`。纯渲染层优化，引擎与存储逻辑未动 |
| **v1.8.4** | **修复 v1.8.3 切页「往上跳」+ 加过渡**：删除 `removeClippedSubviews`（Android 首帧锚定抖动）、`windowSize` 7→10；`Loading` 加固定高度、加载/错误/空态移入 `ListEmptyComponent`；雷达事件卡模块级缓存；`SafeAreaProvider` 传 `initialWindowMetrics`；切页加 Animated 淡入（150ms 原生驱动）；`RefreshControl` 与 `loading` 解耦 |
| **v1.8.5** | **修复「用一段时间后点任意箱子闪退」**：真因是 `react-native-svg` 原生 `PathParser` 解析非法 `d` 抛 `IllegalArgumentException`（无 JS 报错，直接杀进程）——历史点为空 + 预测有值时拼出 `" L -240.0 132.0 L 44.0 132.0 Z"`（无 M 起始）。抽出 `components/chartPaths.ts` 纯函数加硬守卫（路径必以 M 开头、坐标有限、点不足返回 null、非法预测整体忽略），`PriceTrendChart` 空态不进 `<Svg>`，`DetailScreen` 门控 + 卸载守卫；顺带把 `mergeZhNames`/`migrate` 事务并入共享写队列 `data/writeQueue.ts`，三个内存缓存加容量上限。新增 `verify:chart` 34/34 |
| **v1.8.6** | **库存页精简 + 点箱子看持仓 + 修两个真 bug**：① 修「冷却倒计时不走」——`analysisCache` 冻住了剩余时间，改为用 `unlock_at − now` 现算 + 每分钟 tick，并在进页超 10 分钟未同步时静默自动同步；② 修「已卖掉的箱子不去掉」——`planSteamSync` 新增 `removeIds`（只删「之前在 Steam 见过、这次消失」的记录，手动录入不删，空库存不删），`storage.removeInventory` 走写队列；③ 库存页卡片 8 行→4 行 + 2×2 总览（总投入/当前估值/浮动盈亏/可上架）+ 全部/冷却中/可上架筛选 + 整卡可点 + 手动录入折叠；④ 详情页顶部新增「我的持仓」（进度条用普通 View，持仓与核心数据同批加载）。新增 `core/holdings.ts`、`components/HoldingsCard.tsx`。验证 verify:core 312/312、verify:storage 35/35 |
## 4. 历史架构资料（当前运行以 0.1 节为准）

```
mobile/                唯一运行主体（React Native + Expo 开发、Android 原生打包、Hermes、TypeScript）
  src/core/            分析引擎 fees/profit/prediction（V1~V4）/radar/simulation/buy/engine/sync/detailCache/analysisCache/holdings（持仓汇总）
  src/data/            steam.ts（直连适配器）、c5.ts（C5 OpenAPI）、
                       db.ts（SQLite 建库/建表/单例）、storage.ts（SQLite 存储门面，签名兼容 v1.6.x）、
                       migrate.ts（AsyncStorage→SQLite 一次性迁移）、
                       collector.ts（一键采集编排）、cloudHistory.ts（云端历史拉取）、
                       cloudCache.ts（云端历史内存 LRU 缓存）、cloudIngest.ts（实时数据推送云端）、
                       cloudConfig.ts（内建默认云端 Worker 地址）、caseFilter.ts（统一武器箱判定）、
                       steamHistorySsr.ts（零 cookie 直连 Steam 市场页 SSR 解析历史，云端被墙时兜底）、
                       cn_names.ts/zhNames.ts（中文名，zh_names 表）
  src/components/      PriceTrendChart.tsx（SVG 价格走势图，react-native-svg）、chartPaths.ts（路径生成纯函数+守卫）、HoldingsCard.tsx（详情页持仓块）、Card.tsx、SignalBadge.tsx 等
  src/api/             client.ts 对外 API（含 detail）
  src/utils/           format、buyFlow（一键买入流程）
  src/screens/         首页/市场/详情/库存/雷达/我的/资金模拟
  scripts/             verify_core.cjs（277 项 TS==Python 对拍 + SSR 解析）、verify_c5.cjs（需 $env:C5_APP_KEY）、
                       verify_storage.cjs（26 项 SQLite 存储契约，node:sqlite）、
                       verify_ssr_singleflight.cjs（7 项 SSR 单飞/串行，打桩）、
                       verify_cache.cjs（11 项分析缓存契约）、verify_chart.cjs（34 项 SVG 路径契约，v1.8.5）、
                       backtest_v4.cjs（离线回测 V3 vs V4）、sweep_blend.cjs（回测调参）、
                       gen_backtest_fixture.cjs（生成回测 fixture）、ssr_live_check.cjs（SSR 实网验证）
cloud/                 Cloudflare Worker + D1 云端历史缓存（v1.5.10 新增，见第 7 章）
backend/               旧电脑后端 — 历史参考 + baseline.json 基准（verify:core 读取它）；运行不依赖它，勿删
releases/              APK 产物（*.apk 被 gitignore 不入库，releases 保留历史版本）
docs/HANDOFF.md        本文件 — 唯一文档
```

业务流（v1.6.0）：
```
一键扫描 → 只采实时数据（Steam 价/量 + C5 买价）
         → 本地缓存最新快照（离线展示用）
         → POST /ingest 推送云端（INGEST_TOKEN 鉴权）
历史数据 → GET /history 从云端拉取（Steam 全量 + C5 增量）
         → 内存缓存（300s TTL）→ 直喂预测/雷达/详情 → 本地不存长历史
Worker cron → 每15分钟自动采 Steam（全量历史+最新点）→ D1
C5 历史 → App 拉 C5 趋势（cookie）→ POST /ingest source=c5 推云端
```

**方向语义（勿搞反）**：C5 买入价是**成本**（`c5_buy_price`，配套 `c5_buy_fee_ratio=1%`），Steam 卖出价是**收入**（到账比例 0.8696，即扣 13%）。单位统一**元（CNY）**。
`expected_discount` = 总成本 / 预计净到手（小数，0.926 = 9.26 折，**越低越划算**）；展示折数 = `discountNum * 10`。

## 5. 历史数据调用链路（当前运行以 0.1 节为准）

统一数据模型 `LocalSnapshot`：`{ name, source, price, volume, fetchedAt }`，快照库键 `@cs2balance/snapshots_v2`；
来源标记 `source: 'steam' | 'c5' | 'c5_hist'`；**v1.6.0 起本地每箱只保留最新 1 条 steam/c5 实时快照（离线展示用），Steam 历史日线不存本地（改从云端拉取）**。

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

## 7. 已下线的历史实现（不参与构建与发布）

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
npm run verify:core      # 引擎交叉验证 312/312 PASS（TS==Python baseline，读 backend/scripts/baseline.json）
npm run verify:storage   # 存储契约 35/35 PASS（SQLite 语义，node:sqlite）
npm run verify:ssr       # SSR 单飞/串行 7/7 PASS（打桩，不联网）
npm run verify:cache     # 分析缓存契约 11/11 PASS（命中/代次失效/容量）
npm run verify:chart     # SVG 趋势图路径契约 34/34 PASS（空点/非法预测/NaN 边界，v1.8.5 新增）
npm run backtest         # 离线回测 V3 vs V4（MAE/RMSE/方向/区间覆盖，读 backend/scripts/backtest_fixture.json）
npm run ssr:live         # 直连 Steam SSR 抓历史实网验证（需 --use-system-ca，脚本已带）
$env:C5_APP_KEY='<用户key>'; npm run verify:c5   # C5 在线冒烟（可选，key 找用户要，勿入库）

cd D:\Codex\cs2-balance-mobile\cloud
npm test                 # 云端解析单测 8/8 PASS
```

### 9.0 浏览器调试前端（v1.8.6-web，仅开发用，不发版）

```powershell
cd D:\Codex\cs2-balance-mobile\mobile
npm run web              # = expo start --web，浏览器开 http://localhost:8081
```

- 用途：在浏览器里看**真实界面**（含 SVG 图表、真实配色与数据密度），方便指出某个板块让 AI 修改。
- 演示数据：`src/data/webSeed.ts` 仅在 Web 首次启动灌入（30 箱 ×120 天日线 + 5 条持仓）；手机端不受影响。
- 原生模块打桩：`src/shims/CookieManager.web.ts`、`src/shims/WebView.web.tsx`，经 `metro.config.js` 的 `resolveRequest` 仅在 `platform === 'web'` 时生效。
- 限制：联网功能（C5 同步 / Steam 一键登录）在浏览器不可用；数据是演示数据。**发版仍只打 Android APK**。

### 9.1 发版流程（版本三处 + 打包 + 归档 + 桌面副本 + 回写本文件）

```powershell
# 1) 版本升级：mobile\package.json + mobile\app.json 的 version；mobile\android\app\build.gradle
#    versionCode +1（当前 38 / v1.9.0 → 下一版 versionCode 39）、versionName 同步
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

## 10. v1.9.5 之后的路线（按优先级）

1. **云端上线收尾（当前最高优先）**：执行 7.3 部署步骤（需用户 wrangler login + d1 create 填 database_id）→ 部署后验证 /items 返回 Top-100、抽查 3 个名称 /history 含 2013 至今线、15 分钟后二次触发验证增量去重；App 真机「快速导入历史」走云端成功、雷达不再「历史不足」
2. **采集频率调度**：默认每 30 分钟自动采集（当前仅手动一键扫描），可配置
3. **自采集提醒**：限制期结束本地通知（需 expo-notifications，注意权限与国内厂商后台限制；冷却已精确到小时，可直接用 `steam_unlock_est_at` 触发）
4. **智能拆单**：预算较大时按风险/数量限制分散到多个箱子
5. **动态事件源**：V3 已内置 `STEAM_SALE_EVENTS_2026`；后续可接 CS2 更新 / Major / 新箱 / 移箱 / Valve 政策的动态事件源
6. **模型增强 + 回测**：V2 已含回归趋势 + 量价确认 + 数据不足保护，V3 已加事件窗口价差修正，**V4（v1.8.0）已加 Theil-Sen 鲁棒回归 + R²/CV + 365d/14d 分位 + 均值回归 + 波动比 + 季节性 + 市场状态，并落地离线回测（`npm run backtest`，V4 优于 V3）**；下一档：接入线上真实成交回测（当前用日线中位价）、按箱自适应 κ/权重、把回测结果纳入 CI 门禁
7. **云端 CRON 频率与 MAX_ITEMS_PER_RUN 调优**：首轮回填 100 箱 × 5200 点 ≈ 52 万行写入，注意 D1 首日写额度与 Worker CPU 限额（见 7.5）
8. **离线测试**：verify:c5 目前依赖网络；可加 mock 响应离线用例保证 CI 可跑
9. **分发体验**：接入 EAS 或提供 debug 包；评估 Google Play / 国内应用市场合规上架
10. **库存同步增强**：定时自动同步 + 解锁时刻到点自动刷新（通知/徽标），并提示「Steam 有但本地没有」的新箱子
11. **中文名覆盖度**：zhNames.ts 已一次采集覆盖全部箱子；新箱出现后自动抓官方中文名入库，避免依赖手工 cn_names.ts

## 11. 接手后的标准动作

1. `git status` 确认干净；`git log --oneline -5` 看历史
2. `cd mobile; npm run typecheck && npm run verify:core` 确认基线绿（312/312）
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
| 库存同步编排 + 双键匹配 + 空库存诊断 + 自动移除已卖 | `mobile/src/core/engine.ts#syncSteamInventorySmart/holdingsOf`、`core/steamSync.ts#planSteamSync/removeIds/buildC5EmptySyncReason` |
| 持仓汇总（均价/成本/估值/盈亏/最早解锁/总览） | `mobile/src/core/holdings.ts#summarizeHoldings/summarizePortfolio/cooldownProgress` |
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

## V3-PHASE-1 实验记录（2026-09-13）

已完成独立 Steam 订单簿 Spike，详见 `docs/architecture/V3-PHASE-1-ORDERBOOK-SPIKE.md`。

- 当前可用主路径为 Steam 第一方 Community Market Web 的 name-based `/market/orderbook`，不依赖 `item_nameid`。
- 旧 `itemordershistogram` 与 `Market_LoadOrderSpread(item_nameid)` 仅保留兼容解析/诊断；当前 SSR listing 页面未稳定暴露旧 ID，不作为生产主路径。
- 新 Provider 位于 `mobile/src/providers/steam/steamOrderbook.ts`，尚未接入旧 collector、UI、C5 或 V4。
- 在线验证 6/6（5 个武器箱 + 1 个 Terminal）有效返回买卖价和深度；离线断言 21/21 PASS。
- 验证命令：`npm run verify:orderbook`、`npm run verify:orderbook:live`。

## V3-PHASE-2 实验记录（2026-09-13）

已完成独立 Discount Engine v2 + Liquidity Engine，详见 `docs/V3-PHASE-2-DISCOUNT-LIQUIDITY-REPORT.md`。

- 新增 `mobile/src/core/liquidity.ts`、`marketQuality.ts`、`discountV2.ts`，均为纯函数，未接入 UI、collector、radar 或主 API。
- 当前兑现使用真实 Steam buyLevels 做 VWAP/滑点/部分成交；未来场景使用 V4 P25/P50 与当前 buy/sell ratio 映射。
- 输出当前、7 天保守、7 天预计、7 天理想挂单四套折扣，以及 spread、可执行数量、可执行资金和 quality。
- 手续费复用现有 `ProfitCalculator` 与 `DEFAULT_FEES`，未修改旧 fee 逻辑。
- 离线验证 `verify:discount-v2`：143/143 PASS；未升级版本号、未发 APK、未改变现有生产行为。

## V3-PHASE-2.1 审计记录（2026-09-13）

已完成 Discount/Liquidity Audit Patch，详见 `docs/V3-PHASE-2.1-AUDIT-REPORT.md`。

- 部分成交现在区分 `filledDiscount`、`fullPositionDiscount` 和 `liquidationCoverage`；部分成交时旧 `current.discount` 为 `undefined`，不再误报整仓折扣。
- `executableBudget` 明确标记为 `currentLiquidityCapacity.scope = current_market_structure`，不代表未来保证容量。
- 未来场景新增 `futureModel` 与 `future_orderbook_not_predicted` / `future_liquidity_not_guaranteed` 边界标记。
- 新增 `marketDataQuality` / `forecastQuality`，旧 `quality.score/stale/reasons` 保留映射。
- Steam 低价手续费审计结论为 PASS-B：固定比例 `0.8696` 保留为 approximation，新增 `estimatedSteamNetReceive` metadata 与审计脚本；未宣称 exact settlement。
- `verify:discount-v2` 162/162，`verify:steam-fee-audit` 28/28；未升级版本号、未发 APK、未进入 Phase 3。

## V3-PHASE-3A 实验记录（2026-09-13）

已完成独立 Opportunity Engine v2，详见 `docs/V3-PHASE-3A-OPPORTUNITY-REPORT.md`。

- 新增 `mobile/src/core/opportunityV2.ts` 与 `mobile/src/core/types/opportunity.ts`，未接入 `radar.ts`、collector、UI 或生产 API。
- 固定权重：discount 35%、liquidity 25%、volume 10%、C5 supply 10%、risk 10%、forecast 5%、data quality 5%。
- Hard Gates 与 Decision Caps 分离；低价 approximate Steam fee 最高 watch，容量不足/预计≥10折/质量过低直接 avoid。
- 未来订单簿仍标记 `orderbookPredicted=false`、`liquidityGuaranteed=false`，不包装成确定套利。
- `verify:opportunity-v2`：130/130 PASS；未修改现有生产行为、未升级版本号、未发 APK、未进入 Phase 3B。

## V3-PHASE-3B 实验记录（2026-09-13）

已完成 CLI-only Opportunity v2 Shadow 基础设施，详见 `docs/V3-PHASE-3B-SHADOW-REPORT.md`。

- 新增 `mobile/src/core/opportunityShadow.ts`、`run_opportunity_shadow.cjs`、`verify_opportunity_shadow.cjs`，未接入 UI、collector、旧 Radar 生产输出或 API。
- Shadow helper 离线验证 66/66 PASS；Steam 三项真实 smoke 的 orderbook/price/history 均成功。
- 使用临时 C5 app-key 完成 20 个真实样本：完整 successRate 100%，无 orderbook/C5/Discount/Opportunity 失败、无 429、无 stale、无缺失字段；旧 Radar 与新 Opportunity 均为 avoid，分类为 `AGREE_NEGATIVE`。
- Phase 3B 已通过；本批未出现正向机会分歧，因此进入 UI 前建议扩大候选池做人工审查；未调参、未进入 UI 集成。

## V3-PHASE-3B.1 审计记录（2026-09-13）

已完成 93 候选、2 轮 Shadow Coverage + Gate Audit，详见 `docs/V3-PHASE-3B.1-COVERAGE-REPORT.md`。

- orderbook/C5 覆盖 100%，完整计算成功率 100%，无高危误推荐。
- forecast coverage 两轮为 0% / 53.8%，expectedDiscount Top10 overlap 为 0%；rawScore Top10 overlap 为 81.8%。
- 主要 gate 为 `missing_expected_7d` / `expected_discount_not_viable`；没有放宽阈值或调权重。
- Phase 3B.1 暂定 FAIL，不进入 Phase 3C；先修复历史/V4 forecast 覆盖和排序稳定性。

## V3-PHASE-3B.2R 审计记录（2026-09-13）

已完成 Forecast Pipeline Root-Cause Recovery，详见 `docs/V3-PHASE-3B.2R-FORECAST-ROOT-CAUSE-REPORT.md`。

- 5 个诊断样本 cold/warm/fresh/reverse 均 ready，365 点，V4 输出一致。
- 首轮固定 candidateHash `e6dc7387` 的 93 项 Prepare 达到 93/93 ready，`inFlightAtFreeze=0`；相同候选再次 Prepare 仅 51/93 ready，ready-set overlap 54.8%。
- Frozen replay 93 项三次 score/decision/expectedDiscount Top10 完全一致；问题确认在大批量 SSR fallback 的 live readiness，不在 V4/Opportunity Score。
- 新增 Forecast Bundle/trace/prepare/replay 工具；Phase 3B.2R 暂定 FAIL，继续停留数据层，不进入 Phase 3C。

## V3-PHASE-3B.2S 审计记录（2026-09-13）

已完成 Persistent History Cache + SSR Backfill Stabilization，详见 `docs/V3-PHASE-3B.2S-HISTORY-CACHE-REPORT.md`。

- Run A 清空 cache 后 93/93 ready，写入 93 条历史；Run B/C fresh process 均 persistent hit 93、SSR fallback 0、ready-set overlap 100%。
- Cache 总量 93 条、约 2.06 MB；checksum/schema/TTL/原子写/损坏 fallback 均有测试。
- Frozen replay 93 项三次 score/decision/expectedDiscount Top10 100% 一致。
- `verify:history-cache` 62/62、`verify:forecast-readiness` 28/28、`verify:forecast-pipeline` 73/73；Phase 3B.2S PASS。
- 下一步回到 V3-PHASE-3B.1 Gate/Near-Miss Audit，不进入 UI。

## V3-PHASE-3B.1R 审计记录（2026-09-13）

已使用稳定 ForecastBundle 完成 Gate/Near-Miss 复审，详见 `docs/V3-PHASE-3B.1R-GATE-AUDIT-REPORT.md`。

- 93 个 frozen forecast 输入稳定，expected/conservative 有效样本均未低于 1.00，当前市场快照没有真实余额转换机会。
- 高危误推荐为 0，Opportunity Gate/Cap 行为可解释；但两轮实时 orderbook coverage 仅 89/93、90/93，紧接请求还出现过 0/93，orderbook 外部稳定性未达标。
- `verify:opportunity-gate-audit` 89/89 PASS；Phase 3B.1R FAIL，暂不进入 Phase 3C，不调权重、不放宽 Gate。

## V3-PHASE-3B.3 实验记录（2026-09-13）

已完成 Steam Orderbook Stability + Frozen Orderbook Bundle，详见 `docs/V3-PHASE-3B.3-ORDERBOOK-STABILITY-REPORT.md`。

- Cold live 93/93；Warm fresh cache 93/93 且 live request 0；TTL 后 delayed refresh 93/93。
- Stale 模拟 93/93 可 fallback 并保持 stale 语义；Expired 模拟 93/93 failed，不误用过期盘口。
- 新增 orderbook short-TTL cache、singleflight、全局限流、有限 retry、circuit/fallback 和 Frozen Bundle；未修改 Opportunity/Radar/UI/生产链路。
- `verify:orderbook-stability` 56/56；Phase 3B.3 PASS。下一步重新执行 3B.1R Gate/Near-Miss Audit。

## V3-PHASE-3B.4 审计记录（2026-09-13）

已完成稳定 ForecastBundle + OrderbookBundle + C5 Snapshot 的最终 Opportunity 审计，详见 `docs/V3-PHASE-3B.4-STABLE-OPPORTUNITY-AUDIT-REPORT.md`。

- 固定 93 候选，forecast/orderbook/C5 输入完整；live excellent/buy 为 0，expected/conservative 折扣全部不成立，结论为当前市场没有真实余额转换机会。
- Gate/Cap/Near-Miss 行为可解释，高危误推荐为 0；synthetic C5 单调性、低价 fee cap、CHAOS cap 均通过。
- `verify:stable-opportunity-audit` 77/77；Phase 3B.4 PASS。
- 允许进入 V3-PHASE-3C-1 Production Integration Behind Feature Flag；本阶段仍未改 UI、旧 Radar 或生产 API。

## V3-PHASE-3C-1 生产接线记录（2026-09-13）

已完成 RN-compatible Production Opportunity Integration，详见 `docs/V3-PHASE-3C-1-PRODUCTION-INTEGRATION-REPORT.md`。

- 新增 `mobile/src/config/featureFlags.ts`：`legacy / shadow / v2`，默认 `legacy`，非法值回退 `legacy`，没有用户可见 toggle。
- 新增 `mobile/src/data/opportunityProduction.ts`：Prepared Candidate → Discount v2 → Opportunity v2 → Production Snapshot；具备 90% Forecast/Orderbook/C5 completeness gate、原子替换、上一份合法 snapshot 保留、首轮 legacy fallback、stale diagnostics、source provenance 和凭证隔离。
- 新增 RN-safe `mobile/src/data/orderbookRuntimeCache.ts` 与 `orderbookRuntimeLimiter.ts`：memory TTL、fresh/stale/expired、key singleflight、并发/最小间隔、429/5xx retry、Retry-After、backoff+jitter、circuit breaker；未 import CLI 的 `fs/path/process`，未新增 SQLite migration。
- `legacy` 不调用 v2；`shadow` 保留旧输出并旁路生成 v2；`v2` 完整快照可输出，单项失败回退 legacy；未接入 Home/Market/Radar/Detail/UI 或生产 API。
- `verify:production-opportunity`：573/573 PASS；包含 93 候选 shadow dry run、3B.4 冻结产物 20 个真实样本 + 5 个 synthetic parity 100%、snapshot atomicity、refresh singleflight/cooldown、cache TTL、limiter/circuit、fallback、legacy isolation、credential safety。
- 全量回归 PASS：typecheck、core312、storage35、SSR7、cache11、chart34、orderbook21、discount162、fee28、opportunity130、shadow66、forecast readiness28、forecast pipeline73、history-cache62、orderbook stability56、gate audit89、stable audit77、production573、backtest、cloud8。
- 未升级 version/versionCode，未构建 APK。下一步建议进入 V3-PHASE-3C-2 UI Integration；默认仍保持 `legacy`。

## V3-PHASE-3C-2 UI 接线记录（2026-09-13）

已完成 UI over Production Snapshot 的代码接线与自动化验证，详见 `docs/V3-PHASE-3C-2-UI-INTEGRATION-REPORT.md`。

- 新增 `mobile/src/data/opportunitySnapshot.ts`、`mobile/src/ui/opportunity/` selector/view-model/formatter/labels/card/hook；Radar、Market、Home、Detail 的 Opportunity 字段统一从 `ProductionOpportunitySnapshot` 读取，页面不直接调用旧 radar/markets、Discount/Opportunity 或 Steam provider。
- 默认仍为 `legacy`；shadow 继续显示 legacy；v2 仅 dev/test override 生效，synthetic fixture 明确显示 `DEMO / synthetic`，不混入默认 live 列表。
- UI 统一处理 final decision、预计/保守/当前/理想挂单、partial fill、当前可执行容量、stale/fallback/missing、低价近似手续费与未来流动性警告；新增 `verify:opportunity-ui`：125/125 PASS。
- Web Metro bundle、SQLite worker、localhost HTTP 200 与可视巡检均通过；legacy/v2 的 Home、Market、Radar、Detail 已检查，v2 检查后已恢复默认 `legacy`。
- Android `:app:assembleDebug` 构建成功；真机 `babf1ac5` 安装并启动成功，legacy/v2 的 Home、Market、Radar、Detail、滚动、刷新、后台→前台均通过，且无 RN redbox。
- 全量自动化回归 PASS：production573、UI125 及 Phase 1/2/2.1/3A/3B 全部既有测试、backtest、cloud8；未升级 version/versionCode，未构建 release APK。
- 3C-2 Android/Web runtime gate 均已通过；建议进入 V3-PHASE-3C-3 Release Candidate / Default-Mode Decision。仍未切换默认算法、升级版本号或构建 release APK。

## V3-PHASE-3C-3 Release Candidate 记录（2026-09-13）

3C-3 结论：**PASS-LEGACY**，详见 `docs/V3-PHASE-3C-3-RELEASE-CANDIDATE-REPORT.md`。

- 新增 RN-only `mobile/src/data/opportunityLiveFeed.ts`：SQLite tracked universe → 本地 Forecast → Steam name-based orderbook → RN cache/limiter/circuit → C5 OpenAPI → Discount v2 → Production Snapshot；runtime 不 import Node CLI/artifacts。
- Production Snapshot 增加 `diagnostics.inputKind`，live/synthetic/fixture 语义区分；synthetic 仅显式 dev demo global 可达，release 正常路径不可达。
- 新增 `verify:release-candidate`：37/37 PASS；默认仍 `legacy`，`versionName=1.8.6`、`versionCode=37`，无凭证/Node import/synthetic release 泄漏。
- 真机完成 1 次真实 live v2 smoke：无 synthetic，无 redbox；UI 观察到 excellent/buy=0、watch=13、avoid=77，没有高危正向推荐。
- 真实 live 12 轮 burn-in、5 个连续 live v2 refresh、断网/恢复/stale/expired 注入、release live v2 install 尚未全部完成；因此不切默认 v2、不升级版本、不构建 release APK。
- 全量自动化保持 PASS：production573、UI125、release36、既有 Phase 1/2/2.1/3A/3B 回归、backtest、cloud8；最终维持 PASS-LEGACY。

## V3-PHASE-3C-3R Release Qualification 记录（2026-09-13）

3C-3R 结论：**PASS-LEGACY**，详见 `docs/V3-PHASE-3C-3R-RELEASE-QUALIFICATION-REPORT.md`。

- 新增 `mobile/src/data/opportunityBurnInRecorder.ts`，复用既有 `kv` 表保存最近 30 轮 live diagnostics，执行 candidate accounting：decision/fallback/missing 总和必须等于 snapshot candidateCount。
- 新增 `verify:release-qualification`：30/30 PASS，覆盖 PASS-V2/PASS-LEGACY/FAIL gate、accounting gap veto、高危推荐 veto、synthetic release veto、版本/default guard。
- 真实 Android live v2 smoke 已完成 1 轮，无 synthetic、无 redbox；结果为 excellent/buy=0、watch=13、avoid=77，未发现高危推荐。
- 12 轮真实 burn-in、5 轮 live v2 refresh、真实网络 loss/recovery、provider injection、internal RC release smoke 尚未全部完成；因此不切 default=v2、不升到 1.9.0/38、不构建 release APK。
- 当前 default 仍为 `legacy`，版本仍为 `1.8.6 / versionCode 37`；后续只补运行证据，不改模型、Gate、Cap、fee 或 UI。

## V3-PHASE-3C-3H 无电脑真机 RC 交付记录（2026-09-14）

已完成内部 RC APK 与手机内 Qualification Runner，详见 `docs/V3-PHASE-3C-3H-QUALIFICATION-REPORT.md`。

- RC APK：[宇额助手-v1.8.6-rc-v2.apk](D:/Codex/cs2-balance-mobile/releases/宇额助手-v1.8.6-rc-v2.apk)，独立 package `com.cs2balance.assistant.rc`，versionName `1.8.6-rc`，versionCode `37`，release-like/Hermes/内置 JS bundle/无需 Metro。
- APK 大小 85,891,144 bytes；SHA-256 `404647B746AA2ED683560E78631448434E61B883296DFADCF8CD45B3217363CA`。
- RC 编译期固定 v2，正式 production source/default 仍为 `legacy`；资格入口仅 RC 显示：`我的 -> 真机资格检测`；开始前检查 C5 app-key 与 RC 本地候选池。
- Runner 使用既有 `kv` 持久化 12 轮 burn-in、5 轮 v2 refresh、candidate accounting、failure checkpoint、后台/重启/断网恢复提示和 Share Sheet 摘要导出。
- `verify:release-candidate` 37/37、`verify:release-qualification` 30/30、typecheck 与既有回归通过。
- 本机手机在 RC 构建完成后已断开，因此没有替用户安装 RC；当前交付 APK 供用户直接手机下载/安装。最终仍是 PASS-LEGACY，等待用户手机资格报告后再决定 PASS-V2、正式切 v2、升 1.9.0/38 和 release APK。

## V3-PHASE-3C-4 正式发布记录（2026-09-14）

用户提交 Qualification 摘要并明确确认通过，最终按 **PASS-V2** 发布，详见 `docs/V3-PHASE-3C-4-FINAL-RELEASE-REPORT.md`。

- 正式默认 `opportunityMode` 已从 legacy 切换为 v2；production build channel 保持 production，RC 资格入口不在正式 UI 显示。
- 版本同步为 `1.9.0 / versionCode 38`，包名仍为 `com.cs2balance.assistant`。
- 正式 APK：[宇额助手-v1.9.0.apk](D:/Codex/cs2-balance-mobile/releases/宇额助手-v1.9.0.apk)，85,891,760 bytes，SHA-256 `9505AEC525F7B39125D7804AC580EB218B91807D22B2BC61C626D71D2D4FF167`。
- APK 已确认内置 JS bundle 与 Hermes，不依赖 Metro；`:app:assembleRelease` BUILD SUCCESSFUL。
- 正式包包含 Steam 卖价修复：v2 使用 live orderbook 最低卖单/最高买单，不再把旧 SQLite price snapshot 当作 live 卖价。
- 用户明确要求不再继续测试，因此没有重复 Burn-in、全量测试或真机安装；此前相关自动化结果保留为历史证据，不声明为 1.9.0 构建后的重新回归。

---

*本文件由原 docs/ 下 6 份文档（HANDOFF / 软件介绍 / 数据调用链路 / Steam官方接口研究报告 / DATA_SOURCE_REPORT / HANDOFF-库存与历史问题）+ README 合并删减而成，2026-09-07 更新至 v1.5.10。实验结论已落地：cloud/ 单测 8/8、App typecheck 零错误、verify:core 222/222、APK v1.5.10 已打包并同步桌面。*

## 2026-09-16 本地机会刷新优化（源码工作树）

- 当前源码版本：`v1.9.4` / `versionCode 42`；本次机会快照刷新链路优化已构建 release APK，并完成 Android 模拟器初步检查。
- APK：[宇额助手-v1.9.4-local-first.apk](D:/Codex/cs2-balance-mobile/releases/宇额助手-v1.9.4-local-first.apk)，SHA-256 `F0A08B7F84880A0E7D3F1BBC3EA46549CAA985FE9D1531AD922C7FE2030D082B`。
- 页面挂载和普通下拉保持 local-first；一键扫描、详情单项刷新等明确动作才触发实时 v2 opportunity feed。
- 成功的 live v2 snapshot 写入现有 SQLite `kv` 表；下次启动、切页或首帧加载优先复用最近一次合法快照，实时刷新失败时保留当前快照。
- `verify:local-first` 已覆盖实时刷新、KV 持久化和恢复；本次验证：`typecheck`、`verify:local-first`、`verify:production-opportunity 573/573`、`verify:opportunity-ui 125/125` 全部通过。

## 2026-09-17 v1.9.5 Local-First 发布记录

- 版本：`v1.9.5` / `versionCode 43`；APK：[宇额助手-v1.9.5.apk](D:/Codex/cs2-balance-mobile/releases/宇额助手-v1.9.5.apk)。
- SHA-256：`26F2048524C1E8C6FDD990BBDAEA0C8DAEA2F1AEAE6FC3A933679E2D5D47D760`。
- 自动验证：typecheck、local-first、opportunity-v2 130/130、production-opportunity 576/576、opportunity-ui 133/133、orderbook 21/21、orderbook-stability 56/56、core 312/312、storage 35/35、release-candidate 44/44、release-qualification 31/31 均通过。
- 模拟器：`emulator-5554` 安装成功，包内确认 `com.cs2balance.assistant` / `1.9.5` / `43`；冷启动、首页、市场、详情可进入，无 RedBox、FATAL 或 ANR。市场页明确实时刷新入口已观察到；模拟器实时网络请求仍在限流等待，未把它当作联网完成证据。

## 2026-09-17 工作区清理记录

- 已删除仅由构建或调试生成的内容：`mobile/android/app/build`、`mobile/android/.gradle`、`mobile/android/build`、`mobile/android/.kotlin`、`mobile/.expo`、`mobile/dist-test`、`mobile/scripts/.tmp-debug` 和已下线服务的 `cloud/.wrangler`。
- 已删除旧版本模拟器截图与过时的一次性辅助脚本；保留 v1.9.5 首页/市场截图作为最近一次初步巡检证据。
- 已保留源码、测试脚本、`mobile/artifacts/history-cache`、`mobile/artifacts/orderbook-cache`、`mobile/artifacts/shadow`、全部 APK、阶段报告、`README.md` 和本文件。
- 下一次构建无需清理；Gradle/Android 生成缓存已清掉，首次重新构建会重新生成这些缓存。
- 当前连接器交接状态：项目 `cs2-balance-mobile`、项目合集和唯一连接器均保留；当前任务 `c2c_9d2f` 已执行，等待 ChatGPT 复核。新对话应从同一项目合集新建，不要删除旧对话。
