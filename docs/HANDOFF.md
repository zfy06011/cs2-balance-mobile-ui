# HANDOFF —— 宇额助手（原 CS2 余额助手/余额雷达，v1.4.4 更名）交接文档

> 本文件写给**接手继续改进的 AI / 开发者**。先读本文件，再读 `docs/` 下的
> Phase 0 调研报告与原 PRD《CS2 武器箱跨市场倒余额分析系统》。所有对外说明必须简体中文。

## 0. 一句话定位

**纯手机 Android App「宇额助手」**：C5GAME 低价买入武器箱 → 约 7 天限制期 → Steam Community Market 卖出，
在手机内完成采集 / 收益分析 / 7 天预测 / 机会雷达 / 资金模拟 / 库存倒计时，**不自动买卖、不连电脑**。
最高目标：让用户快速知道**现在买哪个箱子最划算、预计能以几折倒成 Steam 钱包余额**。

## 1. 当前状态（2026-09-07）

> ⚠ **专项（v1.5.9 方向变更）**：库存同步**只走 C5GAME 官方 OpenAPI（app-key）**——`GET /merchant/inventory/v2/{steamId}/730`，C5 服务端高权限通道能看到交易保护期物品（status=4 冷却中归为不可交易），**彻底解决 Steam Web API 对保护期账号返回 `{"response":{}}` 导致库存永远为空的问题**（对应此前 v1.5.2~v1.5.8 的 Web API 链路与诊断已全部移除）。设置页只保留 C5 app-key 输入（Steam Web Key 输入项已删除）；历史价格仍走 C5 网页 cookie（C5 OpenAPI 无历史端点，已枚举 opendoc 全部端点 + 实测 404），Steam 历史不能通过 C5 app-key 获取。
> 全部已试通道、根因判断与下一步见 **`docs/HANDOFF-库存与历史问题.md`**（接手者必读）。

| 项目 | 值 |
|---|---|
| 最新版本 | **v1.5.9（已打包，2026-09-07，versionCode 25）**（包名 `com.cs2balance.assistant`，minSdk 24；名称「宇额助手」。说明：v1.5.0/v1.5.1 由其他 AI 仅改版本号重打包，功能与 v1.4.9 相同；**v1.5.2 起为功能版本**；v1.5.2 = 库存 Web API 诊断增强、v1.5.3 = 空库存诊断一锤定音、v1.5.4 = C5 一键登录 cookie 修复 + 设置页即时刷新、v1.5.5 = 历史导入改 C5 官方趋势通道，失败停止不再静默跳过、v1.5.6 = Steam 官方库存 response 包装解析修复（健壮性改进，非本案例根因）、v1.5.7 = 空库存诊断一锤定音 v2（透出 Steam 原始返回片段 + success=0 显式报错，用户实测双通道 `{"response":{}}`）、v1.5.8 = 空库存文案据实定论（Steam Web API 不返回保护期物品 + 本地保护中件数/最早解锁日提示，解锁后自动显示）、**v1.5.9 = 库存方案收敛为仅 C5 OpenAPI（app-key）唯一通道**（C5 服务端能看到保护期物品 status=4，彻底解决空库存问题；移除 Steam Web API 库存与设置里 Steam Web Key 输入项）） |
| 安装包 | `releases\宇额助手-v1.5.9.apk`（versionCode=25 / versionName=1.5.9 / label=宇额助手；releases 保留历史版本，桌面副本 `C:\Users\Administrator\Desktop\宇额助手-v1.5.9.apk` 仅留最新、已同步） |
| 构建工具链 | **已变更**：原 `D:\dev\gradle-9.3.1` 与 `D:\dev\jdk17` 被误删部分文件，gradle 已从 wrapper 缓存恢复，JDK 17.0.2 重新部署于 `D:\dev\jdk17-fresh\jdk-17.0.2`（华为云镜像）。构建命令 JAVA_HOME 需指向新 JDK；gradle 用 `C:\Users\Administrator\.gradle\wrapper\dists\gradle-9.3.1-bin\1lole3zto6bam3nn92w6lo9we\gradle-9.3.1\bin\gradle.bat` 或恢复后的 D:\\dev 路径 |
| 一级页面 | 首页 / 市场 / 库存 / 雷达 / 我的（资金模拟为首页工具入口，不作一级导航） |
| 已验证 | typecheck 零错误；引擎交叉验证 **222/222 PASS**（TS==Python 全对拍，v1.5.9 移除 Steam Web API 库存断言、新增 C5 OpenAPI 库存 5 项 + buildC5EmptySyncReason 3 项）；pytest **39 passed** |
| 工作区引擎 | **baseline-momentum-v2 + 事件日历 V3**（已随 v1.4.0 打包发布） |
| 工作区新增 | **v1.5.9（已打包，2026-09-07，versionCode 25）：库存方案收敛为仅 C5 OpenAPI（app-key）**——用户拍板：库存只走 `GET https://openapi.c5game.com/merchant/inventory/v2/{steamId}/730`（app-key query 参数，自动分页直到 lastAssetId 空、最多 20 页）；C5 服务端高权限通道能看到交易保护期物品（status=4 冷却中 → tradable=false），**彻底解决 v1.5.2~v1.5.8 期间 Steam Web API 对保护期账号返回 `{"response":{}}` 的空库存问题**（用户问「C5 为何能显示」的答案：C5 服务端从 Steam 高权限通道拉库存，能看到 status=4 保护中物品，而第三方 Steam Web API key 看不到）。本版新增 `data/c5.ts#fetchC5Inventory/parseC5Inventory/aggregateC5Inventory`（武器箱过滤、同名聚合）；`core/engine.ts#syncSteamInventorySmart` 改为 C5 app-key 通道（`source: 'c5_openapi'`，缓存 Steam 一键登录识别出的本人 SteamID64）；空库存文案改用 `core/steamSync.ts#buildC5EmptySyncReason`（C5 返回空 = SteamID64 非本人或 C5 app-key 未绑定该账号，不再有保护期歧义）。**移除 Steam Web API 库存全部代码**：`data/steam.ts` 的 `SteamInventoryItem/parseWebApiInventory/fetchSteamInventoryWebApi/resolveSteamIdViaWebApi/fetchSteamPlayerSummary` 等、`core/engine.ts` 的 `importSteamInventoryRaw/syncSteamInventoryFromSession`、`api/client.ts` 的 `syncSteamInventoryFromSession`；**设置页 Steam Web Key 输入项已删除**（`data/storage.ts#AppSettings.steamApiKey` 移除），设置页测试按钮改为「测试 Steam 搜索」。**历史价格结论（回答用户提问）**：Steam 历史**不能**通过 C5 app-key 获取——C5 OpenAPI 没有历史端点（枚举 opendoc.c5game.com 全部端点均为实时快照：余额/在售/订单/求购/库存/购买；探测 price-trend/price/history/item/trend 实测 404），历史仍走 C5 网页 cookie（`trade-flex/order/price-trend/chart?itemId=&period=7|30`）与 Steam cookie（`pricehistory`）；verify:core 更新为 C5 库存断言 + buildC5EmptySyncReason **222/222 PASS**。**v1.5.8（已打包，2026-09-07）：
| 核心指标 | **预计几折余额**（低于 1 更划算；如投入 100 元、预计 Steam 净到手 108 元 = 9.26 折） |

