/**
 * cs2-price-history Worker：Steam CS2 武器箱历史价格云端缓存。
 *
 * 公开只读 API：
 *   GET /health             服务状态 + 上次运行摘要
 *   GET /items?limit=100    已入库箱子（名称/gid/点数/最后时间）
 *   GET /history?name=..&days=120  价格序列 [[ts秒, 价格, 成交量], ...]
 * 写入口（可选，供「国内本机采集器」兜底模式，避免免费版 CPU 限额）：
 *   POST /ingest  { name, points:[[ts,price,volume],...], gid? }  需 INGEST_TOKEN（若已配置）
 *
 * 定时任务：默认 */15 * * * * 直连抓取 gid 页入库（Cloudflare 海外出口，无需 Steam++）。
 */
import { type Env, envNum } from './config.ts';
import type { D1DatabaseLike } from './db.ts';
import {
  getGid, setGid, getLastTs, getHistory, listItems, getMeta, setMeta, upsertHistory,
} from './db.ts';
import { fetchListingHtml, filterHistoryPoints, parseListingPage } from './steamClient.ts';
import { collectTargetNames } from './topCases.ts';
import { fmtErr, sleep, unixSec } from './util.ts';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (request.method === 'GET' && (path === '/' || path === '/health')) return await handleHealth(env);
      if (request.method === 'GET' && path === '/items') return await handleItems(env, url);
      if (request.method === 'GET' && path === '/history') return await handleHistory(env, url);
      if (request.method === 'POST' && path === '/ingest') return await handleIngest(request, env);
      return json({ error: 'not found', path }, 404);
    } catch (e) {
      return json({ error: fmtErr(e) }, 500);
    }
  },

  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(runCollection(env));
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function handleHealth(env: Env): Promise<Response> {
  const items = await listItems(env.DB, 1);
  const lastRunRaw = await getMeta(env.DB, 'last_run_summary');
  let lastRun: unknown = null;
  if (lastRunRaw) {
    try {
      lastRun = JSON.parse(lastRunRaw);
    } catch {
      lastRun = null;
    }
  }
  return json({ ok: true, service: 'cs2-price-history', time: new Date().toISOString(), itemCount: items.length, lastRun });
}

async function handleItems(env: Env, url: URL): Promise<Response> {
  const raw = Number(url.searchParams.get('limit') ?? 100);
  const limit = Math.min(Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 100, 500);
  const items = await listItems(env.DB, limit);
  return json({ count: items.length, items, time: new Date().toISOString() });
}

async function handleHistory(env: Env, url: URL): Promise<Response> {
  const name = (url.searchParams.get('name') ?? '').trim();
  if (!name) return json({ error: '缺少 name 参数（market_hash_name）' }, 400);
  const daysRaw = Number(url.searchParams.get('days') ?? envNum(env, 'DEFAULT_HISTORY_DAYS', 120));
  const days = Math.min(Number.isFinite(daysRaw) && daysRaw > 0 ? Math.floor(daysRaw) : 120, 3650);
  const since = unixSec() - days * 86400;
  const rows = await getHistory(env.DB, name, since);
  if (rows.length === 0) {
    return json({ name, price_prefix: '¥', points: [], count: 0, hint: '该箱子尚未收录，等待定时采集或 /ingest 写入' });
  }
  return json({
    name,
    price_prefix: '¥',
    points: rows.map((r) => [r.ts, r.price, r.volume]),
    count: rows.length,
  });
}

async function handleIngest(request: Request, env: Env): Promise<Response> {
  const token = env.INGEST_TOKEN;
  if (token) {
    const auth = request.headers.get('Authorization') ?? '';
    if (auth !== 'Bearer ' + token) return json({ error: 'unauthorized' }, 401);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const name = String(b.name ?? '').trim();
  const raw = b.points;
  if (!name || !Array.isArray(raw) || raw.length === 0) {
    return json({ error: '需要 { name, points: [[ts, price, volume], ...] }' }, 400);
  }
  const points: Array<{ ts: number; price: number; volume: number }> = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const ts = Number(p[0]);
    const price = Number(p[1]);
    if (!Number.isFinite(ts) || !Number.isFinite(price)) continue;
    const volume = Number(p[2]);
    points.push({ ts, price, volume: Number.isFinite(volume) ? volume : 0 });
  }
  if (points.length === 0) return json({ error: 'points 无有效数据' }, 400);
  const inserted = await upsertHistory(env.DB, name, points);
  if (typeof b.gid === 'string' && b.gid) await setGid(env.DB, name, b.gid, unixSec());
  return json({ ok: true, name, inserted });
}

async function runCollection(env: Env): Promise<void> {
  const db = env.DB;
  const started = Date.now();
  const maxItems = envNum(env, 'MAX_ITEMS_PER_RUN', 100);
  const concurrency = envNum(env, 'CONCURRENCY', 3);
  const timeoutMs = envNum(env, 'STEAM_TIMEOUT_MS', 10000);
  const retries = envNum(env, 'STEAM_RETRIES', 2);
  const delayMs = envNum(env, 'REQUEST_DELAY_MS', 400);
  const days = envNum(env, 'HISTORY_DAYS', 3650);
  const opts = { timeoutMs, retries };

  const names = (await collectTargetNames(env, db)).slice(0, maxItems);
  const okNames: string[] = [];
  const failed: Array<{ name: string; reason: string }> = [];
  let addedTotal = 0;
  let idx = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = idx++;
      if (i >= names.length) return;
      const name = names[i];
      try {
        const added = await collectOne(db, name, days, opts);
        okNames.push(name);
        addedTotal += added;
      } catch (e) {
        failed.push({ name, reason: fmtErr(e) });
      }
      if (i < names.length - 1) await sleep(delayMs);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(Math.max(concurrency, 1), Math.max(names.length, 1)) }, () => worker()),
  );

  const summary = {
    at: new Date().toISOString(),
    durationMs: Date.now() - started,
    total: names.length,
    ok: okNames.length,
    fail: failed.length,
    addedPoints: addedTotal,
    failed: failed.slice(0, 50),
  };
  await setMeta(db, 'last_run_summary', JSON.stringify(summary));
  await setMeta(db, 'last_run_at', String(unixSec()));
}

async function collectOne(
  db: D1DatabaseLike,
  name: string,
  days: number,
  opts: { timeoutMs: number; retries: number },
): Promise<number> {
  const gid = await getGid(db, name);
  const { html, finalUrl } = await fetchListingHtml(name, gid, opts);
  const parsed = parseListingPage(html, finalUrl);
  if (!parsed.pricePoints || parsed.pricePoints.length === 0) {
    throw new Error('页面未解析到价格历史（SSR 与 line1 均无）');
  }
  if (parsed.gid && parsed.gid !== gid) await setGid(db, name, parsed.gid, unixSec());
  const lastTs = await getLastTs(db, name);
  const points = filterHistoryPoints(parsed.pricePoints, days, lastTs);
  if (points.length === 0) return 0;
  return upsertHistory(db, name, points);
}