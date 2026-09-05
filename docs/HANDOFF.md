# HANDOFF —— CS2 余额助手（纯手机版）交接文档

> 本文件写给**接手继续改进的 AI / 开发者**。先读本文件，再读 `docs/` 下的
> Phase 0 调研报告与原 PRD《CS2 武器箱跨市场倒余额分析系统》。所有对外说明必须简体中文。

## 0. 一句话定位

**纯手机 Android App**：C5GAME 低价买入武器箱 → 约 7 天限制期 → Steam Community Market 卖出，
在手机内完成采集 / 收益分析 / 7 天预测 / 机会雷达 / 资金模拟 / 库存倒计时，**不自动买卖、不连电脑**。
最高目标：让用户快速知道**现在买哪个箱子最划算、预计能以几折倒成 Steam 钱包余额**。

## 1. 当前状态（2026-09-05）

| 项目 | 值 |
|---|---|
| 最新版本 | **v1.3.1**（versionCode 5，包名 `com.cs2balance.assistant`，minSdk 24） |
| 安装包 | `releases\CS2余额助手-v1.3.1.apk`（桌面副本 `C:\Users\Administrator\Desktop\CS2余额助手-v1.3.1.apk`） |
| 一级页面 | 首页 / 市场 / 库存 / 雷达 / 我的（资金模拟为首页工具入口，不作一级导航） |
| 已验证 | typecheck 零错误；引擎交叉验证 **71/71 PASS** |
| 核心指标 | **预计几折余额**（低于 1 更划算；如投入 100 元、预计 Steam 净到手 108 元 = 9.26 折） |

## 2. v2 已完成功能（相对 v1.2.0）

**v1.3.1（2026-09-05）**：
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
  scripts/        verify_core.cjs（71 项对拍）、verify_c5.cjs（C5 在线冒烟，需要 $env:C5_APP_KEY）
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
- 热门榜 query 用**原始字符串**拼在 `steam.ts searchPopular()`（`category_730_Type[]=...` 中括号
  会被 URLSearchParams 转义，勿改回 URLSearchParams）
- **本机访问不稳定**：曾 20s 超时。采集失败/超时 ≠ 代码错误，先重试
- 文档缓存：`%TEMP%\c5doc.html`、`c5_price.html`、`c5_batch.html`、`c5_maxprice.html`（可离线解析）

## 5. 构建 / 验证命令（Windows PowerShell，环境变量每条命令都要重新设置）

```powershell
cd D:\Codex\cs2-balance-mobile\mobile
npm run typecheck        # TS 零错误
npm run verify:core      # 引擎交叉验证 71/71
$env:C5_APP_KEY='<用户的key>'; npm run verify:c5   # C5 在线冒烟（可选，key 找用户要，勿入库）

# 打包（android/ 被 gitignore，需手动改版本）
# 版本升级：mobile\package.json + mobile\app.json 的 version；mobile\android\app\build.gradle
#   versionCode +1（当前 4）、versionName "1.3.0" → 下一版
cd D:\Codex\cs2-balance-mobile\mobile\android
$env:JAVA_HOME="D:\dev\jdk17\jdk-17.0.20.1+1"; $env:ANDROID_HOME="D:\Android\Sdk"
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
- 新增箱子若无中文映射，UI **回退显示英文原名**（避免出现「暂无中文名」）；
  可继续在 `cn_names.ts` 补充 C5GAME 译名

## 7. 建议改进路线（按优先级，供下一位接手者挑选）

1. **~~max-price 求购最高价接入~~ → 已完成（v1.3.1）**：详情页「C5 卖出参考」展示求购最高价
   （`fetchC5StatsBulk`，stat 接口）；后续可做「采集时自动批量查询求购价并入库」
2. **采集频率调度**：默认每 30 分钟自动采集（当前仅手动一键扫描），可配置
3. **自采集提醒**：限制期结束本地通知（需 expo-notifications，注意权限与国内厂商后台限制）
4. **智能拆单**：预算较大时按风险/数量限制分散到多个箱子（HANDOFF v2 第 9 节）
5. **市场事件数据库**：Steam 大促 / CS2 更新 / Major 等作为预测与回测特征（第 8 节）
6. **模型增强 + 回测**：当前 baseline-momentum-v1；加波动率、成交量、热门排名、事件特征，
   记录 MAE/RMSE/方向准确率/盈利命中率/平均实际折扣（第 24 节）
7. **离线测试**：verify:c5 目前依赖网络；可加 mock 响应离线用例，保证 CI 可跑
8. **分发体验**：接入 EAS 或提供 debug 包；或做 Google Play/国内应用市场合规上架评估

## 8. 接手后的标准动作

1. `git status` 确认干净；`git log --oneline -5` 看历史
2. `npm run typecheck && npm run verify:core` 确认基线绿
3. 改动后必须重跑上述验证；涉及 C5 改动时用真实 key 跑 `verify:c5`
4. 用户相关 App 升级时：版本号三处（package.json / app.json / build.gradle）同步 +1，重打包，
   归档替换 releases 与桌面副本（用 python pathlib，勿用 Remove-Item -Recurse）
5. 所有用户可读输出用简体中文；不输出内部思维链，只给简短的结论与验证结果
