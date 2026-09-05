/**
 * cn_names：CS2 武器箱中文名称映射（HANDOFF v2.0 第 4 节）。
 * - 后台保留 MarketHashName 作为唯一关联键，UI 统一显示中文 displayName。
 * - 只收录可靠确认的官方/社区译名（避免机械直译）。
 * - 新箱子暂无映射时显示「暂无中文名称」，进入待处理状态。
 */
export const CN_CASE_NAMES: Record<string, string> = {
  // CS2 时代 / 武库
  'Kilowatt Case': '千瓦武器箱',
  'Gallery Case': '画廊武器箱',
  'Fever Case': '狂热武器箱',
  'Revolution Case': '变革武器箱',
  'Recoil Case': '反冲武器箱',
  'Dreams & Nightmares Case': '梦魇武器箱',
  'Snakebite Case': '蛇噬武器箱',
  'Fracture Case': '裂空武器箱',
  'Clutch Case': '命悬一线武器箱',
  // 大行动
  'Operation Riptide Case': '激流大行动武器箱',
  'Operation Broken Fang Case': '狂牙大行动武器箱',
  'Shattered Web Case': '裂网大行动武器箱',
  'Operation Hydra Case': '九头蛇大行动武器箱',
  'Operation Wildfire Case': '野火大行动武器箱',
  'Operation Vanguard Weapon Case': '先锋大行动武器箱',
  'Operation Breakout Weapon Case': '突围大行动武器箱',
  'Operation Bloodhound Weapon Case': '血猎大行动武器箱',
  'Operation Phoenix Weapon Case': '凤凰大行动武器箱',
  'Operation Bravo Case': '英勇大行动武器箱',
  // 棱彩 / 光谱 / 幻彩 / 伽马
  'Prisma Case': '棱彩武器箱',
  'Prisma 2 Case': '棱彩2号武器箱',
  'Spectrum Case': '光谱武器箱',
  'Spectrum 2 Case': '光谱2号武器箱',
  'Chroma Case': '幻彩武器箱',
  'Chroma 2 Case': '幻彩2号武器箱',
  'Chroma 3 Case': '幻彩3号武器箱',
  'Gamma Case': '伽马武器箱',
  'Gamma 2 Case': '伽马2号武器箱',
  'Glove Case': '手套武器箱',
  // 经典老箱
  'CS20 Case': '反恐精英20周年武器箱',
  'Danger Zone Case': '头号特训武器箱',
  'Horizon Case': '地平线武器箱',
  'Shadow Case': '暗影武器箱',
  'Revolver Case': '左轮武器箱',
  'Falchion Case': '弯曲猎手武器箱',
  'Huntsman Weapon Case': '猎杀者武器箱',
  'Winter Offensive Weapon Case': '冬季大行动武器箱',
  'CS:GO Weapon Case': '反恐精英武器箱',
  'CS:GO Weapon Case 2': '反恐精英2号武器箱',
  'CS:GO Weapon Case 3': '反恐精英3号武器箱',
  // 收藏包
  'Anubis Collection Package': '阿努比斯收藏包',
};

export const UNKNOWN_CN_NAME = '暂无中文名称';

/** 取中文显示名；未收录返回「暂无中文名称」（后台仍用原 MarketHashName 关联）。 */
export function displayName(marketHashName: string): string {
  if (!marketHashName) return UNKNOWN_CN_NAME;
  return CN_CASE_NAMES[marketHashName] ?? UNKNOWN_CN_NAME;
}
