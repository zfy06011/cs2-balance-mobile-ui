# 竞品研究报告 —— CS2 倒余额/挂刀/饰品套利开源项目全景分析

> **本文件是工作区竞品研究文档**，与 `docs/HANDOFF.md`（项目交接文档）配合使用。
> 覆盖 GitHub 上 18 个相关开源项目的深度代码分析，按宇额助手的每个功能板块和每条数据通道逐项映射可借鉴做法。
> **写给接手改进的 AI / 开发者**：改动代码前先完整读一遍；所有对外解释必须简体中文。
> **研究日期**：2026-09-07 **项目版本基线**：宇额助手 v1.5.10（versionCode 26）

---

## 0. 研究范围与方法

从 GitHub 搜索「倒余额」「挂刀」「CS2 套利」「CS2 价格监控」「steam balance」「csgo arbitrage」等关键词，共检索到 18 个公开项目，逐一阅读核心源码（Python/JS/TS/C#/Kotlin），提取可借鉴做法。

**筛选标准**：有实质代码实现（非空壳）、功能与宇额助手相关、有可移植的技术方案。

**最终筛选出 8 个有实质借鉴价值的项目**：

| 项目 | ⭐ | 语言 | 最后更新 | 核心价值 |
|---|---|---|---|---|
| **VexedWilosn/AetherSwap** | 652 | Python | 2026-09-05 | Steam SSR 解析/选品模型/限速容错/代理池/策略引擎 |
| **EricZhu-42/SteamTradingSiteTracker** | 2325 | Python | 2024-09-04 | 多平台挂刀比例聚合/4进程并行架构 |
| **hitazuki/steam-skin-ops** | 1 | Python | 2026-07-28 | Theil-Sen 鲁棒预测/多模型选择/盈亏计算器/监控规则 |
| **ArseniHv/cs2-market-bot** | 0 | Python | 2026-03-23 | Skinport 全量价格/Prophet ML 预测/InfluxDB 存储 |
| **Pgooone/cs-monitor** | 8 | Python | 2026-04-30 | SteamDT 批量 API/极致追踪/波动分析/告警 |
| **Croutl/cs2-valueyes** | 3 | Python | 2026-06-18 | CSQAQ API/4 维估值模型/开箱回报率 |
| **haoran444/Starbucks** | 3 | Python | 2026-05-10 | CSQAQ 批量查询/全局限速锁/比例计算 |
| **Leonardo-DaVinci-80/QuantStrike** | 1 | Python | 2026-08-23 | MA30/MA90/最大回撤/量化指标管线 |

其余 10 个项目（caseflip、cabbage、steam-hangdao-calc、CS2TradeMonitor、CS_MONITOR、steam_market_reminder、steam_trading_notice、steam-balance-ratio-userscript、SteamBalanceRecommendBot、steam-market-tracker）功能较简单或与上述项目重叠，不单独展开。

---

## 1. 按宇额助手板块逐项分析

### 1.1 📡 一键扫描（Steam 实时卖价 + C5 买价采集）

#### 1.1.1 Steam 实时卖价采集

**宇额助手现状**：`priceoverview/?appid=730&currency=23` 逐个请求，间隔 1.8 秒，100 箱需 180 秒。未登录 `search/render` 单页约 10 条靠翻页。

**竞品做法**：

| 做法 | 来源 | 详情 |
|---|---|---|
| **SSR 页面解析替代 priceoverview** | AetherSwap | 请求 listing 页 HTML，从 `window.SSR.renderContext` 提取嵌入数据，一次请求同时拿到当前卖价 + 订单簿 + 全量历史。三级瀑布：SSR → Action Orderbook API → Histogram API |
| **Skinport 一次请求拿全量价格** | cs2-market-bot | `api.skinport.com/v1/items?app_id=730&currency=CNY&tradable=0`，无需 API key，返回 median/min/max/suggested price + volume，限速 8 次/5 分钟 |
| **SteamDT 批量查询** | cs-monitor | `POST /open/cs2/v1/price/batch`，一次最多 100 个名称，60 秒间隔，需 API key，含 7 天均价/K 线/统计 |
| **CSQAQ 批量查询** | Starbucks | `POST /api/v1/goods/getPriceByMarketHashName`，每次最多 50 条，全局限速锁 1.2 秒 |
| **并发采集** | AetherSwap | `ThreadPoolExecutor(max_workers=4)`，每线程独立 Session |
| **进程级共享冷却** | AetherSwap | `MarketCooldown` 类，429 时设置 endpoint 冷却，所有任务共享，不阻塞线程 |
| **成功/失败分层缓存** | AetherSwap | 成功 300 秒 / 失败 30 秒，LRU 淘汰，最大 200 条 |
| **熔断器** | AetherSwap | 连续 5 次失败 → 300 秒冷却 |
| **代理池（加权随机）** | AetherSwap | `score = max(1, 100000 - latency_ms)`，预热测速，三种策略：本机优先/全走代理/关代理 |

**可借鉴落地方案**：

- 主数据源改为 SSR 页面解析（从 listing 页一次拿卖价+订单簿+历史，省掉 priceoverview 请求）
- 辅助数据源引入 Skinport 全量拉取（1 请求替代 100 次 priceoverview）
- 并发 3 路，正常间隔 0.8 秒（等效 0.27 秒/箱），429 全局共享冷却
- 降级瀑布：SSR → Skinport → priceoverview → 跳过标记

#### 1.1.2 C5 实时买价采集

