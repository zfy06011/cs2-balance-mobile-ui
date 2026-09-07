# 宇额助手（CS2 余额助手）

纯手机端 Android App：监控 CS2 武器箱行情，发现「C5GAME 低价买入 → 约 7 天交易保护期 → Steam 市场卖出」的套利机会，本地完成采集 / 分析 / 预测 / 雷达 / 库存管理 / 买入记账，不自动买卖、不连电脑。

- **最新版本**：v1.5.10（versionCode 26，2026-09-07）→ `releases\宇额助手-v1.5.10.apk`（历史版本也保留在 releases/）
- **唯一文档**：**`docs/HANDOFF.md`** —— 项目定位 / 功能 / 数据调用链路 / 接口实验结论 / 云端方案 / 构建发版流程 / 版本记录全部在此，接手前必读
- **目录**：`mobile/` 唯一运行主体；`cloud/` 云端历史缓存（Cloudflare Worker + D1，v1.5.10）；`backend/` 旧电脑后端（历史参考 + verify:core 基准，勿删）；`releases/` APK 产物

> 所有对外解释必须简体中文；新版本发布后必须回写 docs/HANDOFF.md 并同步桌面副本 APK（详见 HANDOFF 第 9.1 节发版流程）。