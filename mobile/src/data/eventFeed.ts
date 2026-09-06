/**
 * eventFeed：软件内实时市场事件源（无需任何 API key）。
 * 数据源：CS2 官方博客 RSS + Steam CS2 新闻 RSS；6 小时缓存，拉取失败保留旧缓存。
 * 标签（core/rss.ts#tagTitle）标出可能影响箱子价格的事件：
 * policy=交易/更新类（警惕闪崩）、boost=Major 锦标赛（需求提振）、
 * sale=特卖（压制）、case=箱子/收藏包相关、op=行动/通行证。
 */
import { storage } from './storage';
import { parseRss, filterRecent, FeedItem } from '../core/rss';

const SOURCES = [
  { url: 'https://blog.counter-strike.net/index.php/feed/', source: 'CS2 官方博客' },
  { url: 'https://store.steampowered.com/feeds/news/app/730/', source: 'Steam 新闻' },
];

const TTL_MS = 6 * 3600000;
const KEEP_ITEMS = 30;

export interface MarketNews {
  items: FeedItem[];
  fetchedAt: string;
  /** 本次拉取失败的数据源数量（0 = 全部成功；全部失败且无缓存时 items 为空） */
  failed: number;
}

export async function refreshMarketNews(force = false): Promise<MarketNews> {
  const cached = await storage.getEventFeed();
  const cachedAt = cached?.fetchedAt ?? '';
  if (!force && cached && cachedAt && Date.now() - new Date(cachedAt).getTime() < TTL_MS) {
    return { items: cached.items as unknown as FeedItem[], fetchedAt: cachedAt, failed: 0 };
  }

  const results = await Promise.allSettled(
    SOURCES.map(async (s) => {
      const resp = await fetch(s.url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/rss+xml, application/xml, text/xml, */*' } });
      if (!resp.ok) throw new Error(`feed ${resp.status}`);
      return resp.text();
    }),
  );

  let items: FeedItem[] = [];
  let failed = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      items = items.concat(parseRss(r.value, SOURCES[i].source, 15));
    } else {
      failed++;
    }
  });
  items = filterRecent(items, 45).slice(0, KEEP_ITEMS);

  const fetchedAt = new Date().toISOString();
  if (items.length > 0 || !cached) {
    await storage.saveEventFeed({ items: items as unknown as Array<Record<string, unknown>>, fetchedAt });
  }
  const finalItems = items.length > 0 ? items : ((cached?.items ?? []) as unknown as FeedItem[]);
  return { items: finalItems, fetchedAt, failed };
}
