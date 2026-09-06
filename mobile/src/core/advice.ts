/**
 * advice：C5 买入时机参考 + 库存最佳卖出时机（纯逻辑，无 RN / 存储依赖，可进 verify_core 对拍）。
 * - 买入参考：近 7/30 天 C5 历史统计 + 近 24h 变化 + 分位 + 趋势，
 *   可选长周期日线（Steam pricehistory 数月）：90 天波动率 / 90 天最低距离 / 长趋势
 * - 卖出时机：解锁日 vs 事件窗口（suppress=大促/政策压制 + 回补；boost=Major/春节需求提振）
 */

export interface AdvicePoint {
  /** 毫秒时间戳 */
  t: number;
  price: number;
}

export interface C5BuyAdvice {
  now: number | null;
  avg7d: number | null;
  min7d: number | null;
  max7d: number | null;
  /** 相对昨日（或上一个更早点）的变化比例，-0.03 = 降 3%；无对比点为 null */
  change1d: number | null;
  /** 当前价在近 7 天分布中的分位（0-100，越低越便宜） */
  percentile7d: number | null;
  trend: 'up' | 'down' | 'flat';
  suggested: 'good' | 'ok' | 'wait';
  reason: string;
  /** 长周期指标（可选，来自 Steam 日线）：90 天日波动率（%） */
  vol90Pct?: number | null;
  /** 当前价相对 90 天最低价的距离（0.03 = 高 3%） */
  distFromMin90d?: number | null;
  /** 90 天长趋势（%/天） */
  longTrend90?: number | null;
}

const DAY_MS = 86400000;

