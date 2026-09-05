/**
 * collector：手机端一键采集编排。
 * 流程：Steam search/render 取成交量 Top 武器箱 → 逐个 priceoverview（限速）
 *      → 如果配置了 C5 app-key 则尝试 C5 价格 → 快照写入本地存储。
 */
import { storage } from './storage';
import { fetchSteamPrice, searchCases, STEAM_DELAY_MS } from './steam';
import { fetchC5Price } from './c5';

export interface CollectProgress {
  stage: 'listing' | 'prices' | 'done';
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

  onProgress?.({
    stage: 'listing',
    done: 0, total: count, currentName: '', success: 0, failed: 0,
    message: '正在拉取 Steam 成交量排行榜…',
  });

  // 多拉一些再过滤（search 默认按成交量排序，一次最多 100）
  const hits = await searchCases(Math.min(Math.max(count * 2, 50), 100), cookie);
  const target = hits.slice(0, count);
  if (target.length === 0) {
    onProgress?.({
      stage: 'done', done: 0, total: 0, currentName: '', success: 0, failed: 0, message: '未找到武器箱',
    });
    return { total: 0, success: 0, failed: 0, elapsedSec: 0 };
  }

  let success = 0;
  let failed = 0;
  const startedAt = Date.now();

  for (let i = 0; i < target.length; i++) {
    const hit = target[i];
    onProgress?.({
      stage: 'prices',
      done: i,
      total: target.length,
      currentName: hit.name,
      success,
      failed,
      message: `正在获取 ${i + 1}/${target.length} ${hit.name}`,
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
        });
        success++;
      } else {
        // 首次失败重试一次
        await sleep(Math.min(sleepMs * 2, 4000));
        const sp2 = await fetchSteamPrice(hit.name, cookie);
        if (sp2.success && sp2.lowest_price != null) {
          await storage.addSnapshot({
            name: hit.name,
            source: 'steam',
            price: sp2.lowest_price,
            volume: sp2.volume ?? hit.volume,
            fetchedAt: new Date().toISOString(),
          });
          success++;
        } else {
          failed++;
        }
      }
    } catch {
      failed++;
    }

    // C5：有 app-key 时尝试
    if (settings.c5AppKey && settings.c5AppKey.trim()) {
      try {
        const c5 = await fetchC5Price(hit.name, settings.c5AppKey.trim());
        if (c5 != null && c5 > 0) {
          await storage.setC5Price(hit.name, c5);
        }
      } catch {
        // C5 失败不阻塞主流程
      }
    }

    if (i < target.length - 1) await sleep(sleepMs);
  }

  onProgress?.({
    stage: 'done',
    done: target.length,
    total: target.length,
    currentName: '',
    success,
    failed,
    message: `采集完成：成功 ${success}，失败 ${failed}`,
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
      const c5 = await fetchC5Price(name, settings.c5AppKey.trim());
      if (c5 != null && c5 > 0) await storage.setC5Price(name, c5);
    } catch {
      // ignore
    }
  }
  return { total: 1, success, failed, elapsedSec: Math.round((Date.now() - startedAt) / 1000) };
}
