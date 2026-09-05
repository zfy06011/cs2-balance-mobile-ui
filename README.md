# CS2 余额助手（纯手机版 v1.2.0）

基于 PRD《CS2 武器箱跨市场倒余额分析系统》开发的**纯手机软件**：
C5GAME 买入 → 约 7 天限制期 → Steam Community Market 卖出，App 内完成
**采集 / 分析 / 预测 / 提醒 / 记录**，不自动买卖、不用连电脑。

> **v1.2.0 核心变化：C5GAME OpenAPI 正式接入**——在设置页填入 C5 app-key 后，
> C5 买入价自动抓取（在售最低价），不再依赖手动录入；分析引擎继续在手机内本地运行，直连 Steam / C5GAME。
> **v1.1.0：整套分析引擎已集成进手机 App，不再需要电脑后端。**

## 为什么不需要电脑

旧版是「手机 App + 电脑 Python 后端」：后端负责分析，App 只做展示，
必须电脑开机且手机与电脑同一网络才能用。

v1.1.0 把后端同一套分析引擎（手续费、收益、7 天预测、机会雷达、资金模拟、库存）
完整移植到手机本地 TypeScript 运行，手机**直接**访问 Steam Community Market
公开接口采集价格，分析、预测全部在手机内完成，任何时间地点打开即可用。
已用 Python 后端同输入输出逐项交叉验证，**58/58 项全部一致**。
v1.2.0 在此基础上正式接入 C5GAME OpenAPI，C5 买入价也可自动获取。

## 安装包

| 文件 | 说明 |
|---|---|
| `releases\CS2余额助手-v1.2.0.apk` | 正式安装包（v1.2.0 / versionCode 3，约 66 MB） |

安装步骤：
1. 把 APK 传到 Android 手机（微信/网盘/数据线均可）
2. 点击安装，允许「安装未知来源应用」（Android 7.0+，minSdk 24）
3. 打开 App → 进「设置」页 → 点「📡 开始采集」

## 使用流程

1. **一键采集**：设置页点「开始采集」即可从 Steam 拉取成交量 Top 武器箱的
   最新价格快照（可选 10 / 20 / 50 个，每个约 2 秒，采集进度实时显示）。
2. **C5 买入价**（二选一）：
   - **自动（推荐）**：到 [C5GAME 开放平台](https://opendoc.c5game.com/) 注册开发者 →
     创建应用获取 **app-key**，填入设置页「C5GAME app-key」后，采集时自动抓取 C5 在售最低价；
   - **手动**：直接在商品详情页录入 C5 买入价（未配置 app-key 时 App 不会臆造价格）。
   - app-key 是个人凭证，仅保存在手机本地，请勿外泄。
3. **看结果**：首页展示跨市场收益、机会雷达（🟢买入 / 🟡等待 / 🔴不建议）、
   7 天预测区间、三情景与置信度；模拟页做预算组合与目标余额反推；
   库存页管理 7 天倒计时与解锁时估值。

## C5GAME OpenAPI 说明（v1.2.0 已接入）

- 文档站：<https://opendoc.c5game.com>；服务地址：`https://openapi.c5game.com`
- 鉴权：app-key 作为 query 参数（`?app-key=xxx`），无签名机制，默认限流 50 QPS
- 已接入接口（文档 /api-125914570）：
  `POST /merchant/product/price/batch` —— MarketHashNames 批量查询在售最低价和数量
  （请求体 `{ "appId": "730", "marketHashNames": [...] }`，价格单位元，与 Steam 一致）
- appId 参考：CSGO/CS2 = `730`，DOTA2 = `570`，TF2 = `440`
- 采集过程中 C5 请求失败不会阻塞主流程，价格缺失时仍可手动录入兜底

## 数据与隐私

- 所有行情快照、库存、设置只保存在**手机本地**（AsyncStorage），不上传任何服务器
- 不登录用户 Steam / C5 账号，不做自动买卖
- Steam 公开价格接口无需密钥；如需历史价格稳定性可选填浏览器 Cookie
- 采集频率内置限速，遵守数据源限制

## 目录结构

```
mobile/
  src/core/      分析引擎（fees / profit / prediction / radar / simulation / engine）—— 手机内本地运行
  src/data/      Steam 直连适配器、C5 适配器（OpenAPI）、本地存储、一键采集编排
  src/api/       对外接口（与旧后端 API 形状一致）
  src/screens/   首页 / 雷达 / 详情 / 库存 / 模拟 / 设置
  scripts/       verify_core.cjs 交叉验证脚本（58 项）、verify_c5.cjs C5 在线冒烟脚本
releases/        APK 安装包
docs/            Phase 0 数据源可行性调研报告
backend/         旧版电脑后端源码（历史参考；手机版已内置其引擎，运行无需它）
```

## 开发与验证

```bash
cd mobile
npm install
npm run typecheck     # TypeScript 零错误
npm run verify:core   # 与 Python 后端基准交叉验证（58/58 PASS）
$env:C5_APP_KEY='你的app-key'; npm run verify:c5   # C5 OpenAPI 在线冒烟（可选）
npm start             # Expo 开发调试
```

构建正式 APK（已内置，如需重打包）：
```bash
cd mobile/android
JAVA_HOME=<JDK17> ANDROID_HOME=<SDK> gradle.bat assembleRelease --no-daemon
# 产物：app/build/outputs/apk/release/app-release.apk
```

## 合规声明

- 只分析不自动买卖；不登录用户账户、不绕过平台限制
- 采集频率遵守数据源限流，内置退避与失败重试
- 所有外部数据记录 source + timestamp，禁止臆造市场数据