function avg(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** 近 7 天线性斜率（元/天）；点数 <3 返回 0 */
function slope7d(points: AdvicePoint[]): number {
  const p = points.slice(-7);
  if (p.length < 3) return 0;
  const n = p.length;
  const xs = p.map((_, i) => i);
  const ys = p.map((x) => x.price);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** 长周期线性斜率（%/天）；点数 <14 返回 null */
function slopePctPerDay(points: AdvicePoint[]): number | null {
  const p = points.slice(-90);
  if (p.length < 14) return null;
  const first = p[0].price;
  const lastP = p[p.length - 1].price;
  const days = Math.max(1, (p[p.length - 1].t - p[0].t) / DAY_MS);
  if (first <= 0) return null;
  return Math.round(((lastP / first - 1) / days) * 10000) / 10000;
}

export function buildC5BuyAdvice(
  history: AdvicePoint[],
  nowPrice: number | null,
  now = Date.now(),
  opts?: { longHistory?: AdvicePoint[] },
): C5BuyAdvice {
  const clean = history
    .filter((p) => Number.isFinite(p.price) && p.price > 0 && Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t)
    .slice(-30);
  const last = clean.length > 0 ? clean[clean.length - 1].price : null;
  const cur = nowPrice != null && nowPrice > 0 ? nowPrice : last;

  const win7 = clean.filter((p) => now - p.t <= 7 * DAY_MS);
  const prices7 = win7.map((p) => p.price);
  const avg7d = cur != null ? avg([...prices7, cur]) : avg(prices7);
  const min7d = prices7.length > 0 ? Math.min(...prices7, cur ?? Infinity) : null;
  const max7d = prices7.length > 0 ? Math.max(...prices7, cur ?? -Infinity) : null;

  // 近一天变化：对比「昨天及更早的最后一个点」
  let change1d: number | null = null;
  if (cur != null) {
    const before = clean.filter((p) => now - p.t >= 12 * 3600000); // 至少半天前的点
    if (before.length > 0) {
      const base = before[before.length - 1].price;
      if (base > 0) change1d = cur / base - 1;
    }
  }

  let percentile7d: number | null = null;
  if (cur != null && prices7.length > 0) {
    const below = prices7.filter((p) => p <= cur).length;
    percentile7d = Math.round((below / (prices7.length + 1)) * 100);
  }

  const sl = slope7d(win7.length >= 3 ? win7 : clean);
  const trend: C5BuyAdvice['trend'] = sl > 0.003 * (avg7d ?? 1) ? 'up' : sl < -0.003 * (avg7d ?? 1) ? 'down' : 'flat';

  // ---- 长周期指标（Steam 日线，≈ 数月）----
  let vol90Pct: number | null = null;
  let distFromMin90d: number | null = null;
  let longTrend90: number | null = null;
  const long = (opts?.longHistory ?? [])
    .filter((p) => Number.isFinite(p.price) && p.price > 0 && Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t)
    .filter((p) => now - p.t <= 90 * DAY_MS);
  if (long.length >= 14 && cur != null) {
    const rets: number[] = [];
    for (let i = 1; i < long.length; i++) {
      if (long[i - 1].price > 0) rets.push(long[i].price / long[i - 1].price - 1);
    }
    if (rets.length >= 10) {
      const m = rets.reduce((a, b) => a + b, 0) / rets.length;
      const variance = rets.reduce((a, b) => a + (b - m) ** 2, 0) / rets.length;
      vol90Pct = Math.round(Math.sqrt(variance) * 10000) / 100; // 日波动率 %
    }
    const min90 = Math.min(...long.map((p) => p.price));
    if (min90 > 0) distFromMin90d = Math.round((cur / min90 - 1) * 1000) / 1000;
    longTrend90 = slopePctPerDay(long);
  }

  let suggested: C5BuyAdvice['suggested'] = 'ok';
  const parts: string[] = [];
  if (cur != null && avg7d != null) {
    const ratio = cur / avg7d;
    if (percentile7d != null && percentile7d <= 30) {
      suggested = 'good';
      parts.push(`当前价处于近 7 天 ${percentile7d}% 分位，偏低`);
    } else if (percentile7d != null && percentile7d >= 75) {
      suggested = 'wait';
      parts.push(`当前价处于近 7 天 ${percentile7d}% 分位，偏高`);
    }
    if (ratio <= 0.97) {
      suggested = 'good';
      parts.push(`低于近 7 天均值 ${Math.round((1 - ratio) * 100)}%`);
    } else if (ratio >= 1.04) {
      suggested = 'wait';
      parts.push(`高于近 7 天均值 ${Math.round((ratio - 1) * 100)}%`);
    }
    if (change1d != null && change1d <= -0.02) parts.push(`近一天下跌 ${Math.round(-change1d * 100)}%`);
    if (change1d != null && change1d >= 0.02) parts.push(`近一天上涨 ${Math.round(change1d * 100)}%`);
    if (trend === 'down') parts.push('近 7 天呈下行趋势');
    if (trend === 'up' && suggested === 'ok') parts.push('近 7 天呈上行趋势');
  }
  // 长周期修正
  if (distFromMin90d != null) {
    if (distFromMin90d <= 0.03) {
      suggested = suggested === 'wait' ? 'ok' : 'good';
      parts.push(`接近 90 天最低点（仅高 ${Math.round(distFromMin90d * 100)}%）`);
    } else if (distFromMin90d >= 0.25) {
      if (suggested === 'good') suggested = 'ok';
      parts.push(`高于 90 天最低点 ${Math.round(distFromMin90d * 100)}%（高位区）`);
    }
  }
  if (vol90Pct != null && vol90Pct >= 2.5) {
    parts.push(`近期波动较大（日波动 ${vol90Pct}%），建议分批买入`);
  }
  if (parts.length === 0) parts.push('价格处于常规区间');

  const reason =
    suggested === 'good'
      ? `适合买入：${parts.join('；')}`
      : suggested === 'wait'
        ? `建议观望：${parts.join('；')}`
        : `可正常买入：${parts.join('；')}`;

  return {
    now: cur,
    avg7d,
    min7d,
    max7d,
    change1d,
    percentile7d,
    trend,
    suggested,
    reason,
    vol90Pct,
    distFromMin90d,
    longTrend90,
  };
}

// ---------------------------------------------------------------------------
// 库存最佳卖出时机：结合事件窗口（suppress=大促/政策压制 + 回补；boost=Major/春节提振）
// ---------------------------------------------------------------------------

export interface MarketWindow {
  /** YYYY-MM-DD */
  start: string;
  end: string;
  name?: string;
  /** 窗口内价差幅度（默认 0.03） */
  pressure?: number;
  /** 缺省按 kind 推断（steam-sale/valve-policy/case-removal → suppress，major/game-event 等 → boost）；都缺省按 suppress */
  impact?: 'suppress' | 'boost';
  /** 兼容 MarketEvent 直传：有 kind 无 impact 时按 kind 推断方向 */
  kind?: string;
}

export interface SellAdvice {
  code: 'sell_now' | 'sell_at_unlock' | 'wait_recovery' | 'wait_event_pass';
  text: string;
}

const RECOVERY_DAYS = 14;

function dateOf(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function impactOf(e: MarketWindow): 'suppress' | 'boost' {
  if (e.impact) return e.impact;
  const k = e.kind;
  if (k === 'steam-sale' || k === 'valve-policy' || k === 'case-removal') return 'suppress';
  if (k === 'major' || k === 'game-event' || k === 'case-release') return 'boost';
  return 'suppress';
}

export function buildSellAdvice(
  unlockAt: string,
  tradableNow: boolean,
  events: MarketWindow[],
  now = new Date(),
): SellAdvice {
  const today = dateOf(now.toISOString());
  const unlockDay = dateOf(unlockAt);

  const inWindow = (day: string) => events.find((e) => e.start <= day && day <= e.end);
  const recoveryHit = (day: string) =>
    events.find(
      (e) =>
        impactOf(e) === 'suppress' &&
        e.end < day &&
        new Date(`${day}T00:00:00Z`).getTime() <= new Date(`${e.end}T00:00:00Z`).getTime() + (e.pressure != null ? RECOVERY_DAYS : RECOVERY_DAYS) * DAY_MS,
    );

  if (tradableNow) {
    const w = inWindow(today);
    if (w && impactOf(w) === 'suppress') {
      const p = Math.round((w.pressure ?? 0.03) * 100);
      return {
        code: 'wait_recovery',
        text: `已可上架，但正处于${w.name ?? '大促'}窗口（价格被压制约 ${p}%）：不急可等结束后回补再卖`,
      };
    }
    if (w && impactOf(w) === 'boost') {
      const p = Math.round((w.pressure ?? 0.02) * 100);
      return {
        code: 'sell_now',
        text: `已可上架，且正值${w.name ?? '活动'}窗口（需求提振约 +${p}%）：当前是较好的卖出时机`,
      };
    }
    return { code: 'sell_now', text: '已可上架：当前即可卖出' };
  }

  const w = inWindow(unlockDay);
  if (w && impactOf(w) === 'suppress') {
    const p = Math.round((w.pressure ?? 0.03) * 100);
    return {
      code: 'wait_event_pass',
      text: `解锁日（${unlockDay}）落在${w.name ?? '大促'}窗口内，价格被压制约 ${p}%：建议活动结束后再卖`,
    };
  }
  if (w && impactOf(w) === 'boost') {
    return {
      code: 'sell_at_unlock',
      text: `解锁正值${w.name ?? '活动'}窗口（需求提振），解锁后尽快卖出更划算`,
    };
  }
  const rec = recoveryHit(unlockDay);
  if (rec) {
    return {
      code: 'sell_at_unlock',
      text: `解锁正值${rec.name ?? '大促'}结束后回补期，解锁后尽快卖出`,
    };
  }
  // 解锁后 5 天内开始的压制事件：赶在压制前卖
  for (const e of events) {
    if (impactOf(e) !== 'suppress') continue;
    const startMs = new Date(`${e.start}T00:00:00Z`).getTime();
    const unlockMs = new Date(`${unlockDay}T00:00:00Z`).getTime();
    if (unlockMs < startMs && startMs <= unlockMs + 5 * DAY_MS) {
      const days = Math.round((startMs - unlockMs) / DAY_MS);
      return {
        code: 'sell_at_unlock',
        text: `${e.name ?? '大促'}将在解锁后 ${days} 天开始（价格会先被压制），建议解锁后立即卖出`,
      };
    }
  }
  // 解锁后 1-3 天开始的提振事件：可等需求升温再卖
  for (const e of events) {
    if (impactOf(e) !== 'boost') continue;
    const startMs = new Date(`${e.start}T00:00:00Z`).getTime();
    const unlockMs = new Date(`${unlockDay}T00:00:00Z`).getTime();
    if (unlockMs < startMs && startMs <= unlockMs + 3 * DAY_MS) {
      const days = Math.round((startMs - unlockMs) / DAY_MS);
      return {
        code: 'sell_at_unlock',
        text: `${e.name ?? '活动'}将在解锁后 ${days} 天开始（需求升温），可等到活动期卖出`,
      };
    }
  }
  return { code: 'sell_at_unlock', text: `解锁后即可卖出（${unlockDay}，近期无事件影响）` };
}
