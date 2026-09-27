/**
 * PriceTrendChart：SVG 价格走势图（折线 + 预测扇区 + 成交量柱）。
 * 参考 C5 交易详情页设计：历史折线 + 预测 P25~P75 面积 + P50 虚线 + x 轴日期 + y 轴价格。
 *
 * v1.8.5 闪退修复：路径生成全部交给 chartPaths.buildTrendPaths（纯函数 + 硬守卫）。
 * 历史点不足 2 个时 linePath 为 null → 本组件直接渲染「数据不足」空态，绝不把
 * 非法 `d`（无 M 起始 / 含 NaN）交给 react-native-svg 原生解析器——那会抛
 * IllegalArgumentException 并在主线程杀进程（无 JS 报错，表现为直接闪退）。
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Line, Rect, Text as SvgText, Circle } from 'react-native-svg';
import { colors } from '../theme/colors';
import { buildTrendPaths, CHART_PADDING } from './chartPaths';

export interface ChartPoint {
  date: string;       // YYYY-MM-DD 或简短标签
  price: number;
  volume?: number | null;
}

export interface PredictionBand {
  p25: number;
  p50: number;
  p75: number;
  label?: string;     // 预测日期标签
}

interface Props {
  /** 历史数据点（升序，近 N 天） */
  points: ChartPoint[];
  /** 预测区间（可选） */
  prediction?: PredictionBand | null;
  /** 图表宽度（默认 340） */
  width?: number;
  /** 图表高度（默认 180） */
  height?: number;
  /** 成交量柱高度（默认 50） */
  volumeHeight?: number;
}

const { PADDING_LEFT, PADDING_RIGHT, PADDING_TOP, PADDING_BOTTOM, VOL_GAP } = CHART_PADDING;
const TICK_COUNT = 5;

function fmtDateShort(date: string): string {
  // YYYY-MM-DD → MM/DD
  const parts = date.split('-');
  if (parts.length >= 3) return `${parts[1]}/${parts[2]}`;
  return date.slice(5);
}

