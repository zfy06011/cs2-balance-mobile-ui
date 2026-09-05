# HANDOFF —— CS2 余额助手（纯手机版）交接文档

> 本文件写给**接手继续改进的 AI / 开发者**。先读本文件，再读 `docs/` 下的
> Phase 0 调研报告与原 PRD《CS2 武器箱跨市场倒余额分析系统》。所有对外说明必须简体中文。

## 0. 一句话定位

**纯手机 Android App**：C5GAME 低价买入武器箱 → 约 7 天限制期 → Steam Community Market 卖出，
在手机内完成采集 / 收益分析 / 7 天预测 / 机会雷达 / 资金模拟 / 库存倒计时，**不自动买卖、不连电脑**。

## 1. 当前状态（2026-09-05，HEAD = c09e38b）

| 项目 | 值 |
|---|---|
| 最新版本 | **v1.2.0**（versionCode 3，包名 `com.cs2balance.assistant`，minSdk 24） |
| 安装包 | `releases\CS2余额助手-v1.2.0.apk`（69,484,210 字节 ≈ 66 MB，桌面副本 `C:\Users\Administrator\Desktop\CS2余额助手-v1.2.0.apk`） |
| 提交历史 | `c09e38b` v1.2.0 C5 OpenAPI 接入 / `7e62081` v1.1.0 纯手机版 / `7b38ec1` v1.0 骨架 |
| 已验证 | typecheck 零错误；引擎交叉验证 58/58 PASS；C5 真 key 在线冒烟 4/4 PASS |
| 工作树 | 干净（git status 无改动） |

## 2. 架构（mobile/ 为唯一运行主体）

```
mobile/
  src/core/       分析引擎（fees/profit/prediction/radar/simulation/engine）—— 手机内本地运行
  src/data/       steam.ts 直连适配器、c5.ts（C5 OpenAPI）、storage.ts（AsyncStorage）、collector.ts 一键采集编排
  src/api/        client.ts 对外 API（与旧后端形状一致）
  src/screens/    首页/雷达/详情/库存/模拟/设置
  scripts/        verify_core.cjs（58 项对拍）、verify_c5.cjs（C5 在线冒烟，需要 $env:C5_APP_KEY）
backend/          旧电脑后端（历史参考 + baseline.json 基准；运行不依赖它）
releases/         APK 产物（*.apk 被 gitignore，不入库）
docs/             Phase 0 调研报告
```

业务流：`collector.collectCases()` → Steam search/render 取成交量 Top 武器箱 →
逐箱 `priceoverview` 取价（限速 1.8s）→ 若设置页已填 C5 app-key，`fetchC5Price()` 抓 C5 在售最低价 →
快照写 AsyncStorage → `core/engine.ts` 计算收益/预测/雷达。

**方向语义（勿搞反）**：C5 买入价是**成本**（`c5_buy_price`，引擎中与 `c5_buy_fee_ratio=1%` 相乘），
Steam 卖出价是**收入**（到账比例 0.8696，即扣 13%）。单位统一为**元（CNY）**。

## 3. 已验证的关键事实（改动前务必先读）

### C5GAME OpenAPI（opendoc.c5game.com / openapi.c5game.com）
- 鉴权：`app-key` 作 query 参数，无签名，默认限流 50 QPS；CSGO/CS2 appId = `730`
- **已接入**「MarketHashNames 批量查询在售最低价和数量」：
  `POST https://openapi.c5game.com/merchant/product/price/batch?app-key=<key>`
  请求体 `{"appId":"730","marketHashNames":["M4A4 | Temukau (Minimal Wear)"]}`
  响应 `{success, data:{ "<MarketHashName>": {itemId, marketHashName, price(元), count, website} }, errorCode, errorMsg}`
  实测：AK-47 Redline FT = 186.8 元；M4A4 Temukau MW = 352.64 元
- **已实测可用但未接入**「求购最高价」：
  `GET https://openapi.c5game.com/merchant/purchase/v1/max-price?itemId=<itemId>&styleId=0&app-key=<key>`
  响应 `{success, data:{maxPrice:"372.0"(字符串，元)}}`；itemId 由批量接口返回
- **注意**：文档中的 `GET /price/info`（价格查询）实测返回 **404，已下线，勿用**
- 服务端要求 Accept-Encoding 头（curl 需 `--compressed`；RN fetch 自动处理）
- 文档缓存：`%TEMP%\c5doc.html`、`c5_price.html`、`c5_batch.html`、`c5_maxprice.html`（可离线解析）

