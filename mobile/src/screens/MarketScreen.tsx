/**
 * 市场（HANDOFF v2.0 第 14 节）：全部武器箱按预计几折从低到高。
 * 支持 全部 / 推荐购买 / 可以观察 / 暂时别买 筛选 + 中文搜索。
 */
import React, { useState } from 'react';
import {
  FlatList, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
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
type SortKey = 'discount' | 'decision' | 'capacity';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'buy', label: '推荐购买' },
  { key: 'wait', label: '可以观察' },
  { key: 'avoid', label: '暂时别买' },
];

export function MarketScreen({ onOpenDetail }: Props) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('discount');
  const { snapshot, loading, refreshing, error, reload, refreshLive, liveRefreshing, liveError } = useOpportunitySnapshot();

  const q = query.trim().toLowerCase();
  // v1.8.3：筛选/计数只在数据或条件变化时重算（原来每次渲染跑 4 遍全量过滤）
  const cards = React.useMemo(() => snapshot ? selectOpportunityCards(snapshot, { query: q, sort }) : [], [snapshot, q, sort]);
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
      <View style={styles.headerBlock}>
        <Text style={styles.headerEyebrow}>MARKET / PRICE WATCH</Text>
        <View style={styles.headerLine}>
          <View>
            <Text style={styles.header}>箱子市场</Text>
            <Text style={styles.headerHint}>按折扣与流动性筛选</Text>
          </View>
          <View style={styles.countPill}><Text style={styles.countText}>{counts.all} 项</Text></View>
        </View>
      </View>
      <View style={styles.searchWrap}>
        <View style={styles.searchField}>
          <Text style={styles.searchIcon} accessibilityElementsHidden>⌕</Text>
          <TextInput
            style={styles.search}
            placeholder="搜索武器箱（支持中文）"
            placeholderTextColor={colors.textDim}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            returnKeyType="search"
          />
          {query ? (
            <TouchableOpacity style={styles.clearSearch} onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="清空搜索">
              <Text style={styles.clearSearchText}>×</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.tab, filter === f.key && styles.tabActive]}
            onPress={() => setFilter(f.key)}
            activeOpacity={0.76}
            accessibilityRole="button"
            accessibilityLabel={`${f.label}，${counts[f.key]} 项`}
            accessibilityState={{ selected: filter === f.key }}
          >
            <Text style={[styles.tabText, filter === f.key && styles.tabTextActive]}>
              {f.label} <Text style={styles.tabCount}>{counts[f.key]}</Text>
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <View style={styles.liveActionWrap}>
        <TouchableOpacity
          style={[styles.liveAction, liveRefreshing && { opacity: 0.6 }]}
          disabled={liveRefreshing || !snapshot}
          onPress={() => { if (snapshot) void refreshLive(snapshot.items.map((item) => item.item)); }}
          activeOpacity={0.82}
          accessibilityRole="button"
          accessibilityState={{ disabled: liveRefreshing || !snapshot, busy: liveRefreshing }}
        >
          <Text style={styles.liveActionText}>{liveRefreshing ? '正在更新实时盘口…' : '更新实时行情'}</Text>
        </TouchableOpacity>
        {liveError ? <Text style={styles.liveError}>{liveError}，当前仍显示本地结果</Text> : null}
      </View>
      <View style={styles.sortRow}>
        <Text style={styles.sortCount}>{shown.length} 个结果</Text>
        <View style={styles.sortOptions}>
          {([['discount', '折扣'], ['decision', '推荐'], ['capacity', '容量']] as const).map(([key, label]) => (
            <TouchableOpacity
              key={key}
              style={[styles.sortOption, sort === key && styles.sortOptionActive]}
              onPress={() => setSort(key)}
              accessibilityRole="button"
              accessibilityLabel={`按${label}排序`}
              accessibilityState={{ selected: sort === key }}
            >
              <Text style={[styles.sortText, sort === key && styles.sortTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <FlatList
        data={shown}
        keyExtractor={(card) => card.item}
        renderItem={({ item: card }) => (
          <TouchableOpacity onPress={() => onOpenDetail(card.item)} accessibilityRole="button" accessibilityLabel={`查看${card.displayNameZh}详情`}>
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
                  ? '暂无行情。去首页扫描，获取本地箱子快照。'
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
  headerBlock: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 12 },
  headerEyebrow: { color: colors.primary, fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: 1.1, marginBottom: 5 },
  headerLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  header: { color: colors.text, fontSize: 25, lineHeight: 30, fontWeight: '800', letterSpacing: -0.6 },
  headerHint: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  countPill: { minHeight: 32, paddingHorizontal: 11, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  countText: { color: colors.textDim, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  searchWrap: { paddingHorizontal: 18, marginBottom: 12 },
  searchField: { minHeight: 50, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  searchIcon: { color: colors.textDim, fontSize: 22, lineHeight: 25, marginRight: 8 },
  search: { flex: 1, minHeight: 48, color: colors.text, paddingVertical: 10, fontSize: 14 },
  clearSearch: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  clearSearchText: { color: colors.textDim, fontSize: 22 },
  tabs: { flexDirection: 'row', paddingHorizontal: 18, gap: 8, paddingBottom: 12 },
  tab: {
    minHeight: 48, justifyContent: 'center', paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  tabCount: { fontVariant: ['tabular-nums'], fontWeight: '700' },
  tabTextActive: { color: colors.onPrimary },
  content: { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 96 },
  liveActionWrap: { paddingHorizontal: 18, paddingBottom: 10 },
  liveAction: { minHeight: 48, backgroundColor: colors.primary, borderRadius: 15, borderWidth: 1, borderColor: colors.primary, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  liveActionText: { color: colors.onPrimary, fontSize: 13, fontWeight: '700' },
  liveError: { color: colors.warning, fontSize: 11, marginTop: 6, lineHeight: 16 },
  sortRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 6 },
  sortCount: { color: colors.textDim, fontSize: 12, fontVariant: ['tabular-nums'] },
  sortOptions: { flexDirection: 'row', gap: 2, backgroundColor: colors.surfaceRaised, borderRadius: 12, padding: 3 },
  sortOption: { minWidth: 44, minHeight: 38, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  sortOptionActive: { backgroundColor: colors.card },
  sortText: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
  sortTextActive: { color: colors.primaryText, fontWeight: '800' },
  itemCard: { paddingVertical: 12, marginBottom: 10 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  name: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  priceRow: { flexDirection: 'row', alignItems: 'center' },
  arrow: { color: colors.textDim, fontSize: 24, marginLeft: 8 },
  empty: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
});
