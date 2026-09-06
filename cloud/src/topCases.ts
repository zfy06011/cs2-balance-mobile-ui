/**
 * 热门武器箱 Top-N：Steam 搜索（popular + CS2 武器箱分类）优先；
 * 失败回退 D1 已有名称 + 内置兜底清单，保证空跑时仍有目标。
 */
import { MARKET_BASE, APPID, type Env, envNum } from './config.ts';
import type { D1DatabaseLike } from './db.ts';
import { listAllHistoryNames } from './db.ts';
import { fetchWithRetry } from './steamClient.ts';
import { sleep } from './util.ts';

export interface CaseHit {
  name: string;
  volume: number;
}

export async function fetchTopCases(limit: number, timeoutMs = 10000): Promise<CaseHit[]> {
  const out: CaseHit[] = [];
  const seen = new Set<string>();
  const count = Math.min(limit, 100);
  for (let start = 0; start < limit && out.length < limit; start += count) {
    const qs =
      'appid=' + APPID + '&norender=1&query=&start=' + start + '&count=' + count +
      '&sort_column=popular&sort_dir=desc&l=schinese&category_730_Type[]=tag_CSGO_Type_WeaponCase';
    const resp = await fetchWithRetry(MARKET_BASE + '/search/render/?' + qs, { timeoutMs, retries: 2 });
    const data = (await resp.json()) as { results?: Array<Record<string, unknown>>; total_count?: number };
    let added = 0;
    for (const r of data.results ?? []) {
      const name = String(r.hash_name ?? r.name ?? '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push({ name, volume: Number(r.sell_listings ?? 0) || 0 });
      added++;
    }
    if (added === 0) break;
    if (data.total_count != null && start >= Number(data.total_count)) break;
    await sleep(400);
  }
  return out.slice(0, limit);
}

/** 内置兜底：经得起长期考验的热门武器箱（search/render 失败时用） */
export const FALLBACK_CASES: string[] = [
  'CS:GO Weapon Case', 'CS:GO Weapon Case 2', 'CS:GO Weapon Case 3',
  'eSports 2013 Case', 'eSports 2013 Winter Case', 'eSports 2014 Summer Case',
  'Winter Offensive Weapon Case', 'Operation Bravo Case', 'Operation Phoenix Weapon Case',
  'Operation Breakout Weapon Case', 'Operation Vanguard Weapon Case', 'Operation Wildfire Case',
  'Operation Hydra Case', 'Operation Bloodhound Case', 'Chroma Case', 'Chroma 2 Case', 'Chroma 3 Case',
  'Falchion Case', 'Huntsman Weapon Case', 'Shadow Case', 'Revolver Case', 'Clutch Case',
  'Spectrum Case', 'Spectrum 2 Case', 'Gamma Case', 'Gamma 2 Case', 'Glove Case',
  'Danger Zone Case', 'Horizon Case', 'Prisma Case', 'Prisma 2 Case', 'Fracture Case',
  'Shattered Web Case', 'Snakebite Case', 'Operation Broken Fang Case', 'Operation Riptide Case',
  'Dreams & Nightmares Case', 'Recoil Case', 'Revolution Case', 'CS20 Case', 'Kilowatt Case',
  'Gallery Case', 'Sport & Field Case',
];

/** 采集目标：search/render 热门榜 → D1 已有名称 → 内置兜底清单 */
export async function collectTargetNames(env: Env, db: D1DatabaseLike): Promise<string[]> {
  const limit = envNum(env, 'TOP_CASES', 100);
  try {
    const top = await fetchTopCases(limit);
    if (top.length >= 10) return top.map((t) => t.name).slice(0, limit);
  } catch {
    // 忽略，走回退
  }
  const fromDb = await listAllHistoryNames(db);
  const merged = [...new Set([...fromDb, ...FALLBACK_CASES])];
  return merged.slice(0, limit);
}