/**
 * 首页（HANDOFF v2.0 第 15 节）：极简决策页。
 * 视觉优先级：预计几折 → 推荐结论 → 预计赚多少 → 风险。
 * - 顶部：市场状态 + 最后更新时间
 * - 最大字号「预计 X.X 折」+ 结论行
 * - 推荐卡片 + 一键买入（主按钮） / 查看详情（次按钮）
 * - 一键扫描采集
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, Quote } from '../api/client';
import type { CollectProgress } from '../data/collector';
import { Card, Row, SectionTitle } from '../components/Card';
import { ErrorView, Loading } from '../components/Loading';
import { SignalBadge } from '../components/SignalBadge';
import { colors, riskColors } from '../theme/colors';
import { displayNameOf, fmtMoney, fmtZhe, SIGNAL_TEXT } from '../utils/format';
import { runBuyFlow } from '../utils/buyFlow';

interface Props {
  onOpenMarket: () => void;
  onOpenRadar: () => void;
  onOpenSimulate: () => void;
  onOpenDetail: (name: string) => void;
}

function statusText(lastUpdated: string | null): { text: string; color: string } {
  if (!lastUpdated) return { text: '暂无数据', color: colors.danger };
  const ageMs = Date.now() - new Date(lastUpdated).getTime();
  const hours = ageMs / 3600000;
  if (hours <= 24) return { text: '数据正常', color: colors.success };
  if (hours <= 72) return { text: '数据较旧', color: colors.warning };
  return { text: '数据过期', color: colors.danger };
}

export function HomeScreen({ onOpenMarket, onOpenRadar, onOpenSimulate, onOpenDetail }: Props) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [status, setStatus] = useState<{ lastUpdated: string | null; snapshotCount: number; itemCount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [progress, setProgress] = useState<CollectProgress | null>(null);
  const [collectCount, setCollectCount] = useState(20);

  const load = useCallback(async () => {
    try {
      const [m, h] = await Promise.all([api.markets(), api.health()]);
      setQuotes(m);
      setStatus({ lastUpdated: h.lastUpdated, snapshotCount: h.snapshotCount, itemCount: h.itemCount });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
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
      const stats = await api.refresh({ count: collectCount, onProgress: setProgress });
      await load();
      if (stats.success === 0) setError('采集失败：请检查网络后重试');
    } catch (e) {
      setError(e instanceof Error ? e.message : '采集失败');
    } finally {
      setCollecting(false);
    }
  };

  const best: Quote | null = quotes[0] ?? null;
  const buyCount = quotes.filter((q) => q.signal === 'buy').length;
  const waitCount = quotes.filter((q) => q.signal === 'wait').length;
  const avoidCount = quotes.filter((q) => q.signal === 'avoid').length;
  const st = statusText(status?.lastUpdated ?? null);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>CS2 余额助手</Text>
            <Text style={styles.subtitle}>C5GAME 买入 → 7 天限制期 → Steam 卖出</Text>
          </View>
          <View style={styles.statusBox}>
            <Text style={[styles.statusText, { color: st.color }]}>● {st.text}</Text>
            <Text style={styles.statusTime}>
              {status?.lastUpdated ? `更新 ${new Date(status.lastUpdated).toLocaleString()}` : '--'}
            </Text>
          </View>
        </View>

        {/* 一键扫描 */}
        {collecting ? (
          <Card style={styles.collectCard}>
            <Text style={styles.collectTitle}>📡 正在采集行情…</Text>
            <Text style={styles.collectDesc}>
              {progress
                ? progress.message ||
                  (progress.stage === 'listing' ? '拉取热门武器箱榜单…' : `已采集 ${progress.done}/${progress.total} 个`)
                : '准备中…'}
            </Text>
          </Card>
        ) : (
          <TouchableOpacity onPress={startCollect}>
            <Card style={styles.collectCard}>
              <Text style={styles.collectTitle}>📡 一键扫描（{collectCount} 个）</Text>
              <Text style={styles.collectDesc}>Steam 热门武器箱 → C5GAME 买入价，本地完成分析与预测</Text>
            </Card>
          </TouchableOpacity>
        )}

        {loading ? <Loading msg="正在获取市场分析…" /> : null}
        {!loading && error ? <ErrorView message={error} onRetry={load} /> : null}

        {!loading && !error && quotes.length === 0 ? (
          <Card>
            <Text style={styles.empty}>暂无本地行情数据。点击上方「一键扫描」拉取最新武器箱价格，或到底部「我的」页配置采集数量。</Text>
          </Card>
        ) : null}

        {!loading && !error && best ? (
          <>
            {/* 核心：预计几折 */}
            <Card style={styles.heroCard}>
              <View style={styles.heroHead}>
                <Text style={styles.heroLabel} numberOfLines={1}>{displayNameOf(best.market_hash_name)}</Text>
                <SignalBadge signal={best.signal} />
              </View>
              <Text style={styles.heroBig}>{fmtZhe(best.expected_discount)}</Text>
              <Text style={styles.heroHint}>预计几折（越低越划算）· 今日最值得关注</Text>
              <View style={styles.heroRow}>
                <Text style={styles.heroTag}>C5 买入 {fmtMoney(best.c5_buy_price)}</Text>
                <Text style={styles.heroArrow}>→</Text>
                <Text style={[styles.heroTag, { color: colors.success }]}>Steam 到手 {fmtMoney(best.steam_net_receive)}</Text>
              </View>
              <View style={styles.heroBtns}>
                <TouchableOpacity
                  style={[styles.buyBtn, best.c5_buy_price == null && { opacity: 0.5 }]}
                  onPress={() => runBuyFlow({ name: best.market_hash_name })}
                  disabled={best.c5_buy_price == null}
                >
                  <Text style={styles.buyBtnText}>🛒 一键买入</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.detailBtn} onPress={() => onOpenDetail(best.market_hash_name)}>
                  <Text style={styles.detailBtnText}>查看详情</Text>
                </TouchableOpacity>
              </View>
            </Card>

            {/* 结论聚合 */}
            <Card>
              <SectionTitle>今日结论</SectionTitle>
              <Row label="推荐购买" value={`${buyCount} 个`} valueColor={colors.success} />
              <Row label="可以观察" value={`${waitCount} 个`} valueColor={colors.warning} />
              <Row label="暂时别买" value={`${avoidCount} 个`} valueColor={colors.danger} />
              <Text style={styles.note}>信号综合预计几折、7 天预测、流动性、风险，仅作参考，不构成投资建议。</Text>
            </Card>

            {/* 低价机会 Top 3 */}
            <SectionTitle>当前最划算 Top 3</SectionTitle>
            {quotes.slice(0, 3).map((q, idx) => (
              <TouchableOpacity key={q.market_hash_name} onPress={() => onOpenDetail(q.market_hash_name)}>
                <Card style={styles.itemCard}>
                  <View style={styles.itemHeader}>
                    <Text style={styles.rank}>#{idx + 1}</Text>
                    <Text style={styles.itemName} numberOfLines={1}>{displayNameOf(q.market_hash_name)}</Text>
                    <Text style={[styles.itemZhe, { color: q.expected_discount != null && q.expected_discount <= 0.95 ? colors.success : colors.warning }]}>
                      {fmtZhe(q.expected_discount)}
                    </Text>
                  </View>
                  <Row label="预计赚/亏（7 天后）" value={q.net_profit != null ? `${q.net_profit >= 0 ? '+' : ''}${fmtMoney(q.net_profit)}` : '--'} valueColor={q.net_profit != null && q.net_profit >= 0 ? colors.success : colors.danger} />
                  <View style={styles.tagsRow}>
                    <Text style={[styles.tag, { color: riskColors[q.signal === 'buy' ? 'low' : q.signal === 'wait' ? 'medium' : 'high'] ?? colors.textDim }]}>
                      结论：{SIGNAL_TEXT[q.signal] ?? q.signal}
                    </Text>
                    <Text style={[styles.tag, { color: colors.info }]}>成交量 {q.steam_volume != null ? q.steam_volume : '--'}</Text>
                  </View>
                </Card>
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={onOpenMarket}>
              <Text style={styles.moreLink}>查看全部市场 →</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={onOpenRadar}>
              <Text style={styles.moreLink}>机会雷达（全池信号）→</Text>
            </TouchableOpacity>
          </>
        ) : null}

        {/* 资金模拟入口 */}
        <SectionTitle>我有 X 元预算？</SectionTitle>
        <TouchableOpacity onPress={onOpenSimulate}>
          <Card style={styles.simCard}>
            <Text style={styles.simTitle}>🎯 资金模拟与目标余额反推</Text>
            <Text style={styles.simDesc}>输入预算自动给出组合，或输入目标 Steam 余额反推所需本金。</Text>
          </Card>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 14, paddingBottom: 32 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  subtitle: { color: colors.textDim, fontSize: 12, marginTop: 4 },
  statusBox: { alignItems: 'flex-end', maxWidth: 150 },
  statusText: { fontSize: 13, fontWeight: '800' },
  statusTime: { color: colors.textDim, fontSize: 10, marginTop: 3, textAlign: 'right' },
  collectCard: { backgroundColor: colors.cardAlt, borderColor: colors.primary },
  collectTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  collectDesc: { color: colors.textDim, fontSize: 13, marginTop: 6, lineHeight: 18 },
  heroCard: { backgroundColor: colors.cardAlt, borderColor: colors.primary, padding: 18 },
  heroHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  heroLabel: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  heroBig: { color: colors.text, fontSize: 64, fontWeight: '900', marginTop: 10, fontVariant: ['tabular-nums'] },
  heroHint: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  heroTag: { color: colors.text, fontSize: 13, fontWeight: '600' },
  heroArrow: { color: colors.textDim, fontSize: 13 },
  heroBtns: { flexDirection: 'row', gap: 10, marginTop: 16 },
  buyBtn: { flex: 1.4, backgroundColor: colors.success, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buyBtnText: { color: '#06210F', fontSize: 15, fontWeight: '800' },
  detailBtn: {
    flex: 1, backgroundColor: colors.card, borderRadius: 12, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, borderColor: colors.primary,
  },
  detailBtnText: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  itemCard: { paddingVertical: 10 },
  itemHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  rank: { color: colors.textDim, fontSize: 13, fontWeight: '700', marginRight: 8, width: 24 },
  itemName: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  itemZhe: { fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  tagsRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  tag: { fontSize: 12 },
  moreLink: { color: colors.primary, fontSize: 14, fontWeight: '600', textAlign: 'center', paddingVertical: 8 },
  empty: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  note: { color: colors.textDim, fontSize: 12, marginTop: 8, lineHeight: 17 },
  simCard: { backgroundColor: colors.cardAlt, borderColor: colors.primary },
  simTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  simDesc: { color: colors.textDim, fontSize: 13, marginTop: 6, lineHeight: 18 },
});
