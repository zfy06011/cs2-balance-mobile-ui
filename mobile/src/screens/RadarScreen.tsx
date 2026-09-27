/** 机会雷达：全池信号列表（PRD 第八节） */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Animated, FlatList, Linking, RefreshControl, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { refreshMarketNews, MarketNews } from '../data/eventFeed';
import { Card, Row } from '../components/Card';
import { ErrorView, Loading } from '../components/Loading';
import { SignalBadge } from '../components/SignalBadge';
import { colors, riskColors } from '../theme/colors';
import { SIGNAL_TEXT } from '../utils/format';
import { OpportunityCard } from '../ui/opportunity/OpportunityCard';
import { useOpportunitySnapshot } from '../ui/opportunity/useOpportunitySnapshot';
import { selectOpportunityCards, type OpportunityCardViewModel } from '../ui/opportunity/opportunityViewModel';

interface Props {
  onOpenDetail: (name: string) => void;
}

/**
 * v1.8.4：市场事件缓存到模块级。雷达页每次切入都会重挂载，
 * 原来 news 初值 null → 异步到达后这张几百像素的卡片插到列表最上方，
 * 把下面内容整体推下去（每次进雷达页必然跳动）。有缓存则首帧即稳定。
 */
let newsCache: MarketNews | null = null;

