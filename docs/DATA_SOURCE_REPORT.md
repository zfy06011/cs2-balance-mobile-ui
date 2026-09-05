# DATA_SOURCE_REPORT.md — 数据源可行性调研报告（Phase 0）

> 版本：v1.0 ｜ 日期：2026-09-05 ｜ 状态：✅ 数据源可行性已确认，可进入 Phase 1

## 1. 核心结论

| 数据源 | 可行 | 方式 | 认证 | 限流/风险 |
|---|---|---|---|---|
| Steam 实时价格 | ✅ | `priceoverview` 公开接口 | 无 | 约 20 次/分钟/IP，需轮询+退避 |
| Steam 历史价格 | ✅ | `pricehistory` 接口 | 需登录 Cookie（可配置） | 频率限制，单次返回约 1 年数据（按天） |
| Steam 商品列表/成交榜 | ✅ | `search/render` 接口 | 无 | 用于构建监控池，注意分页与限流 |
| Steam 买卖单深度 | ⚠️ | 商品详情页 HTML 解析 | 反爬风险 | 高频解析易触发验证码，慎用 |
| C5GAME 实时/历史价格 | ✅ | 官方 OpenAPI（`openapi.c5game.com`） | App-Key | 需注册申请；按套餐限流 |
| C5GAME 网页内部接口 | ⚠️ | 网页端 API | 需要登录态 | 非官方接口，可能变更，仅作备用 |
| 特殊事件 | ✅ | 人工维护 Event Database + 官方新闻 | 无 | 半自动，先人工录入 |

## 2. Steam Community Market

### 2.1 实时价格（推荐）
```
GET https://steamcommunity.com/market/priceoverview/
    ?appid=730&currency=23&market_hash_name=<URL编码的商品名>
```
- `appid=730` 为 CS2/CS:GO；`currency=23` 为人民币（CNY）
- 返回示例：`{"success":true,"lowest_price":"2.39元","median_price":"2.41元","volume":15262}`
- 低频个人使用无需密钥；建议默认 30 分钟轮询，单商品间隔 ≥ 3 秒

### 2.2 历史价格
```
GET https://steamcommunity.com/market/pricehistory/
    ?appid=730&market_hash_name=<URL编码的商品名>
```
- 返回 `prices` 数组：`[unix时间, "价格", 成交量]`，粒度约每天
- 需要携带登录 Cookie（`steamLoginSecure` 等），未登录常返回空数组或降级
- 数据用途：训练 7 天预测模型、回测、P10/P90 区间估计

### 2.3 市场搜索（构建监控池）
```
GET https://steamcommunity.com/market/search/render/
    ?appid=730&norender=1&query=&start=0&count=100
    &sort_column=volume&sort_dir=desc
```
- `norender=1` 时返回 JSON，其中 `results[]` 含 `name`、`sell_price`、`sale_price_text`、`sell_listings` 等字段
- 按成交量排序即可动态获取「流动性 Top N」武器箱（文档要求的核心池 Top 50、候选池 51–100）
- 注意：结果包含全类型物品，需要过滤只保留名字含“武器箱/Sticker Capsule/Case”等关键词

### 2.4 卖出手续费（口径说明）
- Steam 市场对每笔交易收取约 **15%（10% Steam 费用 + 5% 游戏内费用）**，由**买家支付总额**承担
- 对卖家收益的换算：**卖家实得 ≈ 挂牌价的 86.96%**（= 1 / 1.15）；若买家实付 115 元，卖家到账 100 元
- 本项目统一使用 `seller_receive_ratio = 1/1.15 ≈ 0.8696`，并配置化记录费率版本与生效时间
- 若未来 CS2 调整费率，只需更新 `fees` 配置表，不修改业务代码

## 3. C5GAME

### 3.1 官方开放平台（推荐）
- 文档地址：<https://opendoc.c5game.com/>，接口基址：`https://openapi.c5game.com`
- 需要先在 C5GAME 开放平台注册并申请 App-Key（`app-key` 参数），部分接口需签名
- 可获取：商品实时价格、历史价格、售卖/求购列表等（以开放平台文档为准，字段需在接入时二次核对）
- 限流按套餐，需读取官方文档确认并写入配置

### 3.2 网页内部接口（备用，慎用）
- 常见路径形如 `https://www.c5game.com/api/...`，需要页面登录态（Cookie/Token）
- 非官方、无契约、可能随时变更；仅用于原型验证，不作为长期方案
- 开源参考：SteamTradingSiteTracker 中有 C5 抓取实现，可参考其字段命名

### 3.3 C5GAME 手续费（2026-04-09 起新规，需配置化）
- CS2 交易手续费：普通 **1%**，VIP **0.5%**，SVIP **0%**
- 提现手续费约为 0.9%（按官方公示，需定期核对）
- 结论：`fees` 表需支持多版本（fee_version + effective_at），收益模型按版本取值

## 4. 7 天限制期（业务规则确认）

- 2025-10-03 CS2 更新：从游戏内商店、交易报价、Steam 社区市场获得的物品，统一附加 **7 天**再交易/再上架冷却
- 2026-06-23 左右起：冷却从「北京时间 15:00 统一解锁」改为 **「获得时间 + 168 小时（7×24）精确计时」**
- 对武器箱倒余额：**C5GAME 买入 → 假设备受同样冷却 → 第 168 小时后可在 Steam 市场上架**
- 设计为配置项：`LOCK_DAYS=7`、`LOCK_MODE=exact_hours`、`LOCK_HOURS=168`
- 冷却期会变化，代码不得硬编码，统一走 `settings` / `fees` 配置表

## 5. 推荐数据源组合与更新频率

| 用途 | 首选 | 频率 | 成本 |
|---|---|---|---|
| 监控池 Top 100 | Steam search/render | 30 分钟 | 免费 |
| 池内商品实时价格 | Steam priceoverview + C5 OpenAPI | 30 分钟 | 免费/低 |
| 池内商品历史价格 | Steam pricehistory（并行节流） | 每日 1 次增量 | 免费 |
| 7 天预测训练数据 | 上述历史 + 本地快照 | 每日 | 免费 |
| 特殊事件 | Event Database + 官方公告 | 人工/半自动 | 免费 |

## 6. 风险点与缓解措施

1. **Steam 限流/封禁**：低频轮询、指数退避、随机抖动、必要时使用代理池；默认 30 分钟不允许无脑调高
2. **C5 OpenAPI 审批**：提前申请 App-Key；未获批前用网页接口做原型，不写死
3. **反爬**：不解析需要验证码的页面；`search/render` 若被拦，降级为本地缓存 + 手动名单
4. **手续费变动**：全部费用走 `fees` 版本表，任何费率变化只改配置
5. **7 天规则变动**：冷却参数走配置，不硬编码
6. **数据一致性**：所有外部数据落库必须带 `source` 与 `timestamp`，禁止 AI 臆造

## 7. Phase 0 交付检查

- [x] Steam 当前/历史/成交量数据方式确认（priceoverview / pricehistory / search/render）
- [x] C5GAME 可获得方式确认（OpenAPI 首选、网页接口备用）
- [x] 7 天限制规则确认并设计为可配置
- [x] 手续费口径确认（Steam 15% / C5 1%）并设计为版本化配置
- [x] 更新频率与成本给出（默认 30 分钟）
- [x] 本报告输出

> ⚠️ 所有「金额/费率/规则」均来自公开资料与平台公告，接入前需以实际接口返回与官方最新公告为准；实现中每个值都会保存 source + timestamp，绝不硬编码到业务代码。