### Steam Community Market（公共接口，无需密钥）
- `priceoverview`（当前价/成交量，currency=23 CNY）、`search/render`（按成交量排序）
- **本机访问不稳定**：曾 20s 超时。采集失败/超时 ≠ 代码错误，先重试

## 4. 构建 / 验证命令（Windows PowerShell，环境变量每条命令都要重新设置）

```powershell
cd D:\Codex\cs2-balance-mobile\mobile
npm run typecheck        # TS 零错误
npm run verify:core      # 引擎交叉验证 58/58
$env:C5_APP_KEY='<用户的key>'; npm run verify:c5   # C5 在线冒烟（可选，key 找用户要，勿入库）

# 打包（android/ 被 gitignore，需手动改版本）
# 版本升级：mobile\package.json + mobile\app.json 的 version；mobile\android\app\build.gradle
#   versionCode +1（当前 3）、versionName "1.2.0" → "1.3.0"
cd D:\Codex\cs2-balance-mobile\mobile\android
$env:JAVA_HOME="D:\dev\jdk17\jdk-17.0.20.1+1"; $env:ANDROID_HOME="D:\Android\Sdk"
& "D:\dev\gradle-9.3.1\gradle-9.3.1\bin\gradle.bat" assembleRelease --no-daemon
# 产物 mobile\android\app\build\outputs\apk\release\app-release.apk
# 归档（沙箱禁 Remove-Item -Recurse；删除文件一律 python pathlib）：
#   python -c "from pathlib import Path; import shutil; shutil.copy2(...); ..."
```

**踩坑**：gradle wrapper 的 distributionUrl 指向 services.gradle.org，本机**下载超时**，
必须用 `D:\dev\gradle-9.3.1\gradle-9.3.1\bin\gradle.bat`；PowerShell 无 heredoc（用 here-string 写文件）；
`${...}` 会在双引号字符串里展开（模板字符串用单引号 here-string 或 Python 写）。

## 5. 已知限制与风险

- C5 价格为「在售最低价」，非实时成交价；采集是快照，价格可能波动
- Steam 网络在本机不稳定，App 内已做一次重试 + 2s 退避
- `merchant/product/price/batch` 每次请求只传 1 个 name（collector 逐条调），可优化为批量
- app-key 为**用户个人凭证**：只存 AsyncStorage，**绝不写进代码/README/仓库/日志**
- Hermes 引擎：勿用 `Array.prototype.at` 等新 API；TS 目标 es2020

## 6. 建议改进路线（按优先级，供下一位接手者挑选）

1. **C5 批量查询**（低风险高收益）：给 `c5.ts` 增加批量导出（一次 POST 多个 marketHashNames），
   改造 `collector.ts` 循环为打包批量调用，减少请求数；保持 `fetchC5Price(name,key)` 签名不变兼容手动录入/引擎
2. **设置页「测试 C5 app-key」按钮**：调批量接口验证 key 有效性，失败给出提示（网络/406 等）
3. **接入 max-price 求购最高价**：详情页展示 C5「可秒出求购价」作参考（注意这是卖出参考，勿与买入成本混用）
4. **Steam 会话/cookie 过期提示**、采集失败明细页（哪些箱子失败、原因）
5. **本地通知**：库存页 7 天限制期到期提醒（需 expo-notifications，注意权限与国内厂商后台限制）
6. **离线测试**：verify:c5 目前依赖网络；可加 mock 响应离线用例，保证 CI 可跑
7. **预测模型增强**：当前 baseline-momentum-v1；可加波动率/成交量特征并回测
8. **分发体验**：接入 EAS 或提供 debug 包；或做 Google Play/国内应用市场合规上架评估

## 7. 接手后的标准动作

1. `git status` 确认干净；`git log --oneline -5` 看历史
2. `npm run typecheck && npm run verify:core` 确认基线绿
3. 改动后必须重跑 上述验证；涉及 C5 改动时用真实 key 跑 `verify:c5`
4. 用户相关 App 升级时：版本号三处（package.json / app.json / build.gradle）同步 +1，重打包，归档替换 releases 与桌面副本
5. 所有用户可读输出用简体中文；不输出内部思维链，只给简短的结论与验证结果