**宇额助手现状**：`POST /merchant/product/price/batch?app-key=`，每批 30 个，Body `{"appId":"730","marketHashNames":[...]}`。返回 `{itemId, marketHashName, price(元), count, website}`。

**竞品做法**：

| 做法 | 来源 | 详情 |
|---|---|---|
| C5 仅用于买价，不用于卖价 | 全部项目 | 所有项目都把 C5 当作成本侧数据源，卖价走 Steam |
| C5 itemId 查询 | AetherSwap | 用于后续趋势图接口调用 |
| C5 求购价参考 | AetherSwap | `stat` 接口获取 `purchaseMaxPrice`，用于定价参考 |

**可借鉴落地方案**：

- C5 批量买价保持现有逻辑（已是最优方案）
- 可考虑将每批 30 放宽到 50（需实测 C5 限流）
- C5 `stat` 接口的 `purchaseMaxPrice`（求购最高价）已在详情页展示，保持不变

#### 1.1.3 搜索/热门榜

**宇额助手现状**：`search/render/?sort_column=popular&l=schinese`，未登录单页约 10 条靠翻页（`searchPaged`），填 Steam cookie 可单页 100。

**竞品做法**：

| 做法 | 来源 | 详情 |
|---|---|---|
| 从 Buff 获取全量饰品列表 | SteamTradingSiteTracker | `/api/market/goods` 分页，page_size=80，获取所有饰品元数据 |
| 从 SteamDT 获取全量饰品索引 | cs-monitor | `GET /open/cs2/v1/base`，每天 1 次 |
| 热门箱候选来源 | AetherSwap | SteamDT 行情接口取前 N 条 |

**可借鉴落地方案**：

- 现有 search/render 翻页机制已够用
- 可选：引入 SteamDT `/open/cs2/v1/base` 作为全量箱索引补充（每天刷新一次）

---

### 1.2 📊 市场行情（列表/详情页展示）

**宇额助手现状**：每箱最新 Steam 价 / C5 买入价 / 预计几折 / 近 7 天与 90 天走势图。

**竞品做法**：

| 做法 | 来源 | 落地方案 |
|---|---|---|
| **趋势状态标签**（STABLE/RISING/FALLING/CHAOS） | AetherSwap | 基于 R² 拟合度 + 斜率方向，详情页新增「趋势状态」行 |
| **价格分位指标** | AetherSwap | 当前价在 365 天/14 天区间的位置（0-100%），越低越便宜 |
| **布林带（BB）** | AetherSwap | MA30 ± 2σ 上下轨，突破上轨标注「偏高」，跌破下轨标注「偏低」 |
| **EMA7/EMA30 均线** | AetherSwap | 7 日/30 日 EMA 线，金叉/死叉标注 |
| **MA30/MA90 移动均线** | QuantStrike | 可切换 7/30/90 天走势图视图 |
| **最大回撤 (Max Drawdown)** | QuantStrike | `(peak - trough) / peak`，近 90 天，量化持有风险 |
| **VWAP（成交量加权均价）** | AetherSwap | 近 30 天 VWAP，比简单均价更反映真实成交 |
| **多平台价格对比** | cs2-valueyes / SteamTradingSiteTracker | 详情页展示 C5 买价 + Steam 卖价 + Skinport 成交价 + 求购价 |
| **挂刀比例排行** | SteamTradingSiteTracker | 独立页面：C5 买入 ÷ Steam 净到手折扣比例排序 |
| **订单簿深度** | AetherSwap | SSR 解析同时拿到买单/卖单数量和最优价格 |
| **2 小时网格规范化** | steam-skin-ops | 将稀疏快照统一到固定时间格，走势图更平滑 |
| **K 线数据** | cs-monitor | SteamDT K 线接口，可做蜡烛图 |

**可借鉴落地方案**：

- 详情页新增趋势状态行 + 价格分位 + BB/EMA 图层 + 最大回撤 + VWAP + 订单簿
- 走势图可切换 7/30/90 天
- 首页新增折扣排行标签页

---

### 1.3 🎯 雷达信号（预测模型 + 评分）

**宇额助手现状**：V3 预测器——21 天 EW 加权对数回归 + EWMA 波动率(λ=0.94) + 量价连续确认 + 事件窗口修正。雷达评分——ROI/流动性/波动率/热门排名/事件修正。

**竞品做法——预测模型**：

| 做法 | 来源 | 详情 |
|---|---|---|
| **Theil-Sen 鲁棒回归** | steam-skin-ops | 所有点对斜率的中位数，对异常值（大促波动）完全免疫，比 OLS 稳健得多 |
| **多模型选择 + 交叉验证** | steam-skin-ops | 4 候选：persistence / recent_level / theil_sen_linear / theil_sen_log，回测 MAE 选最优 |
| **Kendall tau 秩相关** | steam-skin-ops | 趋势一致性 ∈ [-1,1]，>0.3 = 上涨一致性强 |
| **Prophet ML 预测** | cs2-market-bot | Facebook Prophet，每日+每年季节性，最少 30 点，7 天预测 80% 置信区间 |
| **均值回归** | 新设计 | `drift_meanrev = −κ·log(price/SMA365)`，长周期修正 |
| **长周期分位** | AetherSwap | 当前价在 365 天分位 > 0.8 → 降漂移、降置信 |
| **季节性因子** | cs2-market-bot / 新设计 | 去年同期同月历史收益均值 |

**竞品做法——雷达评分**：