## 2. v2 已完成功能（相对 v1.2.0）

**v1.4.0（已打包，2026-09-05）—— 事件日历 + 活动窗口价差修正**：
- **预测器 V3（事件增强）**：`BaselinePredictorV2.predict({ events })` 对 targetAt（7 天后）做窗口价差修正：
  - Steam 大促等事件**窗口内**（含首尾日）：×（1 - pressure，默认 3%，价格被压制）
  - 事件**结束后 recoveryDays（默认 14）天内**：×（1 + pressure×(1 - d/recoveryDays)）线性回补到 0
  - 命中事件 → features 带 event_active / event_count / event_adjust / event_kinds / event_names，confidence ×0.9（保留 0.1~0.95 封顶）
- **Steam 2026 官方大促内置**：`STEAM_SALE_EVENTS_2026`（春促 3/19~3/26、夏促 6/25~7/9、秋促 10/1~10/8、冬促 12/17~1/4，UTC 日期近似），由引擎层注入；prediction 模块缺省为空数组 → 旧行为与旧基准完全不变
- **雷达事件修正**：引擎把**还原后的原始 P50/P25** 传给雷达，雷达内部乘回 (1+event_adjust) 避免双重修正；评分偏移 event_adjust×-200（封顶 ±8，大促压制期买入机会加分）；details 输出 event_adjust 与修正后 predicted_p50
- 验证：TS==Python 双实现全对拍 **131/131 PASS**；pytest **39 passed**


**v1.4.0-plus（2026-09-05，已随 v1.4.0 打包发布）**：
- **Steam 官方中文名自动缓存（`926fe4f`）**：采集时带 `l=schinese` 抓官方中文名入 `src/data/zhNames.ts` 缓存（一次采集覆盖全部箱子）；UI 显示三级回退：手工映射 `cn_names.ts` → 官方缓存 → 英文原名，「暂无中文名」问题已根治；后台仍以 MarketHashName 关联
- **Steam 库存同步冷却期（`2fecd25`）**：设置页填 SteamID64（支持 17 位或 `profiles/` 链接）→ 库存页「同步 Steam 冷却」→ `fetchSteamInventory` 拉真实冷却（`market_tradable_restriction` 剩余整数天），`engine.syncSteamInventory` 结合本地首次观察时间推算到小时、多轮 min 累积逼近；库存页显示 steam 同步状态、真实可交易时间/剩余小时，替代一刀切的「买入 +7 天」
- 涉及文件：`src/data/steam.ts` / `src/core/engine.ts#syncSteamInventory` / `src/data/storage.ts#updateInventoryCooldown` / `InventoryScreen.tsx` / `SettingsScreen.tsx`

**v1.4.1（已打包，2026-09-05）—— Steam 库存同步自动导入 + 采集翻页 + 三项体验修复**：
- **一键采集只采 10 个的根因修复（采集翻页）**：实测 Steam `search/render` **未登录（无 cookie）时
  单页最多只返回 10 条**（请求 count=100 实测 results_len=10，榜单 total_count=458），旧代码只拉一页
  → 无论设置 12/20/50 都只能采到 10 个。修复：`steam.ts#searchPaged` 按 start 翻页（页间 1.2s 限速、
  最多 10 页、按名去重、翻完 total_count 即止），热门榜与成交量回退路径都走翻页；实测 5 页拉到 50 条。
  在设置页填 Steam cookie 登录态可单页拿满 100，翻页会自动只翻一页
- **collector 榜单拉取量与采集数量联动**：`searchCases(min(100, max(want, 30)))`（保留中文名缓存覆盖），
  替代固定 100，避免选 12 个也要翻 10 页
- **Steam 箱子自动导入本地库存**：同步 Steam 冷却时，Steam 库存里未被本地收录的武器箱自动写入库存
  （`item_name`=英文 MarketHashName、`quantity`=Steam 数量、`buy_price=0`、`source='steam_sync'`，
  冷却字段一并写入）；纯逻辑抽在 `src/core/steamSync.ts#planSteamSync`（无 RN 依赖，verify_core 直接对拍）
- **双键匹配**：本地记录按「英文 MarketHashName + Steam 官方中文名」双键匹配（手动录入中文名也能匹配上），
  解决「匹配 0 件」的主因；同步结果消息改为「本地匹配 X 件（可上架 Y），从 Steam 新导入 Z 件，未在 Steam 找到 W 件」
- **同步后自动保存 SteamID**：库存页同步成功即 `updateSettings({ steamId })`，一次填写永久记住
- **清空本地数据保留设置**：`storage.clearAllData` 不再删 `K_SETTINGS`（C5 app-key / SteamID / Cookie /
  购买保护全保留），只清快照/库存/订单；确认弹窗文案同步更新
- **storage 新增 `addInventoryBulk`**（一次读一次写批量导入）
- 涉及文件：`src/core/steamSync.ts`（新）/ `src/core/engine.ts` / `src/data/storage.ts` / `InventoryScreen.tsx` / `SettingsScreen.tsx` / `scripts/verify_core.cjs`
- 验证：typecheck 零错误；verify:core **143/143 PASS**（新增 12 项 steam_sync 断言）；pytest 39 passed

**v1.4.2（已打包，2026-09-05）—— 官方历史价格接入（算法增强）+ 断点续采 + 采集入口去重 + 库存同步诊断加固**：
- **采集入口去重**：首页/市场/设置三处原本是同一个 `engine.refresh` 的重复触发。现**首页「📡 一键扫描」
  为唯一入口**（带数量与进度）；市场页删掉悬浮扫描按钮与采集中横幅；设置页卡片改为「采集数量」纯配置。
  雷达（engine.radar）不自行抓数据，消费的正是扫描写入的快照
- **断点续采 + 限流冷却（collector）**：价格阶段先查 `getLatestSteam`，15 分钟内已采集的直接跳过
  （RESUME_FRESH_MS）——切换页面本就不会中断（异步循环继续跑），真正中断是退出 App；
  中断后重扫自动只补缺失项，不再从头来。连续失败 ≥2 视为被限流，冷却 8 秒（FAIL_COOLDOWN_MS）再继续，
  解决「扫 50 个最后几个拉不到」；重试统一为两次尝试（异常与无数据都重试）
- **CollectStats/CollectProgress 新增 `skipped`**；首页「全部失败」判断兼容全跳过场景；
  完成消息含「跳过 X 个（15 分钟内已采）」
- **调研结论（实测）**：C5 OpenAPI（apikey）**没有历史价格接口**——36 个端点全枚举（sitemap），全是
  实时快照类（余额/在售/订单/求购/库存/购买）；C5 网页趋势接口在
  `GET www.c5game.com/trade-flex/order/price-trend/chart?itemId=<id>&period=<7|30|...>`，**需 C5 网页登录
  cookie**（响应内嵌 {dates:[unix秒],prices:[元]}，网页图表同款结构）。Steam 官方历史
  `GET steamcommunity.com/market/pricehistory/?appid=730&market_hash_name=`（日线、可回溯数年）
  **需 Steam 登录 cookie**（未登录 400/401）
- **Steam 历史导入**：`steam.ts#fetchSteamPriceHistory/parsePriceHistory`（pricehistory → 日线点）；
  `storage.mergeSteamHistory` 按日期去重、每名 50 条上限，写入 steam 快照（fetchedAt=日期T08:00:00Z）；
  导入后预测器 V2 / 雷达 / 详情趋势图自动用真实历史，无需改下游
