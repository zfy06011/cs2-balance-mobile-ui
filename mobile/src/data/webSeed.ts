/**
 * webSeed.ts —— Web 调试用演示数据（v1.8.6-web）。
 *
 * 为什么需要：网页版是全新数据库，首页/市场/雷达/库存全是空的，看不出布局效果。
 * 这里在 Web 平台首次启动时灌入一批仿真数据（价格快照 + 历史日线 + 库存持仓），
 * 让所有页面都能看到真实排版。**仅在 Web 生效**，手机端完全不受影响。
 *
 * 数据全部写进本地 SQLite（Web 端是内存/OPFS），不改动任何业务逻辑。
 */
import { Platform } from 'react-native';
import { storage } from './storage';

const CASES: Array<{
  name: string;
  c5: number;
  steam: number;
  volume: number;
  rank: number;
  /** 90 天前的价格，用于生成历史曲线 */
  start: number;
  /** 波动强度 */
  vol: number;
}> = [
  { name: 'Fever Case', c5: 2.40, steam: 3.57, volume: 12840, rank: 6, start: 2.10, vol: 0.035 },
  { name: 'Kilowatt Case', c5: 1.20, steam: 1.68, volume: 44576, rank: 1, start: 1.35, vol: 0.03 },
  { name: 'Gallery Case', c5: 3.15, steam: 4.29, volume: 8920, rank: 12, start: 3.60, vol: 0.028 },
  { name: 'Revolution Case', c5: 0.34, steam: 0.54, volume: 52100, rank: 3, start: 0.30, vol: 0.04 },
  { name: 'Recoil Case', c5: 7.38, steam: 10.24, volume: 3540, rank: 22, start: 6.90, vol: 0.026 },
  { name: 'Dreams & Nightmares Case', c5: 2.79, steam: 3.87, volume: 9870, rank: 9, start: 3.05, vol: 0.032 },
  { name: 'Snakebite Case', c5: 2.40, steam: 3.57, volume: 12840, rank: 7, start: 2.25, vol: 0.03 },
  { name: 'Fracture Case', c5: 1.85, steam: 2.62, volume: 15600, rank: 5, start: 1.95, vol: 0.027 },
  { name: 'Clutch Case', c5: 5.60, steam: 7.85, volume: 4120, rank: 18, start: 5.20, vol: 0.025 },
  { name: 'Prisma Case', c5: 4.90, steam: 6.95, volume: 6230, rank: 15, start: 5.40, vol: 0.029 },
  { name: 'Spectrum Case', c5: 12.30, steam: 16.80, volume: 1980, rank: 34, start: 11.50, vol: 0.024 },
  { name: 'Chroma Case', c5: 18.60, steam: 24.90, volume: 1120, rank: 41, start: 19.80, vol: 0.022 },
  { name: 'Gamma Case', c5: 9.80, steam: 13.40, volume: 2640, rank: 27, start: 10.60, vol: 0.026 },
  { name: 'Glove Case', c5: 22.40, steam: 30.10, volume: 860, rank: 48, start: 24.20, vol: 0.021 },
  { name: 'Operation Riptide Case', c5: 3.85, steam: 5.30, volume: 7100, rank: 11, start: 4.20, vol: 0.028 },
  { name: 'Operation Broken Fang Case', c5: 6.20, steam: 8.55, volume: 3980, rank: 19, start: 6.80, vol: 0.025 },
  { name: 'Shattered Web Case', c5: 8.40, steam: 11.60, volume: 2890, rank: 25, start: 9.10, vol: 0.024 },
  { name: 'Operation Hydra Case', c5: 31.50, steam: 42.30, volume: 520, rank: 55, start: 34.20, vol: 0.02 },
  { name: 'Operation Wildfire Case', c5: 14.20, steam: 19.30, volume: 1420, rank: 38, start: 15.60, vol: 0.023 },
  { name: 'CS20 Case', c5: 2.95, steam: 4.05, volume: 8240, rank: 10, start: 3.20, vol: 0.029 },
  { name: 'Danger Zone Case', c5: 4.35, steam: 5.95, volume: 6580, rank: 14, start: 4.70, vol: 0.027 },
  { name: 'Horizon Case', c5: 3.60, steam: 4.95, volume: 7420, rank: 13, start: 3.95, vol: 0.028 },
  { name: 'Shadow Case', c5: 7.85, steam: 10.80, volume: 3310, rank: 21, start: 8.40, vol: 0.025 },
  { name: 'Revolver Case', c5: 19.20, steam: 25.80, volume: 940, rank: 44, start: 21.10, vol: 0.022 },
  { name: 'Falchion Case', c5: 16.40, steam: 22.10, volume: 1280, rank: 36, start: 17.80, vol: 0.023 },
  { name: 'Huntsman Weapon Case', c5: 26.70, steam: 35.60, volume: 680, rank: 51, start: 29.20, vol: 0.021 },
  { name: 'eSports 2014 Summer Case', c5: 79.70, steam: 130.31, volume: 128, rank: 68, start: 85.40, vol: 0.018 },
  { name: 'CS:GO Weapon Case', c5: 245.00, steam: 340.50, volume: 42, rank: 88, start: 268.00, vol: 0.017 },
  { name: 'CS:GO Weapon Case 2', c5: 88.20, steam: 118.60, volume: 96, rank: 72, start: 92.40, vol: 0.019 },
  { name: 'Operation Bravo Case', c5: 156.00, steam: 212.40, volume: 58, rank: 81, start: 168.00, vol: 0.018 },
];

