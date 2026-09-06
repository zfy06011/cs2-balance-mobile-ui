/**
 * Steam 市场网络层：限时/重试的抓取（Cloudflare 海外出口直连，无需 Steam++）。
 */
import { MARKET_BASE, APPID } from './config.ts';
import { parseListingPage, type SteamPricePoint } from './steam.ts';
import { fmtErr, sleep } from './util.ts';

export interface FetchOpts {
  timeoutMs: number;
  retries: number;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export async function fetchWithRetry(url: string, opts: FetchOpts, init?: RequestInit): Promise<Response> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    try {
      const resp = await fetch(url, { ...init, redirect: 'follow', signal: ctrl.signal });
      if (resp.ok) return resp;
      lastErr = new Error('Steam 返回 HTTP ' + resp.status);
      if (resp.status === 403 || resp.status === 429) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < opts.retries) await sleep(1000 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(fmtErr(lastErr));
}

/** 抓列表页（有 gid 缓存则直接抓 gid 页，否则抓名称页并跟随重定向），返回 HTML + 终态 URL */
export async function fetchListingHtml(
  name: string,
  gid: string | null,
  opts: FetchOpts,
  cookie = '',
): Promise<{ html: string; finalUrl: string }> {
  const path = gid ? String(gid) : encodeURIComponent(name);
  const url = MARKET_BASE + '/listings/' + APPID + '/' + path;
  const init: RequestInit = {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      ...(cookie ? { Cookie: cookie } : {}),
    },
  };
  const resp = await fetchWithRetry(url, opts, init);
  const html = await resp.text();
  return { html, finalUrl: resp.url };
}

/** 按天数截断 + 按「已存最大 ts」增量过滤，升序返回 */
export function filterHistoryPoints(points: SteamPricePoint[], days: number, afterTs: number | null): SteamPricePoint[] {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  return points
    .filter((p) => p.ts >= since && (afterTs == null || p.ts > afterTs))
    .sort((a, b) => a.ts - b.ts);
}

export { parseListingPage };