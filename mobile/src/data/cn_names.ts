/**
 * cn_names：CS2 武器箱中文名称映射（HANDOFF v2.0 第 4 节）。
 * - 后台保留 MarketHashName 作为唯一关联键，UI 统一显示中文 displayName。
 * - 中文名以 C5GAME 商品页/市场分类使用的译名为准（用户买入时看到的名字），
 *   与 Steam 官方译名不一致时优先 C5GAME 叫法（如 Fever→热潮、Gamma→伽玛、
 *   Winter Offensive→冬季攻势、CS:GO Weapon Case→军火交易）。
 * - 未收录映射的箱子优先查本地「Steam 官方中文名」缓存（zhNames：采集时
 *   带 l=schinese 自动获取，覆盖 Steam 全部箱子），仍无则回退英文原名。
 * - 「Sealed Dead Hand Terminal」等 C5GAME 译名与 Steam 官方译名不一致时，
 *   在此手工覆盖（优先级高于 Steam 官方中文名缓存）。
 */
import { zhNameOf } from './zhNames';
export const CN_CASE_NAMES: Record<string, string> = {
  // CS2 时代 / 武库
  'Kilowatt Case': '千瓦武器箱',
  'Gallery Case': '画廊武器箱',
  'Fever Case': '热潮武器箱',
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
  // 棱彩 / 光谱 / 幻彩 / 伽玛
  'Prisma Case': '棱彩武器箱',
  'Prisma 2 Case': '棱彩2号武器箱',
  'Spectrum Case': '光谱武器箱',
  'Spectrum 2 Case': '光谱2号武器箱',
  'Chroma Case': '幻彩武器箱',
  'Chroma 2 Case': '幻彩2号武器箱',
  'Chroma 3 Case': '幻彩3号武器箱',
  'Gamma Case': '伽玛武器箱',
  'Gamma 2 Case': '伽玛2号武器箱',
  'Glove Case': '手套武器箱',
  // 电竞 / 军火交易（C5GAME 叫法）
  'eSports 2013 Case': '电竞2013武器箱',
  'eSports 2013 Winter Case': '电竞2013冬季武器箱',
  'eSports 2014 Summer Case': '电竞2014夏季武器箱',
  'CS:GO Weapon Case': '军火交易武器箱',
  'CS:GO Weapon Case 2': '军火交易2号武器箱',
  'CS:GO Weapon Case 3': '军火交易3号武器箱',
  // 经典老箱
  'CS20 Case': 'CS20周年武器箱',
  'Danger Zone Case': '头号特训武器箱',
  'Horizon Case': '地平线武器箱',
  'Shadow Case': '暗影武器箱',
  'Revolver Case': '左轮武器箱',
  'Falchion Case': '弯曲猎手武器箱',
  'Huntsman Weapon Case': '猎杀者武器箱',
  'Winter Offensive Weapon Case': '冬季攻势武器箱',
  // 收藏包
  'Anubis Collection Package': '阿努比斯收藏包',
  // 终端机系列（C5GAME 译名，2026-03）
  'Sealed Dead Hand Terminal': '封装的毁灭之手终端机',
};

export const UNKNOWN_CN_NAME = '未收录中文名';

/** 取中文显示名：手工映射 → Steam 官方中文名缓存 → 回退英文原名。 */
export function displayName(marketHashName: string): string {
  if (!marketHashName) return UNKNOWN_CN_NAME;
  return CN_CASE_NAMES[marketHashName] ?? zhNameOf(marketHashName) ?? marketHashName;
}
