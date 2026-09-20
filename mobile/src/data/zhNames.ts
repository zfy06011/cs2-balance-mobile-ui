/**
 * zhNames：Steam 市场中文名自动缓存（解决「未收录中文名」问题）。
 * - 采集热门榜单时带上 l=schinese，Steam 会返回官方中文名（name 字段），
 *   与英文 MarketHashName（hash_name 字段）配对后写入本地缓存。
 * - 覆盖 Steam 全部武器箱/胶囊/收藏包，无需逐条手工维护映射；
 *   手工映射（cn_names.ts）优先级更高，可覆盖 Steam 官方译名（如 C5GAME 叫法）。
 * - displayName() 为同步函数，这里用「内存缓存 + 启动预热」配合：
 *     warmZhNames()  App 启动时把持久化缓存加载进内存
 *     mergeZhNames() 每次采集后合并新中文名并落盘
 * - v1.7.0 起持久化介质由 AsyncStorage 改为 SQLite（zh_names 表）。
 */
import { ensureDb } from './db';
import { enqueueWrite } from './writeQueue';

/** 内存缓存：App 启动后由 warmZhNames() 预热，采集后由 mergeZhNames() 增量更新 */
let cache: Record<string, string> | null = null;

/** 判断字符串是否含简体中文（防御：l=schinese 未生效时不误存） */
function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

/** 预热：读持久化缓存到内存（App 启动时调用一次） */
export async function warmZhNames(): Promise<void> {
  try {
    const db = await ensureDb();
    const rows = await db.getAllAsync<{ market_hash_name: string; cn_name: string }>(
      'SELECT market_hash_name, cn_name FROM zh_names',
    );
    const next: Record<string, string> = {};
    for (const r of rows) {
      if (r.market_hash_name && r.cn_name && hasChinese(r.cn_name)) {
        next[r.market_hash_name] = r.cn_name;
      }
    }
    cache = next;
  } catch {
    cache = cache ?? {};
  }
}

/** 合并一批 { 英文MarketHashName: 中文名 } 进缓存并落盘 */
export async function mergeZhNames(map: Record<string, string>): Promise<void> {
  if (!cache) await warmZhNames();
  const changed: Array<[string, string]> = [];
  for (const key of Object.keys(map)) {
    const v = map[key];
    if (key && v && hasChinese(v)) {
      if (cache![key] !== v) {
        cache![key] = v;
        changed.push([key, v]);
      }
    }
  }
  if (changed.length > 0) {
    try {
      // v1.8.5：并入全局写队列（原来自行开事务，会与详情页补历史/后台扫描的事务交错
      // → 嵌套 BEGIN → 原生层闪退；见 data/writeQueue.ts）
      await enqueueWrite(async () => {
        const db = await ensureDb();
        await db.withTransactionAsync(async () => {
          for (const [k, v] of changed) {
            await db.runAsync(
              'INSERT OR REPLACE INTO zh_names (market_hash_name, cn_name) VALUES (?, ?)',
              k,
              v,
            );
          }
        });
      });
    } catch {
      // 缓存写失败不阻断主流程，内存仍可用
    }
  }
}

/** 同步取中文名（配合 displayName 使用）；未收录返回 null */
export function zhNameOf(marketHashName: string): string | null {
  return cache?.[marketHashName] ?? null;
}

/** 当前内存缓存条目数（调试/测试用） */
export function zhCacheSize(): number {
  return cache ? Object.keys(cache).length : 0;
}
