/**
 * 市场（HANDOFF v2.0 第 14 节）：全部武器箱按预计几折从低到高。
 * 支持 全部 / 推荐购买 / 可以观察 / 暂时别买 筛选 + 中文搜索。
 */
import React, { useState } from 'react';
import {
  FlatList, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, Row } from '../components/Card';
import { ErrorView, Loading } from '../components/Loading';
import { SignalBadge } from '../components/SignalBadge';
import { colors } from '../theme/colors';
import { OpportunityCard } from '../ui/opportunity/OpportunityCard';
import { useOpportunitySnapshot } from '../ui/opportunity/useOpportunitySnapshot';
import { selectOpportunityCards, type OpportunityCardViewModel } from '../ui/opportunity/opportunityViewModel';

interface Props {
  onOpenDetail: (name: string) => void;
}

type FilterKey = 'all' | 'buy' | 'wait' | 'avoid';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'buy', label: '推荐购买' },
  { key: 'wait', label: '可以观察' },
  { key: 'avoid', label: '暂时别买' },
];

export function MarketScreen({ onOpenDetail }: Props) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const { snapshot, loading, refreshing, error, reload, refreshLive, liveRefreshing, liveError } = useOpportunitySnapshot();

  const q = query.trim().toLowerCase();
  // v1.8.3：筛选/计数只在数据或条件变化时重算（原来每次渲染跑 4 遍全量过滤）
  const cards = React.useMemo(() => snapshot ? selectOpportunityCards(snapshot, { query: q }) : [], [snapshot, q]);
  const signalOf = (card: OpportunityCardViewModel): string => {
    if (card.decision === 'legacy') return card.legacySignal ?? 'waiting';
    if (card.decision === 'excellent' || card.decision === 'buy') return 'buy';
    if (card.decision === 'watch') return 'wait';
    return 'avoid';
  };
  const shown = React.useMemo(() => cards.filter((card) => filter === 'all' || signalOf(card) === filter), [cards, filter]);

  const counts: Record<FilterKey, number> = React.useMemo(() => ({
    all: cards.length,
    buy: cards.filter((i) => signalOf(i) === 'buy').length,
    wait: cards.filter((i) => signalOf(i) === 'wait').length,
    avoid: cards.filter((i) => signalOf(i) === 'avoid').length,
  }), [cards]);

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
      <View style={styles.liveActionWrap}>
        <TouchableOpacity
          style={[styles.liveAction, liveRefreshing && { opacity: 0.6 }]}
          disabled={liveRefreshing || !snapshot}
          onPress={() => { if (snapshot) void refreshLive(snapshot.items.map((item) => item.item)); }}
        >
          <Text style={styles.liveActionText}>{liveRefreshing ? '正在更新实时盘口…' : '更新实时盘口 / 机会'}</Text>
        </TouchableOpacity>
        {liveError ? <Text style={styles.liveError}>{liveError}，当前仍显示本地结果</Text> : null}
      </View>
      <FlatList
        data={shown}
        keyExtractor={(card) => card.item}
        renderItem={({ item: card }) => (
          <TouchableOpacity onPress={() => onOpenDetail(card.item)}>
            {snapshot?.mode === 'v2' ? <OpportunityCard card={card} compact /> : <MarketRow card={card} />}
          </TouchableOpacity>
        )}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={reload} />
        }
        // v1.8.3 切页提速：只渲染可见行（原来 ScrollView+map 一次性挂载全部 1500+ 视图）
        // v1.8.4：不加 removeClippedSubviews（Android 会脱离屏外子视图导致首帧内容上跳）
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={10}
        ListEmptyComponent={
          // v1.8.4：加载/错误/空态只在「列表无数据」时占位，有数据时头部高度恒定，切页不再上跳
          loading ? <Loading height={160} /> : error ? <ErrorView message={error} onRetry={reload} /> : (
            <Card>
              <Text style={styles.empty}>
                {cards.length === 0
                  ? '暂无数据。去首页点「📡 一键扫描」拉取 Steam 热门武器箱行情。'
                  : '没有匹配的武器箱，换个关键词或筛选条件试试。'}
              </Text>
            </Card>
          )
        }
      />
    </SafeAreaView>
  );
}

/** 单行（React.memo：列表滚动/筛选时不重复渲染未变化的行） */
const MarketRow = React.memo(function MarketRow({ card }: { card: OpportunityCardViewModel }) {
  return (
      <Card style={styles.itemCard}>
        <View style={styles.itemHeader}>
          <Text style={styles.name} numberOfLines={1}>{card.displayNameZh}</Text>
          <SignalBadge signal={card.decision === 'legacy' ? card.legacySignal ?? 'waiting' : card.decision === 'excellent' || card.decision === 'buy' ? 'buy' : card.decision === 'watch' ? 'wait' : 'avoid'} />
        </View>
        <View style={styles.priceRow}>
          <View style={{ flex: 1 }}>
            <Row label="预计几折" value={card.expectedDiscountText ?? '--'} valueColor={colors.warning} />
            <Row label="C5 买入 / Steam 到手" value={`${card.c5BuyPriceText ?? '--'} / ${card.steamNetReceiveText ?? '--'}`} />
          </View>
          <Text style={styles.arrow}>›</Text>
        </View>
      </Card>
  );
});

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
  content: { padding: 14, paddingBottom: 90 },
  liveActionWrap: { paddingHorizontal: 14, paddingBottom: 8 },
  liveAction: { backgroundColor: colors.cardAlt, borderRadius: 10, borderWidth: 1, borderColor: colors.primary, paddingVertical: 10, alignItems: 'center' },
  liveActionText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  liveError: { color: colors.warning, fontSize: 12, marginTop: 5 },
  itemCard: { paddingVertical: 10 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  name: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  priceRow: { flexDirection: 'row', alignItems: 'center' },
  arrow: { color: colors.textDim, fontSize: 24, marginLeft: 8 },
  empty: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
});