- **C5 历史导入**：`c5.ts#fetchC5PriceTrend/parseC5Trend`（弹性提取 dates/prices，兼容毫秒时间戳）；
  `storage.mergeC5History`（source='c5_hist'，独立于 c5 实时价，addSnapshot 的 c5 替换逻辑不碰它）+
  `storage.getC5History`；collector 用 `fetchC5StatsBulk` 拿 itemId 后逐件拉趋势
- **collector 采集编排**：listing → C5 批量价 → Steam 历史导入 → C5 历史导入 → 逐件 priceoverview；
  两类历史导入都在「本地点 < 14 且 cookie 已配」时才拉（一次性成本约每件 2 秒，之后自动跳过）
- **设置页新增 C5 Cookie 输入**（`AppSettings.c5Cookie`）；Steam cookie 提示语更新
- **库存同步诊断加固**：`fetchSteamInventory` 429/5xx 自动重试（3s/6s 退避）、403/401 明确提示、
  拉到库存但无武器箱时报「可见 X 件物品但没有武器箱」；实测私密库存=403、无效账号=401
- **verify_core**：新增 `steam.ts`/`c5.ts` 独立编译通道（src/data 文件），price_hist 6 项 + c5_hist 5 项断言
- **详情页「刷新价格」整合**：按钮改名「⟳ 刷新价格（Steam + C5）」；`collectOne` 返回值带
  `c5Price`，刷新结果消息分平台汇报（Steam 成功 + C5 有价/未配 key/暂无价）
- 涉及文件：`src/data/steam.ts` / `src/data/c5.ts` / `src/data/storage.ts` / `src/data/collector.ts` /
  `src/screens/SettingsScreen.tsx` / `src/screens/DetailScreen.tsx` / `src/core/engine.ts` / `scripts/verify_core.cjs`
- 验证：typecheck 零错误；verify:core **154/154 PASS**；pytest 39 passed
- **待真机验证**：C5 趋势接口响应形状是从网页代码逆向推断（弹性解析可容忍包装差异），
  需用户在设置页填 C5 cookie 后真机采集确认；若未导入需抓包调整解析

**v1.4.3（已打包，2026-09-05）—— App 内一键登录 + 深色启动页 + 扫描体验三项优化 + 新品牌（图标/名称）**：
- **新品牌**：更名「CS2余额雷达」（strings.xml / app.json，包名不变 `com.cs2balance.assistant`，升级即覆盖安装）；
  新图标为 PIL 绘制的品牌设计（深色圆角底 #0B1220 + 雷达同心圆 + 扫描扇形 + 中心 ¥ 徽标 + 信号点），
  方形/圆形两版替换 mipmap-*/ic_launcher(_round).webp 全密度；assets/icon.png 供 app.json 引用；
  生成脚本未入库（临时），重生成可参考 `assets/icon.png` 视觉用 PIL 复刻
- **App 内一键登录（免手抄 cookie）**：
  - **新依赖（含原生代码，需重打包）**：`react-native-webview` + `@preeternal/react-native-cookie-manager`
    （新架构 TurboModule，`@react-native-cookies/cookies` 已废弃故弃用）+ `@react-native-community/slider`（扫描数量滑块）
  - **CookieLoginScreen**：设置页「🔐 Steam 一键登录 / 🔐 C5 一键登录」→ App 内 WebView 打开登录页
    （支持验证码）→ 每次跳转/加载后检查关键 cookie（Steam=steamLoginSecure，C5=token/passport/session/uid
    正则）→ 命中即自动保存到设置；右上角「手动保存」兜底（getCookieHeader 整行保存）
  - 设置页手填 Cookie 输入框降级为备用；App.tsx 新增全屏 overlay 接线
  - **注意**：cookie 是 HttpOnly 的，网页 JS 读不到，必须走原生 CookieManager（已用该方案）

**v1.4.4-wip（2026-09-05 工作区，未打包）—— 关键修复：扫描读取设置 cookie + 空库存细分诊断**：
- **Bug（v1.4.3 实测暴露）**：`collectCases` 的 Steam cookie 只从调用参数拿（默认 ''），
  首页扫描不传 → 设置里保存的 cookie（一键登录/手填）从未被扫描使用 → Steam/C5 官方历史导入
  被整段跳过 → 详情页一直「历史不足」。修复：cookie 改为优先读 `settings.steamCookie`
  （调用方显式传参可覆盖）。**C5 历史导入此前无此问题**（c5Cookie 本来就读 settings）
- **空库存诊断细分**：fetchSteamInventory 返回 `total_inventory_count`；为空时区分
  「总量 0 = 账号 CS2 库存真没物品（附浏览器核对链接）」vs「报告 X 件但列表空 = 接口异常重试」
  vs「可见 N 件但无武器箱」
- 涉及文件：`src/data/collector.ts` / `src/data/steam.ts` / `src/core/engine.ts`
- 验证：typecheck 零错误；verify:core 154/154 PASS
- **会话同步（用户要求的新方式）**：`steam.ts#resolveOwnSteamId`——请求 steamcommunity.com/my
  （重定向到本人资料页），从 data-miniprofile / g_steamID / 最终 URL 提取本人 SteamID64；
  `engine.syncSteamInventoryFromSession` 识别后自动存回设置再复用 syncSteamInventory。
  库存页新增主按钮「⟳ 用已登录账号同步（推荐）」，免手填 ID、排除 ID 填错账号的问题；
  登录失效（返回登录页 HTML）时明确提示重新一键登录

**v1.4.4-wip（续）—— 买入/卖出时机建议 + 库存堆叠**：
- **core/advice.ts（新纯模块，进对拍）**：
  - `buildC5BuyAdvice(history, nowPrice, now)`：近 7/30 天统计（均值/最低/最高）、较昨日变化（≥半天前的
    最近的点）、近 7 天价格分位（≤30% 低 / ≥75% 高）、7 点线性斜率趋势 → good/ok/wait + 中文理由
  - `buildSellAdvice(unlockAt, tradableNow, events, now)`：解锁日 vs 活动窗口 →
    sell_now / sell_at_unlock / wait_recovery（已可上架但在活动内）/ wait_event_pass（解锁日落活动内）；
    活动结束 14 天回补期内解锁 → 尽快卖；解锁后 5 天内有活动开始 → 赶在压制前立即卖
- **engine**：`inventory()` 每条带 sell_advice_code/text（用 STEAM_SALE_EVENTS_2026）；
  新增 `c5BuyAdvice(name)`（storage.getC5History 40 点 + getLatestC5）
- **详情页**新增「C5 买入时机参考」卡：当前价 / 7 天均值-最低-最高 / 较昨日 / 分位 / 趋势 /
  活动影响（pred.features.event_names）/ 建议结论
- **库存页**同名堆叠：按 item_name 合并（总数量 ×N 徽章、N 笔记录、总成本、按件总净利/回报率、
  最早解锁倒计时），标题显示「X 条 · 堆叠后 Y 种」；卡片底部显示卖出时机建议
