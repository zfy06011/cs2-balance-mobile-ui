/**
 * steamSync：Steam 库存同步的纯匹配/导入规划（无 RN / 无存储依赖，可进 verify_core 对拍）。
 * - 匹配键：英文 MarketHashName + Steam 官方中文名双键（手动录入中文名也能匹配）
 * - Steam 库存里未被本地收录的武器箱 → 生成新库存条目（source='steam_sync'，buy_price=0）
 * - 冷却估算：已解锁记「观察到可交易」时刻；冷却中取 min(历史估计, 本次观察+剩余整天)
 */

export interface SteamSyncRow {
  id: number;
  item_name: string;
  steam_first_seen_at?: string | null;
  steam_unlock_est_at?: string | null;
}

export interface SteamSyncInputItem {
  name: string;
  cnName: string | null;
  amount: number;
  tradable: boolean;
  /** 距可交易剩余整数天；0 或 null 且 tradable=true 表示已解锁 */
  tradableRestrictionDays: number | null;
}

export interface SteamCooldownPatch {
  steam_synced_at: string;
  steam_tradable: boolean;
  steam_unlock_est_at: string;
  steam_first_seen_at: string;
}

export interface SteamSyncNewEntry extends SteamCooldownPatch {
  item_name: string;
  quantity: number;
  buy_price: number;
  buy_at: string;
  source: string;
}

// v1.5.9：库存仅走 C5 app-key，空的 Steam Web API 诊断（buildEmptySyncReason/isEmptyResponseRaw）已随 Web API 库存移除。

/** C5 空库存诊断上下文（v1.5.9）：C5 服务端高权限通道能看到交易保护中的物品（status=4 冷却中），
 *  若 C5 也返回空，说明该 SteamID 下确实没有武器箱（或 SteamID64 填错 / app-key 未绑定该账号）。 */
export interface C5EmptySyncContext {
  /** C5 接口报告的资产总数（data.total，可能为 null） */
  total: number | null;
  /** 列表资产件数（含非武器箱；data.list 长度） */
  assetCount: number;
}

/** C5 空库存诊断文案（v1.5.9）：不再有「Steam 不返回保护期物品」的歧义——C5 视角可见保护期箱子。 */
export function buildC5EmptySyncReason(c: C5EmptySyncContext): string {
  const totalText = c.total != null ? String(c.total) : '?';
  if (c.assetCount === 0) {
    return 'C5 服务端未返回任何物品（Steam 侧共报 ' + totalText + ' 件资产）。C5 官方库存通道（app-key）能看到交易保护中的箱子（含 7 天冷却期），因此「C5 返回空」通常意味着 SteamID64 不是本人账号、或 C5 app-key 未绑定该账号；请核对后重试。';
  }
  return 'C5 服务端可见 ' + c.assetCount + ' 件资产，其中没有武器箱（共报 ' + totalText + ' 件）';
}

export interface SteamSyncPlan {
  updates: Array<{ id: number; patch: SteamCooldownPatch }>;
  newEntries: SteamSyncNewEntry[];
  /** v1.8.6：本次应移除的本地库存 id（之前确实在 Steam 见过、这次已不在库 = 已卖出/已移走）。
   *  只含 steam_first_seen_at != null 的条目——纯手动录入、从没在 Steam 见过的记录绝不自动删。 */
  removeIds: number[];
  /** 本地记录在 Steam 库存中匹配到的条数 */
  matched: number;
  /** 其中已可上架的条数（含新导入且已解锁的） */
  unlocked: number;
  /** 从 Steam 新导入到本地库存的条数 */
  imported: number;
  /** 本地记录未在 Steam 库存中找到的条数 */
  notFound: number;
  /** 实际从本地移除的条数（= removeIds.length） */
  removed: number;
}

const DAY_MS = 86400000;

/** 单条冷却估算：已解锁 → 当前时刻；冷却中 → min(历史估计, 本次观察 + 剩余整天) */
export function estimateCooldown(
  item: Pick<SteamSyncInputItem, 'tradable' | 'tradableRestrictionDays'>,
  prevEstAt: string | null | undefined,
  now: Date,
): { tradableNow: boolean; estAt: string } {
  const nowIso = now.toISOString();
  if (item.tradable || item.tradableRestrictionDays === 0) {
    return { tradableNow: true, estAt: nowIso };
  }
  const effDays = item.tradableRestrictionDays ?? 7;
  const estThis = now.getTime() + effDays * DAY_MS;
  const prevMs = prevEstAt ? new Date(prevEstAt).getTime() : NaN;
  const hasPrev = Number.isFinite(prevMs) && prevMs > 0;
  return { tradableNow: false, estAt: new Date(hasPrev ? Math.min(prevMs, estThis) : estThis).toISOString() };
}

/** 规划一次 Steam 库存同步：对既有记录产出 patch，对 Steam 独有的箱子产出新条目，
 *  并列出「已不在 Steam 库存」的本地记录（v1.8.6：自动移除已卖出的箱子）。 */
export function planSteamSync(
  rows: SteamSyncRow[],
  items: SteamSyncInputItem[],
  now: Date = new Date(),
  opts: { allowRemoval?: boolean } = {},
): SteamSyncPlan {
  const byKey = new Map<string, SteamSyncInputItem>();
  for (const it of items) {
    byKey.set(it.name, it);
    if (it.cnName) byKey.set(it.cnName, it);
  }

  const updates: SteamSyncPlan['updates'] = [];
  const removeIds: number[] = [];
  const matchedSteam = new Set<string>();
  let matched = 0;
  let unlocked = 0;
  let notFound = 0;

  // allowRemoval 默认 true；调用方在「C5 返回空库存」时必须显式传 false（疑似接口异常，不能据此删数据）
  const allowRemoval = opts.allowRemoval !== false;

  for (const r of rows) {
    const st = byKey.get(r.item_name);
    if (!st) {
      notFound++;
      // 之前确实在 Steam 见过（有首次观察时间）→ 现在不在库了，说明已卖出/移走
      if (allowRemoval && r.steam_first_seen_at) removeIds.push(r.id);
      continue;
    }
    matched++;
    matchedSteam.add(st.name);
    const { tradableNow, estAt } = estimateCooldown(st, r.steam_unlock_est_at, now);
    if (tradableNow) unlocked++;
    updates.push({
      id: r.id,
      patch: {
        steam_synced_at: now.toISOString(),
        steam_tradable: tradableNow,
        steam_unlock_est_at: estAt,
        steam_first_seen_at: r.steam_first_seen_at || now.toISOString(),
      },
    });
  }

  const newEntries: SteamSyncNewEntry[] = [];
  for (const it of items) {
    if (matchedSteam.has(it.name)) continue;
    const { tradableNow, estAt } = estimateCooldown(it, null, now);
    if (tradableNow) unlocked++;
    newEntries.push({
      item_name: it.name,
      quantity: Math.max(1, it.amount),
      buy_price: 0,
      buy_at: now.toISOString(),
      source: 'steam_sync',
      steam_synced_at: now.toISOString(),
      steam_tradable: tradableNow,
      steam_unlock_est_at: estAt,
      steam_first_seen_at: now.toISOString(),
    });
  }

  return {
    updates,
    newEntries,
    removeIds,
    matched,
    unlocked,
    imported: newEntries.length,
    notFound,
    removed: removeIds.length,
  };
}
