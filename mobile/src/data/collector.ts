/**
 * collector：手机端一键采集编排。
 * 流程：Steam「热门物品 → CS2 武器箱」拉取候选（失败回退成交量榜）
 *      → C5GAME 批量查询买入价（配置了 app-key 时，真正批量）
 *      → 逐个 priceoverview（限速 + 失败重试）→ 快照写入本地存储。
 * 数量必须来自设置，禁止写死 10；进度显示「已采集 X / Y 个」。
 */
import { storage } from './storage';
import { fetchSteamPrice, searchCases, STEAM_DELAY_MS, SteamCaseHit } from './steam';
import { fetchC5PricesBulk, fetchC5StatsBulk } from './c5';
import { mergeZhNames } from './zhNames';
import { fetchSteamHistorySsr } from './steamHistorySsr';

export interface CollectProgress {
  stage: 'listing' | 'c5' | 'prices' | 'done';
  done: number;
  total: number;
  currentName: string;
  success: number;
  failed: number;
  /** 断点续采跳过数（15 分钟内已采集；仅价格阶段与完成报告有值） */
  skipped?: number;
  message: string;
}

export interface CollectStats {
  total: number;
  success: number;
  failed: number;
  /** 断点续采跳过数（15 分钟内已采集） */
  skipped: number;
  elapsedSec: number;
  candidateNames: string[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 15 分钟内已采集的物品直接跳过（中断后重扫自动续采；重复扫描也不浪费限流额度） */
const RESUME_FRESH_MS = 15 * 60 * 1000;
/** 连续失败 ≥2 时视为被限流，冷却后继续，避免尾部物品拉不到 */
const FAIL_COOLDOWN_MS = 8000;

export async function collectCases(opts: {
  count: number;
  cookie?: string;
  onProgress?: (p: CollectProgress) => void;
  sleepMs?: number;
}): Promise<CollectStats> {
  const { count, onProgress } = opts;
  const sleepMs = opts.sleepMs ?? STEAM_DELAY_MS;
  const settings = await storage.getSettings();
  // Steam cookie 以设置为准（App 内一键登录 / 手填都存这里），调用方显式传入时可覆盖
  const cookie = (opts.cookie ?? (settings.steamCookie || '')).trim();
  const want = Math.max(1, Math.min(count, 100));

  const report = (p: CollectProgress) => onProgress?.(p);

  report({
    stage: 'listing', done: 0, total: want, currentName: '', success: 0, failed: 0,
    message: '正在拉取 Steam 热门武器箱榜单…',
  });

  // 榜单至少拉 30 个（覆盖全部箱子中文名缓存），价格只采前 want 个；
  // 未登录时 Steam 搜索单页仅约 10 条，steam.ts 内部自动翻页补齐
  const hits = await searchCases(Math.min(100, Math.max(want, 30)), cookie);
  // 把 Steam 官方中文名（l=schinese）写入本地缓存：覆盖所有箱子，无需逐条手工映射
  const zhMap: Record<string, string> = {};
  for (const h of hits) {
    if (h.cnName) zhMap[h.name] = h.cnName;
  }
  if (Object.keys(zhMap).length > 0) {
    try {
      await mergeZhNames(zhMap);
    } catch {
      // 中文名缓存失败不阻断采集主流程
    }
  }
  const target: SteamCaseHit[] = hits.slice(0, want);
  if (target.length === 0) {
    report({ stage: 'done', done: 0, total: 0, currentName: '', success: 0, failed: 0, skipped: 0, message: '未找到武器箱，请稍后重试' });
    return { total: 0, success: 0, failed: 0, skipped: 0, elapsedSec: 0, candidateNames: [] };
  }

  const startedAt = Date.now();
  let success = 0;
  let failed = 0;
  let skipped = 0;
  let consecFail = 0;

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

    // 断点续采：15 分钟内已成功采集的直接跳过（中断后重扫只补缺失项）
    try {
      const latest = await storage.getLatestSteam(hit.name);
      if (latest && Date.now() - new Date(latest.fetchedAt).getTime() < RESUME_FRESH_MS) {
        skipped++;
        continue;
      }
    } catch {
      // 读取失败不跳过，照常采集
    }

    report({
      stage: 'prices',
      done: success + skipped,
      total: target.length,
      currentName: hit.name,
      success,
      failed,
      message: `已采集 ${success + skipped} / ${target.length} 个 · 正在获取 ${hit.name}`,
    });

    // 两次尝试：接口异常（如 429）与无数据都重试一次
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      if (attempt > 0) await sleep(Math.min(sleepMs * 2, 4000));
      try {
        const sp = await fetchSteamPrice(hit.name, cookie);
        if (sp.success && sp.lowest_price != null) {
          const vol = sp.volume ?? hit.volume;
          await storage.addSnapshot({
            name: hit.name,
            source: 'steam',
            price: sp.lowest_price,
            volume: vol,
            fetchedAt: new Date().toISOString(),
            popular_rank: hit.popular_rank,
          });
          ok = true;
        }
      } catch {
        // 进入下一次尝试或计为失败
      }
    }

    if (ok) {
      success++;
      consecFail = 0;
    } else {
      failed++;
      consecFail++;
    }

    if (i < target.length - 1) {
      if (consecFail >= 2) {
        await sleep(FAIL_COOLDOWN_MS);
      } else {
        await sleep(sleepMs);
      }
    }
  }