| 做法 | 来源 | 详情 |
|---|---|---|
| **CV 稳定性过滤** | AetherSwap | 变异系数 < 动态阈值（低价品 0.08、高价品 0.04）才给 buy |
| **R² 趋势拟合度** | AetherSwap | R² > 0.6 趋势可信，< 0.3 走势紊乱扣分 |
| **价格历史分位** | AetherSwap | 365 天分位 > 0.8 → 降为 wait/avoid |
| **近 14 天短期分位** | AetherSwap | 短期高位追涨扣分 |
| **EMA7 突破布林带** | AetherSwap | EMA7 > BB 上轨 → 标记暴涨风险 → 降为 wait |
| **Kendall tau 趋势一致性** | steam-skin-ops | 正值加分、负值扣分 |
| **市场状态分类** | AetherSwap | STABLE/RISING/FALLING/CHAOS，CHAOS 信号封顶 wait |
| **风险等级** | steam-skin-ops | volatility × 100 + eventRisk × 3 + liquidity，low/medium/high |
| **7 天 P25 统计** | steam-skin-ops | `t7_stats` 函数，至少 12 样本且跨度 ≥ 3 天 |
| **监控规则引擎** | steam-skin-ops | 4 种规则：ratio/t7/platform/steam，可配置阈值 |

**可借鉴落地方案**：

- V4 预测器新增：Theil-Sen 鲁棒回归 + 价格分位(365d/14d) + 均值回归 + 波动比(30d/365d) + 季节性因子
- 雷达新增维度：CV 稳定性 / R² 拟合度 / 价格分位 / BB 突破 / 趋势一致性
- Python 逐位镜像 + baseline.json 重生成 + verify_core 扩展

---

### 1.4 📦 库存同步（C5 OpenAPI 唯一通道）

**宇额助手现状**：`GET openapi.c5game.com/merchant/inventory/v2/{steamId}/730`，自动分页（最多 20 页），status=4 保护期物品可见。双键匹配（英文 MarketHashName + C5 中文名），冷却估算（min 逼近）。

**竞品做法**：

| 做法 | 来源 | 详情 |
|---|---|---|
| **Steam 库存并行拉 context 2+16** | AetherSwap | `ThreadPoolExecutor(max_workers=2)`，两个 context 同时拉 |
| **库存分页 + 429 退避** | AetherSwap | 每页间隔 1 秒，429 时指数退避 10×2^(attempt-1) 秒 |
| **403 = Cookie 过期** | AetherSwap | 判定为 `SteamAuthExpired` |
| **盈亏统计** | steam-skin-ops | 总投入/总市值/总浮盈浮亏/综合倒余额比例/最佳最差持仓/平均持仓天数 |
| **单笔盈亏** | steam-skin-ops | 买入价 vs 当前 Steam 价 → 盈亏金额 + 百分比 |
| **持仓风险等级** | steam-skin-ops | 基于历史波动率 🟢低/🟡中/🔴高 |
| **按游戏/箱子分类** | steam-skin-ops | 各箱子类型汇总：最赚钱/最亏损 |
| **库存估值总览** | cs2-valueyes | 总估值 = 最新价格 × 数量求和 |

**可借鉴落地方案**：

- C5 库存同步通道保持不变（已是最优方案）
- 库存页新增：顶部汇总卡片（总成本/总市值/总盈亏）+ 每行盈亏标注 + 风险等级标签
- 持仓天数统计（从 buy_at 到当前日期）

---

### 1.5 🔁 快速导入历史（Steam 历史 + C5 历史）

#### 1.5.1 Steam 历史数据

**宇额助手现状**：云端优先——`GET {workerUrl}/history?name=..&days=120`（Cloudflare Worker + D1，零 cookie），失败回退 C5 官方趋势（需登录态）。gid 页 SSR 零 cookie 全量历史（2013 至今）。

**竞品做法**：

| 做法 | 来源 | 详情 |
|---|---|---|
| **pricehistory API（需登录）** | AetherSwap / cs2-market-bot | `steamcommunity.com/market/pricehistory/`，返回完整 JSON，cs2-market-bot 用本地文件缓存避免重复请求 |
| **SSR 页面解析（零 cookie）** | AetherSwap | listing 页 SSR 提取 pricehistory，与宇额助手 cloud/ 的 gid 页解析法本质相同 |
| **本地文件缓存** | cs2-market-bot | `data/cache/{safe_name}.json`，已导入的历史不再重复请求 |
| **2 小时网格规范化** | steam-skin-ops | 将稀疏的历史+实时混合数据统一到 2h 格，提升回归质量 |
| **每日价格中位数** | steam-skin-ops | 同一天多个观测取中位数，减少噪声 |
| **IQR 数据清洗** | AetherSwap | 四分位距法剔除异常价格点后再做分析 |
| **断点续传** | AetherSwap | checkpoint JSON 持久化导入进度 |

#### 1.5.2 C5 历史数据

**宇额助手现状**：`GET www.c5game.com/trade-flex/order/price-trend/chart?itemId=..&period=90`，必须 C5 登录 cookie，最多 90 天。

**竞品做法**：

| 做法 | 来源 | 详情 |
|---|---|---|
| C5 历史仅作回退 | 宇额助手唯一做法 | 其他项目均不使用 C5 历史（C5 无 OpenAPI 历史端点，网页趋势必须登录是官方设定） |
| 用 Steam 历史替代 | AetherSwap / cs2-market-bot | 买价（C5）实时快照即可，卖价历史（Steam）才是预测核心输入 |
| 多源价格历史 | steam-skin-ops | 同时跟踪 BUFF/C5/IGXE/UUYP/ECO/Steam 六平台价格变化 |

