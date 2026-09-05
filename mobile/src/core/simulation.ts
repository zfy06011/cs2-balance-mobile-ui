/**
 * simulation：资金模拟（与后端 services/simulation.py 对齐）。
 * 稳健/平衡/激进三配置；考虑单箱流动性上限；目标余额反推。
 */
export interface SimItemInput {
  name: string;
  c5_price: number;
  predicted_p50: number;
  predicted_p25: number;
  prob_loss: number;
  volume: number;
  risk: 'low' | 'medium' | 'high';
  liquidity: 'low' | 'medium' | 'high';
}

export const SIM_CONFIG: Record<string, { max_items: number; risk_ceiling: string; liquidity_min: number }> = {
  conservative: { max_items: 3, risk_ceiling: 'low', liquidity_min: 5000 },
  balanced: { max_items: 5, risk_ceiling: 'medium', liquidity_min: 2000 },
  aggressive: { max_items: 8, risk_ceiling: 'high', liquidity_min: 800 },
};

export interface SimResult {
  allocation: string;
  items: {
    name: string;
    qty: number;
    buy_cost: number;
    expected_receive: number;
    expected_roi: number;
    prob_loss: number;
  }[];
  total_buy_cost: number;
  expected_steam_receive: number;
  expected_net_profit: number;
  expected_roi: number;
  weighted_loss_prob: number;
}

function dailyVolume(volume: number): number {
  return Math.max(1, Math.floor(volume / 30));
}

function maxBuyQty(it: SimItemInput, budgetPerItem: number): number {
  const depth = Math.max(1, Math.floor(dailyVolume(it.volume) / 4));
  const byBudget = it.c5_price > 0 ? Math.floor(budgetPerItem / it.c5_price) : 0;
  return Math.max(1, Math.min(depth, byBudget));
}

export function simulate(budget: number, items: SimItemInput[], allocation = 'balanced'): SimResult | null {
  if (budget <= 0 || items.length === 0) return null;
  const cfg = SIM_CONFIG[allocation] ?? SIM_CONFIG.balanced;

  const scored: { score: number; it: SimItemInput }[] = [];
  for (const it of items) {
    const roi = it.c5_price > 0 ? (it.predicted_p50 * 0.8696 - it.c5_price * 1.01) / (it.c5_price * 1.01) : 0;
    const liqScore = it.liquidity === 'high' ? 1 : it.liquidity === 'medium' ? 0.6 : 0.2;
    const riskPenalty = it.risk === 'low' ? 0.05 : it.risk === 'medium' ? 0.15 : 0.3;
    const score = roi * 10 + liqScore * 0.5 - riskPenalty + (1 - it.prob_loss) * 0.3;
    scored.push({ score, it });
  }
  scored.sort((a, b) => b.score - a.score);

  const chosen: SimResult['items'] = [];
  let remaining = budget;
  for (const { it } of scored.slice(0, cfg.max_items)) {
    if (remaining <= 0) break;
    const budgetPer = remaining / Math.max(1, cfg.max_items - chosen.length);
    let qty = maxBuyQty(it, budgetPer);
    let cost = qty * it.c5_price * 1.01;
    if (cost > remaining) {
      qty = Math.max(0, Math.floor(remaining / (it.c5_price * 1.01)));
      cost = qty * it.c5_price * 1.01;
    }
    if (qty <= 0) continue;
    const expectedReceive = qty * it.predicted_p50 * 0.8696;
    chosen.push({
      name: it.name,
      qty,
      buy_cost: round2(cost, 2),
      expected_receive: round2(expectedReceive, 2),
      expected_roi: cost ? round4((expectedReceive - cost) / cost) : 0,
      prob_loss: it.prob_loss,
    });
    remaining -= cost;
    if (remaining < Math.min(...items.map((i) => i.c5_price), 9999)) continue;
  }

  if (chosen.length === 0) return null;
  const totalCost = chosen.reduce((a, d) => a + d.buy_cost, 0);
  const totalReceive = chosen.reduce((a, d) => a + d.expected_receive, 0);
  const net = totalReceive - totalCost;
  const weighted = totalCost ? chosen.reduce((a, d) => a + d.buy_cost * d.prob_loss, 0) / totalCost : 0;
  return {
    allocation,
    items: chosen,
    total_buy_cost: round2(totalCost, 2),
    expected_steam_receive: round2(totalReceive, 2),
    expected_net_profit: round2(net, 2),
    expected_roi: totalCost ? round4(net / totalCost) : 0,
    weighted_loss_prob: round4(weighted),
  };
}

export function reverseTarget(targetBalance: number, expectedRoi = 0.03): {
  target_balance: number;
  assumed_roi: number;
  required_budget: number;
  expected_profit: number;
} {
  const requiredBudget = targetBalance / (1 + expectedRoi);
  return {
    target_balance: targetBalance,
    assumed_roi: expectedRoi,
    required_budget: round2(requiredBudget, 2),
    expected_profit: round2(targetBalance - requiredBudget, 2),
  };
}

function round2(v: number, d = 2): number {
  const p = Math.pow(10, d);
  return Math.round(v * p) / p;
}
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
