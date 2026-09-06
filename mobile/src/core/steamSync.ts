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

export interface EmptySyncContext {
  ctx16Error?: string | null;
  assetCount: number;
  totalInventoryCount: number | null;
  ctx2Total: number | null;
  ctx16Total: number | null;
  playerName: string | null;
  /** context 2 原始响应片段（截断 ≤300 字符、单行）；空库存时透出定位 Steam 实际返回形状 */
  ctx2Raw?: string;
  /** context 16 原始响应片段（截断 ≤300 字符、单行） */
  ctx16Raw?: string;
}

/** 空库存结果的诊断文案：透出 context 2/16 各自 report 总数 + SteamID 昵称，
 *  用于区分「ID 填错」与「Valve 不向第三方返回保护期物品」。纯函数，可对拍测试。 */
export function buildEmptySyncReason(c: EmptySyncContext): string {
  const ctxDetail = `context 2 报 ${c.ctx2Total ?? '?'} 件、context 16 报 ${c.ctx16Total ?? '?'} 件`;
  const who = c.playerName
    ? `该 SteamID 昵称「${c.playerName}」，请核对是否本人账号`
    : '无法取得该 SteamID 昵称（接口失败），请核对是否本人账号';
  // 原始响应片段（fetchContext 截断后的真实返回）：两通道都空/无计数时，先看 Steam 实际返回形状定位，
  // 例如响应确实是 {response:{...}} 但内部为空，还是被 Valve 改成了别的结构。
  const raws = [c.ctx2Raw, c.ctx16Raw].filter((x): x is string => !!x && x !== '{}');
  const rawSnippet = raws.length > 0 ? `；Steam 原始返回片段：${raws.join(' || ')}` : '';
  if (c.ctx16Error) {
    return `库存为空，且交易保护箱通道（context 16）失败：${c.ctx16Error}；${ctxDetail}；${who}${rawSnippet}`;
  }
  if (c.assetCount === 0 && (c.totalInventoryCount ?? 0) === 0) {
    return `Steam 库存为空：该账号 CS2 库存里没有任何物品（${ctxDetail}；${who}）。若物品全在交易保护期，Steam Web API 可能不返回保护期物品，请用 Steam 登录后的会话同步验证${rawSnippet}`;
  }
  if (c.assetCount > 0) {
    return `Steam 库存可见 ${c.assetCount} 件物品，但没有武器箱（${ctxDetail}；${who}${rawSnippet}）`;
  }
  return `Steam 返回异常（报告共 ${c.totalInventoryCount ?? '?'} 件但列表为空；${ctxDetail}；${who}${rawSnippet}）`;
}

export interface SteamSyncPlan {
  updates: Array<{ id: number; patch: SteamCooldownPatch }>;
  newEntries: SteamSyncNewEntry[];
  /** 本地记录在 Steam 库存中匹配到的条数 */
  matched: number;
  /** 其中已可上架的条数（含新导入且已解锁的） */
  unlocked: number;
  /** 从 Steam 新导入到本地库存的条数 */
  imported: number;
  /** 本地记录未在 Steam 库存中找到的条数 */
  notFound: number;
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

/** 规划一次 Steam 库存同步：对既有记录产出 patch，对 Steam 独有的箱子产出新条目 */
export function planSteamSync(
  rows: SteamSyncRow[],
  items: SteamSyncInputItem[],
  now: Date = new Date(),
): SteamSyncPlan {
  const byKey = new Map<string, SteamSyncInputItem>();
  for (const it of items) {
    byKey.set(it.name, it);
    if (it.cnName) byKey.set(it.cnName, it);
  }

  const updates: SteamSyncPlan['updates'] = [];
  const matchedSteam = new Set<string>();
  let matched = 0;
  let unlocked = 0;
  let notFound = 0;

  for (const r of rows) {
    const st = byKey.get(r.item_name);
    if (!st) {
      notFound++;
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

  return { updates, newEntries, matched, unlocked, imported: newEntries.length, notFound };
}