**可借鉴落地方案**：

- Steam 历史：SSR 解析已包含全量历史，扫描时自动入库，减少单独导入步骤
- C5 历史：保持现有回退通道，period 从 90 改为 730（C5 支持更大 period）
- 新增 IQR 数据清洗：入库前剔除异常价格点
- 新增断点续传：导入进度持久化

---

### 1.6 💰 买入记账

**宇额助手现状**：本地记账（核验预算/限制期/二次确认），生成订单流水；C5 下单接口实测未开放。

**竞品做法**：

| 做法 | 来源 | 详情 |
|---|---|---|
| **买卖自动配对** | steam-skin-ops | `TransactionMatcher` 自动将卖出与买入配对，计算单笔净利润 |
| **单笔盈亏** | steam-skin-ops | `profit_cny = sell_price - buy_price`，`balance_ratio = buy/sell × 100%` |
| **汇总统计** | steam-skin-ops | 总投入/总收益/综合倒余额比例/最佳最差持仓/平均持仓天数 |
| **按箱子分类** | steam-skin-ops | 各箱子类型汇总：最赚钱/最亏损的排行 |
| **完整进销存** | AetherSwap | 永久记录每笔交易的成本、售价、余额和综合折扣率 |
| **自动下单（Buff）** | AetherSwap | 从选品到下单全自动（但宇额助手 C5 下单接口未开放，保持本地记账） |

**可借鉴落地方案**：

- 新增「交易记录」页：自动将库存卖出与历史买入配对
- 每笔交易：买入价、卖出价、净利润、持仓天数、倒余额比例
- 按箱子类型汇总排行
- 累计统计：总投入、总收益、平均倒余额比例、平均持仓天数

---

### 1.7 🧮 模拟器

**宇额助手现状**：按预算与分配策略模拟买入组合收益/风险；反向模拟（目标收益推预算）。

**竞品做法**：

| 做法 | 来源 | 详情 |
|---|---|---|
| **稳定性评分影响分配** | AetherSwap | CV/R² 高稳定性箱优先分配预算，不稳定箱标记风险 |
| **预期最大回撤** | QuantStrike | `(peak - trough) / peak`，基于历史回撤分析 |
| **风险调整收益率** | QuantStrike | Sharpe-like：预期收益 / 波动率 |
| **预期持仓天数** | steam-skin-ops | 保护期 + 不稳定因子修正天数 |
| **dry-run 模拟** | AetherSwap | 策略引擎支持模拟运行，不实际下单 |
| **预期倒余额比例** | Starbucks | `calc_ratio = buy_price / (steam_price × 0.85)` |

**可借鉴落地方案**：

- 模拟器引入 CV/R² 稳定性评分：高稳定性箱优先分配预算
- 输出新增：组合预期最大回撤 + 风险调整收益率 + 组合稳定性评分
- 预期持仓天数估算（7 天保护期 + CV 修正）

---

### 1.8 🔐 一键登录

**宇额助手现状**：WebView 登录 Steam / C5GAME，自动抓 cookie。Steam 登录用于自动识别本人 SteamID64 与搜索榜提额。C5 登录用于历史趋势回退通道。

**竞品做法**：

| 做法 | 来源 | 详情 |
|---|---|---|
| **内嵌 Steam 登录** | AetherSwap | Playwright 浏览器自动化登录 |
| **手动 Cookie 输入** | AetherSwap | 支持两种方式：自动登录或手动粘贴 |
| **Steam 令牌自动确认** | AetherSwap | 内置 identity_secret + 自动签名确认上架 |
| **C5 Cookie 管理** | 宇额助手 | 其他项目均不使用 C5（C5 不如 BUFF 流行） |

**可借鉴落地方案**：

- 现有 WebView 登录保持不变
- 可选增强：支持手动粘贴 cookie（WebView 登录失败时的回退）
- 可选增强：Steam 令牌自动确认（需 identity_secret，隐私敏感）

---

### 1.9 📦 存储架构

**宇额助手现状**：6 个 AsyncStorage 键，`@cs2balance/snapshots_v2` 是单个 JSON 大数组（全量读-改-写模式），HISTORY_KEEP=730 时 100 箱约 8-10 MB，超过 Android CursorWindow ~2MB 限制。

**竞品做法**：

| 做法 | 来源 | 详情 |
|---|---|---|
| **MongoDB** | SteamTradingSiteTracker | `meta`（14 天过期）+ `data`（价格数据）两个集合 |
| **SQLite（SQLModel ORM）** | AetherSwap | FastAPI + SQLModel，结构化存储 |
| **InfluxDB（时序数据库）** | cs2-market-bot | 专为时间序列优化，适合价格历史 |
| **本地文件缓存** | cs2-market-bot | `data/cache/{safe_name}.json` |
| **AsyncStorage** | 宇额助手 | 单 key 全量 JSON，有 CursorWindow 风险 |
| **内存 LRU 缓存** | AetherSwap | 成功 300s / 失败 30s，最大 200 条 |

**可借鉴落地方案**：

- 近期：按箱分键存储（`@cs2balance/snap/{encodedName}`），每箱独立读写，单箱 ~86 KB
- 迁移逻辑：首次启动检测旧键 → 逐箱拆分写入新键 → 删除旧键
- 中期：引入 SQLite 替代 AsyncStorage，走索引查询而非全量 filter
- 请求级缓存：内存 LRU（成功 300s / 失败 30s）

---

## 2. 按数据通道逐项分析

