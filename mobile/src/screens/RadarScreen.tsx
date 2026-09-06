/** 机会雷达：全池信号列表（PRD 第八节） */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Linking, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, RadarItem } from '../api/client';
import { refreshMarketNews, MarketNews } from '../data/eventFeed';
import { Card, Row } from '../components/Card';
import { ErrorView, Loading } from '../components/Loading';
import { SignalBadge } from '../components/SignalBadge';
import { colors, riskColors } from '../theme/colors';
import { displayNameOf, fmtMoney, fmtZhe, SIGNAL_TEXT } from '../utils/format';

interface Props {
  onOpenDetail: (name: string) => void;
}

export function RadarScreen({ onOpenDetail }: Props) {
  const [items, setItems] = useState<RadarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'buy' | 'wait' | 'avoid'>('all');
  const [news, setNews] = useState<MarketNews | null>(null);

  useEffect(() => {
    refreshMarketNews().then(setNews).catch(() => undefined);
  }, []);

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
  const insufficientCount = items.filter((i) => i.details?.data_insufficient === true).length;
  const mostlyInsufficient = items.length > 0 && insufficientCount / items.length > 0.5;

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
              {k === 'all' ? '全部' : SIGNAL_TEXT[k]}{' '}{counts[k]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => {
              setLoading(true);
              load();
              refreshMarketNews(true).then(setNews).catch(() => undefined);
            }}
          />
        }
      >
        {/* 市场事件（实时拉取：官方博客 + Steam 新闻） */}
        {news && news.items.length > 0 ? (
          <Card>
            <View style={styles.newsHead}>
              <Text style={styles.newsTitle}>📰 市场事件</Text>
              <Text style={styles.newsMeta}>
                {news.failed > 0 ? `${news.failed} 个源失败 · ` : ''}
                {new Date(news.fetchedAt).toLocaleString()}
              </Text>
            </View>
            {news.items.slice(0, 6).map((it, i) => (
              <TouchableOpacity key={`${it.link}-${i}`} onPress={() => it.link && Linking.openURL(it.link)}>
                <View style={styles.newsItem}>
                  <View style={styles.newsTags}>
                    {it.tags.map((t) => (
                      <Text key={t} style={[styles.newsTag, t === 'policy' && styles.newsTagPolicy]}>
                        {t === 'policy' ? '政策/更新' : t === 'boost' ? '赛事提振' : t === 'sale' ? '特卖' : t === 'case' ? '箱子' : t === 'op' ? '行动' : t}
                      </Text>
                    ))}
                  </View>
                  <Text style={styles.newsItemTitle} numberOfLines={2}>{it.title}</Text>
                  <Text style={styles.newsItemMeta}>
                    {it.source}
                    {it.date ? ` · ${new Date(it.date).toLocaleDateString()}` : ''}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
            <Text style={styles.newsHint}>标签为关键词推断：政策/更新类事件需警惕价格波动；赛事/节日通常提振需求。点击可打开原文。</Text>
          </Card>
        ) : null}
        {loading ? <Loading /> : null}
        {mostlyInsufficient && !loading ? (
          <Card>
            <Text style={styles.insufficientBanner}>
              ⚠ {insufficientCount}/{items.length} 个箱子历史不足。解决：到「我的 → 设置」完成「Steam 一键登录」，
              再到首页点一次「一键扫描」——会自动导入近 120 天官方历史，历史即刻补齐。
            </Text>
          </Card>
        ) : null}
        {!loading && error ? <ErrorView message={error} onRetry={load} /> : null}
        {!loading && !error && shown.length === 0 ? (
          <Card><Text style={styles.empty}>暂无数据。先到「首页」点击「一键扫描」拉取行情，采集后自动生成雷达信号。</Text></Card>
        ) : null}
        {shown.map((r) => (
          <TouchableOpacity key={r.market_hash_name} onPress={() => onOpenDetail(r.market_hash_name)}>
            <Card>
              <View style={styles.itemHeader}>
                <Text style={styles.name} numberOfLines={1}>{displayNameOf(r.market_hash_name)}</Text>
                <SignalBadge signal={r.signal} />
              </View>
              <Row label="预计几折（越低越划算）" value={fmtZhe(r.expected_discount)} valueColor={r.expected_discount != null && r.expected_discount <= 0.95 ? colors.success : colors.warning} />
              <Row label="预计回报 (7日)" value={r.expected_roi != null ? `${(r.expected_roi * 100).toFixed(1)}%` : '--'} valueColor={r.expected_roi != null && r.expected_roi >= 0 ? colors.success : colors.danger} />
              <Row
                label="C5 买入 / Steam 到手"
                value={`${r.c5_buy_price != null ? fmtMoney(r.c5_buy_price) : '--'} / ${r.steam_sell_price != null ? fmtMoney(r.steam_sell_price) : '--'}`}
              />
              <View style={styles.tagsRow}>
                <Text style={[styles.tag, { color: riskColors[r.risk_level] ?? colors.textDim }]}>风险 {r.risk_level}</Text>
                <Text style={[styles.tag, { color: colors.info }]}>流动性 {r.liquidity}</Text>
                <Text style={[styles.tag, { color: colors.gold }]}>评分 {r.score}</Text>
                {r.details.data_insufficient === true ? (
                  <Text style={[styles.tag, { color: colors.warning }]}>历史不足</Text>
                ) : null}
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
  insufficientBanner: { color: colors.warning, fontSize: 13, lineHeight: 19 },
  newsHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  newsTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  newsMeta: { color: colors.textDim, fontSize: 10 },
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

