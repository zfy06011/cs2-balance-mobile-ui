/**
 * buy：C5GAME 一键买入的购买保护核验（HANDOFF v2.0 第 9 节）。
 *
 * 原则：只调用已验证的官方接口。当前账号体系下没有确认可用的 C5GAME 下单 API，
 * 因此「一键买入」= 购买前核验（最高买入价 / 最低目标折扣 / 预算上限 / 异常价格二次确认）
 * → 用户确认 → 写入本地库存 + 订单记录。绝不臆造自动化下单接口。
 */
import { DEFAULT_FEES } from './fees';

export interface BuyProtection {
  /** 最高买入价（元），0 = 不限 */
  maxBuyPrice: number;
  /** 最低目标折扣（折数，如 9.5 = 只接受预计 9.5 折及以下），0 = 不限 */
  minTargetDiscount: number;
  /** 单笔预算上限（元），0 = 不限 */
  maxBudget: number;
}

export const DEFAULT_BUY_PROTECTION: BuyProtection = {
  maxBuyPrice: 0,
  minTargetDiscount: 0,
  maxBudget: 0,
};

export interface BuySummary {
  buyPrice: number;
  qty: number;
  /** 含 C5 买入费用的总投入（元） */
  totalCost: number;
  /** 预计 Steam 到手总额（扣费后，元）；null = 无 Steam 价 */
  netReceive: number | null;
  /** 预计几折（0.926 = 9.26 折，越低越划算） */
  discountNum: number | null;
  /** 展示用折数（discountNum × 10） */
  discountZhe: number | null;
  /** 预计净利润（元） */
  netProfit: number | null;
}

export interface BuyCheckResult {
  ok: boolean;
  /** 阻断购买的原因（必须解决后才允许买入） */
  errors: string[];
  /** 需要二次确认的警告（用户确认后才允许买入） */
  warnings: string[];
  summary: BuySummary;
}

export function buildBuySummary(buyPrice: number, qty: number, steamNetReceivePerUnit: number | null): BuySummary {
  const perCost = buyPrice > 0 ? buyPrice * (1 + DEFAULT_FEES.c5_buy_fee_ratio) : 0;
  const totalCost = perCost * Math.max(1, qty);
  const netReceive = steamNetReceivePerUnit != null && steamNetReceivePerUnit > 0 ? steamNetReceivePerUnit * Math.max(1, qty) : null;
  const discountNum = netReceive != null && netReceive > 0 ? perCost / steamNetReceivePerUnit! : null;
  const discountZhe = discountNum != null ? discountNum * 10 : null;
  const netProfit = netReceive != null ? netReceive - totalCost : null;
  return { buyPrice, qty, totalCost, netReceive, discountNum, discountZhe, netProfit };
}

/**
 * 购买前核验：返回是否可买、阻断错误、二次确认警告与摘要。
 * protection 中为 0 的项视为不限。
 */
export function checkPurchase(input: {
  buyPrice: number;
  qty: number;
  steamNetReceivePerUnit: number | null;
  protection?: Partial<BuyProtection>;
}): BuyCheckResult {
  const p: BuyProtection = { ...DEFAULT_BUY_PROTECTION, ...(input.protection ?? {}) };
  const errors: string[] = [];
  const warnings: string[] = [];
  const { buyPrice, qty, steamNetReceivePerUnit } = input;

  if (!Number.isFinite(buyPrice) || buyPrice <= 0) errors.push('买入价无效');
  if (!Number.isFinite(qty) || qty < 1 || qty > 999) errors.push('数量需在 1-999 之间');

  const summary = buildBuySummary(Number.isFinite(buyPrice) ? buyPrice : 0, qty, steamNetReceivePerUnit);

  if (p.maxBuyPrice > 0 && buyPrice > p.maxBuyPrice) {
    errors.push(`买入价 ¥${buyPrice.toFixed(2)} 超过最高限价 ¥${p.maxBuyPrice.toFixed(2)}`);
  }
  if (p.maxBudget > 0 && summary.totalCost > p.maxBudget) {
    errors.push(`本次投入 ¥${summary.totalCost.toFixed(2)} 超过预算上限 ¥${p.maxBudget.toFixed(2)}`);
  }
  if (p.minTargetDiscount > 0 && summary.discountZhe != null && summary.discountZhe > p.minTargetDiscount) {
    errors.push(`预计 ${summary.discountZhe.toFixed(2)} 折，未达到目标折扣 ${p.minTargetDiscount.toFixed(2)} 折`);
  }
  if (summary.discountNum != null && summary.discountNum > 1.2) {
    warnings.push(`预计 ${summary.discountZhe?.toFixed(2)} 折，到手可能低于投入，存在亏损风险`);
  }
  if (summary.discountNum == null) {
    warnings.push('缺少 Steam 价格，无法估算到手与折扣，请先刷新价格');
  }
  return { ok: errors.length === 0, errors, warnings, summary };
}