### 2.1 Steam 卖价（实时）

| 通道 | 端点 | 认证 | 竞品使用情况 | 宇额助手现状 |
|---|---|---|---|---|
| SSR 页面解析 | GET listings/730/{name} | 零 cookie | **AetherSwap 主通道** | cloud/ 有解析，App 未用 |
| priceoverview | GET priceoverview/?currency=23 | 零 | 所有项目兜底 | **主通道** |
| orderbook API | GET market/orderbook | 零 | AetherSwap 第二级 | 未用 |
| histogram API | GET itemordershistogram | 需 item_nameid | AetherSwap 第三级 / SteamTradingSiteTracker | 未用 |
| Skinport 全量 | GET skinport.com/v1/items | 免 key | **cs2-market-bot 主通道** | 已有接入（仅详情页参考） |
| SteamDT 批量 | POST open.steamdt.com/.../batch | 需 key | **cs-monitor 主通道** | 未用 |
| CSQAQ 批量 | POST csqaq.com/.../getPriceByMarketHashName | 需 key | Starbucks | 未用 |

### 2.2 C5 买价（实时）

| 通道 | 端点 | 认证 | 竞品使用情况 | 宇额助手现状 |
|---|---|---|---|---|
| 批量最低价 | POST /merchant/product/price/batch | app-key | 宇额助手独有 | **主通道**（每批 30） |
| 统计/求购价 | POST /merchant/market/v2/item/stat/hash/name | app-key | 宇额助手独有 | 详情页展示 |
| 在售搜索 | GET /merchant/market/v2/products/search | app-key + IP 白名单 | 未接入 | 实测需 IP 白名单 |
| 求购最高价 | GET /merchant/purchase/v1/max-price | app-key | 未接入 | 实测可用 |
| 账户余额 | GET /merchant/account/v1/balance | app-key | 未接入 | 实测可用 |

> **C5 独占优势**：其他项目主要用 BUFF 作为买价源，C5 OpenAPI 的批量查询和库存（status=4 可见保护期物品）是宇额助手的核心差异化。

### 2.3 Steam 历史（价格历史）

| 通道 | 端点 | 认证 | 竞品使用情况 | 宇额助手现状 |
|---|---|---|---|---|
| gid 页 SSR | GET listings/730/{name} → SSR 解析 | 零 cookie | **AetherSwap**（同一页面解析） | **云端主通道**（cloud/ Worker） |
| pricehistory API | GET market/pricehistory/ | 需 cookie | **AetherSwap / cs2-market-bot** | 云端不可用（未登录 400） |
| 列表页 var line1 | 旧版页面内嵌 | 零 cookie | AetherSwap 未用 | cloud/ 已实现（兜底） |
| C5 官方趋势 | GET /trade-flex/order/price-trend/chart | 需 C5 cookie | 仅宇额助手 | **回退通道** |
| Skinport 历史 | GET skinport.com/v1/items | 免 key | cs2-market-bot | 已有接入 |

### 2.4 C5 历史

| 通道 | 端点 | 认证 | 竞品使用情况 | 宇额助手现状 |
|---|---|---|---|---|
| 网页趋势图 | GET c5game.com/trade-flex/order/price-trend/chart | 需 C5 cookie | 仅宇额助手 | **唯一通道**（OpenAPI 无历史端点，实测确认） |
| OpenAPI 历史 | 不存在 | — | — | 已确认 36 个端点均为实时快照类 |

> **C5 历史无法零 cookie 获取**，这是官方设定。其他项目不依赖 C5 历史（它们的预测模型主要消费 Steam 历史）。

### 2.5 Steam 搜索/热门榜

| 通道 | 端点 | 认证 | 竞品使用情况 | 宇额助手现状 |
|---|---|---|---|---|
| search/render | GET market/search/render/ | 零（未登录单页 10 条） | AetherSwap | **主通道**（searchPaged 翻页） |
| Buff 全量列表 | GET buff.com/api/market/goods | Cookie | SteamTradingSiteTracker | 未用 |
| SteamDT 全量索引 | GET open.steamdt.com/.../base | 需 key | cs-monitor | 未用 |

### 2.6 Steam 库存

| 通道 | 端点 | 认证 | 竞品使用情况 | 宇额助手现状 |
|---|---|---|---|---|
| inventory context 2 | GET inventory/{id}/730/2 | 需公开库存或 cookie | AetherSwap（并行拉 2+16） | 已于 v1.5.9 移除（不返回保护期物品） |
| inventory context 16 | GET inventory/{id}/730/16 | 同上 | AetherSwap | 已于 v1.5.9 移除 |
| C5 库存 | GET /merchant/inventory/v2/{steamId}/730 | app-key | 仅宇额助手 | **唯一通道**（status=4 可见保护期） |

### 2.7 云端历史缓存

| 通道 | 端点 | 认证 | 竞品使用情况 | 宇额助手现状 |
|---|---|---|---|---|
| Cloudflare Worker | GET {workerUrl}/history?name=..&days=120 | 零 | 仅宇额助手 | **主通道**（v1.5.10） |
| /items | GET {workerUrl}/items?limit=100 | 零 | 仅宇额助手 | 已收录清单 |
| /ingest | POST {workerUrl}/ingest | 可选 token | 仅宇额助手 | 本机采集器兜底写入 |
| /health | GET {workerUrl}/health | 零 | 仅宇额助手 | 健康检查 |

---

## 3. 横向最佳实践汇总表

### 3.1 限速与容错