- verify_core 新增 advice.ts（core 目录）断言 11 项：c5_advice 6 + sell_advice 5
- 验证：typecheck 零错误；verify:core **165/165 PASS**
- **说明**：C5「近几小时」粒度依赖一天内多次扫描产生的日内点（当前 c5_hist 为日线），
  首版以「较昨日」+ Steam 侧日内快照近似；后续可在 setC5Price 时并入日内点存储

**v1.4.4-wip（续 2）—— 事件双向日历（联网核实）+ 买卖时机算法升级**：
- **事件方向化（prediction.ts）**：MarketEvent 新增 `impact: 'suppress' | 'boost'`（缺省按 kind 推断：
  steam-sale/valve-policy/case-removal → suppress，major/game-event/case-release → boost）。
  computeEventAdjust：boost 窗口内 ×(1+p)、开始前 3 天预期 ×(1+p/2)、无回补尾；
  suppress 保持原逻辑（窗口压制 + 结束线性回补）
- **综合事件日历 MARKET_EVENTS（2025-2027，2026-09 联网核实，UTC 近似）**：
  - Steam 大促（suppress 3%）：2025 春 3/13-3/20、夏 6/26-7/10、秋 9/29-10/6、冬 12/18-1/4；
    2026 四季（原有）；2027 春 3/18-3/25
  - CS2 Major（boost 2%）：Austin 2025/6/3-22、Budapest 2025/11/24-12/14、
    IEM Cologne 2026/6/2-21、PGL Singapore 2026/11/25-12/13
  - 春节行情（boost 2%）：2025/1/22-2/5、2026/2/10-2/24、2027/1/30-2/13
  - Valve 政策冲击（suppress 8%、回补 21 天，历史事件）：2025/10/23 交易保护更新闪崩
  - engine 预测与卖出建议的默认日历由 STEAM_SALE_EVENTS_2026 换为 MARKET_EVENTS（原导出保留兼容）
- **advice.ts 升级**：
  - `buildC5BuyAdvice` 可选 `longHistory`（Steam 日线数月）：新增 90 天日波动率 vol90Pct、
    距 90 天最低点 distFromMin90d、90 天长趋势 longTrend90；低位（≤3%）上调建议、
    高位（≥25%）下调、高波动（≥2.5%/日）提示分批买入
  - `buildSellAdvice` 方向感知：boost 窗口内解锁/可上架 → 尽快卖（需求提振）；解锁后 1-3 天有
    boost 事件 → 可等活动期再卖；suppress 逻辑不变。MarketWindow 兼容 MarketEvent 直传
    （有 kind 无 impact 时按 kind 推断——已加回归测试防止 Major 被误判为压制）
- **长历史导入**：Steam pricehistory 由 60 天 → 120 天（`fetchSteamPriceHistory` 默认与 collector）；
  storage 新增 `HISTORY_KEEP=120`（历史导入专用保留上限，快照实时点仍为 STEAM_KEEP=50）
- verify_core 新增：market_events/count、boost/boost_pre/cny_hit/shock 因子、
  sell_advice boost×2 + kind 推断回归、c5_advice.long_metrics —— 共 **174/174 PASS**
- 事件依据来源：Steam 官方销售日程公告（store.steampowered.com/news / SteamDB）、
  HLTV/Wikipedia/Red Bull（Major 日期）、财联社/证券时报/5EPlay（2025-10-23 政策冲击）、
  Reddit csgomarketforum/SMZDM（春节行情）

**v1.4.4-wip（续 3）—— 软件内实时市场事件源（RSS）**：
- **数据源（免密钥）**：CS2 官方博客 RSS（blog.counter-strike.net/index.php/feed/）+
  Steam CS2 新闻 RSS（store.steampowered.com/feeds/news/app/730/）；6h 缓存，全失败保留旧缓存
- **core/rss.ts（纯模块，进对拍）**：parseRss（CDATA/实体解码、pubDate→ISO）、tagTitle 关键词标记
  （policy=交易/更新类警惕闪崩、boost=Major、sale=特卖、case=箱子、op=行动）、
  filterRecent（45 天窗口、丢未来项——回归测试覆盖）
- **data/eventFeed.ts**：Promise.allSettled 双源拉取 + storage 缓存（K_EVENT_FEED）
- **雷达页顶部「📰 市场事件」卡**：标签徽章 + 标题（可点开原文 Linking）+ 来源/日期 + 免责说明；
  下拉刷新强制更新
- verify_core 新增 rss 9 项断言 —— **183/183 PASS**

**v1.4.5-wip（2026-09-05 工作区，未打包）—— 交易保护箱会话拉取（解决「库存有箱但同步为空」）**：
- **根因（2026-09-05 联网核实 + 用户实测截图）**：2025 Steam 交易保护更新后，**近期交易收到的箱子
  （带黄盾，7 天保护期）经常不出现在 steamcommunity.com/inventory/{id}/730/2 的返回里**——即使库存公开、
  甚至带登录 cookie。r/SteamBot 有专门讨论；SteamWebAPI 为此做了单独的付费检测产品。保护期（约 7 天）
  过后普通同步即可看到
- **会话拉取兜底**：`CookieLoginScreen` 新增 `steam-inv` 模式——WebView 打开本人库存页
  （完整登录态），`onLoadEnd`/手动注入 JS：读 `g_steamID`/`data-miniprofile` → 页面内
  `fetch('/inventory/{id}/730/2', {credentials:'include'})` → `postMessage` 回 RN →
  `engine.importSteamInventoryRaw`（`parseInventoryResponse` 从 fetchSteamInventory 抽出共用）→
  planSteamSync 入库。结果 Alert 汇报 matched/imported；接口仍为空时提示等保护期结束
- 库存页新增按钮「🔗 网页会话拉取（含交易保护箱）」（App.tsx overlay 接线；同步后下拉刷新列表）
- **历史导入显形（修「一直历史不足」的盲区）**：collector 统计 histImported/histFailed/histSkipped；
  完成消息含「历史导入 X 成功 / Y 失败 / Z 已充足」；未配 cookie 时提示「无法导入官方历史」；
  首页扫描后若 0 成功 → 明确提示重新一键登录；雷达页过半历史不足时显示解决路径横幅
  （V2/V3 的 insufficient 阈值 = 每箱 ≥4 个价格点；1 次扫描只产生 1–2 个点，
  cookie 正常时历史导入一次即补齐 120 天）
- 涉及文件：`src/data/steam.ts`（解析抽取）/ `src/core/engine.ts` / `src/api/client.ts` /
  `src/screens/CookieLoginScreen.tsx`（steam-inv 模式）/ `src/screens/InventoryScreen.tsx` / `App.tsx`
