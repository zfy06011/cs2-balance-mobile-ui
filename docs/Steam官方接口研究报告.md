# Steam 官方接口研究报告

> **研究日期**：2026-09-06
> **研究范围**：Steam 官方库存接口、历史价格接口、认证机制、开源实现参考
> **研究目的**：回答「为什么库存/历史获取失败」及「正确调用方式是什么」，为下一阶段实施提供依据
> **约束**：数据源必须来自 Steam 官方接口，不使用第三方 API 作为主要数据源

---

## 目录

1. [研究结论摘要（TL;DR）](#1-研究结论摘要)
2. [问题一：库存同步为空的根因分析](#2-库存同步为空的根因分析)
3. [问题二：历史价格导入失败的根因分析](#3-历史价格导入失败的根因分析)
4. [Steam 官方接口全览](#4-steam-官方接口全览)
5. [Steam 认证机制详解](#5-steam-认证机制详解)
6. [开源项目实现参考](#6-开源项目实现参考)
7. [候选方案对比](#7-候选方案对比)
8. [推荐方案与实施计划](#8-推荐方案与实施计划)
9. [2026-09-07 实测补充：gid 页 SSR 解析法（零 cookie 全量历史）](#9-2026-09-07-实测补充gid-页-ssr-解析法零-cookie-全量历史)

---

## 1. 研究结论摘要

### 库存问题

**根因已锁定**：Steam 社区库存接口（`steamcommunity.com/inventory/{id}/730/2`）对 CS2（appid 730）有**已知的特殊行为**——当所有物品处于交易保护期时，接口返回 `{ success: true, total_inventory_count: N }` 但 **`assets` 数组为空或不存在**。这不是 bug，而是 Valve 的设计：交易保护中的物品不在 context 2 返回里，需要单独请求 **context 16**。

**node-steamcommunity（DoctorMcKay，Steam 生态最权威的开源库）源码中有明确的特殊处理**：
```javascript
// CS inventory has no visible items. We need a special case for this
// because Valve is incapable of doing anything not dumb.
if (appID == 730 && body && body.success && !body.assets) {
    callback(null, [], [], body.total_inventory_count);
}
```

**推荐方案**：Web API（`IEconService/GetInventoryItemsWithDescriptions`）同时请求 context 2 + context 16 是正确的官方路径。当前项目的实现逻辑已经正确，**用户报告的「Web API 也不行」需要重试并抓取具体报错**（上次失败原因未留存）。

### 历史价格问题

**根因已锁定**：`/market/pricehistory/` 是一个**未公开的内部接口**，**必须**携带有效的 `steamLoginSecure` cookie（浏览器登录态），不支持 Web API Key。该用户的网络环境（中国大陆 + VPN）对该接口的 cookie 传递链路存在问题。

**推荐方案**：采用 **scm-price-history 开源项目的发现**——Steam 市场列表页（`/market/listings/{appid}/{name}`）是**公开可访问的**（无需登录），页面 HTML 中内嵌了 `var line1=[...]` 变量，包含完整的日线价格历史数据。当前项目的 `steam-hist` 模式已实现了这个方案，但需要确认其在用户环境是否可用。

---

## 2. 库存同步为空的根因分析

### 2.1 现象回顾

用户账号「言念如一」在 Steam 手机 App / 网页正常显示 14 件箱子（3× Dreams & Nightmares Case + 11× CS:GO Weapon Case），全部带交易保护盾（2025 Steam 新机制：交易收到的箱子 7 天内受保护）。App 所有库存同步方式均返回「空」。

### 2.2 根因：CS2 Context 2 vs Context 16

Steam 的 CS2 库存使用两个 context：

| Context | 含义 | 内容 |
|---------|------|------|
| **2** | 普通物品（已解锁） | 已完成交易保护期、可交易/可上架的物品 |
| **16** | 交易保护物品 | 正在交易保护期内的物品（收到后 7 天内） |

**关键事实**：社区库存接口（`/inventory/{id}/730/2`）**只返回 context 2 的物品**。当所有物品都在保护期内时，context 2 为空 → 返回 `total_inventory_count: N`（N>0）但 `assets` 为空数组或不存在。

**Web API（`IEconService`）**需要**分别请求 context 2 和 context 16**，然后合并结果。这是正确的官方做法。

### 2.3 为什么网页能看到而 JSON 为空？

Steam 库存网页（`steamcommunity.com/inventory/`）的渲染数据来自两条不同链路：

1. **页面源码内嵌数据**（`g_rgAssets` / `g_rgDescriptions`）：由服务端渲染注入，包含所有 context 的物品（含 context 16）。**这就是为什么网页能看到物品。**
2. **JSON API 接口**（`/inventory/{id}/730/2`）：客户端 JS 后续调用的接口，可能返回空。

当前项目的 `CookieLoginScreen.tsx`（`steam-inv` 模式）已实现了从 `g_rgAssets` 抓取数据的方案（INV_SCRIPT），这是正确的思路。**但需要注意**：该脚本的 `tryFetchInventory` 分支（当 `g_rgAssets` 不可用时的回退）仍然是调用 JSON 接口，可能仍然拿到空数据。

### 2.4 已验证的事实汇总

| 通道 | 结果 | 分析 |
|------|------|------|
| 社区接口 `/inventory/{id}/730/2`（匿名） | 200 + 空 | **符合预期**：context 2 无物品（全在保护期） |
| 同上 + 登录 cookie | 200 + 空 | **符合预期**：cookie 不改变 context 返回逻辑 |
| 同上 + 会话内 fetch | 200 + 空（total 0） | **需要重试**：可能是 context 2 独查的结果 |
| Web API `IEconService`（用户 Key） | 用户报「不行」 | **需要抓具体报错**（403？429？IP？） |
| 页面直抓 `g_rgAssets` | **未实测**（打包后未反馈） | **当前最大希望** |
| C5 官方库存通道 | 已实现，待用户测试 | 走 C5 服务器拉 Steam，不受用户网络限制 |

### 2.5 关键问题：Web API 为什么「也不行」？

可能原因（按概率排序）：

1. **只请求了 context 2，没有请求 context 16**：当前代码已修复（`fetchSteamInventoryWebApi` 同时请求两个 context），但用户测试的版本可能还未包含此修复
2. **Web API Key 无效或未绑定**：免费 Key 在 `steamcommunity.com/dev/apikey` 申请，需与 SteamID 关联
3. **IP 限制**：`api.steampowered.com` 在中国大陆可能受 GFW 影响
4. **请求频率**：429 限流

**下一步**：让用户重新测试 Web API 通道，同时抓取 HTTP 状态码和响应体。

---

## 3. 历史价格导入失败的根因分析

### 3.1 接口特性

`/market/pricehistory/` 是 Steam 的**未公开内部接口**：

- **必须**携带 `steamLoginSecure` cookie（浏览器登录态）
- **不支持** Web API Key 认证
- **不支持** OAuth / Access Token
- 响应格式：JSON `{ success: true, prices: [["MMM DD YYYY HH: +0", price, volume], ...] }`
- 未登录时返回 401 或重定向到登录页

### 3.2 为什么 cookie 从 WebView 搬到 RN fetch 不可靠？

当前项目的 `steam-hist` 模式已经发现并解决了这个问题：

- **问题**：RN 的 `fetch` 与 WebView 的 cookie jar 是**隔离的**。即使 WebView 里登录了，RN fetch 带的 cookie 可能不完整或已过期
- **解决方案**：直接在 WebView 页面内用 `fetch`（`{credentials:'include'}`）调用接口，这样走的是 WebView 的 cookie jar

### 3.3 为什么「会话内导入历史」也可能失败？

`steam-hist` 模式（在登录态页面内逐箱 fetch 市场列表页提取 `line1`）**理论上不需要调用 pricehistory API**，它走的是公开的市场列表页。如果这个方案也失败，可能原因：

1. **Steam 对自动化请求的检测**：即使在 WebView 内，频繁 fetch 也可能触发反爬
2. **VPN 节点被 Steam 限流**：同一 IP 高频请求被标记
3. **页面格式变化**：`var line1=` 变量可能在新版页面中不再存在（需要检查是否有其他内嵌格式）

### 3.4 scm-price-history 的关键发现

开源项目 `scm-price-history`（HilliamT/scm-price-history）发现了一个重要事实：

**Steam 市场列表页（`/market/listings/{appid}/{name}`）是公开可访问的，无需登录**。页面 HTML 中内嵌了完整的价格历史数据（`var line1=[...]`），格式与 pricehistory API 返回的一致。

这意味着：**价格历史数据实际上不需要登录就能获取**，只是不能通过专门的 pricehistory API 端点获取，而是通过解析公开的市场列表页。

当前项目的 `steam-hist` 模式已实现了这个方案。**需要确认该方案在用户环境是否可用**。

---

## 4. Steam 官方接口全览

### 4.1 库存相关接口

| 接口 | URL | 认证 | 说明 |
|------|-----|------|------|
| **社区库存** | `steamcommunity.com/inventory/{steamid}/{appid}/{contextid}` | Cookie（可选） | 现代端点，支持 `start_assetid` 分页；context 2 可能漏掉保护物品 |
| **Web API 库存** | `api.steampowered.com/IEconService/GetInventoryItemsWithDescriptions/v1/` | Web API Key | 需分别请求 context 2 和 context 16；保护物品带 `cache_expiration` |
| **页面数据** | `steamcommunity.com/profiles/{steamid}/inventory/` | Cookie | 服务端渲染，`g_rgAssets` 包含所有 context |

**参数详解（社区库存）**：
- `l=schinese`：返回中文名
- `count=2000`：每页最大数量（未登录实际只返回 ~10 条）
- `start_assetid`：游标分页

**参数详解（Web API 库存）**：
- `key`：免费 Web API Key
- `steamid`：SteamID64
- `appid=730`：CS2
- `contextid=2` 或 `contextid=16`：分别请求
- `get_descriptions=true`：返回物品描述（含 `market_hash_name`）

### 4.2 价格相关接口

| 接口 | URL | 认证 | 说明 |
|------|-----|------|------|
| **当前价格** | `steamcommunity.com/market/priceoverview/` | 无（公开） | 返回 lowest_price / median_price / volume |
| **价格历史** | `steamcommunity.com/market/pricehistory/` | **Cookie 必需** | 未公开接口，返回日线数据 |
| **搜索/热门** | `steamcommunity.com/market/search/render/` | 无（公开） | 支持热门榜/成交量排序，未登录单页 ~10 条 |
| **市场列表页** | `steamcommunity.com/market/listings/{appid}/{name}` | **无（公开）** | HTML 页面，内嵌 `var line1=[...]` 价格历史 |
| **Web API 资产价格** | `api.steampowered.com/ISteamEconomy/GetAssetPrices/v1/` | Web API Key | 当前价格，非历史 |

### 4.3 认证方式汇总

| 方式 | 适用接口 | 获取方式 | 有效期 |
|------|----------|----------|--------|
| **匿名** | priceoverview, search/render, market/listings | 无需 | N/A |
| **steamLoginSecure Cookie** | pricehistory, 私密库存, 市场操作 | 浏览器登录 / WebView 登录 | 数小时至数天（IP 变化可能失效） |
| **Web API Key** | IEconService, ISteamEconomy | `steamcommunity.com/dev/apikey`（免费） | 永久（除非违规被封） |
| **Access Token (JWT)** | 移动端专用功能 | `steam-session` 库生成 | 有有效期 |

---

## 5. Steam 认证机制详解

### 5.1 Cookie 认证

`steamLoginSecure` 格式：`<SteamID64>||<40字符十六进制令牌>`

**完整 cookie 列表**：
| Cookie | 用途 | 是否必需 |
|--------|------|----------|
| `steamLoginSecure` | 主认证凭证（HTTPS-only） | ✅ 必需 |
| `sessionid` | CSRF 令牌（POST 请求需要） | POST 时必需 |
| `steamMachineAuth` | Steam Guard 机器授权 | 增强安全性 |
| `steamLogin` | 旧版认证（逐步淘汰） | 不必需 |

**获取方式**：
1. **浏览器登录**：用户在 `steamcommunity.com` 正常登录，cookie 自动设置
2. **App 内 WebView 登录**：当前项目已实现（`CookieLoginScreen`），通过原生 `CookieManager` 读取 HttpOnly cookie
3. **steam-session 库**（node-steamcommunity 使用）：编程模拟登录流程，支持 Steam Guard

### 5.2 Web API Key

- **获取**：登录状态下访问 `steamcommunity.com/dev/apikey`，同意条款即获得
- **类型**：用户级（免费，任何 Steam 账号可申请）vs 发行商级（需 Steamworks 合作伙伴账号）
- **使用**：作为 `key=` 查询参数或 `x-webapi-key` HTTP 头发送
- **限制**：免费 Key 可访问大部分公开方法；部分敏感方法（经济操作、销售数据）需发行商 Key

### 5.3 移动端认证

Steam 移动端使用与 Web 相同的 cookie 认证，但通过 `MobileWebAuth` 流程会额外返回 `oauth_token`（用于交易确认等移动专有功能）。**对于库存/价格查询，移动端和 Web 端使用完全相同的接口。**

### 5.4 中国区域特殊考虑

- `steamcommunity.com` 在中国大陆可能被 GFW 干扰，需要 VPN
- VPN 切换 IP 可能导致 `steamLoginSecure` session 失效
- VPN 的 IP 可能在 Steam 的限流/反爬名单上，导致更严格的 429/验证码
- `api.steampowered.com`（Web API 主机）的可访问性与 `steamcommunity.com` 不同，需分别测试
- `currency=23`（CNY）参数不受物理位置影响

---

## 6. 开源项目实现参考

### 6.1 node-steamcommunity（DoctorMcKay）

**最权威的参考**——Steam 社区交互的事实标准库。

**库存获取**：
- 使用现代端点 `/inventory/{steamid64}/{appid}/{contextid}`
- 支持 `start_assetid` + `count`（最大 1000）分页
- **CS2 特殊处理**：当 `success=true` 但无 `assets` 时，返回空数组而非报错
- 通过 `g_rgAppContextData` 发现可用的 inventory context

**价格历史**：
- 通过 `/market/listings/{appid}/{name}` 页面获取（不是 pricehistory API）
- 页面内嵌数据由上层库解析

**认证**：
- 支持 cookie jar（`request` 模块）
- 支持 `steam-session` 库的编程登录（WebBrowser / MobileApp 平台）
- 支持 Mobile App Access Token（JWT）

### 6.2 scm-price-history（HilliamT）

**关键创新**：发现市场列表页内嵌价格历史数据，无需登录。

- 端点：`steamcommunity.com/market/listings/{appid}/{market_hash_name}`（**公开**）
- 解析：提取 `var line1=[...]` JavaScript 变量
- 格式：`["MMM DD YYYY HH: +0", median_price, volume]`
- **无需任何认证**

### 6.3 node-steam-market-fetcher（SnaBe）

提供了 Steam 市场 API 的完整封装，确认了各端点的认证需求：

| 方法 | 端点 | 需要认证 |
|------|------|----------|
| `getItemPrice()` | `/market/priceoverview/` | ❌ |
| `getItemPriceHistory()` | `/market/pricehistory/` | ✅ steamLoginSecure |
| `getMarketListings()` | `/market/search/render/` | ❌ |
| `getItemHistogram()` | `/market/itemordershistogram` | ❌ |
| `getMyListings()` | `/market/mylistings` | ✅ |

### 6.4 SteamKit2（.NET）

底层 Steam 客户端协议库，不直接处理库存/市场 HTTP API。提供 `WebAPI` 通用接口调用任何 Steam Web API 端点。认证走 Steam CM 服务器协议（用户名/密码/Steam Guard），不使用 cookie。

---

## 7. 候选方案对比

### 7.1 库存获取方案

| 方案 | 端点 | 认证 | 含保护物品 | 网络依赖 | 已实现 | 推荐度 |
|------|------|------|-----------|----------|--------|--------|
| **A. Web API + 双 Context** | `IEconService/GetInventoryItemsWithDescriptions` | Web API Key（免费） | ✅ context 16 | `api.steampowered.com` | ✅ | ⭐⭐⭐⭐⭐ |
| **B. C5 官方库存** | `openapi.c5game.com/merchant/inventory/v2/` | C5 app-key | ✅ | `openapi.c5game.com` | ✅ | ⭐⭐⭐⭐ |
| **C. 社区接口 + 双 Context** | `steamcommunity.com/inventory/.../{2,16}` | Cookie（可选） | ⚠️ context 16 不稳定 | `steamcommunity.com` | ✅ | ⭐⭐⭐ |
| **D. 页面直抓 g_rgAssets** | WebView 内库存页 | Cookie（登录态） | ✅ | WebView 页面 | ✅ | ⭐⭐⭐ |
| **E. 会话内 fetch（WebView）** | 同 A/C 但在 WebView 内 | Cookie（登录态） | ⚠️ 同 A/C | WebView 页面 | ✅ | ⭐⭐⭐ |

**推荐优先级**：A → B → D → C → E

- **方案 A（Web API + 双 Context）** 是纯正的官方接口，最可靠。关键是确认用户 Web API Key 的有效性并同时请求 context 2 和 16
- **方案 B（C5 官方库存）** 走 C5 服务器中转，不受用户网络限制，是很好的备选
- **方案 D（页面直抓）** 最终兜底：页面能看到 = 一定能抓到

### 7.2 历史价格获取方案

| 方案 | 端点 | 认证 | 数据范围 | 已实现 | 推荐度 |
|------|------|------|----------|--------|--------|
| **A. 市场列表页 line1 提取** | `/market/listings/{appid}/{name}` | **无需登录** | 完整日线 | ✅ steam-hist | ⭐⭐⭐⭐⭐ |
| **B. pricehistory API** | `/market/pricehistory/` | Cookie 必需 | 完整日线 | ✅ | ⭐⭐⭐ |
| **C. 快速补历史（priceoverview）** | `/market/priceoverview/` | 无需 | 仅当前价 | ✅ backfill | ⭐⭐⭐ |
| **D. Skinport 成交历史** | `api.skinport.com/v1/sales/history` | 无需 | 7/30/90/365 天聚合 | ✅ | ⭐⭐⭐（辅助） |
| **E. 第三方付费源** | cs2.sh Scale 档 / Pricempire | API Key | 全历史 | ❌ | ⭐⭐（备选） |

**推荐优先级**：A → B → C → D → E

- **方案 A（line1 提取）** 是最重要的发现：公开页面内嵌完整价格历史，无需登录。当前项目已实现（steam-hist 模式）
- **方案 B（pricehistory API）** 需要有效 cookie，在用户环境不可靠
- **方案 C（快速补历史）** 每次扫描产生 1-2 个点，多次积累可达到 4+ 点阈值

> **2026-09-07 更正**：本章生成本报告当日尚未实测 gid 页。实测后确认——**gid 页 SSR 数据（方案 F）取代 line1 成为主通道**（零 cookie、2013 至今全量日线 + 近期小时粒度 + 盘口深度，CS:GO Weapon Case 实测 5202 点）。详见 [#9](#9-2026-09-07-实测补充gid-页-ssr-解析法零-cookie-全量历史)。line1 仅作旧版页面兜底。

---

## 8. 推荐方案与实施计划

### 8.1 库存问题：推荐方案

**主路径：Web API + 双 Context（方案 A）**

1. **立即行动**：让用户重新测试 Web API 通道
   - 确认 Web API Key 在 `steamcommunity.com/dev/apikey` 有效
   - 确认代码同时请求了 context 2 和 context 16（当前 `fetchSteamInventoryWebApi` 已实现）
   - 抓取具体的 HTTP 状态码和响应体（403=key 问题？429=限流？其他？）

2. **备选路径：C5 官方库存（方案 B）**
   - 用户已有 C5 app-key
   - `syncSteamInventorySmart` 已将 C5 设为首选通道
   - 走 C5 服务器拉 Steam，不受用户网络限制

3. **最终兜底：页面直抓（方案 D）**
   - `CookieLoginScreen.tsx` 的 `INV_SCRIPT` 已实现
   - 需要用户完成 Steam 一键登录后在库存页测试

### 8.2 历史价格问题：推荐方案

**主路径：市场列表页 line1 提取（方案 A）**

1. **立即行动**：让用户测试「会话内导入历史」功能
   - 确认页面右上角显示已登录状态
   - 点击「开始导入」观察结果
   - 如果全部失败，查看 Steam 原始返回片段诊断

2. **备选路径：快速补历史（方案 C）**
   - 多次运行「⚡ 快速补历史」，每次扫描产生 1-2 个点
   - 积累到 4+ 点即可解除「历史不足」标记

3. **长期方案**：
   - 如果 line1 提取在用户环境稳定可用，作为主要历史数据源
   - Skinport 成交统计作为辅助参考（免登录）
   - 考虑 cs2.sh 付费档（Scale）如果用户愿意付费

### 8.3 需要修改的代码模块

| 模块 | 文件 | 修改内容 | 优先级 |
|------|------|----------|--------|
| Web API 库存 | `steam.ts#fetchSteamInventoryWebApi` | ✅ 已完成并打包（v1.5.2 / versionCode 18）：双 context 确认正确；错误消息带 HTTP 状态码 + Steam 原始返回片段（≤200 字符）；context 16 失败经 `ctx16Error` 透出并显示 | 高 |
| ~~C5 库存~~ | ~~`c5.ts#fetchC5Inventory`~~ | ❎ 不采用（用户拍板「库存只用 Steam Web API」）；C5 仅保留价格采集 | 高 |
| 智能同步 | `engine.ts#syncSteamInventorySmart` | ✅ 已完成：单通道 Web API 双 Context；返回 `source: 'steam_webapi'` + `ctx16Error` | 中 |
| 历史导入 | `CookieLoginScreen.tsx` steam-hist | 已实现（市场列表页 line1 提取，免登录），待用户测试确认 | 高 |
| 快速补历史 | `collector.ts` backfill 模式 | 已实现（priceoverview 无登录兜底 + 仍不足 4 点统计） | 低 |
| 诊断增强 | 各错误路径 | ✅ 库存路径（v1.5.2）与历史路径（histFailReason/原始片段）已完成 | 中 |

> **实施状态备注（2026-09-06）**：按用户决策，库存方案收敛为**仅 Steam Web API 双 Context**
> （方案 A 主路径，方案 B/C/D/E 均不采用）；历史以方案 A（line1 提取）为主、
> 方案 C（快速补历史）为无登录兜底。当前验证：typecheck 零错误；verify:core 221/221。

### 8.4 验证计划

1. **库存验证**：
   - 用户在 App 中点击「⟳ 同步 Steam 库存」→ 确认走 Web API 通道
   - 预期结果：14 件箱子（3 + 11），显示来源为 `steam_webapi`
   - 如果仍为空：切换到 C5 通道测试

2. **历史验证**：
   - 用户在 App 中点击「🔁 会话内导入历史」
   - 预期结果：成功导入 ≥10 个箱子的历史数据
   - 如果全部失败：检查原始返回片段，判断是网络问题还是页面格式变化

3. **端到端验证**：
   - 库存同步成功后，库存页应显示 14 件物品及冷却倒计时
   - 历史导入成功后，雷达页不应再显示「历史不足」
   - 详情页应显示完整的价格趋势图

---

## 附录 A：Steam 接口速查表

```
# 库存（社区，公开）
GET https://steamcommunity.com/inventory/{steamid}/730/2?l=schinese&count=2000
GET https://steamcommunity.com/inventory/{steamid}/730/16?l=schinese&count=2000

# 库存（Web API，需 Key）
GET https://api.steampowered.com/IEconService/GetInventoryItemsWithDescriptions/v1/?key={key}&steamid={sid}&appid=730&contextid=2&get_descriptions=true
GET https://api.steampowered.com/IEconService/GetInventoryItemsWithDescriptions/v1/?key={key}&steamid={sid}&appid=730&contextid=16&get_descriptions=true

# 当前价格（公开）
GET https://steamcommunity.com/market/priceoverview/?appid=730&currency=23&market_hash_name={name}

# 搜索/热门（公开，未登录单页 ~10 条）
GET https://steamcommunity.com/market/search/render/?appid=730&norender=1&query=&start=0&count=100&sort_column=popular&sort_dir=desc&l=schinese&category_730_Type[]=tag_CSGO_Type_WeaponCase

# 价格历史（需 Cookie）
GET https://steamcommunity.com/market/pricehistory/?appid=730&market_hash_name={name}

# 市场列表页（公开，内嵌 line1 价格历史）
GET https://steamcommunity.com/market/listings/730/{market_hash_name}

# C5 官方库存（需 app-key）
GET https://openapi.c5game.com/merchant/inventory/v2/{steamId}/730?language=zh&startAssetId=0&app-key={key}

# C5 批量价格（需 app-key）
POST https://openapi.c5game.com/merchant/product/price/batch?app-key={key}
Body: {"appId":"730","marketHashNames":["..."]}
```

## 附录 B：node-steamcommunity CS2 库存特殊处理源码

来自 `DoctorMcKay/node-steamcommunity` 的 `components/users.js`：

```javascript
// Modern inventory endpoint
CEconItem = require('./classes/CEconItem.js');

SteamCommunity.prototype.getUserInventoryContents = function(sid, appID, contextID, tradableOnly, callback) {
    // ... 构建请求 ...
    request(url, (err, response, body) => {
        // ...
        if (appID == 730 && body && body.success && !body.assets) {
            // CS inventory has no visible items. We need a special case for this
            // because Valve is incapable of doing anything not dumb.
            callback(null, [], [], body.total_inventory_count);
            return;
        }
        // ... 正常解析 assets/descriptions ...
    });
};
```

## 附录 C：scm-price-history 无登录获取价格历史

来自 `HilliamT/scm-price-history` 的核心逻辑：

```typescript
// 无需登录，直接抓取公开的市场列表页
const response = await axios.get(
    `https://steamcommunity.com/market/listings/${appid}/${market_hash_name}`
);
const html = response.data;

// 提取内嵌的 line1 变量（价格历史数据）
const match = html.match(/var line1\s*=\s*(\[.*?\]);/s);
if (match) {
    const prices = JSON.parse(match[1]);
    // prices 格式: [["Jun 01 2014 01: +0", 0.12, 15], ...]
}
```

---

## 9. 2026-09-07 实测补充：gid 页 SSR 解析法（零 cookie 全量历史，取代 line1 成为主通道）

> **研究日期**：2026-09-07。本报告 7.2 / 8.2 曾推荐 line1 提取为主通道；**实测后更正**：
> Steam 市场「gid 页」（重定向终态页）内嵌的 SSR 数据是当前**唯一可靠、零 cookie、全量**的历史通道，
> 且比 line1 数据更全（日线 + 近期小时粒度 + 盘口深度）。line1 仅作旧版页面兜底。

### 9.1 访问路径与重定向

```
GET https://steamcommunity.com/market/listings/730/{urlencode(market_hash_name)}
  → 302 重定向 → https://steamcommunity.com/market/listings/730/G18A11F3004   （gid 页）
```

- 名称页（含中文/空格等特殊字符）会被 302 改写为 `/listings/730/{GID}`；GID 格式：**`G` + 10 位大写十六进制**（共 11 字符，如 `G18A11F3004`）
- 跟随重定向后抓终态页 HTML 即可，**无需任何 cookie**

### 9.2 内嵌 SSR 数据结构

页面内一行：

```html
<script>
window.SSR.renderContext=JSON.parse("...");  // 注意：双重编码 JSON 字符串
</script>
```

解析步骤（实测 CS:GO Weapon Case，2026-09-07 抓取）：
1. 提取 `window.SSR.renderContext=JSON.parse(` 后的引号字符串 → `JSON.parse` → **得到一段 JSON 字符串**（双重编码）
2. 对该字符串再 `JSON.parse` → `renderContext` 对象：`{ localizationSettings, queryData, cookiePrefs, manifest }`
3. `renderContext.queryData` 是 JSON 字符串 → 再 parse → `{ mutations, queries }`
4. `queries[]` 中找 `queryKey: ["market", "pricehistory", 730, "<名称>"]` → `state.data.prices`
5. `prices` 每项是对象 `{ time: unix秒, price_median: 元, purchases: 成交量 }`

同页另有 `queryKey: ["market", "orderbook", 730, "<名称>"]` → `state.data` 里的买卖盘深度：
`amtMaxBuyOrder / amtMinSellOrder / eCurrency / rgCompactBuyOrders / rgCompactSellOrders`。

### 9.3 实测数据（CS:GO Weapon Case，G18A11F3004）

| 指标 | 实测值 |
|------|--------|
| 价格点数 | **5202 个**（2013-08-14 → 2026-09-06） |
| 粒度 | 日粒度为主 + 近期小时粒度（2013 至今全量） |
| 货币 | currency=23（CNY），价格用页面 `price_prefix/suffix` 还原 |
| 买单深度 | `rgCompactBuyOrders` 2900 档（最高么买价 `amtMaxBuyOrder`=93000） |
| 卖单深度 | `rgCompactSellOrders` 668 档（最低卖价 `amtMinSellOrder`=96673） |

> 同一时间 `pricehistory/?appid=730&market_hash_name=..` 未登录实测返回 `[]`（HTTP 400），
> 说明 gid 页 SSR 是真正零 cookie 的官方全量数据通道，云端（海外出口）可直连。

### 9.4 与既有通道对比（更正 7.2）

| 方案 | 端点 | 认证 | 数据范围 | 结论（2026-09-07） |
|------|------|------|----------|--------------------|
| **F. gid 页 SSR（新主通道）** | `/market/listings/730/{gid}` 重定向终态页 | **零 cookie** | 2013 至今全量日线 + 近期小时 + 盘口深度 | ⭐⭐⭐⭐⭐ **云端缓存方案的基础** |
| A. 市场列表页 line1 提取 | `/market/listings/730/{name}` | 零 cookie | 完整日线（无小时粒度/盘口） | ⭐⭐⭐⭐ 旧版页面兜底 |
| B. pricehistory API | `/market/pricehistory/` | Cookie 必需 | 完整日线 | ⭐⭐ 云端不可用 |
| C. 快速补历史（priceoverview） | `/market/priceoverview/` | 无需 | 仅当前价 | ⭐⭐⭐ 实时通道 |
| E. 第三方付费源 | cs2.sh / Pricempire | API Key | 全历史 | ⭐⭐ 备选 |

### 9.5 落地：云端历史缓存（cloud/，v1.5.10）

- 新目录 `cloud/`：Cloudflare Worker + D1 定时抓 gid 页入库（cron `*/15 * * * *`，热门武器箱 Top-100）
- 公开只读 API：`GET /history?name=..&days=120` → `{ name, price_prefix, points:[[ts,price,volume],..] }`
- App 端「🔁 快速导入历史」优先走云端（设置页填 Worker 地址，零登录），失败回退 C5 官方趋势
- 详见 `docs/数据调用链路.md` 第 6 章与 `cloud/` 源码（`src/steam.ts`、`src/worker.ts`）

---

## 附录 D：gid 页 SSR 解析参考（cloud/src/steam.ts 已实现，8/8 单测通过）

```typescript
// cloud/src/steam.ts：parseSSR / extractPriceHistory / extractOrderbook
// 关键点：
// 1) JSON.parse 外层 → 得到字符串 → 再 JSON.parse 才是 renderContext 对象（双重编码）
// 2) renderContext.queryData 也是字符串 → 再 parse 得 queries[]
// 3) 找 queryKey[0..1] === ['market','pricehistory'] → state.data.prices
// 4) 旧格式兜底：var line1 = [["Jun 01 2014 01: +0", 0.12, 15], ...]
// 5) gid 提取：/\/market\/listings\/730\/(G[0-9A-F]{10})/i（11 字符，G + 10 位 hex）
// 6) orderbook：queryKey[0..1] === ['market','orderbook'] → state.data 盘口字段
```

*报告完成。本报告结论已落地为 `cloud/`（Worker + D1）+ App v1.5.10 云端历史通道。*
