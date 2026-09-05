/**
 * 市场（HANDOFF v2.0 第 14 节）：全部武器箱按预计几折从低到高。
 * 支持 全部 / 推荐购买 / 可以观察 / 暂时别买 筛选 + 中文搜索。
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, Quote } from '../api/client';
import type { CollectProgress } from '../data/collector';
import { Card, Row } from '../components/Card';
import { ErrorView, Loading } from '../components/Loading';
import { SignalBadge } from '../components/SignalBadge';
import { colors } from '../theme/colors';
import { displayNameOf, fmtMoney, fmtZhe } from '../utils/format';

interface Props {
  onOpenDetail: (name: string) => void;
  onOpenCollect?: () => void;
}

type FilterKey = 'all' | 'buy' | 'wait' | 'avoid';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'buy', label: '推荐购买' },
  { key: 'wait', label: '可以观察' },
  { key: 'avoid', label: '暂时别买' },
];

export function MarketScreen({ onOpenDetail }: Props) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [collecting, setCollecting] = useState(false);
  const [progress, setProgress] = useState<CollectProgress | null>(null);
  const [collectCount, setCollectCount] = useState(20);

  const load = useCallback(async () => {
    try {
      const data = await api.markets();
      setQuotes(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    api.getSettings().then((s) => setCollectCount(s.refreshCount)).catch(() => undefined);
  }, [load]);

  const startCollect = async () => {
    setCollecting(true);
    setProgress(null);
    try {
      await api.refresh({ count: collectCount, onProgress: setProgress });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '采集失败');
    } finally {
      setCollecting(false);
    }
  };

  const q = query.trim().toLowerCase();
  const shown = quotes.filter((it) => {
    if (filter !== 'all' && it.signal !== filter) return false;
    if (!q) return true;
    return (
      it.market_hash_name.toLowerCase().includes(q) ||
      displayNameOf(it.market_hash_name).toLowerCase().includes(q)
    );
  });

  const counts: Record<FilterKey, number> = {
    all: quotes.length,
    buy: quotes.filter((i) => i.signal === 'buy').length,
    wait: quotes.filter((i) => i.signal === 'wait').length,
    avoid: quotes.filter((i) => i.signal === 'avoid').length,
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Text style={styles.header}>市场</Text>
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          placeholder="搜索武器箱（支持中文）"
          placeholderTextColor={colors.textDim}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
        />
      </View>
      <View style={styles.tabs}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.tab, filter === f.key && styles.tabActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.tabText, filter === f.key && styles.tabTextActive]}>
              {f.label} {counts[f.key]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {collecting ? (
        <View style={styles.collecting}>
          <Text style={styles.collectingText}>
            📡 {progress?.message ?? '正在采集行情…'}
          </Text>
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        {loading ? <Loading /> : null}
        {!loading && error ? <ErrorView message={error} onRetry={load} /> : null}
        {!loading && !error && shown.length === 0 ? (
          <Card>
            <Text style={styles.empty}>
              {quotes.length === 0
                ? '暂无数据。点击上方「📡 一键扫描」拉取 Steam 热门武器箱行情。'
                : '没有匹配的武器箱，换个关键词或筛选条件试试。'}
            </Text>
          </Card>
        ) : null}
        {shown.map((q) => (
          <TouchableOpacity key={q.market_hash_name} onPress={() => onOpenDetail(q.market_hash_name)}>
            <Card style={styles.itemCard}>
              <View style={styles.itemHeader}>
                <Text style={styles.name} numberOfLines={1}>{displayNameOf(q.market_hash_name)}</Text>
                <SignalBadge signal={q.signal} />
              </View>
              <View style={styles.priceRow}>
                <View style={{ flex: 1 }}>
                  <Row label="预计几折" value={fmtZhe(q.expected_discount)} valueColor={q.expected_discount != null && q.expected_discount <= 0.95 ? colors.success : colors.warning} />
                  <Row label="C5 买入 / Steam 到手" value={`${fmtMoney(q.c5_buy_price)} / ${fmtMoney(q.steam_net_receive)}`} />
                </View>
                <Text style={styles.arrow}>›</Text>
              </View>
            </Card>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {!collecting ? (
        <TouchableOpacity style={styles.scanFab} onPress={startCollect}>
          <Text style={styles.scanFabText}>📡 一键扫描</Text>
        </TouchableOpacity>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { color: colors.text, fontSize: 22, fontWeight: '800', paddingHorizontal: 14, paddingTop: 8, paddingBottom: 8 },
  searchWrap: { paddingHorizontal: 14, marginBottom: 8 },
  search: {
    backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    color: colors.text, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14,
  },
  tabs: { flexDirection: 'row', paddingHorizontal: 14, gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  tab: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#FFFFFF' },
  collecting: { paddingHorizontal: 14, paddingBottom: 4 },
  collectingText: { color: colors.info, fontSize: 12 },
  content: { padding: 14, paddingBottom: 90 },
  itemCard: { paddingVertical: 10 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  name: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  priceRow: { flexDirection: 'row', alignItems: 'center' },
  arrow: { color: colors.textDim, fontSize: 24, marginLeft: 8 },
  empty: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  scanFab: {
    position: 'absolute', bottom: 16, left: 14, right: 14,
    backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  scanFabText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
