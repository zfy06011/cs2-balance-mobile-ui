/**
 * rss：极简 RSS 2.0 解析 + 市场事件标记（纯逻辑，供软件内实时事件源使用）。
 * 数据源（App 内定时拉取）：CS2 官方博客 feed、Steam CS2 新闻 feed。
 * 标签推断市场影响：policy（交易/更新类，可能闪崩）、boost（Major/锦标赛）、
 * sale（特卖）、case（箱子/收藏包）、op（行动）。
 */

export interface FeedItem {
  title: string;
  link: string;
  /** ISO 日期 */
  date: string;
  source: string;
  tags: string[];
}

const DAY_MS = 86400000;

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function firstTag(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}

/** 标题 → 市场影响标签（多选） */
export function tagTitle(title: string): string[] {
  const t = title.toLowerCase();
  const tags: string[] = [];
  if (/(更新|补丁|patch|update|交易|trade|保护|限制|ban|政策)/.test(t)) tags.push('policy');
  if (/(major|锦标赛|championship|季后赛|playoff|比赛)/.test(t)) tags.push('boost');
  if (/(特卖|促销|sale|festival|节日)/.test(t)) tags.push('sale');
  if (/(箱子|武器箱|case|收藏包|capsule|胶囊|key|钥匙)/.test(t)) tags.push('case');
  if (/(行动|operation|通行证|pass)/.test(t)) tags.push('op');
  return tags;
}

/** 解析 RSS 2.0（item 块内 title/link/pubDate）；非法输入返回空数组 */
export function parseRss(xml: string, source: string, limit = 20): FeedItem[] {
  if (!xml || xml.length < 20) return [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  const out: FeedItem[] = [];
  for (const b of blocks) {
    const title = firstTag(b, 'title');
    const link = firstTag(b, 'link');
    const pub = firstTag(b, 'pubdate') ?? firstTag(b, 'pubDate') ?? firstTag(b, 'dc:date');
    if (!title) continue;
    let date = '';
    if (pub) {
      const d = new Date(pub);
      if (!Number.isNaN(d.getTime())) date = d.toISOString();
    }
    out.push({ title, link: link ?? '', date, source, tags: tagTitle(title) });
    if (out.length >= limit) break;
  }
  return out;
}

/** 只保留近 N 天（默认 45）并按日期降序；无日期保守保留；未来日期（>1 天）丢弃 */
export function filterRecent(items: FeedItem[], days = 45, now = Date.now()): FeedItem[] {
  return items
    .filter((it) => {
      if (!it.date) return true;
      const t = new Date(it.date).getTime();
      if (!Number.isFinite(t)) return true;
      return t <= now + DAY_MS && now - t <= days * 86400000;
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
