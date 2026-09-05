# CS2 余额助手（手机版）

基于 PRD《CS2 武器箱跨市场倒余额分析系统》实现的**手机软件**：
C5GAME 买入 → 约 7 天限制期 → Steam Community Market 卖出，全程只做**分析 / 预测 / 提醒 / 记录**，不自动买卖。

## 技术架构

```
mobile/   Expo React Native (TypeScript)   —— iOS / Android 手机 App
backend/  Python + FastAPI + SQLAlchemy     —— 分析 API + 数据采集
docs/     DATA_SOURCE_REPORT.md             —— Phase 0 数据源调研报告
```

- 后端默认 SQLite（开发），可平滑切换 PostgreSQL；Docker 化
- 数据采集：APScheduler，默认每 30 分钟一次（可配置）
- Data Adapter 层：`SteamAdapter` / `C5GameAdapter`，更换数据源不改分析核心
- 手续费、7 天限制期全部**配置化 + 版本化**，不写死

## 模块与对应 PRD

| 模块 | 说明 | PRD 章节 |
|---|---|---|
| 收益模型 | 净到账 / 净利润 / ROI / 盈亏平衡价 / 三情景 | 五 |
| 7 天预测 | 基线动量模型，P10-P90 区间、盈利/亏损概率、置信度 | 六 |
| 监控池 | 核心池 Top 50、候选池 51-100、一键发现 | 四 |
| 机会雷达 | 🟢 买入 / 🟡 等待 / 🔴 不建议，综合评分 | 八 |
| 资金模拟 | 预算组合（稳健/平衡/激进）、目标余额反推、流动性上限 | 九 |
| 库存管理 | 录入、7 天倒计时、当前/解锁时估值 | 十 |
| 权限与提醒 | AlertRule / events / predictions 版本可追踪 | 七、十一 |

## 快速开始

### 1. 后端

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
copy .env.example .env          # 按需填写 C5_APP_KEY、STEAM_COOKIE
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- API 文档：http://localhost:8000/docs
- 健康检查：http://localhost:8000/api/v1/health

可选：Docker 启动 `docker compose up -d --build`

### 2. 手机 App

```bash
cd mobile
npm install
npx expo start                 # 扫码在真机运行 / 按 a 开 Android 模拟器
```

- 默认后端地址：Android 模拟器 `http://10.0.2.2:8000/api/v1`，iOS/Web `http://localhost:8000/api/v1`
- 真机：在 App「设置」页填入电脑局域网 IP，如 `http://192.168.1.5:8000/api/v1`

### 3. 数据采集

后端启动后调度器自动运行：每 30 分钟采集一轮价格，每 6 小时刷新成交榜监控池。
`Steam` 端无需密钥即可工作；`C5GAME` 需到 [开放平台](https://opendoc.c5game.com/) 申请 App-Key 填入 `.env`。

## API 一览（/api/v1）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| GET | `/radar` | 机会雷达全池信号 |
| GET | `/quote/{name}` | 单箱跨市场报价与收益 |
| GET | `/prediction/{name}` | 7 天预测区间与三情景 |
| GET | `/inventory` ｜ POST `/inventory` | 库存查询/录入 |
| GET | `/simulate?budget=&allocation=` | 预算组合模拟 |
| GET | `/simulate/reverse?target_balance=` | 目标余额反推 |

## 测试

```bash
cd backend
.venv\Scripts\python.exe -m pytest tests -q      # 28 个用例全部通过
cd mobile
npm run typecheck                                  # TypeScript 零错误
npx expo export --platform android                 # Metro 打包验证（606 模块）
```

## 阶段状态

- [x] Phase 0：数据源调研（docs/DATA_SOURCE_REPORT.md）
- [x] Phase 1：基础工程（骨架/数据库/配置/测试/容器）
- [x] Phase 2~9 核心：Adapter、收益、监控池、预测、雷达、资金模拟、库存、API、移动端 UI
- [ ] 待办：接入 C5GAME App-Key 实测、事件数据库扩充、回测面板、提醒推送、生产部署

## 合规声明

- 只分析不自动买卖；不登录用户账户、不绕过平台限制
- 采集频率遵守数据源限流，默认 30 分钟
- 所有外部数据保存 source + timestamp，禁止臆造市场数据
