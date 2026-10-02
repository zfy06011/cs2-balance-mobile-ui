# 宇额助手：数据链路与比价验证

更新：2026-10-02（Asia/Shanghai）。用户已确认 MVP 需求，指示“按开发流程开发项目，卡住的可以跳过”，并在推荐 Kotlin + Jetpack Compose 后回复“继续”。当前执行者：Codex，使用 pwsh 7、Node.js 24.15.0、Python 静态解析及连接器，可读写仓库、运行非 Android 本地检查、读取 GitHub 仓库信息。目标分支 `codex/mvp`，本轮基准 `6360420`；未设置远端、未推送或运行云端构建。

**状态：执行中。用户在推荐 Kotlin + Jetpack Compose 方案后明确回复“继续”，据此按推荐方案建立 Android MVP。真实接口、费用与手机性能仍未验证，未授权推送。**

## Android MVP 接续（2026-10-02）

- 当前目标分支 `codex/mvp`，本轮基准 `6360420`，执行工具 Codex／pwsh 7／Node 24；不安装或运行本地 Android 工具链。
- 技术方案按用户“继续”授权执行：Kotlin + Jetpack Compose + Material 3，单应用模块，计算／网络／本地存储／ViewModel／页面分开；Android Keystore 加密 C5 key，私有原子文件存缓存与候选池。小规模本地数据无需服务器或数据库迁移。
- 实现三个主页面与商品详情：缓存优先、手动整批或单项刷新、失败旧完整结果分开显示、候选增删与校验、隐藏凭证保存和删除、实际手续费观察文件导入。
- 新包名 `com.cs2balance.assistant.mvp`、开发版本 `0.1.0`／1，与历史应用隔离；只配置 debug 试用包，不确定正式签名或发布身份。测试样本不打入生产资产。
- 请求按受控工具规则串行、同源至少 3 秒、429 停止当前来源并持久化冷却、5xx 有限重试；C5 接口未实测和 Steam 匿名稳定性保持待验证，不加入交易或登录功能。
- 云端检查复用 Node 验证，再增加 Android JVM 测试、lint 和 debug APK 构建，实际检出 SHA 写入构建信息。尚无远端；源码和配置完成后再请用户提供目标仓库并确认推送。
- 完成标准仍是四项功能完整实现与实际验证；源码检查不能代替云端编译和真机。前文的技术栈等待已由本次继续指示解除，下文历史阻塞仅保留追溯。

### Android 实现结果与检查

