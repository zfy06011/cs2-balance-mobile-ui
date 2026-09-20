/**
 * chartPaths：趋势图路径/几何计算（纯函数，可离线单测）。
 *
 * 为什么单独抽出来（v1.8.5 闪退修复）：react-native-svg 的原生 PathParser 对非法 `d`
 * 直接抛 IllegalArgumentException（主线程未捕获 → 进程被杀，无 JS 报错）。
 * 原 PriceTrendChart 在「历史点为 0 但有预测」时会拼出 `" L x y L x y Z"`（无 M 起始）
 * 以及 NaN 坐标，正好触发该崩溃。本模块把所有路径生成收敛到一处并加硬守卫：
 *  - 任何路径非 null 时必定以 M 开头；
 *  - 所有坐标经 fin() 过滤，绝无 NaN/Infinity；
 *  - 历史点不足 2 个时 line/area 返回 null（调用方据此不渲染 Path）。
 */

export interface TrendGeom {
  width: number;
  height: number;
  volumeHeight: number;
}

export interface TrendPrediction {
  p25: number;
  p50: number;
  p75: number;
}

export interface TrendPaths {
  /** 历史折线（>=2 个有效点才有值，保证以 M 开头） */
  linePath: string | null;
  /** 历史面积（依赖 linePath） */
  areaPath: string | null;
  /** 预测扇区（依赖 linePath + 合法预测） */
  predPath: string | null;
  /** P50 预测点坐标（用于圆点） */
  predP50: { x: number; y: number } | null;
  /** 最后一个历史点坐标（用于 P50 虚线起点） */
  lastPoint: { x: number; y: number } | null;
  yMin: number;
  yMax: number;
  yRange: number;
  chartW: number;
  chartH: number;
  totalH: number;
  xStep: number;
  /** 每个有效历史点的 x 坐标（与有效点一一对应） */
  xs: number[];
  /** 成交量柱（已过滤掉非有限值） */
  volBars: Array<{ x: number; y: number; w: number; h: number }>;
  /** 成交量柱宽 */
  volBarW: number;
  maxVol: number;
}

const PADDING_LEFT = 44;
const PADDING_RIGHT = 16;
const PADDING_TOP = 16;
const PADDING_BOTTOM = 28;
const VOL_GAP = 8;
const MIN_RANGE = 0.01;

/** 有限数 → 定点字符串；非有限一律 0.0（绝不让 NaN/Infinity 进入 SVG 路径） */
function fin(v: number): string {
  return Number.isFinite(v) ? v.toFixed(1) : '0.0';
}