const HISTORY_DAYS = 120;

/** 生成一条价格日线：几何随机游走，保证走势自然 */
function genHistory(start: number, end: number, days: number, vol: number): Array<{ date: string; price: number; volume: number }> {
  const out: Array<{ date: string; price: number; volume: number }> = [];
  const today = new Date();
  const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  // 用固定种子的伪随机，保证每次刷新曲线一致（便于对照界面）
  let seed = 20260909;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const totalLog = Math.log(end / start);
  for (let i = 0; i < days; i++) {
    const t = i / (days - 1);
    const trend = start * Math.exp(totalLog * t);
    const noise = 1 + (rnd() - 0.5) * 2 * vol;
    const price = Math.max(0.01, trend * noise);
    const d = new Date(base.getTime() - (days - 1 - i) * 86400000);
    out.push({
      date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
      price: Math.round(price * 100) / 100,
      volume: Math.round(200 + rnd() * 3000),
    });
  }
  return out;
}

/** 演示持仓：3 个箱子，覆盖「可上架 / 冷却中 / 多笔」三种状态 */
const HOLDINGS: Array<{ name: string; qty: number; buy: number; daysAgo: number; source: string }> = [
  { name: 'eSports 2014 Summer Case', qty: 6, buy: 7.2, daysAgo: 9, source: 'c5game' },
  { name: 'eSports 2014 Summer Case', qty: 6, buy: 7.56, daysAgo: 4, source: 'c5game' },
  { name: 'Recoil Case', qty: 12, buy: 6.85, daysAgo: 3, source: 'c5game' },
  { name: 'Prisma Case', qty: 7, buy: 0.01, daysAgo: 12, source: 'steam_sync' },
  { name: 'Fever Case', qty: 20, buy: 2.15, daysAgo: 2, source: 'c5game' },
];

let seeded = false;

/** 仅 Web：灌入演示数据（幂等，只跑一次） */
export async function seedWebDemoData(): Promise<void> {
  if (Platform.OS !== 'web' || seeded) return;
  seeded = true;
  try {
    // 已有数据就不覆盖（避免每次刷新重复灌）
    const existing = await storage.getSnapshotNames();
    if (existing.length > 0) return;

    const now = Date.now();
    for (const c of CASES) {
      // 历史日线
      const hist = genHistory(c.start, c.steam, HISTORY_DAYS, c.vol);
      await storage.mergeSteamHistory(c.name, hist.map((h) => ({ date: h.date, price: h.price, volume: h.volume })));
      // 实时点：Steam + C5
      await storage.addSnapshot({
        name: c.name, source: 'steam', price: c.steam, volume: c.volume,
        fetchedAt: new Date(now - 60_000).toISOString(), popular_rank: c.rank,
      });
      await storage.addSnapshot({
        name: c.name, source: 'c5', price: c.c5, volume: null,
        fetchedAt: new Date(now - 90_000).toISOString(),
      });
      // C5 日内点（近 7 天，供「C5 买入时机参考」）
      for (let d = 6; d >= 0; d--) {
        const drift = 1 + Math.sin(d) * 0.012;
        await storage.addSnapshot({
          name: c.name, source: 'c5_hist', price: Math.round(c.c5 * drift * 100) / 100,
          volume: null, fetchedAt: new Date(now - d * 86400000).toISOString(),
        });
      }
    }

    // 库存持仓
    for (const h of HOLDINGS) {
      await storage.addInventory({
        item_name: h.name,
        quantity: h.qty,
        buy_price: h.buy,
        buy_at: new Date(now - h.daysAgo * 86400000).toISOString(),
        source: h.source,
        steam_synced_at: h.source === 'steam_sync' ? new Date(now - 3600_000).toISOString() : null,
        steam_tradable: h.source === 'steam_sync',
        steam_unlock_est_at: new Date(now - h.daysAgo * 86400000 + 168 * 3600000).toISOString(),
        steam_first_seen_at: h.source === 'steam_sync' ? new Date(now - h.daysAgo * 86400000).toISOString() : null,
      });
    }
  } catch {
    // 演示数据失败不影响页面渲染
  }
}
