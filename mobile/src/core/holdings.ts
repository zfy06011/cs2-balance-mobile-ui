/**
 * holdings：持仓汇总（纯函数，无 RN / 无存储依赖，可进 verify:core 对拍）。
 *
 * 为什么单独抽出来（v1.8.6）：
 *  - 库存页每张卡片、详情页顶部「我的持仓」块需要同一套口径（均价/成本/估值/盈亏/最早解锁），
 *    抽成纯函数避免两处算出不同结果；
 *  - 更重要的是「倒计时必须实时」：调用方把 now 传进来，每次渲染用
 *    unlock_at - now 现算剩余时间，不再依赖会被缓存冻住的 days_left/hours_left。
 */
import type { InventoryEntry, HoldingsSummary } from './types';

/** C5 买入手续费率（与 core/fees.ts 的 DEFAULT_FEES.c5_buy_fee_ratio 保持一致） */
export const C5_BUY_FEE_RATIO = 0.01;

const HOUR_MS = 3600000;

/**
 * 汇总一组同种武器箱的持仓。
 * - 返回 null 表示没有持仓（调用方据此不渲染持仓块）
 * - 加权均价按数量加权（不是简单平均）
 * - 总成本含 C5 买入手续费（买价 × 数量 × (1 + 1%)）
 * - 当前估值 = 最新 Steam 价 × 数量（无行情时为 null，不影响其它字段）
 * - 剩余时间基于 now 现算，保证倒计时实时
 */
export function summarizeHoldings(
  entries: InventoryEntry[],
  now: number = Date.now(),
): HoldingsSummary | null {
  if (!entries || entries.length === 0) return null;

  let quantity = 0;
  let totalBuyCost = 0;
  let totalValue = 0;
  let valueKnown = true;
  let earliestUnlock = Infinity;
  let anyTradable = false;
  let allTradable = true;

  for (const e of entries) {
    const qty = Number.isFinite(e.quantity) && e.quantity > 0 ? e.quantity : 0;
    quantity += qty;
    const buy = Number.isFinite(e.buy_price) ? e.buy_price : 0;
    totalBuyCost += buy * qty;

    if (e.current_estimate != null && Number.isFinite(e.current_estimate)) {
      totalValue += e.current_estimate * qty;
    } else {
      valueKnown = false;
    }

    // Steam 确认可交易 或 剩余时间已归零 → 该条已可上架，不参与「最早解锁」计算
    const tradable = e.steam_tradable === true || e.hours_left <= 0;
    if (tradable) {
      anyTradable = true;
    } else {
      allTradable = false;
      const unlockMs = new Date(e.unlock_at).getTime();
      if (Number.isFinite(unlockMs) && unlockMs < earliestUnlock) earliestUnlock = unlockMs;
    }
  }

  const totalCost = totalBuyCost * (1 + C5_BUY_FEE_RATIO);
  const avgBuyPrice = quantity > 0 ? totalBuyCost / quantity : 0;
  const currentValue = valueKnown ? totalValue : null;
  // 净利按「Steam 到手」口径：估值已是到手价（net_receive_estimate），故直接减含费成本
  const netProfit = currentValue != null ? currentValue - totalCost : null;
  const roi = netProfit != null && totalCost > 0 ? netProfit / totalCost : null;

  // 全部可上架 → 剩余 0；否则取「尚未解锁的那些」里最早的一个
  const earliestUnlockMs = allTradable ? now : (Number.isFinite(earliestUnlock) ? earliestUnlock : now);
  const msLeft = Math.max(0, earliestUnlockMs - now);

  return {
    itemName: entries[0].item_name,
    quantity,
    records: entries.length,
    avgBuyPrice,
    totalCost,
    currentValue,
    netProfit,
    roi,
    earliestUnlockAt: new Date(earliestUnlockMs).toISOString(),
    msLeft,
    hoursLeft: msLeft / HOUR_MS,
    allTradable,
    anyTradable,
    // 全部可上架时用第一条的建议（此时各条通常一致）；否则取最早解锁那条
    sellAdviceText: pickAdvice(entries, allTradable),
    sellAdviceCode: pickAdviceCode(entries, allTradable),
  };
}

