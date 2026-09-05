/** 机会雷达：全池信号列表（PRD 第八节） */
import React, { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, RadarItem } from '../api/client';
import { Card, Row } from '../components/Card';
import { ErrorView, Loading } from '../components/Loading';
import { SignalBadge } from '../components/SignalBadge';
import { colors, riskColors } from '../theme/colors';

interface Props {
  onOpenDetail: (name: string) => void;
}

export function RadarScreen({ onOpenDetail }: Props) {
  const [items, setItems] = useState<RadarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'buy' | 'wait' | 'avoid'>('all');

  const load = useCallback(async () => {
    try {
      const data = await api.radar();
      setItems(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shown = items.filter((i) => filter === 'all' || i.signal === filter);
  const counts = {
    all: items.length,
    buy: items.filter((i) => i.signal === 'buy').length,
    wait: items.filter((i) => i.signal === 'wait').length,
    avoid: items.filter((i) => i.signal === 'avoid').length,
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Text style={styles.header}>机会雷达</Text>
      <View style={styles.tabs}>
        {(['all', 'buy', 'wait', 'avoid'] as const).map((k) => (
          <TouchableOpacity
            key={k}
            style={[styles.tab, filter === k && styles.tabActive]}
            onPress={() => setFilter(k)}
          >
            <Text style={[styles.tabText, filter === k && styles.tabTextActive]}>
              {k === 'all' ? '全部' : k === 'buy' ? '买入候选' : k === 'wait' ? '等待' : '不建议'}{' '}{counts[k]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        {loading ? <Loading /> : null}
        {!loading && error ? <ErrorView message={error} onRetry={load} /> : null}
        {!loading && !error && shown.length === 0 ? (
          <Card><Text style={styles.empty}>该分类下暂无武器箱。请先启动后端完成采集。</Text></Card>
        ) : null}
        {shown.map((r) => (
          <TouchableOpacity key={r.market_hash_name} onPress={() => onOpenDetail(r.market_hash_name)}>
            <Card>
              <View style={styles.itemHeader}>
                <Text style={styles.name} numberOfLines={1}>{r.market_hash_name}</Text>
                <SignalBadge signal={r.signal} />
              </View>
              <Row label="预期 ROI (7日)" value={r.expected_roi != null ? `${(r.expected_roi * 100).toFixed(1)}%` : '--'} valueColor={r.expected_roi != null && r.expected_roi >= 0 ? colors.success : colors.danger} />
              <Row
                label="C5 买入 / Steam 卖"
                value={`${r.c5_buy_price != null ? `¥${r.c5_buy_price.toFixed(2)}` : '--'} / ${r.steam_sell_price != null ? `¥${r.steam_sell_price.toFixed(2)}` : '--'}`}
              />
              <View style={styles.tagsRow}>
                <Text style={[styles.tag, { color: riskColors[r.risk_level] ?? colors.textDim }]}>风险 {r.risk_level}</Text>
                <Text style={[styles.tag, { color: colors.info }]}>流动性 {r.liquidity}</Text>
                <Text style={[styles.tag, { color: colors.gold }]}>评分 {r.score}</Text>
              </View>
            </Card>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { color: colors.text, fontSize: 22, fontWeight: '800', paddingHorizontal: 14, paddingTop: 8, paddingBottom: 8 },
  tabs: { flexDirection: 'row', paddingHorizontal: 14, gap: 8, marginBottom: 8 },
  tab: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#FFFFFF' },
  content: { padding: 14, paddingBottom: 40 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  name: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  tagsRow: { flexDirection: 'row', gap: 12, marginTop: 6 },
  tag: { fontSize: 12 },
  empty: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
});
