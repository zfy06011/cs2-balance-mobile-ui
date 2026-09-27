import React from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Card, SectionTitle } from './Card';
import { colors } from '../theme/colors';
import type { OpportunityCardViewModel } from '../ui/opportunity/opportunityViewModel';

interface Props {
  readonly cards: readonly OpportunityCardViewModel[];
  readonly buyCount: number;
  readonly waitCount: number;
  readonly avoidCount: number;
  readonly onOpenDetail: (name: string) => void;
}

function colorForDecision(decision: OpportunityCardViewModel['decision']): string {
  if (decision === 'excellent' || decision === 'buy') return colors.success;
  if (decision === 'watch') return colors.warning;
  if (decision === 'avoid') return colors.danger;
  return colors.info;
}

export function HomeInsights({ cards, buyCount, waitCount, avoidCount, onOpenDetail }: Props) {
  const [expanded, setExpanded] = React.useState(false);
  const expansion = React.useRef(new Animated.Value(0)).current;

  const toggleSummary = () => {
    const next = !expanded;
    setExpanded(next);
    Animated.timing(expansion, {
      toValue: next ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  };

  return (
    <>
      <Card style={styles.summary}>
        <TouchableOpacity
          style={styles.summaryHeader}
          onPress={toggleSummary}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={`市场信号，共 ${buyCount + waitCount + avoidCount} 项`}
          accessibilityState={{ expanded }}
        >
          <View>
            <SectionTitle>市场信号</SectionTitle>
            <Text style={styles.summaryCaption}>推荐 {buyCount} · 观察 {waitCount} · 回避 {avoidCount}</Text>
          </View>
          <Text style={styles.summaryTotal}>{expanded ? '收起 ↑' : '展开 ↓'}</Text>
        </TouchableOpacity>
        <Animated.View style={[styles.metricsClip, { opacity: expansion, maxHeight: expansion.interpolate({ inputRange: [0, 1], outputRange: [0, 110] }) }]}>
          <View style={styles.metrics}>
            <Metric count={buyCount} label="推荐" tone={colors.success} />
            <View style={styles.metricDivider} />
            <Metric count={waitCount} label="观察" tone={colors.warning} />
            <View style={styles.metricDivider} />
            <Metric count={avoidCount} label="回避" tone={colors.danger} />
          </View>
          <Text style={styles.summaryNote}>根据当前可用行情，过期数据不会当作实时建议。</Text>
        </Animated.View>
      </Card>

      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>值得留意</Text>
        <Text style={styles.listHint}>预估折扣较低</Text>
      </View>
      <Card style={styles.listCard}>
        {cards.map((card, index) => (
          <TouchableOpacity
            key={card.item}
            style={[styles.opportunityRow, index > 0 && styles.rowBorder]}
            onPress={() => onOpenDetail(card.item)}
            activeOpacity={0.72}
            accessibilityRole="button"
            accessibilityLabel={`${card.displayNameZh}，${card.decisionLabel}，${card.expectedDiscountText ?? '暂无折扣数据'}`}
          >
            <View style={styles.rank}>
              <Text style={styles.rankText}>{String(index + 1).padStart(2, '0')}</Text>
            </View>
            <View style={styles.rowMain}>
              <Text style={styles.itemName} numberOfLines={1}>{card.displayNameZh}</Text>
              <View style={styles.rowMeta}>
                <View style={[styles.statusDot, { backgroundColor: colorForDecision(card.decision) }]} />
                <Text style={[styles.decision, { color: colorForDecision(card.decision) }]} numberOfLines={1}>
                  {card.decisionLabel}
                </Text>
                <Text style={styles.metaSeparator}>·</Text>
                <Text style={styles.profit} numberOfLines={1}>{card.netProfitText ?? '收益待补充'}</Text>
              </View>
            </View>
            <View style={styles.discountBlock}>
              <Text style={styles.discount}>{card.expectedDiscountText ?? '--'}</Text>
              <Text style={styles.discountCaption}>预估折扣</Text>
            </View>
          </TouchableOpacity>
        ))}
      </Card>
    </>
  );
}

function Metric({ count, label, tone }: { readonly count: number; readonly label: string; readonly tone: string }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricCount, { color: tone }]}>{count}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { backgroundColor: colors.card, marginBottom: 26, borderColor: colors.border },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  summaryCaption: { color: colors.textDim, fontSize: 12, marginTop: -6 },
  summaryTotal: { color: colors.textDim, fontSize: 12, fontVariant: ['tabular-nums'] },
  metricsClip: { overflow: 'hidden' },
  metrics: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  summaryNote: { color: colors.textDim, fontSize: 11, lineHeight: 16, marginTop: 12 },
  metric: { flex: 1, alignItems: 'center', gap: 4 },
  metricCount: { fontSize: 21, lineHeight: 26, fontWeight: '700', fontVariant: ['tabular-nums'] },
  metricLabel: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
  metricDivider: { width: 1, height: 28, backgroundColor: colors.border },
  listHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 },
  listTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  listHint: { color: colors.textDim, fontSize: 11 },
  listCard: { paddingVertical: 2, marginBottom: 22, backgroundColor: colors.card },
  opportunityRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rank: { width: 32, height: 32, borderRadius: 11, backgroundColor: colors.surfaceInset, alignItems: 'center', justifyContent: 'center' },
  rankText: { color: colors.textDim, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rowMain: { flex: 1, minWidth: 0 },
  itemName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  decision: { fontSize: 11, fontWeight: '600', flexShrink: 1 },
  metaSeparator: { color: colors.textDim, fontSize: 11 },
  profit: { color: colors.textDim, fontSize: 11, flexShrink: 1 },
  discountBlock: { minWidth: 68, alignItems: 'flex-end' },
  discount: { color: colors.text, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  discountCaption: { color: colors.textDim, fontSize: 10, marginTop: 2 },
});
