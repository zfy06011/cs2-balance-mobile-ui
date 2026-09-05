/**
 * zhNames：Steam 市场中文名自动缓存（解决「未收录中文名」问题）。
 * - 采集热门榜单时带上 l=schinese，Steam 会返回官方中文名（name 字段），
 *   与英文 MarketHashName（hash_name 字段）配对后写入本地缓存。
 * - 覆盖 Steam 全部武器箱/胶囊/收藏包，无需逐条手工维护映射；
 *   手工映射（cn_names.ts）优先级更高，可覆盖 Steam 官方译名（如 C5GAME 叫法）。
 * - displayName() 为同步函数，这里用「内存缓存 + 启动预热」配合：
 *     warmZhNames()  App 启动时把持久化缓存加载进内存
 *     mergeZhNames() 每次采集后合并新中文名并落盘
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const K_ZH_NAMES = '@cs2balance/zh_names_v1';

/** 内存缓存：App 启动后由 warmZhNames() 预热，采集后由 mergeZhNames() 增量更新 */
let cache: Record<string, string> | null = null;

/** 判断字符串是否含简体中文（防御：l=schinese 未生效时不误存） */
function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

/** 预热：读持久化缓存到内存（App 启动时调用一次） */
export async function warmZhNames(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(K_ZH_NAMES);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const next: Record<string, string> = {};
      for (const key of Object.keys(parsed)) {
        const v = parsed[key];
        if (typeof v === 'string' && v && hasChinese(v)) next[key] = v;
      }
      cache = next;
    } else {
      cache = cache ?? {};
    }
  } catch {
    cache = cache ?? {};
  }
}

/** 合并一批 { 英文MarketHashName: 中文名 } 进缓存并落盘 */
export async function mergeZhNames(map: Record<string, string>): Promise<void> {
  if (!cache) await warmZhNames();
  let changed = false;
  for (const key of Object.keys(map)) {
    const v = map[key];
    if (key && v && hasChinese(v)) {
      if (cache![key] !== v) {
        cache![key] = v;
        changed = true;
      }
    }
  }
  if (changed) {
    try {
      await AsyncStorage.setItem(K_ZH_NAMES, JSON.stringify(cache));
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
