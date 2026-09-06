# cs2-price-history（Cloudflare Worker + D1）

Steam CS2 武器箱历史价格云端缓存：定时抓取 **Steam 市场 gid 页 SSR 数据**
（零 cookie、2013 年至今全量日线 + 近期小时粒度 + 盘口深度），App「快速导入历史」零登录拉取。

实验结论见 `../docs/Steam官方接口研究报告.md` 第 9 章；App 接入见 `../docs/数据调用链路.md` 第 6 章。

## 两种运行模式

1. **Worker 直采（v1 默认）**：Cloudflare 海外出口直连 Steam 抓 gid 页入库。
   免费版 Worker CPU 限额 10ms/调用，整轮抓 100 页会超限——建议 Workers Paid（CPU 30s），
   或降低 `MAX_ITEMS_PER_RUN` / 加密 cron 频率分摊。
2. **本机采集器 + Worker 只做存储（兜底）**：若 Steam 对数据中心 IP 风控（403/captcha），
   在国内本机（复用 Steam++ 反代）抓 gid 页 → `POST /ingest` 写 D1，Worker 只提供读 API。
   部署后设置 `npx wrangler secret put INGEST_TOKEN`，本机脚本带 `Authorization: Bearer <token>` 即可。

## 部署步骤

```powershell
cd cloud
npm i -D                                  # 安装 wrangler
npx wrangler login                        # 登录 Cloudflare（首次）
npx wrangler d1 create cs2-price-history  # 创建 D1，把返回的 database_id 填进 wrangler.toml
npm run db:remote                         # 执行 schema.sql 建表
npm run deploy                            # 部署 Worker + Cron
npx wrangler secret put INGEST_TOKEN      # 可选：/ingest 写入口鉴权
```

部署后验证：

```powershell
# 健康检查（部署完成后 Worker 域名如 https://cs2-price-history.xxx.workers.dev）
curl https://<worker>.workers.dev/health
curl "https://<worker>.workers.dev/history?name=CS%3AGO%20Weapon%20Case&days=120"   # 首次需等一轮 cron 采集
curl "https://<worker>.workers.dev/items?limit=10"
```

## 本地开发

```powershell
npm test        # 解析单测（fixtures/gid_page.html 实测页，8 项）
npx wrangler dev --local                  # 本地跑 Worker（D1 用 --persist 落盘）
npm run db:local                          # 本地 D1 建表（--local）
```

## 参数（wrangler.toml [vars]，均可调）

| 变量 | 默认 | 说明 |
|------|------|------|
| `MAX_ITEMS_PER_RUN` | 100 | 每轮最多采集箱数 |
| `CONCURRENCY` | 3 | 并行抓取数（过高易被 Steam 限流） |
| `STEAM_TIMEOUT_MS` | 10000 | 单请求超时 |
| `STEAM_RETRIES` | 2 | 失败重试次数（403/429 额外退避） |
| `REQUEST_DELAY_MS` | 400 | 请求间延迟 |
| `HISTORY_DAYS` | 3650 | 入库保留天数（默认全量） |
| `TOP_CASES` | 100 | 热门武器箱榜前 N |
| `DEFAULT_HISTORY_DAYS` | 120 | `/history` 默认返回天数 |
