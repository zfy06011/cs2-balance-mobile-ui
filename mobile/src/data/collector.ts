/**
 * collector：手机端一键采集编排。
 * 流程：Steam「热门物品 → CS2 武器箱」拉取候选（失败回退成交量榜）
 *      → C5GAME 批量查询买入价（配置了 app-key 时，真正批量）
 *      → 逐个 priceoverview（限速 + 失败重试）→ 快照写入本地存储。
 * 数量必须来自设置，禁止写死 10；进度显示「已采集 X / Y 个」。
 */
import { storage } from './storage';
import { fetchSteamPrice, searchCases, STEAM_DELAY_MS, SteamCaseHit } from './steam';
import { fetchC5PricesBulk } from './c5';

export interface CollectProgress {
  stage: 'listing' | 'c5' | 'prices' | 'done';
  done: number;
  total: number;
  currentName: string;
  success: number;
  failed: number;
  message: string;
}

export interface CollectStats {
  total: number;
  success: number;
  failed: number;
  elapsedSec: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function collectCases(opts: {
  count: number;
  cookie?: string;
  onProgress?: (p: CollectProgress) => void;
  sleepMs?: number;
}): Promise<CollectStats> {
  const { count, cookie = '', onProgress } = opts;
  const sleepMs = opts.sleepMs ?? STEAM_DELAY_MS;
  const settings = await storage.getSettings();
  const want = Math.max(1, Math.min(count, 100));

  const report = (p: CollectProgress) => onProgress?.(p);

  report({
    stage: 'listing', done: 0, total: want, currentName: '', success: 0, failed: 0,
    message: '正在拉取 Steam 热门武器箱榜单…',
  });

  // 热门榜一次最多 100，多拉一些再截断到设置数量
  const hits = await searchCases(Math.min(Math.max(want * 2, 50), 100), cookie);
  const target: SteamCaseHit[] = hits.slice(0, want);
  if (target.length === 0) {
    report({ stage: 'done', done: 0, total: 0, currentName: '', success: 0, failed: 0, message: '未找到武器箱，请稍后重试' });
    return { total: 0, success: 0, failed: 0, elapsedSec: 0 };
  }

  const startedAt = Date.now();
  let success = 0;
  let failed = 0;

  // C5 批量：一次请求多个 MarketHashName，失败不阻塞主流程
  const c5Key = (settings.c5AppKey || '').trim();
  if (c5Key) {
    report({
      stage: 'c5', done: 0, total: target.length, currentName: '', success: 0, failed: 0,
      message: '正在批量查询 C5GAME 买入价…',
    });
    try {
      const map = await fetchC5PricesBulk(target.map((t) => t.name), c5Key);
      let c5ok = 0;
      for (const t of target) {
        const price = map[t.name];
        if (price != null && price > 0) {
          await storage.setC5Price(t.name, price);
          c5ok++;
        }
      }
      report({ stage: 'c5', done: target.length, total: target.length, currentName: '', success: c5ok, failed: target.length - c5ok, message: `C5 批量查询完成：${c5ok}/${target.length} 有价` });
    } catch {
      report({ stage: 'c5', done: target.length, total: target.length, currentName: '', success: 0, failed: target.length, message: 'C5 批量查询失败，继续采集 Steam 价格' });
    }
  }

  for (let i = 0; i < target.length; i++) {
    const hit = target[i];
    report({
      stage: 'prices',
      done: i,
      total: target.length,
      currentName: hit.name,
      success,
      failed,
      message: `已采集 ${i}/${target.length} 个 · 正在获取 ${hit.name}`,
    });

    try {
      const sp = await fetchSteamPrice(hit.name, cookie);
      if (sp.success && sp.lowest_price != null) {
        await storage.addSnapshot({
          name: hit.name,
          source: 'steam',
          price: sp.lowest_price,
          volume: sp.volume ?? hit.volume,
          fetchedAt: new Date().toISOString(),
          popular_rank: hit.popular_rank,
        });
        success++;
      } else {
        // 首次失败重试一次（退避）
        await sleep(Math.min(sleepMs * 2, 4000));
        const sp2 = await fetchSteamPrice(hit.name, cookie);
        if (sp2.success && sp2.lowest_price != null) {
          await storage.addSnapshot({
            name: hit.name,
            source: 'steam',
            price: sp2.lowest_price,
            volume: sp2.volume ?? hit.volume,
            fetchedAt: new Date().toISOString(),
            popular_rank: hit.popular_rank,
          });
          success++;
        } else {
          failed++;
        }
      }
    } catch {
      failed++;
    }

    if (i < target.length - 1) await sleep(sleepMs);
  }

  report({
    stage: 'done',
    done: target.length,
    total: target.length,
    currentName: '',
    success,
    failed,
    message: `采集完成：已采集 ${success} / ${target.length} 个`,
  });
  return {
    total: target.length,
    success,
    failed,
    elapsedSec: Math.round((Date.now() - startedAt) / 1000),
  };
}

export async function collectOne(name: string, cookie = ''): Promise<CollectStats> {
  const settings = await storage.getSettings();
  let success = 0;
  let failed = 0;
  const startedAt = Date.now();
  try {
    const sp = await fetchSteamPrice(name, cookie);
    if (sp.success && sp.lowest_price != null) {
      await storage.addSnapshot({
        name,
        source: 'steam',
        price: sp.lowest_price,
        volume: sp.volume,
        fetchedAt: new Date().toISOString(),
      });
      success = 1;
    } else {
      failed = 1;
    }
  } catch {
    failed = 1;
  }
  if (settings.c5AppKey && settings.c5AppKey.trim()) {
    try {
      const map = await fetchC5PricesBulk([name], settings.c5AppKey.trim());
      const price = map[name];
      if (price != null && price > 0) await storage.setC5Price(name, price);
    } catch {
      // ignore
    }
  }
  return { total: 1, success, failed, elapsedSec: Math.round((Date.now() - startedAt) / 1000) };
}