function pickAdvice(entries: InventoryEntry[], allTradable: boolean): string | undefined {
  if (allTradable) return entries[0].sell_advice_text;
  const withAdvice = entries.find((e) => !!e.sell_advice_text);
  return withAdvice?.sell_advice_text;
}

function pickAdviceCode(entries: InventoryEntry[], allTradable: boolean): InventoryEntry['sell_advice_code'] {
  if (allTradable) return entries[0].sell_advice_code;
  const withAdvice = entries.find((e) => !!e.sell_advice_code);
  return withAdvice?.sell_advice_code;
}

/** 持仓总览（库存页顶部 2×2 卡片用）：把全部持仓按箱子分组后汇总 */
export interface PortfolioOverview {
  /** 种类数（不同箱子个数） */
  kinds: number;
  /** 总件数 */
  quantity: number;
  /** 含费总投入 */
  totalCost: number;
  /** 当前总估值（有行情的按行情，无行情的按成本估） */
  currentValue: number;
  /** 浮动盈亏（估值 - 成本） */
  netProfit: number;
  /** 回报率 */
  roi: number | null;
  /** 可上架的种类数 */
  tradableKinds: number;
  /** 冷却中的种类数 */
  coolingKinds: number;
}

/** 由每箱的持仓汇总再汇总出总览（库存页顶部用） */
export function summarizePortfolio(summaries: HoldingsSummary[]): PortfolioOverview {
  let quantity = 0;
  let totalCost = 0;
  let currentValue = 0;
  let tradableKinds = 0;
  let coolingKinds = 0;
  for (const s of summaries) {
    quantity += s.quantity;
    totalCost += s.totalCost;
    // 无行情的按成本计入估值，避免总览忽大忽小
    currentValue += s.currentValue != null ? s.currentValue : s.totalCost;
    if (s.allTradable) tradableKinds++;
    else coolingKinds++;
  }
  const netProfit = currentValue - totalCost;
  return {
    kinds: summaries.length,
    quantity,
    totalCost,
    currentValue,
    netProfit,
    roi: totalCost > 0 ? netProfit / totalCost : null,
    tradableKinds,
    coolingKinds,
  };
}

/** 冷却进度（0..1，1 = 已解锁）：用于进度条。用买入时刻到解锁时刻作为总时长 */
export function cooldownProgress(entries: InventoryEntry[], now: number = Date.now()): number {
  if (!entries || entries.length === 0) return 1;
  let total = 0;
  let elapsed = 0;
  for (const e of entries) {
    const startMs = new Date(e.buy_at).getTime();
    const endMs = new Date(e.unlock_at).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    total += endMs - startMs;
    elapsed += Math.min(Math.max(now - startMs, 0), endMs - startMs);
  }
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, elapsed / total));
}

/** 剩余时间的可读文案（大白话：>=24h 显示「x 天 y 小时」，<24h 显示「x 小时」，<=0 显示「可上架」） */
export function fmtRemainHours(h: number): string {
  if (!Number.isFinite(h) || h <= 0) return '可上架';
  const total = Math.ceil(h);
  if (total < 24) return `${total} 小时`;
  const d = Math.floor(total / 24);
  const hh = total % 24;
  return hh > 0 ? `${d} 天 ${hh} 小时` : `${d} 天`;
}

/** 相对时间（「3 分钟前」）：库存页「上次同步」用 */
export function fmtAgo(fromIso: string | null, now: number = Date.now()): string {
  if (!fromIso) return '从未同步';
  const t = new Date(fromIso).getTime();
  if (!Number.isFinite(t)) return '从未同步';
  const mins = Math.floor(Math.max(0, now - t) / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}