export function RadarScreen({ onOpenDetail }: Props) {
  const [filter, setFilter] = useState<'all' | 'buy' | 'wait' | 'avoid'>('all');
  const [news, setNews] = useState<MarketNews | null>(newsCache);
  const { snapshot, loading, refreshing, error, reload } = useOpportunitySnapshot();

  useEffect(() => {
    // 已有缓存：后台静默刷新（不改变首帧高度）；无缓存：加载后写入
    refreshMarketNews()
      .then((n) => { newsCache = n; setNews(n); })
      .catch(() => undefined);
  }, []);

  const cards = useMemo(() => snapshot ? selectOpportunityCards(snapshot) : [], [snapshot]);
  const filterSignal = (card: OpportunityCardViewModel): string => {
    if (card.legacySignal) return card.legacySignal;
    if (card.decision === 'excellent' || card.decision === 'buy') return 'buy';
    if (card.decision === 'watch') return 'wait';
    return 'avoid';
  };
  const shown = useMemo(
    () => cards.filter((card) => filter === 'all' || filterSignal(card) === filter),
    [cards, filter],
  );
  // v1.8.3：计数只在数据变化时重算（原来每次渲染跑 5 遍全量过滤）
  const { counts, insufficientCount, mostlyInsufficient } = useMemo(() => ({
    counts: {
      all: cards.length,
      buy: cards.filter((i) => filterSignal(i) === 'buy').length,
      wait: cards.filter((i) => filterSignal(i) === 'wait').length,
      avoid: cards.filter((i) => filterSignal(i) === 'avoid').length,
    },
    insufficientCount: cards.filter((i) => i.dataInsufficient === true).length,
    mostlyInsufficient: cards.length > 0 && cards.filter((i) => i.dataInsufficient === true).length / cards.length > 0.5,
  }), [cards]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Text style={styles.eyebrow}>SIGNAL WATCH</Text>
      <Text style={styles.header}>机会雷达</Text>
      <View style={styles.tabs}>
        {(['all', 'buy', 'wait', 'avoid'] as const).map((k) => (
          <TouchableOpacity
            key={k}
            style={[styles.tab, filter === k && styles.tabActive]}
            onPress={() => setFilter(k)}
            accessibilityRole="button"
            accessibilityLabel={`${k === 'all' ? '全部' : SIGNAL_TEXT[k]}，${counts[k]} 项`}
            accessibilityState={{ selected: filter === k }}
          >
            <Text style={[styles.tabText, filter === k && styles.tabTextActive]}>
              {k === 'all' ? '全部' : SIGNAL_TEXT[k]}{' '}{counts[k]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <FlatList
        data={shown}
        keyExtractor={(r) => r.item}
        renderItem={({ item: r }) => (
          <TouchableOpacity onPress={() => onOpenDetail(r.item)}>
            {snapshot?.mode === 'v2' ? <OpportunityCard card={r} /> : <RadarRow card={r} />}
          </TouchableOpacity>
        )}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              // v1.8.4：不再 setLoading(true)（那会让头部 Loading 重新插入导致高度突变）
              void reload();
              refreshMarketNews(true).then(setNews).catch(() => undefined);
            }}
          />
        }
        // v1.8.3 切页提速：只渲染可见行（原来 ScrollView+map 一次性挂载全部 1900+ 视图）
        // v1.8.4：不加 removeClippedSubviews（Android 会脱离屏外子视图导致首帧内容上跳）
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={10}
        ListHeaderComponent={
          <RadarHeader
            news={news}
            mostlyInsufficient={mostlyInsufficient}
            insufficientCount={insufficientCount}
            itemCount={cards.length}
          />
        }
        ListEmptyComponent={
          // v1.8.4：加载/错误/空态只在「列表无数据」时占位，有数据时头部高度恒定，切页不再上跳
          loading ? <Loading height={160} /> : error ? <ErrorView message={error} onRetry={reload} /> : (
            <Card><Text style={styles.empty}>暂无数据。先到「首页」点击「一键扫描」拉取行情，采集后自动生成雷达信号。</Text></Card>
          )
        }
      />
    </SafeAreaView>
  );
}

interface HeaderProps {
  news: MarketNews | null;
  mostlyInsufficient: boolean;
  insufficientCount: number;
  itemCount: number;
}

/** 列表头部（事件卡 + 历史不足提示）：高度只随 news 变化，且 news 有模块级缓存，首帧即稳定 */
function RadarHeader({ news, mostlyInsufficient, insufficientCount, itemCount }: HeaderProps) {
  const [newsExpanded, setNewsExpanded] = useState(false);
  const newsHeight = React.useRef(new Animated.Value(0)).current;
  const toggleNews = () => {
    const next = !newsExpanded;
    setNewsExpanded(next);
    Animated.timing(newsHeight, { toValue: next ? 1 : 0, duration: 230, useNativeDriver: false }).start();
  };

  return (
    <>
      {/* 市场事件（实时拉取：官方博客 + Steam 新闻） */}
      {news && news.items.length > 0 ? (
        <Card>
          <View style={styles.newsHead}>
            <Text style={styles.newsTitle}>市场事件</Text>
            {news.items.length > 2 ? (
              <TouchableOpacity onPress={toggleNews} accessibilityRole="button" accessibilityState={{ expanded: newsExpanded }} accessibilityLabel={newsExpanded ? '收起市场事件' : '展开市场事件'}>
                <Text style={styles.newsToggle}>{newsExpanded ? '收起 ↑' : `展开 ${Math.min(news.items.length, 6)} 条 ↓`}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={styles.newsMeta}>{news.failed > 0 ? `${news.failed} 个源失败 · ` : ''}{new Date(news.fetchedAt).toLocaleString()}</Text>
          {news.items.slice(0, 2).map((it, i) => <NewsRow key={`${it.link}-${i}`} item={it} />)}
          {news.items.length > 2 ? (
            <Animated.View
              style={[styles.newsMore, { maxHeight: newsHeight.interpolate({ inputRange: [0, 1], outputRange: [0, 520] }), opacity: newsHeight }]}
              pointerEvents={newsExpanded ? 'auto' : 'none'}
              importantForAccessibility={newsExpanded ? 'auto' : 'no-hide-descendants'}
            >
              {news.items.slice(2, 6).map((it, i) => <NewsRow key={`${it.link}-${i + 2}`} item={it} />)}
            </Animated.View>
          ) : null}
          <Text style={styles.newsHint}>标签为关键词推断：政策/更新类事件需警惕价格波动；赛事/节日通常提振需求。点击可打开原文。</Text>
        </Card>
      ) : null}
      {mostlyInsufficient ? (
        <Card>
          <Text style={styles.insufficientBanner}>
            ⚠ {insufficientCount}/{itemCount} 个箱子历史不足。解决：到首页点一次「一键扫描」——
            扫描完成后会自动从 Steam 补齐官方历史，历史数据保存在本机。
          </Text>
        </Card>
      ) : null}
    </>
  );
}

function NewsRow({ item }: { item: MarketNews['items'][number] }) {
  return (
    <TouchableOpacity onPress={() => item.link && Linking.openURL(item.link)} accessibilityRole="link" accessibilityLabel={item.title}>
      <View style={styles.newsItem}>
        <View style={styles.newsTags}>
          {item.tags.map((tag) => (
            <Text key={tag} style={[styles.newsTag, tag === 'policy' && styles.newsTagPolicy]}>
              {tag === 'policy' ? '政策/更新' : tag === 'boost' ? '赛事提振' : tag === 'sale' ? '特卖' : tag === 'case' ? '箱子' : tag === 'op' ? '行动' : tag}
            </Text>
          ))}
        </View>
        <Text style={styles.newsItemTitle} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.newsItemMeta}>{item.source}{item.date ? ` · ${new Date(item.date).toLocaleDateString()}` : ''}</Text>
      </View>
    </TouchableOpacity>
  );
}

/** 单行（React.memo：滚动/筛选时不重复渲染未变化的行） */
const RadarRow = React.memo(function RadarRow({ card }: { card: OpportunityCardViewModel }) {
  return (
      <Card>
        <View style={styles.itemHeader}>
          <Text style={styles.name} numberOfLines={1}>{card.displayNameZh}</Text>
          <SignalBadge signal={card.legacySignal ?? 'waiting'} />
        </View>
        <Row label="预计几折（越低越划算）" value={card.expectedDiscountText ?? '--'} valueColor={card.expectedDiscountText === '--' ? colors.textDim : colors.warning} />
        <Row label="预计回报 (7日)" value={card.expectedRoiText ?? '--'} valueColor={colors.textDim} />
        <Row
          label="C5 买入 / Steam 到手"
          value={`${card.c5BuyPriceText ?? '--'} / ${card.steamNetReceiveText ?? '--'}`}
        />
        <View style={styles.tagsRow}>
          <Text style={[styles.tag, { color: riskColors[card.riskText ?? ''] ?? colors.textDim }]}>风险 {card.riskText ?? '--'}</Text>
          <Text style={[styles.tag, { color: colors.info }]}>流动性 {card.liquidityText ?? '--'}</Text>
          <Text style={[styles.tag, { color: colors.gold }]}>评分 {card.scoreText ?? '--'}</Text>
          {card.dataInsufficient === true ? (
            <Text style={[styles.tag, { color: colors.warning }]}>历史不足</Text>
          ) : null}
        </View>
      </Card>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 1.1, paddingHorizontal: 18, paddingTop: 14 },
  header: { color: colors.text, fontSize: 25, fontWeight: '800', paddingHorizontal: 18, paddingTop: 4, paddingBottom: 12 },
  tabs: { flexDirection: 'row', paddingHorizontal: 14, gap: 8, marginBottom: 8 },
  tab: {
    minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: colors.onPrimary },
  insufficientBanner: { color: colors.warning, fontSize: 13, lineHeight: 19 },
  newsHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  newsTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  newsToggle: { color: colors.primaryText, fontSize: 12, fontWeight: '700', paddingVertical: 8 },
  newsMeta: { color: colors.textDim, fontSize: 10, marginBottom: 4 },
  newsMore: { overflow: 'hidden' },
  newsItem: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  newsTags: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  newsTag: {
    color: colors.info, fontSize: 10, fontWeight: '700',
    backgroundColor: colors.cardAlt, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2,
    overflow: 'hidden',
  },
  newsTagPolicy: { color: colors.danger },
  newsItemTitle: { color: colors.text, fontSize: 13, lineHeight: 18 },
  newsItemMeta: { color: colors.textDim, fontSize: 10, marginTop: 3 },
  newsHint: { color: colors.textDim, fontSize: 11, marginTop: 6, lineHeight: 15 },
  content: { padding: 14, paddingBottom: 40 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  name: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  tagsRow: { flexDirection: 'row', gap: 12, marginTop: 6 },
  tag: { fontSize: 12 },
  empty: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
});