| 做法 | 来源 | 说明 |
|---|---|---|
| 进程级共享冷却（MarketCooldown） | AetherSwap | 429 时设置 endpoint 冷却，所有任务共享 |
| 429 读 Retry-After 自适应退避 | AetherSwap / cs-monitor | 不浪费固定间隔 |
| 熔断器（连续 N 次失败 → 冷却期） | AetherSwap | 连续 5 次失败 → 300 秒冷却 |
| 成功 300s / 失败 30s 分层缓存 | AetherSwap | 避免重复请求失败端点 |
| 全局限速锁 `_acquire_rate_slot()` | Starbucks | 线程安全，确保最小间隔 |
| 5xx 指数退避 2s/4s/8s | cs-monitor | 三级退避 |
| 线程安全锁序列化 cache miss | AetherSwap | 防止并发重复请求同一资源 |

### 3.2 并发

| 做法 | 来源 | 说明 |
|---|---|---|
| ThreadPoolExecutor(4) 独立 Session | AetherSwap | 每线程独立 session，线程安全 |
| aiohttp 4 进程异步 | SteamTradingSiteTracker | 异步高并发 |
| 库存 context 2+16 并行拉取 | AetherSwap | 两个线程同时拉 |

### 3.3 代理

| 做法 | 来源 | 说明 |
|---|---|---|
| 加权随机选择（按延迟评分） | AetherSwap | 低延迟代理获得更高权重 |
| 预热测速 + 延迟排序 | AetherSwap | 启动时测速所有代理 |
| 三种策略模式 | AetherSwap | 本机优先 / 全走代理 / 关代理 |

### 3.4 缓存

| 做法 | 来源 | 说明 |
|---|---|---|
| 内存 LRU（成功 300s/失败 30s） | AetherSwap | 请求级缓存 |
| 本地文件缓存历史数据 | cs2-market-bot | `data/cache/{name}.json` |
| checkpoint JSON 断点续传 | AetherSwap | 导入进度持久化 |
| MongoDB | SteamTradingSiteTracker | 14 天过期元数据 + 持久价格数据 |
| InfluxDB | cs2-market-bot | 时序数据库，适合价格序列 |

### 3.5 选品/稳定性指标

| 指标 | 来源 | 说明 |
|---|---|---|
| 变异系数 CV（动态阈值） | AetherSwap | 低价品 0.08 / 高价品 0.04 |
| R² 趋势拟合度 | AetherSwap | > 0.6 趋势可信 |
| 市场状态（STABLE/RISING/FALLING/CHAOS） | AetherSwap | 基于斜率 + R² |
| 价格分位（365 天 + 14 天） | AetherSwap | 高位避买 |
| 布林带突破 | AetherSwap | MA30 ± 2σ |
| EMA7/EMA30 金叉死叉 | AetherSwap | 趋势转向信号 |
| VWAP | AetherSwap | IQR 清洗后加权均价 |
| Theil-Sen 鲁棒回归 | steam-skin-ops | 中位数斜率，抗异常值 |
| Kendall tau 秩相关 | steam-skin-ops | 趋势一致性 |
| 多模型选择 + 交叉验证 | steam-skin-ops | 4 候选模型，回测 MAE 选最优 |
| 最大回撤 | QuantStrike | (peak - trough) / peak |
| IQR 数据清洗 | AetherSwap | 四分位距法剔除异常点 |

### 3.6 预测模型

| 做法 | 来源 | 说明 |
|---|---|---|
| Theil-Sen 鲁棒回归 | steam-skin-ops | 替代 OLS，对大促波动免疫 |
| 4 候选模型 + 交叉验证 | steam-skin-ops | persistence / recent_level / theil_sen_linear / theil_sen_log |
| Prophet ML（日+年季节性） | cs2-market-bot | 最少 30 点，7 天预测 80% 置信 |
| 均值回归 | 新设计 | 相对 SMA365 的修正 |
| 长周期分位修正 | 新设计 | 高位降漂移、低位加置信 |
| 波动比（30d/365d） | 新设计 | 近期异常波动检测 |

### 3.7 盈亏分析

| 做法 | 来源 | 说明 |
|---|---|---|
| 买卖自动配对 | steam-skin-ops | 单笔净利润 + 持仓天数 |
| 综合倒余额比例 | steam-skin-ops / Starbucks | buy/sell × 100% |
| 按箱子分类排行 | steam-skin-ops | 最赚钱/最亏损 |
| 最佳/最差持仓 | steam-skin-ops | 极值标注 |
| 完整进销存 | AetherSwap | 永久记录成本/售价/余额/折扣率 |

### 3.8 通知推送

| 渠道 | 来源 | 说明 |
|---|---|---|
| PushPlus 微信推送 | AetherSwap | 解锁/价格异动/信号变化 |
| ServerChan 微信推送 | steam_market_reminder | 每日行情 |
| 邮件预警 | AetherSwap / steam_trading_notice | 可配置触发条件 |
| Telegram 告警 | cs-monitor / cs2-market-bot | 最灵活 |
| 企微告警 | cs-monitor | 企业场景 |
| QQ 机器人 | CS_MONITOR | 社群场景 |
| 飞书群机器人 | CS_MONITOR | 企业场景 |
| 短信通知 | SteamBalanceRecommendBot | 紧急场景 |

---

## 4. 宇额助手独有优势（竞品不具备）