  let histSynced = 0;
  const SSr_MAX = 12;
  let ssrDone = 0;
  let ssrFails = 0;
  for (const t of target) {
    if (ssrDone >= SSr_MAX || ssrFails >= 2) break;
    try {
      const existing = await storage.getSteamHistory(t.name, 15);
      if (existing.length >= 15) continue;
      const pts = await fetchSteamHistorySsr(t.name, 365);
      if (pts.length > 0) {
        const added = await storage.mergeSteamHistory(t.name, pts);
        if (added > 0) histSynced++;
      }
      ssrDone++;
    } catch {
      ssrFails++;
    }
  }

  await storage.saveLocalSyncStatus({
    lastRealtimeRefreshAt: new Date().toISOString(),
    lastHistoryRefreshAt: histSynced > 0 ? new Date().toISOString() : undefined,
    historySuccessCount: histSynced,
    historyFailureCount: ssrFails,
  });

  const failPart = failed > 0 ? `，失败 ${failed} 个` : '';
  const skipPart = skipped > 0 ? `（跳过 ${skipped} 个 15 分钟内已采）` : '';
  const histPart = `，历史同步 ${histSynced} 个`;
  report({
    stage: 'done',
    done: target.length,
    total: target.length,
    currentName: '',
    success,
    failed,
    skipped,
    message: `采集完成：成功 ${success} / ${target.length} 个${skipPart}${failPart}${histPart}`,
  });
  return {
    total: target.length,
    success,
    failed,
    skipped,
    elapsedSec: Math.round((Date.now() - startedAt) / 1000),
    candidateNames: target.map((hit) => hit.name),
  };
}

/** 刷新单个商品：Steam 当前价 + C5 买入价（配了 app-key 时）一起刷新 */
export async function collectOne(name: string, cookie = ''): Promise<CollectStats & { c5Price: number | null }> {
  const settings = await storage.getSettings();
  let success = 0;
  let failed = 0;
  let c5Price: number | null = null;
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
  const c5Key = (settings.c5AppKey || '').trim();
  if (c5Key) {
    try {
      const map = await fetchC5PricesBulk([name], c5Key);
      const price = map[name];
      if (price != null && price > 0) {
        await storage.setC5Price(name, price);
        c5Price = price;
      }
    } catch {
      // ignore
    }
  }
  return { total: 1, success, failed, skipped: 0, elapsedSec: Math.round((Date.now() - startedAt) / 1000), candidateNames: [name], c5Price };
}
