/**
 * caseFilter：统一的「受监控武器箱/容器」判定（v1.6.1）。
 * 原来 c5.ts / steam.ts / radar.ts 三处分别定义了 isCaseLikeName / isCaseName，
 * 关键字口径不一致，且词法过滤会漏掉「Sealed Dead Hand Terminal（封装的毁灭之手终端机）」这类
 * 名字里不含 case/package/武器箱 字样的受监控箱子——根因在词法过滤，而非匹配逻辑。
 * 现收敛为唯一模块：白名单优先，词法兜底。
 *
 * 白名单 key 直接内联（不依赖 cn_names.ts，避免 zhNames → AsyncStorage 导入链，
 * 导致 verify:core 编译环境缺失 RN 模块）。
 */

/** 受监控箱子白名单（MarketHashName），含中文名映射的全部箱子（cn_names.ts 的 key 集合） */
const TRACKED_KEYS = new Set([
  // CS2 时代 / 武库
  'Kilowatt Case', 'Gallery Case', 'Fever Case', 'Revolution Case', 'Recoil Case',
  'Dreams & Nightmares Case', 'Snakebite Case', 'Fracture Case', 'Clutch Case',
  // 大行动
  'Operation Riptide Case', 'Operation Broken Fang Case', 'Shattered Web Case',
  'Operation Hydra Case', 'Operation Wildfire Case', 'Operation Vanguard Weapon Case',
  'Operation Breakout Weapon Case', 'Operation Bloodhound Weapon Case',
  'Operation Phoenix Weapon Case', 'Operation Bravo Case',
  // 棱彩 / 光谱 / 幻彩 / 伽玛
  'Prisma Case', 'Prisma 2 Case', 'Spectrum Case', 'Spectrum 2 Case',
  'Chroma Case', 'Chroma 2 Case', 'Chroma 3 Case', 'Gamma Case', 'Gamma 2 Case',
  'Glove Case',
  // 电竞 / 军火交易
  'eSports 2013 Case', 'eSports 2013 Winter Case', 'eSports 2014 Summer Case',
  'CS:GO Weapon Case', 'CS:GO Weapon Case 2', 'CS:GO Weapon Case 3',
  // 经典老箱
  'CS20 Case', 'Danger Zone Case', 'Horizon Case', 'Shadow Case', 'Revolver Case',
  'Falchion Case', 'Huntsman Weapon Case', 'Winter Offensive Weapon Case',
  // 收藏包
  'Anubis Collection Package',
  // 终端机系列
  'Sealed Dead Hand Terminal',
]);

/** 词法关键字（放宽覆盖），大小写不敏感 */
const KEYWORDS = [
  /case/i, /package/i, /box/i, /capsule/i, /stamp/i, /unit/i, /terminal/i, /container/i,
  /武器箱/, /箱子/, /胶囊/, /收藏包/, /钥匙/,
];

/** 是否受监控武器箱/容器：白名单优先，词法兜底。 */
export function isTrackedCase(name: string): boolean {
  if (!name) return false;
  // 白名单命中（含 Sealed Dead Hand Terminal 等名字里不含 case 字样的箱子）
  if (TRACKED_KEYS.has(name)) return true;
  return KEYWORDS.some((re) => re.test(name));
}

export function isSeedTrackedCase(name: string): boolean {
  return TRACKED_KEYS.has(name);
}