function isPos(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * 计算趋势图全部路径与几何。返回 null 表示「连一条历史线都画不出来」，
 * 调用方应渲染空状态而不是 SVG（避免非法 Path）。
 */
export function buildTrendPaths(
  points: Array<{ price: number; volume?: number | null }>,
  prediction: TrendPrediction | null | undefined,
  geom: TrendGeom,
): TrendPaths | null {
  const width = Number.isFinite(geom.width) && geom.width > 0 ? geom.width : 340;
  const height = Number.isFinite(geom.height) && geom.height > 0 ? geom.height : 180;
  const volumeHeight = Number.isFinite(geom.volumeHeight) && geom.volumeHeight >= 0 ? geom.volumeHeight : 0;

  const prices = (points ?? []).map((p) => p.price).filter(isPos);
  const vols = (points ?? []).map((p) => (Number.isFinite(p.volume as number) && (p.volume as number) > 0 ? (p.volume as number) : 0));

  // 预测值必须三个都合法才参与绘图（任一为 NaN/<=0 视为无预测）
  const pred: TrendPrediction | null =
    prediction && isPos(prediction.p25) && isPos(prediction.p50) && isPos(prediction.p75)
      ? { p25: prediction.p25, p50: prediction.p50, p75: prediction.p75 }
      : null;

  const allPrices = pred ? prices.concat([pred.p25, pred.p50, pred.p75]) : prices.slice();
  if (allPrices.length === 0) return null;

  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  if (!Number.isFinite(minP) || !Number.isFinite(maxP)) return null;

  const priceRange = Math.max(maxP - minP, MIN_RANGE);
  const yMin = Math.max(0, minP - priceRange * 0.08);
  const yMax = maxP + priceRange * 0.08;
  const yRange = Math.max(yMax - yMin, MIN_RANGE);
  const chartW = Math.max(1, width - PADDING_LEFT - PADDING_RIGHT);
  const chartH = Math.max(1, height - PADDING_TOP - PADDING_BOTTOM);
  const totalH = height + volumeHeight + VOL_GAP;

  const yOf = (price: number): number => PADDING_TOP + (1 - (price - yMin) / yRange) * chartH;

  const n = prices.length;
  const totalX = n + (pred ? 1 : 0);
  const xStep = totalX > 1 ? chartW / (totalX - 1) : chartW;
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(PADDING_LEFT + i * xStep);

  // 历史折线：至少 2 个点，保证以 M 开头
  let linePath: string | null = null;
  let areaPath: string | null = null;
  let lastPoint: { x: number; y: number } | null = null;
  if (n >= 2) {
    const segs: string[] = [];
    for (let i = 0; i < n; i++) {
      const x = xs[i];
      const y = yOf(prices[i]);
      segs.push(`${i === 0 ? 'M' : 'L'} ${fin(x)} ${fin(y)}`);
    }
    linePath = segs.join(' ');
    lastPoint = { x: xs[n - 1], y: yOf(prices[n - 1]) };
    areaPath =
      linePath +
      ` L ${fin(lastPoint.x)} ${fin(PADDING_TOP + chartH)}` +
      ` L ${fin(PADDING_LEFT)} ${fin(PADDING_TOP + chartH)} Z`;
  }

  // 预测扇区：必须有历史线 + 合法预测
  let predPath: string | null = null;
  let predP50: { x: number; y: number } | null = null;
  if (pred && linePath != null && lastPoint != null) {
    const predX = PADDING_LEFT + n * xStep;
    const y25 = yOf(pred.p25);
    const y50 = yOf(pred.p50);
    const y75 = yOf(pred.p75);
    const lastP25Y = yOf(pred.p25);
    const lastP75Y = yOf(pred.p75);
    predP50 = { x: predX, y: y50 };
    predPath =
      `M ${fin(lastPoint.x)} ${fin(lastP25Y)}` +
      ` L ${fin(predX)} ${fin(y25)}` +
      ` L ${fin(predX)} ${fin(y75)}` +
      ` L ${fin(lastPoint.x)} ${fin(lastP75Y)} Z`;
  }

  // 成交量柱：只对有效历史点生成
  let maxVol = 1;
  for (const v of vols) if (v > maxVol) maxVol = v;
  const volBarW = Math.max(2, xStep * 0.6);
  const volBars: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (let i = 0; i < n; i++) {
    const v = vols[i] ?? 0;
    if (!(v > 0)) continue;
    const barH = (v / maxVol) * volumeHeight;
    volBars.push({
      x: xs[i] - volBarW / 2,
      y: height + VOL_GAP + 12 + (volumeHeight - barH),
      w: volBarW,
      h: barH,
    });
  }

  return {
    linePath,
    areaPath,
    predPath,
    predP50,
    lastPoint,
    yMin,
    yMax,
    yRange,
    chartW,
    chartH,
    totalH,
    xStep,
    xs,
    volBars,
    volBarW,
    maxVol,
  };
}

/** 仅用于单测/断言：路径是否合法（非 null 时必须以 M 开头且不含 NaN/Infinity） */
export function isValidSvgPath(d: string | null): boolean {
  if (d == null) return true;
  if (!/^M\s/.test(d)) return false;
  if (/NaN|Infinity|undefined/.test(d)) return false;
  return true;
}

export const CHART_PADDING = { PADDING_LEFT, PADDING_RIGHT, PADDING_TOP, PADDING_BOTTOM, VOL_GAP };
