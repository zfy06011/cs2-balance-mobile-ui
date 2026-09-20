import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, Row } from '../../components/Card';
import { colors } from '../../theme/colors';
import { formatDiscount } from './opportunityFormatters';
import type { OpportunityCardViewModel } from './opportunityViewModel';

export const OpportunityCard = React.memo(function OpportunityCard({ card, compact = false }: { card: OpportunityCardViewModel; compact?: boolean }) {
  const decisionColor = card.decision === 'excellent' || card.decision === 'buy' ? colors.success : card.decision === 'watch' ? colors.warning : card.decision === 'avoid' ? colors.danger : colors.info;
  return (
    <Card style={[styles.card, card.freshness !== 'fresh' && styles.nonFresh]}>
      {card.isDemo ? <Text style={styles.demo}>DEMO / synthetic</Text> : null}
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={1}>{card.displayNameZh}</Text>
        <Text style={[styles.decision, { color: decisionColor }]}>{card.decisionLabel}</Text>
      </View>
      <Text style={styles.discount}>{card.expectedDiscountText ?? formatDiscount(undefined)}</Text>
      <Text style={styles.discountLabel}>预计几折</Text>
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
      {compact ? <Row label="C5 / Steam 最低卖单" value={`${card.c5BuyPriceText ?? '--'} / ${card.steamSellPriceText ?? '--'}`} /> : null}
      {card.primaryReason ? <Text style={styles.reason}>{card.primaryReason}</Text> : null}
      {card.lowPriceApproxFee ? <Text style={styles.warning}>低价手续费为近似估算</Text> : null}
      {card.futureLiquidityNotGuaranteed ? <Text style={styles.warning}>7 天后盘口和流动性不保证</Text> : null}
      {card.freshnessLabel ? <Text style={styles.freshness}>{card.freshnessLabel}</Text> : null}
    </Card>
  );
});

const styles = StyleSheet.create({
  card: { paddingVertical: 12 },
  nonFresh: { borderColor: colors.warning },
  demo: { color: colors.gold, fontSize: 10, fontWeight: '800', marginBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  name: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  decision: { fontSize: 12, fontWeight: '800' },
  discount: { color: colors.text, fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'] },
  discountLabel: { color: colors.textDim, fontSize: 11, marginTop: -2 },
  secondary: { marginTop: 6 },
  reason: { color: colors.text, fontSize: 12, lineHeight: 17, marginTop: 4 },
  warning: { color: colors.warning, fontSize: 11, lineHeight: 16, marginTop: 3 },
  freshness: { color: colors.warning, fontSize: 11, marginTop: 4 },
});