| 能力 | 说明 |
|---|---|
| **C5 OpenAPI 库存（status=4 保护期可见）** | 其他项目用 Steam 库存 API（看不到保护期物品）或 BUFF 库存，只有宇额助手能通过 C5 高权限通道看到冷却中物品 |
| **C5 OpenAPI 批量买价** | 直接获取 C5 在售最低价作为成本，其他项目要爬 BUFF 网页 |
| **纯手机端独立运行** | 所有竞品均为桌面端/服务器端/Web 端，只有宇额助手是纯手机端 + 本地计算 |
| **零依赖自建服务器** | 不需要 Docker/MongoDB/Redis/InfluxDB，手机本地完成全流程 |
| **事件日历修正** | 内置 Steam 大促/Major/春节行情事件窗口，修正预测和卖出时机 |
| **Cloudflare Worker 云端历史缓存** | 零 cookie 全量历史，其他项目要么需登录要么不存历史 |
| **C5 app-key + SteamID64 库存同步** | 不依赖 Steam 登录态即可同步库存（C5 高权限通道） |

---

## 5. 各竞品项目简介（附录）

### 5.1 AetherSwap（VexedWilosn/AetherSwap）⭐652

**定位**：全自动 Steam 低价余额助手，Python + FastAPI + 原生 HTML/JS 前端，支持 Docker 部署。

**核心架构**：两条后台 Pipeline——采买 Pipeline（SteamDT 行情 → CV/R² 选品 → Buff 自动下单）和出售 Pipeline（库存监听 → 寄售深度 → 自动上架 → 令牌签名确认）。

**Steam 数据获取**：完全不用 `priceoverview` API，改用三级瀑布——① SSR 页面解析（最高优先级，从 `window.SSR.renderContext` 提取嵌入的 orderbook 数据，一次请求同时拿到价格和订单簿）→ ② Action Orderbook API（`steamcommunity.com/market/orderbook`，自定义 header `x-valve-request-type: queryAction`）→ ③ Legacy Histogram API（`itemordershistogram` 端点，需先从页面正则提取 `item_nameid`，有熔断器：连续 5 次失败后 300 秒冷却）。

**限速与容错**：`MarketCooldown` 类，基于 `time.monotonic()` 的进程级冷却，线程安全。429 时读 `Retry-After` header 设置共享冷却，所有任务共享同一 endpoint 的冷却状态。成功结果缓存 300 秒，失败缓存 30 秒，LRU 淘汰（最多 200 条）。`_history_lock` 序列化 cache miss，防止并发重复请求。

**代理池**：加权随机选择（`score = max(1, 100000 - latency_ms)`），预热机制（异步测速所有代理，按延迟排序），三种策略模式（本机优先 / 全走代理 / 关代理）。

**并发**：`ThreadPoolExecutor(max_workers=4)`，每线程独立 `requests.Session`（线程安全）。库存查询并行获取 context 2 和 16。429 时指数退避：`10 × 2^(attempt-1)` 秒，最多 3 次。

**选品模型（`analysis/stability.py`）**：核心函数 `analyze_by_time`，多维度稳定性评估——变异系数 CV（动态阈值，低价品 0.08、高价品 0.04）、R² 趋势拟合度（7 天日均价线性回归）、市场状态分类（STABLE/RISING/FALLING/CHAOS）、价格分位（当前价在历史区间的位置，> 0.8 判定高位）、近 14 天短期分位、布林带突破（MA30 ± 2σ，EMA7 突破上轨标记暴涨）、EMA7/EMA30 均线、VWAP（IQR 去异常值后的成交量加权均价）、IQR 数据清洗。

**策略引擎**：声明式模块化架构，内置模块包括 SteamDT 取前 N 条、关键词排除、Buff 实时价查询、Steam 卖出深度、目标余额守卫等。支持模拟运行（dry-run）和自定义声明式策略。

**智能定价**：分析 sell orders 按价格升序排列，跳过低量最低档，动态检测「价格墙」（gap jumps），返回墙下方的价格。5 元以下物品用 0.10/0.08 绝对值/相对值阈值。

**其他**：Steam 令牌生成 + 自动确认上架、PushPlus 微信推送 + 邮件预警、一键出厂重置、进销存永久记录、断点续传（checkpoint JSON 持久化扫描进度）。

### 5.2 SteamTradingSiteTracker（EricZhu-42/SteamTradingSiteTracker）⭐2325

**定位**：Steam 挂刀行情站，24h 更新 BUFF/IGXE/C5/UUYP/ECO 挂刀比例数据。Python，MongoDB + Redis 架构。

**架构**：四进程——元数据爬虫（从 Buff 分页获取所有饰品元数据）、任务映射器、数据抓取器（4 进程并行，aiohttp 异步，每个任务链：volume → buff → igxe → c5 → uuyp → order，Steam order 放最后限速最严，最大重试 80 次，timeout 12 秒）、结果收集器（每 10 秒扫描完成的任务）。

**元数据**：从 Buff API 分页获取所有饰品（`/api/market/goods`，page_size=80），过滤条件：`quick_price >= 1`，低价物品 `sell_num >= 50`，`buff_ratio <= 1.64`。逐个查找各平台 ID。

**存储**：MongoDB 两个集合——`meta`（元数据，14 天过期）和 `data`（价格数据）。Redis 存储任务队列。`weighted_ratio` 排序：`optimal_buy_ratio × 0.4 + optimal_sell_ratio × 0.2 + optimal_transaction_ratio × 0.4`。

### 5.3 steam-skin-ops（hitazuki/steam-skin-ops）⭐1

**定位**：面向第三方饰品平台到 Steam 市场挂刀的收益分析与行情监控工具，Python，支持 AstrBot 告警插件。