function niceStep(range: number): number {
  const raw = range / (TICK_COUNT - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step: number;
  if (norm <= 1.5) step = 1;
  else if (norm <= 3) step = 2;
  else if (norm <= 7) step = 5;
  else step = 10;
  return step * mag;
}

export function PriceTrendChart({
  points,
  prediction,
  width = 340,
  height = 180,
  volumeHeight = 50,
}: Props) {
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null);
  const validPoints = useMemo(() => points.filter((point) => Number.isFinite(point.price) && point.price > 0), [points]);
  const geom = useMemo(
    () => buildTrendPaths(points, prediction ?? null, { width, height, volumeHeight }),
    [points, prediction, width, height, volumeHeight],
  );

  // 历史线画不出来（点不足 2 / 数据异常）：渲染空态，绝不进 SVG
  if (!geom || geom.linePath == null) {
    return (
      <View style={[styles.container, { width, height: height + volumeHeight + VOL_GAP }]}>
        <Text style={styles.empty}>数据不足，无法绘制图表</Text>
      </View>
    );
  }

  const {
    linePath, areaPath, predPath, predP50, lastPoint, yMin, yMax, yRange, chartH, totalH, xs,
  } = geom;

  // y 轴刻度
  const yStep = niceStep(yRange);
  const yTicks: number[] = [];
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) {
    yTicks.push(v);
  }
  const yOf = (price: number): number => PADDING_TOP + (1 - (price - yMin) / yRange) * chartH;
  const selectedIndex = activeIndex != null && activeIndex < xs.length ? activeIndex : null;
  const pickPoint = (x: number) => {
    let closest = 0;
    for (let i = 1; i < xs.length; i++) {
      if (Math.abs(xs[i] - x) < Math.abs(xs[closest] - x)) closest = i;
    }
    setActiveIndex(closest);
  };

  // x 轴标签（取首/末/中间几个）——只对有有效价格的历史点
  const validIdx: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i].price;
    if (Number.isFinite(p) && p > 0) validIdx.push(i);
  }
  const xLabels: Array<{ x: number; label: string }> = [];
  if (validIdx.length > 0) {
    xLabels.push({ x: xs[0], label: fmtDateShort(points[validIdx[0]].date) });
    if (validIdx.length > 2) {
      const mid = Math.floor(validIdx.length / 2);
      xLabels.push({ x: xs[mid], label: fmtDateShort(points[validIdx[mid]].date) });
    }
    if (validIdx.length > 1) {
      const last = validIdx.length - 1;
      xLabels.push({ x: xs[last], label: fmtDateShort(points[validIdx[last]].date) });
    }
  }

  return (
    <View
      style={[styles.container, { width, height: totalH }]}
      accessibilityLabel="价格走势图，手指横向滑动可查看历史价格"
      onTouchStart={(event) => pickPoint(event.nativeEvent.locationX)}
      onTouchMove={(event) => pickPoint(event.nativeEvent.locationX)}
      onTouchEnd={() => setActiveIndex(null)}
      onTouchCancel={() => setActiveIndex(null)}
    >
      <Svg width={width} height={totalH}>
        {/* y 轴网格线 + 标签 */}
        {yTicks.map((v) => {
          const y = yOf(v);
          return (
            <React.Fragment key={`ytick-${v}`}>
              <Line
                x1={PADDING_LEFT}
                y1={y}
                x2={width - PADDING_RIGHT}
                y2={y}
                stroke={colors.border}
                strokeWidth={0.5}
                strokeDasharray="4,3"
              />
              <SvgText
                x={PADDING_LEFT - 6}
                y={y + 4}
                fontSize={10}
                fill={colors.textDim}
                textAnchor="end"
              >
                {v >= 100 ? Math.round(v) : v.toFixed(1)}
              </SvgText>
            </React.Fragment>
          );
        })}

        {/* x 轴标签 */}
        {xLabels.map((l) => (
          <SvgText
            key={`xlabel-${l.label}`}
            x={l.x}
            y={height - 4}
            fontSize={10}
            fill={colors.textDim}
            textAnchor="middle"
          >
            {l.label}
          </SvgText>
        ))}

        {/* 历史面积 */}
        {areaPath ? <Path d={areaPath} fill={colors.primaryText + '15'} /> : null}

        {/* 历史折线 */}
        <Path d={linePath} stroke={colors.primaryText} strokeWidth={2} fill="none" />

        {selectedIndex != null ? (
          <>
            <Line x1={xs[selectedIndex]} y1={PADDING_TOP} x2={xs[selectedIndex]} y2={height - PADDING_BOTTOM} stroke={colors.primaryText} strokeWidth={1} strokeDasharray="3,3" />
            <Circle cx={xs[selectedIndex]} cy={yOf(validPoints[selectedIndex].price)} r={4} fill={colors.primary} />
          </>
        ) : null}

        {/* 预测扇区 */}
        {predPath ? (
          <Path d={predPath} fill={colors.gold + '25'} stroke={colors.gold} strokeWidth={1} strokeDasharray="4,3" />
        ) : null}

        {/* P50 预测点 */}
        {predP50 ? <Circle cx={predP50.x} cy={predP50.y} r={4} fill={colors.gold} /> : null}

        {/* 预测 P50 虚线（从最后历史点到预测点） */}
        {predP50 && lastPoint ? (
          <Line
            x1={lastPoint.x}
            y1={lastPoint.y}
            x2={predP50.x}
            y2={predP50.y}
            stroke={colors.gold}
            strokeWidth={1.5}
            strokeDasharray="6,3"
          />
        ) : null}

        {/* 成交量柱 */}
        <SvgText x={PADDING_LEFT} y={height + VOL_GAP + 2} fontSize={10} fill={colors.textDim}>
          成交量
        </SvgText>
        {geom.volBars.map((b, i) => (
          <Rect key={`vol-${i}`} x={b.x} y={b.y} width={b.w} height={b.h} fill={colors.primaryText + '60'} rx={1} />
        ))}
      </Svg>
      {selectedIndex != null ? (
        <View style={[styles.tooltip, { left: Math.max(0, Math.min(width - 108, xs[selectedIndex] - 54)) }]} pointerEvents="none">
          <Text style={styles.tooltipText}>{fmtDateShort(validPoints[selectedIndex].date)}  ¥{validPoints[selectedIndex].price.toFixed(2)}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  empty: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 20 },
  tooltip: { position: 'absolute', top: 0, minWidth: 108, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.text, alignItems: 'center' },
  tooltipText: { color: colors.onPrimary, fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
