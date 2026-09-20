# V3-PHASE-3C-3H：无电脑真机资格验证 + 可直接安装 APK 交付报告

日期：2026-09-14  
结论：**RC APK READY；PASS-V2 尚未判定**

## RC APK

已构建独立 Internal RC APK：

- 文件：[宇额助手-v1.8.6-rc-v2.apk](D:/Codex/cs2-balance-mobile/releases/宇额助手-v1.8.6-rc-v2.apk)
- Package：`com.cs2balance.assistant.rc`
- Label：`宇额助手 RC`
- versionName：`1.8.6-rc`
- versionCode：`37`
- Build type：`rc`，release-like、debug signing、独立包名
- Metro required：No
- JS bundle：APK 内置 `assets/index.android.bundle`
- Hermes：APK 内含 Hermes runtime
- 文件大小：`85,891,144` bytes
- SHA-256：`404647B746AA2ED683560E78631448434E61B883296DFADCF8CD45B3217363CA`
- 构建时间：2026-09-14 09:08:48（本地文件时间）

RC 不覆盖正式 `com.cs2balance.assistant`，正式版本仍为 `1.8.6 / 37`。

## Qualification Runner

新增 RC-only 资格入口：

```text
我的 -> 真机资格检测
```

Runner 已实现：

- 12 轮 live burn-in，正式轮间隔 5 分钟；
- 5 轮 live v2 refresh；
- 状态写入既有 `kv` 表，可在 App 被杀/锁屏/切后台后恢复；
- offline/online、process restart、background/foreground 手机内 checkpoint；
- candidate accounting、high-risk veto、snapshot validity；
- Share Sheet 导出检测摘要；
- RC 编译期固定 v2，正式 production 默认仍 legacy。

开始检测前会自动检查 C5 app-key 和 RC 独立 SQLite 候选池；任一缺失时开始按钮会禁用，并提示先配置 app-key、回首页执行一次“一键扫描”。

## Release Isolation

`verify:release-candidate`：**37/37 PASS**。

确认：

- 正式源码 build channel 为 production；
- 正式默认 mode 为 legacy；
- RC v2 通过编译期 channel 生效；
- synthetic 需要显式 dev demo global，正常 live path 不使用 synthetic；
- 正式 runtime 不依赖 Metro、Node filesystem、scripts 或 artifacts；
- Snapshot 不包含 C5 key、Cookie、token、authorization。

## 资格测试自动化

`verify:release-qualification`：**30/30 PASS**。

覆盖 qualification gate 的 PASS-V2、PASS-LEGACY、FAIL 分支、12 轮门槛、accounting gap veto、高危推荐 veto、synthetic input veto、版本/default guard。

## 无电脑真机状态

RC APK 已具备独立启动条件，但本次构建完成后手机连接已断开，因此未能在本轮对 RC 包执行 `adb install` smoke。交付给用户后无需电脑，按以下流程操作：

1. 在手机下载安装 APK；
2. 如系统提示，允许该来源安装未知应用；
3. 打开“宇额助手 RC”；
4. 进入“我的 → 真机资格检测”；
5. 点击“开始自动检测”；
6. 按页面提示完成后台、重启、断网/恢复网络；
7. 完成后点击“导出/分享检测摘要”；
8. 将摘要或报告发回 Codex。

建议手机接电并保持 RC 在前台；后台暂停后，Runner 会根据 `nextEligibleAt` 回前台继续，不会把暂停时间伪装成完整 burn-in。

## 当前最终判定

当前仍是 **PASS-LEGACY**，原因是：

- 12 轮真实 burn-in 尚未由用户手机完成；
- 5 轮 live v2 refresh 尚未由用户手机完成；
- 真实断网/恢复和 RC 安装 smoke 尚未取得手机内报告。

RC APK 只负责采集证据，不会自动修改正式 App、默认 mode、版本号或远程配置。只有用户把完成后的 Qualification 报告发回后，才决定是否进入 PASS-V2、正式切换 v2、升级到 1.9.0/38 并构建正式 release APK。