- 验证：typecheck 零错误；verify:core 207/207 PASS
- 依据来源：[Trade Protected Items FAQ](https://help.steampowered.com/en/faqs/view/365F-4BEE-2AE2-7BDD)、
  [r/SteamBot 讨论](https://www.reddit.com/r/SteamBot/comments/1ta63qz/)、
  [SteamWebAPI 交易保护检测](https://www.steamwebapi.com/cs2-trade-protected-items)、
  [r/cs2 看不到保护箱](https://www.reddit.com/r/cs2/comments/1m36vp0/)

**v1.4.6-wip（2026-09-05 工作区，未打包）—— Steam Web API 官方库存接口（全量含保护箱）**：
- **动因**：用户库存已公开、两种同步方式都「为空」——交易保护箱不在社区接口返回（见上）。
  C5 App 能显示库存正是因为其服务端走 Steam 官方 Web API；本版接入同一官方通道
- **`steam.ts#fetchSteamInventoryWebApi` / `parseWebApiInventory`**：GET
  `api.steampowered.com/IEconService/GetInventoryItemsWithDescriptions/v1/?key=&steamid=&appid=730&contextid=2&get_descriptions=true`
  （需免费 Key，steamcommunity.com/dev/apikey）；保护中物品带 `cache_expiration`（资产级或描述对），
  冷却按该时刻精确推算（比社区接口的"剩余整天"更准）
- **engine.syncSteamInventory**：settings.steamApiKey 配置时优先走 Web API；未配置仍走社区接口
- **设置页**新增「Steam Web API Key」输入框（含申请指引）
- verify_core 新增 webapi 5 项断言（解析/保护期推算/解锁聚合）—— **211/211 PASS**
- 登录有效期说明：Steam steamLoginSecure 通常数月有效（改密码/注销全部会话才失效）；
  C5 会话较短（服务端策略），失效重新一键登录即可——历史数据已入库，C5 cookie 只影响下次导入

**v1.4.7-wip（已随 v1.4.7 打包）—— 用户实测定位 + 页面数据直抓（终极版）**：
- **用户实测（v1.4.6）**：网页会话拉取（登录态页内 fetch JSON 接口）与 **Web API Key 通道均失败**，
  但库存页面正常显示物品 → 判定：Steam 的库存 **JSON 服务**对该账号/网络环境返回空
  （页面渲染走源码内嵌数据 `g_rgAssets`，与 JSON 接口是两条不同链路）
- **页面数据直抓（重写 steam-inv 模式）**：INV_SCRIPT 改为在库存页内轮询（≤20s）读
  `g_rgAssets['730']` + `g_rgDescriptions['730']`，构造 assets/descriptions 数组 postMessage 回 RN →
  `engine.importSteamInventoryRaw` 改用 `parseWebApiInventory`（形状兼容且支持 cache_expiration
  保护期精算）→ planSteamSync 入库。**页面能看到 = 一定能抓到，不再依赖任何 JSON 接口**
- **诊断增强**：会话拉取为空/失败时显示 Steam 原始返回或页面状态片段 + 指引
  （填 Web API Key / 换 VPN 节点 / 浏览器开 inventory JSON 对照）
- **历史侧结论**：pricehistory 的 cookie/会话通道在该环境均不通；历史用「⚡ 快速补历史」
  （扫描通道实测可用）+ 详情页 Skinport 实际成交参考（免登录）兜底
- **修正**：首页标题「CS2 余额助手」→「宇额助手」（更名时漏改的页内文案）
- 验证：typecheck 零错误；verify:core 216/216 PASS
- **用户实测**：反复重新一键登录后 pricehistory 导入仍 0 成功 → 判定 cookie 从 WebView 搬到
  RN fetch 的链路对 pricehistory 不可靠 → 参照库存会话拉取的成功经验，把导入也搬进登录态页面
- **CookieLoginScreen 新增 `steam-hist` 模式**：WebView 打开 steamcommunity.com/market/（登录态），
  「开始导入」注入脚本：engine.listHistoryTargets(60)（价格点 <14 的名字优先）→ 页面内逐箱
  `fetch pricehistory`（1.6s 限速）→ postMessage 逐条回传 → `engine.importSteamPriceHistoryRaw`
  （parsePriceHistory + mergeSteamHistory）→ 完成后汇报 成功/失败 数；0 成功提示检查页面登录态
- 首页扫描卡下方新增「🔁 会话内导入历史（需 Steam 登录，一次 120 天，最可靠）」入口
  （App.tsx histPull overlay）；历史导入失败提示改为双路指引（快速补历史 / 会话导入）
- 涉及文件：`src/core/engine.ts`（listHistoryTargets / importSteamPriceHistoryRaw）/
  `src/api/client.ts` / `src/screens/CookieLoginScreen.tsx` / `src/screens/HomeScreen.tsx` / `App.tsx`
- 验证：typecheck 零错误；verify:core **211/211 PASS**

**v1.4.6-wip（续 3）—— Skinport 实际成交参考（免 Key 免登录稳定源）**：
- **定位**：官方没有带 Key 的价格历史接口（Valve 缺口）；Skinport 公开成交 API 是免 Key 免登录的
  官方级替代——真实买家成交（非挂牌）7/30/90/365 天聚合（min/avg/median/volume），一次请求可批量
- **`src/data/skinport.ts`**：fetchSkinportHistory（CNY，单次 ≤50 名）+ parseSkinportHistory
  （数组或 items 包装兼容）；engine.skinportStats（10 分钟内存缓存，失败返回 null）
- **详情页**「C5 买入时机参考」卡新增「实际成交」三行：近 7 天/30 天 均价+最低、90 天均价+成交量，
  用于对照 C5 挂牌价判断偏贵/便宜——**不依赖任何登录**
- verify_core 新增 skinport 5 项断言（独立编译）—— **216/216 PASS**
- 限速注意：Skinport 官方 8 次/5 分钟，故仅详情页按需请求 + 10 分钟缓存；勿做全池批量轮询

**v1.4.6-wip（续）—— 历史不足双方案落地**：
- **快速补历史（无 cookie 兜底）**：首页扫描卡下方「⚡ 快速补历史」→ `scanService.quickBackfill`
  连扫最多 4 轮（轮间 5s），collector 新增 `mode:'backfill'`（无视 15 分钟新鲜度，只采
  `getSteamPrices < 4` 点的箱子）；全部补齐提前结束；完成后汇报轮数与新采点数
- **预测门槛 4→3 点**：V3 minTrendPoints（TS 构造默认 + Python `min_trend_points` 默认同步改 3）；
  3 点即出低置信度预测（data_insufficient 解除，confidence 仍按 σ 与长度因子约束）。
  现有基线测试输入（5 点/1 点）路径不变，baseline.json 无需重生成
- 验证：typecheck 零错误；verify:core **211/211 PASS**；backend pytest 39 passed

**v1.4.6-wip（续）—— 库存同步合一 + 历史导入原因显形**：
- **库存同步收敛为单一入口**：库存页删掉三个并列按钮/ID 输入框，只留「⟳ 同步 Steam 库存」
  （`engine.syncSteamInventorySmart`）：自动识别登录 ID → 配了 Web API Key 走官方接口，
  否则社区接口（带登录 cookie）→ **结果为空时返回 empty 标记，UI 自动打开网页会话拉取**
  （交易保护箱兜底），全程无需用户选择方式
- **历史导入原因显形（修「一直显示 0」盲区）**：collector 捕获首条失败原因 `histFailReason`
  （如「Steam 历史接口需有效登录 cookie」），完成消息与首页错误提示直接展示；
  且首个失败即中断整段导入（同一原因重复失败无意义）；0 成功时首页提示两条路：
  重新一键登录，或点「⚡ 快速补历史」无登录兜底
- 验证：typecheck 零错误；verify:core **211/211 PASS**

**v1.4.4-wip（续 4）—— 预测 V3（对齐业界做法）+ C5 日内点**：
- **BaselinePredictorV3（TS+Python 逐位对齐，`baseline-momentum-v3`）**，修体检报告 #2/#3/#4：
  - 趋势：EW 加权对数回归（窗口 21 点、半衰期 7 点）替代 7 点简单回归（抗噪 + 快响应）
  - 波动率：EWMA（λ=0.94）替代全体简单标准差（对波动状态变化更敏感；分位带本就 σ√t 驱动，保留）
  - 漂移限幅数据驱动：min(2%, max(0.5%, 3×EWMAσ)) 替代固定 ±5%（箱子日波动常 <2%，旧限幅无效）
  - 量价确认连续化：1 + 0.15·tanh((ratio-1)/0.35) 夹 [0.85,1.15] 替代 ≥1.3/≤0.6 二值开关；
    置信度微调改为 ±3% 阈值触发
  - features 新增 trend_points / drift_clamp；V1/V2 保留兼容
  - 基线生成：`backend/scripts/gen_baseline_v3.py`（Python 计算 → baseline.json 的
    prediction_v3 / prediction_v3_event / prediction_v3_low；TS verify 与其逐位比对）
- **C5 日内点**：`storage.setC5Price` 现同时 `addC5Intraday`（c5_hist、真实时间戳、HISTORY_KEEP 上限）
  ——「较昨日」随扫描次数积累变成真实 24h 变化（修体检 #5）
- engine 预测器全局实例切到 V3（雷达/详情/首页全部生效）
- **分板块数据清除**：设置页「清除本地数据」改为弹窗勾选（价格快照 / 库存记录 / 订单流水，
  含各板块后果说明），`storage.clearAllData(parts)` 按需 multiRemove；设置与凭证始终保留；
  无勾选时确认按钮禁用。顺带修正页脚遗留的旧名称/旧版本号
- 验证：typecheck 零错误；verify:core **207/207 PASS**（V3 24 项 TS==Python 逐位）；
  backend pytest 39 passed
- **体检遗留（roadmap，见对话记录）**：回测指标（MAE/方向命中率，需真机历史积累）、
  雷达评分分位化（改 scoring 需同步 Python radar.py + 基线）、C5 vs Steam 价差领先滞后分析、
  多持有期预测（14/30 天）、价格预警、批量买入冲击模型
- **注意**：cookie 是 HttpOnly 的，网页 JS 读不到，必须走原生 CookieManager（已用该方案）
- **深色启动页**：原 splash 为 Expo 默认白底模板图（#FFFFFF），与深色主题反差造成「一闪而过」观感；
  已用 PIL 生成深色品牌启动图（#0B1220 背景 + 雷达同心圆 + 应用名），替换 android res 各密度
  splashscreen_logo.png + colors.xml splashscreen_background → #0B1220 + app.json 增加 splash 配置
  （assets/splash.png）；生成脚本已删，重生成参考 HANDOFF git 历史
- **扫描数量滑块**：设置页「采集数量」改名「扫描数量」，固定 12/20/50 改为 1-100 滑动条
  （@react-native-community/slider），拖动即时保存（onSlidingComplete updateSettings，不再依赖底部保存按钮）；
  设置变化通过 settingsEvents（storage 内 pub/sub）实时推给首页按钮上的数量显示
- **全局扫描进度（scanService）**：进度从页面状态上移到模块级单例（订阅制）+ AsyncStorage 持久化
  （@cs2balance/scan_state_v1）——切 Tab 返回首页进度照常显示；退后台进程存活时循环继续、回前台刷新；
  进程被杀后下次启动 restoreAndResume 自动续扫（30 分钟窗口内，配合 collector 15 分钟跳过只补缺失项）；
  首页卡片三态：扫描中 / 上次未完成点击继续 / 正常一键扫描（显示实时数量）
- 涉及文件：`src/screens/CookieLoginScreen.tsx`（新）/ `src/data/scanService.ts`（新）/
  `src/screens/SettingsScreen.tsx` / `src/screens/HomeScreen.tsx` / `App.tsx` / `src/data/storage.ts` /
  `package.json` / `app.json` / `android res`（splash 资源）
- 验证：typecheck 零错误；verify:core 154/154 PASS

**v1.3.1（2026-09-05）**：
- **预测/推荐引擎 V2（v1.3.1 工作区合入，随 v1.4.0 打包发布）**：
  - 预测 BaselinePredictorV2：7 点对数价格最小二乘回归趋势（<4 点退化为首末对数收益）、
    单日漂移限幅 ±5%、量价确认（最新量/历史均量 ≥1.3 → 漂移 ×1.15，≤0.6 → ×0.85）、
    历史 <4 点 → data_insufficient:true 且置信度封顶 0.25
  - 雷达：热门榜排名 ≤100 +3 分、≤30 再 +3；数据不足信号封顶 wait、评分封顶 40；
    quote() 与雷达页统一用 valuateRadar 口径
  - **修复**：引擎不再拼接 [c5Price, steamPrice] 假历史，只走真实 Steam 历史预测
  - 验证：TS==Python 双实现全对拍，98/98 PASS；pytest 34 passed
- 详情页新增「C5 卖出参考（求购价）」卡（`fetchC5StatsBulk` stat 接口，免 IP 白名单）
- 中文名未收录时回退显示英文原名；译名按 C5GAME 商品页对齐（热潮/伽玛/冬季攻势/军火交易/电竞系列）
- 实测 C5 购买/求购接口权限与余额现状（第 4 节）：接口存在，但需 IP 白名单 + 预充值 + 求购权限

- **预计几折成为首页第一指标**：`profit.expectedDiscount(c5BuyPrice, steamNetReceive)`；
  quote / radar / inventory 全部带 `expected_discount`，UI 统一 `fmtZhe()`（0.926 → "9.26 折"）
- **Steam 热门榜采集**：`steam.searchCases` 优先 `sort_column=popular` + 原始 query 字符串
  `category_730_Type[]=tag_CSGO_Type_WeaponCase`，失败回退成交量榜；热门排名落库
- **C5 真正批量 + 求购参考**：`c5.fetchC5PricesBulk` 每批 30 个 MarketHashName（配套端
  `POST https://openapi.c5game.com/merchant/product/price/batch?app-key=<key>`，
  body `{appId:"730", marketHashNames:[...]}`，价格单位元）；另接入 `fetchC5StatsBulk`
  （stat 接口），详情页「C5 卖出参考」展示求购最高价（可秒出），不计入成本
- **中文名称映射**：`src/data/cn_names.ts`（`displayName()`）；后台仍以 MarketHashName 关联，
  UI 统一显示中文（`utils/format.displayNameOf`）；译名以 C5GAME 商品页为准，
  未收录的箱子**回退显示英文原名**（不再显示「暂无中文名称」）
- **采集数量 Bug 修复**：设置选项 12 / 20 / 50，数量来自设置、collector 不再写死 10；
  进度显示「已采集 X / Y 个」
- **C5GAME 一键买入 = 购买保护核验 + 确认 + 本地记账**（`core/buy.ts` + `utils/buyFlow.ts`）：
  购买前显示买入价 / 预计几折 / 预计到手 / 投入 / 限制期 / 赚亏；
  保护项：最高买入价、最低目标折扣、单笔预算上限、异常价格二次确认；
  确认后写库存 + 订单。**未臆造任何未验证的下单接口**
- **市场页（新 Tab）**：按预计几折升序；全部 / 推荐购买 / 可以观察 / 暂时别买筛选；中英文搜索
- **首页极简重构**：状态 + 最后更新时间、最大字号「预计 X.X 折」、推荐卡片一键买入 / 查看详情、
  今日结论聚合、最划算 Top3、一键扫描
- **详情页重构**：预计几折 hero、价格流程 C5→7 天→Steam、7 天趋势（历史实柱 + 预测描边区）、
  折叠「详细数据」、底部固定一键买入
- **设置页**：购买保护项（最高买入价 / 最低目标折扣 / 单笔预算上限）+ 雷达目标折扣
- **术语规范（第 19 节）**：ROI→预计回报、波动率→价格稳定程度、Confidence→置信度等

## 3. 架构（mobile/ 为唯一运行主体）

```
mobile/
  src/core/       分析引擎（fees/profit/prediction/radar/simulation/buy/engine）—— 手机内本地运行
  src/data/       steam.ts 直连适配器、c5.ts（C5 OpenAPI，含批量）、storage.ts（AsyncStorage）、
                  collector.ts 一键采集编排、cn_names.ts 中文名映射
  src/api/        client.ts 对外 API（与旧后端形状一致；prepareBuy/executeBuy/markets/history/orders 新增）
  src/utils/      format.ts（fmtMoney/fmtZhe/displayNameOf/SIGNAL_TEXT）、buyFlow.ts（一键买入流程）
  src/screens/    首页/市场/详情/库存/雷达/我的/资金模拟
  scripts/        verify_core.cjs（131 项对拍）、verify_c5.cjs（C5 在线冒烟，需要 $env:C5_APP_KEY）
backend/          旧电脑后端（历史参考 + baseline.json 基准；运行不依赖它）
releases/         APK 产物（*.apk 被 gitignore，不入库）
docs/             Phase 0 调研报告
```

业务流：`collector.collectCases()` → Steam「热门物品→CS2 武器箱」拉候选（热门榜失败回退成交量榜）
→ C5 批量查买入价（配 key 时）→ 逐个 `priceoverview`（限速 1.8s + 失败重试一次）→
快照写 AsyncStorage → `core/engine.ts` 计算预计几折 / 收益 / 预测 / 雷达。

**方向语义（勿搞反）**：C5 买入价是**成本**（`c5_buy_price`，引擎中与 `c5_buy_fee_ratio=1%` 相乘），
Steam 卖出价是**收入**（到账比例 0.8696，即扣 13%）。单位统一为**元（CNY）**。
`expected_discount` = 总成本 / 预计净到手（小数，0.926 = 9.26 折，**越低越划算**）；
展示折数 = `discountNum * 10`。

## 4. 已验证的关键事实（改动前务必先读）

### C5GAME OpenAPI（opendoc.c5game.com / openapi.c5game.com）
- 鉴权：`app-key` 作 query 参数，无签名，默认限流 50 QPS；CSGO/CS2 appId = `730`
- **OpenAPI 无历史价格接口（2026-09-05 全目录枚举确认）**：36 个端点全是实时快照类。
  历史趋势只能走网页端 `GET www.c5game.com/trade-flex/order/price-trend/chart?itemId=&period=`
  （需 C5 网页登录 cookie；period 7/30/…，响应内嵌 dates/prices）
- **已接入**「MarketHashNames 批量查询在售最低价」：
  `POST https://openapi.c5game.com/merchant/product/price/batch?app-key=<key>`
  请求体 `{"appId":"730","marketHashNames":["M4A4 | Temukau (Minimal Wear)"]}`（`fetchC5PricesBulk` 每批 30）
  响应 `{success, data:{ "<MarketHashName>": {itemId, marketHashName, price(元), count, website} }, errorCode, errorMsg}`
- **已接入**「根据 hashName 批量查询统计信息」：
  `POST https://openapi.c5game.com/merchant/market/v2/item/stat/hash/name?app-key=<key>`
  响应 `{success, data:[{marketHashName, itemId, sellPrice, sellCount, purchaseMaxPrice, purchaseCount}]}`；
  `fetchC5StatsBulk` 返回 `{itemId, sellPrice, sellCount, purchaseMaxPrice, purchaseCount}`；
  详情页「C5 卖出参考（求购价）」展示求购最高价（可秒出参考价），**不计入成本**。
  实测**无需 IP 白名单**即可访问（与 products/search 不同）。
- **已实测但未接入**「求购最高价」：
  `GET https://openapi.c5game.com/merchant/purchase/v1/max-price?itemId=<itemId>&styleId=0&app-key=<key>`
  响应 `{success, data:{maxPrice:"372.0"(字符串，元)}}`；itemId 由批量接口返回
- **购买/下单实测结论（2026-09-05）**：
  - `POST /merchant/trade/v2/normal-buy`（普通购买）**接口存在**：缺参返回「参数错误」，
    要求 `productId` + `outTradeNo` 非空；填入虚假 productId 后返回「交易链接错误(trade Url format error)」
  - `POST /merchant/market/v2/products/search`（在售列表搜索）实测返回 errorCode **499103**
    「未设置ip白名单或ip不在白名单中」：需在 C5GAME 商户后台配置当前出口 IP 白名单后才能用
  - `POST /merchant/purchase/v1/create`（发起求购）实测返回 errorCode **830001**「您尚未开通求购权限，请联系客服」
  - `GET /merchant/account/v1/balance` 可访问：当前账户余额 **0.01 元**，无法真实购买；
    文档明确购买需**预充值**账户余额
  - **结论：一键买入保持「核验 + 确认 + 本地记账」，不自动下单**；用户开通权限 / 充值 /
    配置 IP 白名单后再评估接入真实下单
- **注意**：文档中的 `GET /price/info`（价格查询）实测返回 **404，已下线，勿用**
- 服务端要求 Accept-Encoding 头（curl 需 `--compressed`；RN fetch 自动处理）

### Steam Community Market（公共接口，无需密钥）
- `priceoverview`（当前价/成交量，currency=23 CNY）、`search/render`（按成交量 / 热门榜排序）
- **`search/render` 未登录（无 cookie）时单页最多返回约 10 条**（2026-09-05 实测：count=100 只回 10，
  榜单 total_count=458）；`steam.ts#searchPaged` 已按 start 翻页补齐，页间 1.2s 限速、最多 10 页、按名去重
- 热门榜 query 用**原始字符串**拼在 `steam.ts searchPopular()`（`category_730_Type[]=...` 中括号
  会被 URLSearchParams 转义，勿改回 URLSearchParams）
- **本机访问不稳定**：曾 20s 超时。采集失败/超时 ≠ 代码错误，先重试
- **Steam 库存冷却同步（2026-09-05 新增）**：`inventory/{steamid}/730/2?l=schinese&count=2000` 无需 key；
  需公开库存或登录 cookie（403/401 有中文提示）；`market_tradable_restriction` 只给**剩余整数天**，
  小时级精度由引擎用「本次观察时刻 + 剩余整天」上界 + 历史 min 单调逼近；同类多把数量累加、冷却取最短；
  已解锁记录「观察到」时刻（误差 ≤ 两次同步间隔）
- 文档缓存：`%TEMP%\c5doc.html`、`c5_price.html`、`c5_batch.html`、`c5_maxprice.html`（可离线解析）

## 5. 构建 / 验证命令（Windows PowerShell，环境变量每条命令都要重新设置）

```powershell
cd D:\Codex\cs2-balance-mobile\mobile
npm run typecheck        # TS 零错误
npm run verify:core      # 引擎交叉验证 240/240 PASS（TS==Python 全对拍 + Web API 库存解析）
$env:C5_APP_KEY='<用户的key>'; npm run verify:c5   # C5 在线冒烟（可选，key 找用户要，勿入库）

# 打包（android/ 被 gitignore，需手动改版本）
# 版本升级：mobile\package.json + mobile\app.json 的 version；mobile\android\app\build.gradle
#   versionCode +1（当前 24 / v1.5.8）、versionName "1.5.8" → 下一版（预计 v1.5.9 / versionCode 25）
# 注意：App 内设置页页脚版本号改自 app.json（expo.version → 打包进 assets/app.config，SettingsScreen 用 Constants.expoConfig.version 动态读取），无需再改 JS；发版只需同步以上三处
cd D:\Codex\cs2-balance-mobile\mobile\android
$env:JAVA_HOME="D:\dev\jdk17-fresh\jdk-17.0.2"; $env:ANDROID_HOME="D:\Android\Sdk"  # 勿用 D:\dev\jdk17\jdk-17.0.20.1+1（jvm.cfg 损坏）
& "D:\dev\gradle-9.3.1\gradle-9.3.1\bin\gradle.bat" assembleRelease --no-daemon
# 产物 mobile\android\app\build\outputs\apk\release\app-release.apk
# 归档（删除文件一律 python pathlib，禁 Remove-Item -Recurse）：
#   python -c "from pathlib import Path; import shutil; shutil.copy2(...); ..."
```

**踩坑**：gradle wrapper 的 distributionUrl 指向 services.gradle.org，本机**下载超时**，
必须用 `D:\dev\gradle-9.3.1\gradle-9.3.1\bin\gradle.bat`；PowerShell 无 heredoc（用 here-string 写文件）；
`${...}` 会在双引号字符串里展开（模板字符串用单引号 here-string 或 Python 写）；
改 .ts/.tsx 文件前先 `replace('\r\n','\n')` 再定位锚点，写回统一 `newline='\n'` + UTF-8。

## 6. 已知限制与风险

- C5 价格为「在售最低价」，非实时成交价；采集是快照，价格可能波动
- Steam 网络在本机不稳定，App 内已做一次重试 + 2s 退避
- app-key 为**用户个人凭证**：只存 AsyncStorage / `$env:C5_APP_KEY`，**绝不写进代码/README/仓库/日志**
- 一键买入目前是**本地记账**（写库存 + 订单流水），不自动下单；待官方开放确认可用的下单接口后再接
- Hermes 引擎：勿用 `Array.prototype.at` 等新 API；TS 目标 es2020
- 中文名已根治：采集自动带 `l=schinese` 抓官方中文名入缓存（`zhNames.ts`），UI 三级回退：手工映射 → 官方缓存 → 英文原名；新箱子仍可在 `cn_names.ts` 补充 C5GAME 译名
- Steam 库存冷却同步依赖用户 SteamID64 与**公开库存 / 登录 cookie**；非公开库存会提示错误；小时级精度依赖多次同步收敛（min 逼近），单次同步只有整天粒度

## 7. 建议改进路线（按优先级，供下一位接手者挑选）

1. **~~max-price 求购最高价接入~~ → 已完成（v1.3.1）**：详情页「C5 卖出参考」展示求购最高价
   （`fetchC5StatsBulk`，stat 接口）；后续可做「采集时自动批量查询求购价并入库」
2. **采集频率调度**：默认每 30 分钟自动采集（当前仅手动一键扫描），可配置
3. **自采集提醒**：限制期结束本地通知（需 expo-notifications，注意权限与国内厂商后台限制；冷却已精确到小时，可直接用 `steam_unlock_est_at` 触发）
4. **智能拆单**：预算较大时按风险/数量限制分散到多个箱子（HANDOFF v2 第 9 节）
5. **~~市场事件数据库~~ → 部分完成（v1.4.0 工作区）**：Steam 2026 大促日历内置 `STEAM_SALE_EVENTS_2026`，
   预测器 V3 对 targetAt 做窗口压制 + 结束后线性回补；后续可接动态事件源：CS2 更新 / Major / 新箱 / 移箱 / Valve 政策
6. **模型增强 + 回测**：V2 已完成回归趋势 + 量价确认 + 数据不足保护（baseline-momentum-v2），V3 已加事件窗口价差修正（大促压制 + 回补，v1.4.0 工作区）；
   下一档：波动率自适应、动态事件源（Major/新箱/移箱/Valve 政策）、真实回测指标 MAE/RMSE/方向准确率/盈利命中率/平均实际折扣（第 24 节）
7. **离线测试**：verify:c5 目前依赖网络；可加 mock 响应离线用例，保证 CI 可跑
8. **分发体验**：接入 EAS 或提供 debug 包；或做 Google Play/国内应用市场合规上架评估
9. **库存同步增强**：`syncSteamInventory` 目前手动触发；可定时自动同步 + 解锁时刻到点自动刷新（通知/徽标），并提示「Steam 有但本地没有」的新箱子
10. **中文名覆盖度**：`zhNames.ts` 已一次采集覆盖全部箱子；新箱出现后可自动抓官方中文名入库，避免依赖手工 `cn_names.ts`

## 8. 接手后的标准动作

1. `git status` 确认干净；`git log --oneline -5` 看历史
2. `npm run typecheck && npm run verify:core` 确认基线绿
3. 改动后必须重跑上述验证；涉及 C5 改动时用真实 key 跑 `verify:c5`；涉及引擎/库存冷却逻辑请在 `verify_core.cjs` 补 TS==Python 对拍或逻辑断言
4. 用户相关 App 升级时：版本号三处（package.json / app.json / build.gradle）同步 +1（当前 v1.5.9 / versionCode 25 → 下一版 v1.5.10 / 26），重打包，
   **注意 app.json 的 version 曾漏更到 1.4.2（v1.4.5 已修正），每次务必三处都核对**；设置页页脚版本号已自动跟随 app.json（Constants.expoConfig.version），**不再有硬编码版本号，勿手动改**，
   **勿用 `gradle clean`**（会波及 node_modules\expo-*\android\build 缓存，导致 expo-log-box/expo-modules-core 等报 MD5 缺失或文件被占用；遇到时重跑 assembleRelease 即可自愈，必要时删对应 node_modules\<包>\android\build 再构建），平时直接 assembleRelease 即增量构建，
   归档到 `releases\`（保留历史版本），并**每次新版本必须同步桌面副本**：复制最新 APK 到 `C:\Users\Administrator\Desktop\`（如 `宇额助手-vX.Y.Z.apk`），删除桌面上的旧版 APK，桌面只留最新（全部用 python pathlib 操作，勿用 Remove-Item -Recurse）
   **每次新版本发布后（APK 构建完成并验证 versionCode/versionName/label 后）必须回写本 HANDOFF**：更新第 1 节「当前状态」的 最新版本 / 安装包 / 已验证 / 工作区新增 + 本「标准动作」的版本号基线（当前 v1.5.9 / 25 → 下一版 v1.5.10 / 26）及对应专项说明，保证接手者读到的永远是当前版本状态——只改代码不发版记录视为未完成发布