**风险预测模型（`monitor/risk.py`）**：Theil-Sen 鲁棒回归（所有点对斜率的中位数，对异常值完全免疫）、Kendall tau 秩相关（趋势一致性 ∈ [-1,1]）、多模型选择（4 候选：persistence/recent_level/theil_sen_linear/theil_sen_log，回测 MAE 选最优）、2 小时网格规范化、每日价格中位数。参数：`FORECAST_DAYS=7, FORECAST_WINDOW_DAYS=21, MIN_FORECAST_DAYS=14, ANALYSIS_DAYS=30`。

**市场快照（`monitor/market.py`）**：`MarketSnapshot` 数据类聚合多平台价格（BUFF/悠悠有品/C5/IGXE/ECO/Steam），`calculated_ratio` = 最低平台价 / Steam 净收入。

**盈亏计算（`profit/calculator.py`）**：单笔（`profit_cny = sell_price - buy_price`）、汇总（总投入/总收益/综合倒余额比例/最佳最差持仓/平均持仓天数）、按游戏分类、买卖自动配对。

**监控规则（`monitor/rules.py`）**：4 种规则类型——ratio（挂刀比例）、t7（7 天 P25 净收入）、platform（平台价）、steam（Steam 价），可配置阈值。

### 5.4 cs2-market-bot（ArseniHv/cs2-market-bot）⭐0

**定位**：CS2 市场分析 bot，Python，InfluxDB 存储 + Facebook Prophet ML 预测。

**数据收集**：Skinport API 一次请求获取全量 CS2 物品价格（`api.skinport.com/v1/items?app_id=730&currency=USD&tradable=0`），无需 API key，限速 8 次/5 分钟。Steam pricehistory（`httpx.Client`，间隔 3 秒，本地文件缓存）。CSFloat API（API Key 认证）。每周期（默认 30 分钟）：Skinport 批量 → 检测异动（≥5% 变化）→ 追踪物品写入 InfluxDB。

**ML 预测**：从 InfluxDB 查询最多 365 天历史，Facebook Prophet 模型（每日+每年季节性），最少 30 点，7 天预测 80% 置信区间，每次 `/predict` 重新训练。

### 5.5 cs-monitor（Pgooone/cs-monitor）⭐8

**定位**：CS2 饰品价格监控平台，Python，SteamDT API + Web 仪表盘 + 企微/Telegram 告警。

**SteamDT API**：批量查询（`POST /open/cs2/v1/price/batch`，一次最多 100 个名称，60 秒间隔）、单条查询（60 次/分钟）、7 天均价、全量饰品信息（每天 1 次）、K 线数据。认证：`Authorization: Bearer {api_key}`。

**限速**：`_Throttle` 类（线程安全），批量端点最小间隔 60 秒，429 时读 `Retry-After`，5xx 指数退避（2s/4s/8s），业务限流码 60 秒冷却。

**极致追踪**：10 秒 tick 调度，每个追踪项独立轮询间隔（默认 60 秒），价格变动超阈值触发告警，支持免打扰时段和告警冷却。

**波动分析**：基准价来源 SteamDT 日 K 线前一交易日收盘价，失败时降级到 DB 最新采集价。阈值可配置（默认 5%），告警冷却 4 小时。

### 5.6 cs2-valueyes（Croutl/cs2-valueyes）⭐3

**定位**：CS2 价值眼，Python FastAPI，集成 Buff/Steam/悠悠有品多平台价格。

**CSQAQ API**：容器详情/饰品详情/统计数据/K 线数据/套利列表/ROI 列表/武器箱统计。市场缓存 300 秒 TTL，无限速/无重试（timeout=10s）。

**估值模型（4 维度）**：炼金基价（品质 + 磨损 + StatTrak/纪念品/主战溢价）、存世稀缺（从 statistic API 获取实际存世量）、市场深度（Buff 买卖比 + Steam 买卖比 + 价差）、趋势健康（30 天/90 天涨跌幅）。

### 5.7 Starbucks（haoran444/Starbucks）⭐3

**定位**：CS2 饰品套利监控工具，Python FastAPI + React 前端。

**数据获取**：`BaseScraper` 抽象基类（httpx.Client，支持代理配置，统一 `PriceData` 数据类，`_delay()` 可配置间隔 + 随机 jitter）。Buff 爬虫（`/api/market/goods` 分页，page_size=50，Cookie 认证，串行逐个获取）。CSQAQ 爬虫（全局限速锁 `_MIN_INTERVAL=1.2s`，429 退避随机 5.1-5.6s，批量查询每次最多 50 条）。

**比例计算**：`calc_ratio = buff_price / (steam_price × 0.85)`（Steam 15% 手续费），机会判定 ratio ≥ `min_ratio_threshold`（默认 0.85）。

### 5.8 QuantStrike（Leonardo-DaVinci-80/QuantStrike）⭐1

**定位**：量化分析平台，Python + pandas，将金融建模应用于 CS 皮肤市场。

**分析模块**：MA30/MA90 移动均线（`technical.py`）、波动率模型（`volatility.py`）、最大回撤 Max Drawdown（`risk.py`：`(peak - trough) / peak`）、收益率分析（`returns.py`）、相关性分析（`correlation.py`）、绩效度量（`performance.py`）。数据来源：CSV 文件批量导入。

---

*本文件基于 GitHub 18 个开源项目的深度代码研究，2026-09-07 完成。覆盖宇额助手全部功能板块和全部数据通道。与 docs/HANDOFF.md 配合使用。*