- `android/` 已建立原生单应用工程：AGP 8.13.2、Gradle 8.13（仅云端安装）、JDK 17（仅云端）、Kotlin／Compose 编译插件 2.3.21、Compose BOM 2025.12.01、Activity 1.11.0、Lifecycle 2.9.4、coroutines 1.10.2、serialization 1.9.0，minSdk 26／targetSdk 36。版本兼容参考 [AGP 官方表](https://developer.android.com/build/releases/agp-8-13-0-release-notes)、[Kotlin 官方表](https://kotlinlang.org/docs/gradle-configure-project.html)；所用 BOM、Activity、Lifecycle、serialization、Kotlin 版本的官方 Maven POM 本轮读取为 HTTP 200，尚未完成实际依赖解析和编译。
- `domain/` 迁移整数分金额、精确手续费逆向、排序、候选范围与唯一性、真实观察核对、逐项快照更新；Kotlin 与 Node 共享字面契约，额外禁止“每100元所需现金”显示金额溢出安全整数。仅匹配本轮完整报价、映射与已核验费用才入榜。
- `data/` 实现 C5 批量与 Steam 人民币读取、超时和响应大小限制、串行／同键在途合并、429 停当前来源、持久化冷却与请求起始时间、跨扫描／重启请求间隔、5xx 最多两次重试。Android 传输只声明 gzip／deflate；不像 Node 工具支持 br／zstd，其他编码明确失败。C5 对此接入是否接受仍待实测，不声称接口已可用。
- `CacheStore` 使用私有 no-backup 目录与 AtomicFile 保存候选、费用配置、当前扫描、旧完整结果和限流状态；逐项保存，中断时保留已完成项。损坏数据报错并保留原文件，未增加自动删除或重置冷却。C5 key 单独使用 Android Keystore AES-GCM 加密，禁备份、禁明文日志、输入不进入可保存的 UI 状态，保存后清空输入，读取失败仍可重新保存／删除。实现依据 [Android Keystore 官方文档](https://developer.android.com/privacy-and-security/keystore)。
- `BalanceViewModel` 与 `ui/` 连通排行、失败与旧结果、比价详情和单项刷新、候选池增删与范围校验、凭证配置和真实观察文件选择。扫描启动冻结候选与手续费，阻止重复启动和扫描期间修改；返回列表保留滚动位置，恢复中断扫描显示未完成状态，浅／深色和系统 Insets 已在源码处理。
- 源码审查已修正：旧 Android 的文件读取兼容性、平板宽度约束、放大文字时分类按钮换行、凭证错误提示消失后仍可删除、不同扫描间请求间隔丢失、金额显示溢出。页面已完成一次源码层审查与调整，但没有渲染、TalkBack 或性能证据，不能给出 UI 已验证或 premium 评分。
- `.github/workflows/validation.yml` 扩展为 `Data validation (Node 24)` → `Android JVM tests, lint and debug APK` 两项必需检查。命令为 `gradle --project-dir android --no-daemon --console=plain :app:testDebugUnitTest :app:lintDebug :app:assembleDebug`；无本地 Gradle Wrapper，云端由 setup-gradle 安装固定 8.13 后运行。构建通过后上传 APK、aapt 实际身份／版本、实际 `git rev-parse HEAD`、APK SHA-256 和 run URL；PR 构建检出的合并 SHA 按实际值记录。无正式发布步骤。
- JVM 测试已编写 10 项，覆盖同一契约的费用／精确排序、部分失败旧完整结果、默认候选和皮肤排除、未填写观察模板、币种与超长 ID、429／冷却恢复、5xx 上限、同键合并与跨批次间隔；**NOT RUN**，必须在云端实际运行后才能判定通过。
- **PASS（本地）**：现有 Node 受控测试 17／17；Tree-sitter 解析 17 个 Kotlin／Gradle 源文件、XML 解析、工作流 YAML 与内嵌 Python 语法检查、diff 空白检查。Python 检查工具安装在 Git 忽略的 `.local/check-tools`，不包含 JDK／Gradle／Android SDK，也未作为源码或应用依赖提交。静态解析不验证类型、API 可用性、lint 或应用运行。
- **未检查／卡点**：Android 依赖解析、JVM 测试、lint、编译和 APK 尚未运行；真实接口、人民币费用、手机网络与 UI 仍未验证。debug 签名尚未固定到持久的私有 CI 配置，不承诺后续不同构建可直接覆盖安装，正式签名另行决定。
- GitHub 连接器已读到 `zfy06011/cs2-balance-mobile-ui`（公开仓库，默认分支 `codex/ui-redesign`，有 push 权限），这是可选云端构建目标，**未设为 origin，未创建或修改远端分支**。下一步确认是否向该仓库的新 `codex/mvp` 分支推送本次独立重写源码，并触发上述检查；不覆盖旧分支或合并／发布。用户也可指定另一仓库。
- 检查结论：四项 MVP 已有源码实现，尚不能交付“构建通过的应用”。缺少本次推送确认时跳过云端执行，保留源码和配置；项目目标继续有效，不能标记完成。

## 本轮开发计划与范围变更

最新用户指示允许跳过阻塞；因此下文旧阶段“真实验证通过后才规划页面与技术选型”的执行顺序已被本轮指示调整。跳过的是等待实测，不是将实测改为 PASS，也不删除测试或绕过报价入榜门槛。

- 已授权执行：继续当前四项 MVP，修复数据层缺陷、实现 Kotlin Android 工程和页面流程、建立本地版本控制及云端检查配置。真实 C5 凭证、手续费对话框和 Steam 页面核对暂记 BLOCKED／NOT TESTED。
- 技术方案已确认：用户在推荐方案后回复“继续”，按 Kotlin + Jetpack Compose + Material 3 原生 Android 执行；不再等待原技术栈选择卡。
- 页面：排行、候选池、设置为三个底部目的地；比价明细从排行／失败列表／候选商品打开，并可返回原列表位置。详情与排行读取同一结果对象。
- 默认清单：初版取现有 50 项清单的前 20 项；这只确认本地配置数量，不代表商品名称、接口可用性或性能已实测。候选池支持精确 hashName 添加／删除，限制 50 个、禁止重复；编辑只影响下一批扫描。
- 排行：打开先读缓存，不自动联网。底部主按钮“开始扫描”，扫描中显示完成数，禁止重复启动。有效项按精确比率逐项显示；失败项在独立列表中说明本轮原因和旧结果时间，提供单项重试。缺凭证时引导设置，手续费未验证时展示来源报价及原因，保持排行为空。
- 明细：显示商品身份、两来源价格／币种／各自时间、手续费及净到账、获得 100 元余额所需现金。缺值显示“未取得”；旧完整结果单独显示并标记旧批次，不拼接当前单边报价。
- 设置：C5 key 密文保存于设备安全存储，输入隐藏、保存后不回显完整值，可删除。手续费配置通过实测观察验证后导入；不提供“跳过验证直接入榜”的开关。首版不添加 Steam 登录，必要性仍待实际接口观察。
- 视觉：采用平台原生组件、简体中文、单一青绿色主色，浅／深色主题、48dp 触控目标、可滚动正文、金额突出；覆盖空列表、扫描中、部分失败、离线、冷却、缺凭证和未验证手续费。UI Design Vault 已检索，未取得匹配素材，未声称 UI 或真机验证通过。
- 不做：服务器、预测、库存、交易、预算组合、后台提醒、旧用户数据自动迁移；新应用身份与签名策略在首次 APK 构建前再确认，不覆盖旧应用。
- 完成条件：四项 MVP 形成完整本地交互；相关受控检查通过；云端编译、APK、真实接口与真机体验分别记录实际状态。缺少远端或推送授权时仅交付源码和构建配置。

### 本轮结果和检查结论

- `scripts/core.mjs`：手续费金额用 BigInt 中间值计算，禁止溢出安全整数；逆向搜索预先检查钱包参数，中点计算避免整数加法精度损失。
- `scripts/probe.mjs`：扫描入口拒绝空／重复候选；第一次等待前复制清单；报告请求统计按本批次计算；手续费观察必须与模型的卖家实际净到账一致，拒绝低于最低值的伪一致观察。
- `scripts/run-with-key.ps1`：增加 `#requires -Version 7.0`，防止使用 Windows PowerShell 5.1 运行隐藏凭证入口。
- `.github/workflows/validation.yml`：受控数据检查，Node 24、模块语法与 `npm test`，只读仓库权限；不使用行情凭证、不请求真实市场、不构建 APK。配置参考 [checkout 官方用法](https://github.com/actions/checkout) 与 [setup-node 官方用法](https://github.com/actions/setup-node)。
- PASS：本地 `npm test` 15／15；`node --check` 检查已修改的两个模块通过。NOT RUN：GitHub Actions、Android 编译／APK／设备 UI；未提交真实手续费配置，未请求 C5 或扩大 Steam 扫描。
- 源码修复可交付；完整应用仍未完成。按关键方案确认后接续工程与 UI，所有真实验证阻塞继续保留，推送仍单独确认。
- 本地提交：`0ca7a1a` 初始化并保留当前数据层、受控测试与 CI；本文件的本轮状态补充另作文档提交。历史 `重写参考.md` 保持原样且未纳入本次提交；artifacts、真实观察和本地凭证目录均未提交。暂存检查与常见密钥格式检查通过，不代表真实接口验证通过。

### 自动接续：跨技术栈的数据契约

上一轮已实现修复并提交，属于实际进展。本轮重新核对 `codex/mvp`、`3382fdc` 和工作区；未发现 Android 工程、远端或用户对技术栈的确认，不重复提交选择卡。

- 新增 `fixtures/comparison-contract.json`，标记 `evidenceType: controlled_fixture`；8 个字面期望比价案例、2 个精确排序案例和1个部分失败扫描案例。所有商品、价格、钱包最低费用都是受控样本，只用于 Android 移植行为对照，不可导入真实手续费验证或行情缓存。
- `tests/validation.test.mjs` 读取同一契约，检查手续费／净到账／精确比例、未核验与错误币种／旧批次的排除原因，确认显示金额相同仍按实际比例排序；扫描案例验证当前失败和上一份完整结果分离，排行／明细共用结果对象。
- PASS：本轮本地 `npm test` 17／17，`git diff --check` 通过。未访问真实市场，未写生产状态，未运行 GitHub Actions 或 Android 构建。
- 接续：Android 单元测试应直接消费同一契约，避免语言移植改变金额单位、舍入或失败恢复。技术栈仍待用户决定；这份契约是开发准备，不代表已经实现四项 Android MVP。

### 前次接续阻塞（已解除）

此前检查源码提交 `95dd6e7` 时，没有 Android 工程或远端、未收到技术栈确认，关键方案等待连续出现三轮，曾将目标标记为 BLOCKED。之后用户明确“继续”，目标已恢复 active，并按推荐方案实现 Android 源码；这里仅保留前次阻塞原因供追溯。

根据 AGENTS.md 第 52 行，影响架构的计划缺口需用户确认。推荐方案仍为 Kotlin + Jetpack Compose + Material 3；备选 Expo + React Native。用户确认技术栈后恢复工程、四项 MVP 与云端构建配置的实现。真实接口验证可按授权继续跳过并保留未验证状态；不以跳过为通过。缺少远端和逐次推送授权时，不执行推送。

以下为前一阶段的数据验证记录；历史测试数、Git 状态与阶段顺序以顶部本轮记录为准。

## 已确认需求与本阶段计划

- Android 手机自用，低成本获得 Steam 钱包余额；优先改善数据采集稳定性。
- 手机独立运行、无服务器费用。打开先读缓存，手动扫描或单项刷新。
- 武器箱、胶囊、贴纸等标准商品；不含武器皮肤。默认精选 20～50 个商品，内置清单可增删。
- 两边均为人民币。C5 最低在售价按单件比较；Steam 按最低卖家挂单的买家支付总额反推卖家净到账。
- 按获得 100 元 Steam 余额所需现金升序排列：`C5 单件买入价 / Steam 单件净到账 * 100`。这只表示当前挂单估算，不证明可成交或等待后价格。
- 首版：扫描排行、商品比价明细、候选池管理、凭证设置。接受 C5 key，Steam 登录按必要性评估。
- 逐项出结果；失败项保留上一份完整结果和时间，单独列出，可重试，不混入本轮排行。
- 默认清单约 1～3 分钟完整扫描是待实测的体验目标。
- 不含预测、库存、买入记录、预算组合、后台提醒和自动交易。

本阶段验证接口、6 个商品比价、手续费和失败恢复，再按 20／50 个商品各 3 次测量。缺少实际条件时记录 BLOCKED／NOT TESTED。`重写参考.md` 保留为历史资料；本文件是当前唯一任务交接。

## 官方资料及真实观察

### C5

- [官方接入指南](https://opendoc.c5game.com/)：个人中心 API 管理申请 app-key，放入 query；默认 50 qps，特定接口可能另有限制。本工具仅使用读取类接口，不调用交易操作。
- 文档顶部要求 `Accept-Encoding: gzip, br, zstd, deflate`。验证传输支持四种解压方式；本阶段未实测 C5 返回哪种编码。
- [按 hashName 批量最低价](https://opendoc.c5game.com/api-125914570)：`POST /merchant/product/price/batch`，请求 `appId:"730"`、`marketHashNames`。文档返回按 hashName 索引的 itemId、marketHashName、price、count、website。
- **批量最低价页面也标为“开发中”**。账户权限、批量上限、是否对当前 key 开通及价格单位仍未实测确认；不把通用 50 qps 当作该接口保证。
- [在售搜索](https://opendoc.c5game.com/api-414954214)：`POST /merchant/market/v2/products/search`；文档称内测，需要 IP 白名单。其示例是按 itemId 搜在售，不是已验证的商品名称目录搜索。手机动态网络能否使用待确认。
- [旧价格查询](https://opendoc.c5game.com/api-161954984) 标为开发中且示例不完整，未作为本轮数据源。伙伴平台的 client_id/client_secret 接口属于另一套接入，未擅自替换 app-key 方案。
- **C5 实际报价：BLOCKED**。用户在聊天发送了疑似密钥，本轮未复述、保存或将其作为脚本参数传递；待用户撤销并重新生成后，通过终端隐藏输入使用。

### Steam

- 对 `https://steamcommunity.com/market/priceoverview/` 使用 `appid=730`、`currency=23`、`market_hash_name=Revolution Case` 的一次匿名 pwsh 读取成功：HTTP 200，`lowest_price = ¥ 1.67`、`median_price = ¥ 1.69`。此处仅证明单次人民币报价可取得；中位价未用于计算。
- 随后匿名 Python 请求同一路径返回 **HTTP 429**。未取得该响应 Retry-After；停止扩大市场请求，本轮没有借更换网络、代理或提高并发绕过限流。
- 匿名商品页带 `l=schinese&cc=CN` 仍返回港币上下文（eCurrency 29、HK$ 1.93）。因此语言和 cc 参数不能替代币种核验，也未把该页面价格当作人民币对照通过。
- 该报价路径是 Steam 网站使用的 Web 端点，本轮没有发现其公开 SLA 或官方请求频率保证。工具暂定同来源串行、请求起始间隔至少 3 秒，这是保守验证默认值，不是官方限额。
- 6 个商品的人民币页面对照、Steam 登录必要性和长期匿名稳定性：**NOT TESTED**。当前登录不是已证明的必需条件。

### 手续费与交易限制

- [Steam 官方市场 FAQ](https://help.steampowered.com/en/faqs/view/61F0-72B7-9A18-C70B) 说明 Steam 交易费 5%、CS2 游戏费 10%，费用由买方支付；不能据此直接将买家总额乘 85% 当作卖家到账。
- 本轮读取了 [Steam 当前 economy_common.js](https://steamcommunity.com/public/javascript/economy_common.js)，包含 `GetTotalWithFees`、`GetItemPriceFromTotal`、`wallet_market_minimum`。本工具独立编写整数金额模型，没有将网页代码复制或执行为本地依赖。
- 模型按钱包最低费用、费率参数计算；从买家总额反推时，如果无法精确回到该总额，标记 `fee_inverse_ambiguous` 并禁止排名。钱包最低值 **7 分仅是待验证模板参数**；人民币卖出对话框未核对，未生成已验证手续费配置。
- [Steam 交易保护 FAQ](https://help.steampowered.com/en/faqs/view/365F-4BEE-2AE2-7BDD) 说明 CS2 交易收到的物品有 7 天保护；匿名商品描述还出现 market_tradable_restriction／market_marketable_restriction 为 7。本轮没有验证用户账户具体可售时间，不能将这两类限制混为精确解锁时间。

本轮官方文档及脚本的实际获取时间、字节数、SHA-256 和特征标记位于 `artifacts/official-sources.json`。Steam 费用脚本 SHA-256：`84429d06a9ef8c250ac567f9fedc9fb155d23ceb7442c92a19b815840c102784`。初步市场观察及未运行阶段位于 `artifacts/session-observations.json`；这些不是完整扫描产物。

## 实现与最小数据约定

### 工具入口

- `scripts/core.mjs`：整数分金额、参数化手续费、精确比例排序、来源解析、请求合并、串行间隔、超时、解压、限流与有限重试。
- `scripts/probe.mjs`：6／20／50 个商品扫描、真实报价归档、完整旧结果保留、阶段门槛、人工手续费／页面核对导入。
- `scripts/run-with-key.ps1`：隐藏输入，凭证仅通过临时子进程环境传递，finally 清除；禁止命令行传 key。依赖 Node 24+ 和 pwsh 7，不决定 Android 技术栈。
- `scripts/audit-public.mjs`：仅获取官方公共文档和静态费用脚本，保存摘要与哈希，不保存原始网页或账号数据。
- `fixtures/candidate-pool.json`：50 个候选标识。前 6 个按武器箱、胶囊、贴纸各 2 个排列。名称及覆盖范围尚未全部在线确认，不宣称都是当前可买商品；所有 C5 ID 初始为空、映射状态 pending。

| 首批商品 | 分类 | Steam hashName | C5 ID／映射 | 本轮真实比价 |
|---|---|---|---|---|
| 变革武器箱 | 武器箱 | Revolution Case | 待接口确认 | 仅 Steam 单次报价 1.67 元，未排名 |
| 突围大行动武器箱 | 武器箱 | Operation Breakout Weapon Case | 待接口确认 | NOT TESTED |
| 巴黎 2023 竞争者印花胶囊 | 胶囊 | Paris 2023 Contenders Sticker Capsule | 待接口确认 | NOT TESTED |
| 印花胶囊 2 | 胶囊 | Sticker Capsule 2 | 待接口确认 | NOT TESTED |
| 涂鸦风小鸡（显示别名待核对） | 贴纸 | Sticker \| Poorly Drawn Chicken | 待接口确认 | NOT TESTED |
| 皇冠（闪亮） | 贴纸 | Sticker \| Crown (Foil) | 待接口确认 | NOT TESTED |

C5 返回的 hashName 必须与请求完全一致，itemId 必须是字符串或安全整数、count 必须正数。满足后建立本轮精确映射；不能靠中文模糊匹配，也不臆造 ID。

### 数据

| 类型 | 字段与约束 |
|---|---|
| 商品映射 | id、category、displayName、steamHashName、c5ItemId、mappingStatus、mappingEvidence；未验证 ID 为 null |
| 来源报价 | source、batchId、collectedAt（UTC ISO）、currency、amountCents、basis、status、failure；缺失金额为 null |
| 比价结果 | item、batchId、c5、steam、rankable、reason；有效时有 fee 和 cashPer100Cny 的精确分子／分母及显示用整数分 |
| 扫描结果 | batchId、起止耗时、首次 Steam 报价／首次可排名结果耗时、请求／重试／限流数、配对成功数、rows、rankings、failures、stagePassed |

每批冻结候选清单。两侧报价必须本轮有效、币种 CNY、金额正整数，商品映射与手续费已核验后才排名。比例用 BigInt 交叉相乘排序，不按四舍五入后的显示值排序。排行与明细共用同一个结果对象。

失败项的本轮报价状态和上一份完整结果分别保存，绝不拼成新比价。只有完整可排名结果更新历史快照。所有缓存和报告在 artifacts，Git 忽略；受控测试不写生产状态。

### 采集及门槛

- 同键在途请求合并，全局串行；同来源起始间隔至少 3 秒。每次正常扫描先做一次 C5 批量查询，再逐项采集 Steam。
- 429 停止该来源当前批次后续网络请求；按 Retry-After 冷却，缺失时采用 15 分钟默认值，并持久化冷却。不得删除状态文件绕过冷却。
- 5xx 最多 2 次重试，退避 2／4 秒，遵守 Retry-After；等待超过 60 秒时停批记录冷却。401／403、认证失败、解析失败、网络断开和超时不无限重试。
- 20 个商品需要最新 6 个商品批次全部可排名，且完成实际市场页面核对。50 个商品还需要 20 个商品连续 3 次合格扫描。失败会重置该档连续通过次数。
- `--steam-only` 只允许 6 个商品的单来源诊断，不算双平台阶段通过。首次 Steam 报价时间与首次比价结果时间分开，不能互相替代。
- 人工页面核对默认要求币种、ID、hashName 和两边金额一致，观察时间距对应 Steam 报价不超过 2 分钟。价格变化或时间差过大时重新采集核对，不偷偷放宽。此为验证工具默认边界，不是产品时效规则。

## 使用与接续步骤

从项目目录执行（Windows 使用 pwsh）：

```powershell
node --test tests/*.test.mjs
node scripts/audit-public.mjs
```

1. 撤销聊天中发送的疑似凭证，在 C5 重新生成；检查读取接口权限和相关 IP 条件。不要把新 key 发给聊天或写入 JSON。
2. Steam 人民币卖出对话框只观察，不提交交易。核对钱包参数及至少 6 个不同净到账金额，覆盖低价、费用边界和至少 100 元净到账的正常价位；记录买家支付、卖家收到和两项费用。将空模板 `fixtures/fee-observations.example.json` 复制到 `.local/fee-observations.json` 后填写实际观察和时间。模板不是实测。
3. 导入手续费核对，再用隐藏输入运行 6 个商品。只有人工真实观察与模型一致才生成 `artifacts/fee-profile.json`。

```powershell
node scripts/probe.mjs fees --observations .local/fee-observations.json
pwsh -File scripts/run-with-key.ps1 -Stage 6
```

4. 如接口有报价但规则仍未确认，6 个商品报告会保留报价及阻塞原因。首批不能全部通过时先处理原因为凭证／接口权限／映射／币种／手续费的问题，不扩大扫描。
5. 在 6 个商品合格批次对应报告基础上，将 `fixtures/page-observations.example.json` 复制到 `.local/page-observations.json`，补全 6 项 ID、币种、页面报价和时间，然后核对。避免记录账号名、余额或完整页面。

```powershell
node scripts/probe.mjs verify-pages --batch <报告中的batchId> --observations .local/page-observations.json
pwsh -File scripts/run-with-key.ps1 -Stage 20 -Runs 3
pwsh -File scripts/run-with-key.ps1 -Stage 50 -Runs 3
```

重复扫描间暂停 30 秒；发现限流或失败即停止该轮序列。报告写入 artifacts/scans/<batchId>.json，按实际成功率和耗时评价，不把部分成功当成全批成功。首次页价变化需要重新观察，不能改报告金额来通过。

## 检查结果与结论

**PASS（受控输入）**：2026-10-02 运行 `node --test tests/*.test.mjs`，13 项测试全部通过。覆盖整数金额／币种、手续费边界和逆向歧义、排名排除条件、缺报价／下架／异常字段、超长 ID、请求合并和间隔、429 冷却、5xx 重试上限、凭证错误脱敏、断网／超时、部分成功与旧结果保留、人工观察门槛、候选池及 CLI 阶段拦截。测试钱包参数及行情是受控样本，不证明现实价格或手续费正确。

**实际观察**：C5 官方文档和 Steam 费用脚本获取成功，有哈希；Steam 匿名人民币单次报价成功，随后遇到 429；匿名商品页出现 HKD 上下文。

| 验证项 | 当前状态 | 原因 |
|---|---|---|
| C5 当前账户最低价接口 | BLOCKED | 未通过隐藏输入取得新的可用凭证；开发中接口权限需实测 |
| 6 个商品精确映射与页面比价 | NOT TESTED | C5 ID 未取得，Steam 遇到限流；不能宣布首批通过 |
| 人民币手续费／净到账 | NOT TESTED | 官方脚本行为已检查，实际钱包参数与卖出对话框未核对 |
| 20 个商品 × 3 次 | NOT RUN | 首批双平台与页面核对门槛未通过 |
| 50 个商品 × 3 次 | NOT RUN | 20 个商品门槛未通过 |
| 手机网络／Android 前台 1～3 分钟 | NOT TESTED | 尚无真机或 Android 原型证据 |

**前一阶段结论：验证工具可交付，数据可行性未通过。** 原阶段要求实测通过后再规划页面与技术选型；本轮用户已允许跳过阻塞，改为并行准备应用开发与保留待验证项，不能用桌面耗时宣称手机达标。如必须付费、引入服务器或缩小范围，仍先记录原因并交由用户取舍。

前一验证轮未运行 Android 构建、未安装 JDK／Gradle／SDK、未推送或创建 CI。本轮已写入受控数据 CI 配置，但尚未运行；Android 检查与 APK 构建继续使用 GitHub Actions，每次推送按 AGENTS.md 单独确认。
