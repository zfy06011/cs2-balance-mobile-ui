# V3-PHASE-3C-4：Opportunity v2 Final Release

日期：2026-09-14  
结论：**PASS-V2 / RELEASE BUILT**

## 发布决定

用户提交 Qualification 报告并明确确认通过：

```text
Burn-in: 12/12
v2 refresh: 5/5
Network recovery: PASS
Process restart: PASS
Background/foreground: PASS
Final: PASS-V2
```

根据用户确认，本阶段正式将 `DEFAULT_FEATURE_FLAGS.opportunityMode` 从 `legacy` 切换为 `v2`。

## 版本

```text
versionName = 1.9.0
versionCode = 38
package = com.cs2balance.assistant
build channel = production
```

`mobile/package.json`、`mobile/package-lock.json`、`mobile/app.json` 与 `mobile/android/app/build.gradle` 已同步。

## Steam 卖价修复

正式包包含 Steam 卖价修复：v2 Snapshot 透传真实 orderbook 的 `highestBuy` / `lowestSell`，详情页显示“当前 Steam 最低卖单”和“当前 Steam 最高买单”，不再把旧 SQLite price snapshot 当作 live 最低卖单。

## APK

- 文件：[宇额助手-v1.9.0.apk](D:/Codex/cs2-balance-mobile/releases/宇额助手-v1.9.0.apk)
- SHA-256：`9505AEC525F7B39125D7804AC580EB218B91807D22B2BC61C626D71D2D4FF167`
- 文件大小：`85,891,760` bytes
- 构建时间：2026-09-14 19:35:02
- 构建任务：`:app:assembleRelease`
- 构建结果：`BUILD SUCCESSFUL`
- JS bundle：APK 内置 `assets/index.android.bundle`
- Hermes：APK 内置 `libhermesvm.so`
- Metro：不需要

## 测试说明

用户明确要求不再继续测试。本阶段没有重复运行 Burn-in、全量测试或真机安装；只执行了正式 release 构建与 APK 元数据/内置 bundle/Hermes 检查。

此前最近一次相关自动化结果：Production 573/573、UI 125/125、release candidate 37/37、release qualification 30/30。上述测试是在正式版本切换前完成，本报告不将其冒充为 1.9.0 构建后的重新回归。

