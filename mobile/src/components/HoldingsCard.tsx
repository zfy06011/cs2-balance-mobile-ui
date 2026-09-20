/**
 * HoldingsCard：详情页顶部「我的持仓」块（v1.8.6）。
 * 展示某个箱子的：件数/笔数、冷却倒计时 + 进度条、买入均价、当前价、浮动盈亏。
 * 进度条用普通 View 拼（不用 SVG）——避免 react-native-svg 原生解析异常（v1.8.5 教训）。
 * 剩余时间由调用方传入 now 现算，保证倒计时实时。
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { Card, Row } from './Card';
import { fmtMoney, fmtPct } from '../utils/format';
import { cooldownProgress, fmtRemainHours } from '../core/holdings';
import type { HoldingsSummary, InventoryEntry } from '../core/types';

interface Props {
  summary: HoldingsSummary;
  /** 该箱子的原始记录（用于进度条与逐笔明细） */
  entries: InventoryEntry[];
  /** 当前时间戳（由父组件每分钟 tick 更新，驱动倒计时实时） */
  now: number;
}

export function HoldingsCard({ summary, entries, now }: Props) {
  const progress = cooldownProgress(entries, now);
  const remainText = summary.allTradable ? '已可上架' : `还有 ${fmtRemainHours(summary.hoursLeft)}`;
  const profit = summary.netProfit;
  const profitColor = profit == null ? colors.textDim : profit >= 0 ? colors.success : colors.danger;
  const profitText =
    profit == null
      ? '--'
      : `${profit >= 0 ? '+' : ''}${fmtMoney(profit)}${summary.roi != null ? ` (${profit >= 0 ? '+' : ''}${fmtPct(summary.roi)})` : ''}`;

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>★ 我的持仓</Text>
        <View style={[styles.badge, summary.allTradable ? styles.badgeOk : styles.badgeCool]}>
          <Text style={[styles.badgeText, summary.allTradable ? styles.badgeTextOk : styles.badgeTextCool]}>
            {summary.allTradable ? '可上架' : '冷却中'}
          </Text>
        </View>
      </View>

      <Text style={styles.meta}>
        共 {summary.quantity} 件 · {summary.records} 笔记录
      </Text>

      {/* 冷却进度条（纯 View） */}
      <View style={styles.progressRow}>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.round(progress * 100)}%` },
              summary.allTradable && { backgroundColor: colors.success },
            ]}
          />
        </View>
        <Text style={[styles.remain, summary.allTradable && { color: colors.success }]}>{remainText}</Text>
      </View>

      <Row label="买入均价（不含费）" value={fmtMoney(summary.avgBuyPrice)} />
      <Row label="总成本（含 1% 费用）" value={fmtMoney(summary.totalCost)} />
      <Row
        label="当前估值（Steam 到手）"
        value={summary.currentValue != null ? fmtMoney(summary.currentValue) : '暂无行情'}
        valueColor={colors.info}
      />
      <Row label="浮动盈亏" value={profitText} valueColor={profitColor} />
      {summary.allTradable ? null : (
        <Row label="最早解锁" value={new Date(summary.earliestUnlockAt).toLocaleString()} />
      )}
      {summary.sellAdviceText ? (
        <Text style={styles.advice}>⏱ {summary.sellAdviceText}</Text>
      ) : null}

      {/* 逐笔明细（多笔时才展开，单笔只显示一行） */}
      {entries.length > 1 ? (
        <View style={styles.detailBox}>
          <Text style={styles.detailTitle}>每笔明细</Text>
          {entries.map((e) => (
            <View key={e.id} style={styles.detailRow}>
              <Text style={styles.detailLeft}>
                {e.quantity} 件 × {fmtMoney(e.buy_price)}
              </Text>
              <Text style={styles.detailRight}>
                {e.hours_left <= 0 ? '可上架' : `${fmtRemainHours(e.hours_left)}后`}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.cardAlt, borderColor: colors.gold },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  title: { color: colors.text, fontSize: 15, fontWeight: '800' },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1 },
  badgeOk: { borderColor: colors.success, backgroundColor: 'transparent' },
  badgeCool: { borderColor: colors.gold, backgroundColor: 'transparent' },
  badgeText: { fontSize: 11, fontWeight: '800' },
  badgeTextOk: { color: colors.success },
  badgeTextCool: { color: colors.gold },
  meta: { color: colors.textDim, fontSize: 12, marginBottom: 10 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  progressTrack: {
    flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden',
  },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.gold },
  remain: { color: colors.gold, fontSize: 12, fontWeight: '700' },
  advice: { color: colors.textDim, fontSize: 12, marginTop: 8, lineHeight: 17 },
  detailBox: { marginTop: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  detailTitle: { color: colors.textDim, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  detailLeft: { color: colors.text, fontSize: 13 },
  detailRight: { color: colors.textDim, fontSize: 13 },
});
