import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, Row } from '../../components/Card';
import { SignalBadge } from '../../components/SignalBadge';
import { colors } from '../../theme/colors';
import { formatDiscount } from './opportunityFormatters';
import type { OpportunityCardViewModel } from './opportunityViewModel';

export const OpportunityCard = React.memo(function OpportunityCard({ card, compact = false }: { card: OpportunityCardViewModel; compact?: boolean }) {
  const signal = card.decision === 'legacy'
    ? card.legacySignal ?? 'waiting'
    : card.decision === 'excellent' || card.decision === 'buy'
      ? 'buy'
      : card.decision === 'watch' ? 'wait' : 'avoid';
  return (
    <Card style={[styles.card, compact && styles.compactCard, card.freshness !== 'fresh' && styles.nonFresh]}>
      {card.isDemo ? <Text style={styles.demo}>DEMO / synthetic</Text> : null}
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={1}>{card.displayNameZh}</Text>
        <View style={styles.statusColumn}>
          <SignalBadge signal={signal} />
          {compact && card.freshnessLabel ? (
            <Text style={[styles.freshness, card.freshness === 'fresh' && styles.freshnessReady]} numberOfLines={1}>
              {card.freshnessLabel}
            </Text>
          ) : null}
        </View>
      </View>
      {compact ? (
        <View style={styles.compactMetrics}>
          <View style={styles.compactDiscount}>
            <Text style={styles.discountLabel}>预估折扣</Text>
            <Text style={styles.compactDiscountValue}>{card.expectedDiscountText ?? formatDiscount(undefined)}</Text>
          </View>
          <View style={styles.compactDivider} />
          <View style={styles.compactPrice}>
            <Text style={styles.discountLabel}>C5 买入 / Steam 卖出</Text>
            <Text style={styles.compactPriceValue} numberOfLines={1}>
              {card.c5BuyPriceText ?? '--'} <Text style={styles.priceSlash}>/</Text> {card.steamSellPriceText ?? '--'}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </View>
      ) : (
        <View style={styles.discountPanel}>
          <View style={styles.discountCopy}>
            <Text style={styles.discountLabel}>预估折扣</Text>
            <Text style={styles.discount}>{card.expectedDiscountText ?? formatDiscount(undefined)}</Text>
          </View>
          {card.freshnessLabel ? (
            <Text style={[styles.freshness, card.freshness === 'fresh' && styles.freshnessReady]} numberOfLines={1}>
              {card.freshnessLabel}
            </Text>
          ) : null}
        </View>
      )}
      {!compact ? (
        <View style={styles.secondary}>
          <Row label="Steam 最低卖单" value={card.steamSellPriceText ?? '--'} />
          {card.steamHighestBuyText ? <Row label="Steam 最高买单" value={card.steamHighestBuyText} /> : null}
          <Row label="保守" value={card.conservativeDiscountText ?? '--'} />
          <Row label="当前盘口" value={card.currentDiscountText ?? '--'} />
          {card.currentFilledDiscountText ? <Row label="部分成交" value={card.currentFilledDiscountText} /> : null}
          <Row label="当前可执行容量" value={card.capacityText?.replace('当前可执行容量 ', '') ?? '--'} />
        </View>
      ) : null}
      {card.primaryReason ? <Text style={styles.reason}>{card.primaryReason}</Text> : null}
      {card.lowPriceApproxFee ? <Text style={styles.warning}>低价手续费为近似估算</Text> : null}
      {card.futureLiquidityNotGuaranteed ? <Text style={styles.warning}>7 天后盘口和流动性不保证</Text> : null}
    </Card>
  );
});

const styles = StyleSheet.create({
  card: { padding: 18, marginBottom: 18, backgroundColor: colors.card, borderColor: colors.borderStrong },
  compactCard: { paddingHorizontal: 16, paddingVertical: 14, marginBottom: 8, backgroundColor: colors.card, borderColor: colors.border },
  nonFresh: { borderColor: colors.warning },
  demo: { color: colors.gold, fontSize: 10, fontWeight: '700', marginBottom: 8, letterSpacing: 0.4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 },
  statusColumn: { alignItems: 'flex-end', gap: 3 },
  name: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1, marginRight: 4 },
  discountPanel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 16, backgroundColor: colors.surfaceInset, paddingHorizontal: 14, paddingVertical: 14, marginBottom: 12 },
  discountCopy: { gap: 2 },
  discount: { color: colors.primary, fontSize: 38, lineHeight: 44, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -1 },
  discountLabel: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
  compactMetrics: { flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 12 },
  compactDiscount: { minWidth: 76 },
  compactDiscountValue: { color: colors.primary, fontSize: 20, lineHeight: 25, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -0.4, marginTop: 2 },
  compactDivider: { width: 1, height: 34, backgroundColor: colors.border },
  compactPrice: { flex: 1, minWidth: 0 },
  compactPriceValue: { color: colors.text, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 4 },
  priceSlash: { color: colors.textDim, fontWeight: '400' },
  chevron: { color: colors.textDim, fontSize: 24, lineHeight: 26, marginLeft: -4 },
  secondary: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  reason: { color: colors.textDim, fontSize: 12, lineHeight: 18, marginTop: 10 },
  warning: { color: colors.warning, fontSize: 11, lineHeight: 16, marginTop: 5 },
  freshness: { color: colors.warning, fontSize: 10, fontWeight: '600', maxWidth: 120, textAlign: 'right' },
  freshnessReady: { color: colors.success },
});
