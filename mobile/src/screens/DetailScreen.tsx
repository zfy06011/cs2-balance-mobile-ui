/** 武器箱详情：跨市场报价 + 7 天预测区间 + 三情景收益 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, Prediction, Quote } from '../api/client';
import { Card, Row, SectionTitle } from '../components/Card';
import { ErrorView, Loading } from '../components/Loading';
import { SignalBadge } from '../components/SignalBadge';
import { colors } from '../theme/colors';

interface Props {
  name: string;
  onBack: () => void;
}

function fmt(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return '--';
  return `¥${v.toFixed(digits)}`;
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return '--';
  return `${(v * 100).toFixed(1)}%`;
}

export function DetailScreen({ name, onBack }: Props) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [pred, setPred] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [q, p] = await Promise.all([api.quote(name), api.prediction(name)]);
      setQuote(q);
      setPred(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    load();
  }, [load]);

  const quantiles = pred
    ? ([
        { label: 'P10 悲观', value: pred.p10, color: colors.danger },
        { label: 'P25', value: pred.p25, color: colors.warning },
        { label: 'P50 基准', value: pred.p50, color: colors.gold },
        { label: 'P75', value: pred.p75, color: colors.info },
        { label: 'P90 乐观', value: pred.p90, color: colors.success },
      ] as const)
    : [];

  const maxQ = pred?.p90 ?? 1;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.navBar}>
        <Text style={styles.back} onPress={onBack}>‹ 返回</Text>
        <Text style={styles.navTitle} numberOfLines={1}>{name}</Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        {loading ? <Loading /> : null}
        {!loading && error ? <ErrorView message={error} onRetry={load} /> : null}

        {quote ? (
          <>
            <Card>
              <View style={styles.headerRow}>
                <Text style={styles.name} numberOfLines={1}>{quote.market_hash_name}</Text>
                <SignalBadge signal={quote.signal} />
              </View>
              <Row label="C5GAME 买入价" value={fmt(quote.c5_buy_price)} />
              <Row label="Steam 当前卖价" value={fmt(quote.steam_sell_price)} />
              <Row label="Steam 近 30 日成交量" value={quote.steam_volume != null ? String(quote.steam_volume) : '--'} />
              <Row label="Steam 净到账（扣费后）" value={fmt(quote.steam_net_receive)} valueColor={colors.success} />
              <Row label="净利润" value={fmt(quote.net_profit)} valueColor={quote.net_profit != null && quote.net_profit >= 0 ? colors.success : colors.danger} />
              <Row label="ROI" value={fmtPct(quote.roi)} valueColor={quote.roi != null && quote.roi >= 0 ? colors.success : colors.danger} />
              <Row label="盈亏平衡卖出价" value={fmt(quote.breakeven_sell_price)} valueColor={colors.warning} />
            </Card>
          </>
        ) : null}

        {pred ? (
          <>
            <SectionTitle>7 天预测区间（模型 {pred.model_version}）</SectionTitle>
            <Card>
              <Text style={styles.target}>预计可卖时点：{new Date(pred.target_at).toLocaleString()}</Text>
              {quantiles.map((q) => (
                <View key={q.label} style={styles.quantileRow}>
                  <Text style={styles.quantileLabel}>{q.label}</Text>
                  <View style={styles.barWrap}>
                    <View
                      style={[
                        styles.bar,
                        { width: `${Math.max(4, (q.value / maxQ) * 100)}%`, backgroundColor: q.color },
                      ]}
                    />
                  </View>
                  <Text style={styles.quantileValue}>{fmt(q.value)}</Text>
                </View>
              ))}
              <View style={styles.hr} />
              <Row label="盈利概率" value={fmtPct(pred.prob_profit)} valueColor={pred.prob_profit >= 0.5 ? colors.success : colors.danger} />
              <Row label="亏损概率" value={fmtPct(pred.prob_loss)} />
              <Row label="模型置信度" value={fmtPct(pred.confidence)} />
            </Card>

            {pred.scenarios.length > 0 ? (
              <>
                <SectionTitle>三情景收益（7 天后估算）</SectionTitle>
                <Card>
                  {pred.scenarios.map((s) => (
                    <View key={s.label} style={styles.scenarioRow}>
                      <Text style={[styles.scenarioLabel, { color: s.label === 'optimistic' ? colors.success : s.label === 'pessimistic' ? colors.danger : colors.warning }]}>
                        {s.label === 'pessimistic' ? '悲观 (P25)' : s.label === 'base' ? '基准 (P50)' : '乐观 (P75)'}
                      </Text>
                      <Text style={styles.scenarioText}>卖 {fmt(s.predicted_sell_price)}</Text>
                      <Text style={styles.scenarioText}>净利 {fmt(s.net_profit)}</Text>
                      <Text style={styles.scenarioText}>ROI {fmtPct(s.roi)}</Text>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}
          </>
        ) : null}

        <Text style={styles.disclaimer}>
          数据来源：Steam Community Market / C5GAME 快照。预测为统计基线模型输出，仅供参考，不构成投资建议。
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 10,
  },
  back: { color: colors.primary, fontSize: 15, fontWeight: '600', width: 60 },
  navTitle: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1, textAlign: 'center' },
  content: { padding: 14, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  name: { color: colors.text, fontSize: 17, fontWeight: '800', flex: 1, marginRight: 8 },
  target: { color: colors.textDim, fontSize: 13, marginBottom: 10 },
  quantileRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  quantileLabel: { color: colors.textDim, fontSize: 12, width: 72 },
  barWrap: { flex: 1, height: 14, backgroundColor: colors.cardAlt, borderRadius: 7, overflow: 'hidden', marginHorizontal: 8 },
  bar: { height: '100%', borderRadius: 7 },
  quantileValue: { color: colors.text, fontSize: 12, width: 64, textAlign: 'right', fontVariant: ['tabular-nums'] },
  hr: { height: 1, backgroundColor: colors.border, marginVertical: 10 },
  scenarioRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, gap: 8 },
  scenarioLabel: { fontSize: 13, fontWeight: '700', width: 84 },
  scenarioText: { color: colors.text, fontSize: 13 },
  disclaimer: { color: colors.textDim, fontSize: 11, marginTop: 12, lineHeight: 16 },
});
