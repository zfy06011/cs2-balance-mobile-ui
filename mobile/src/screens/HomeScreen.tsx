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
import { api } from '../api/client';
import { scanService, ScanState } from '../data/scanService';
import { settingsEvents } from '../data/storage';
import { Card, Row, SectionTitle } from '../components/Card';
import { ErrorView, Loading } from '../components/Loading';
import { SignalBadge } from '../components/SignalBadge';
import { colors } from '../theme/colors';
import { runBuyFlow } from '../utils/buyFlow';
import { OpportunityCard } from '../ui/opportunity/OpportunityCard';
import { useOpportunitySnapshot } from '../ui/opportunity/useOpportunitySnapshot';
import { selectOpportunityCards, type OpportunityCardViewModel } from '../ui/opportunity/opportunityViewModel';

interface Props {
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

export function HomeScreen({ onOpenSimulate, onOpenDetail }: Props) {
  const [status, setStatus] = useState<{ lastUpdated: string | null; snapshotCount: number; itemCount: number } | null>(null);
  const [scan, setScan] = useState<ScanState>(scanService.getState());
  const [collectCount, setCollectCount] = useState(20);
  const [collectError, setCollectError] = useState<string | null>(null);
  const { snapshot, loading, refreshing, error, reload, refreshLive, liveRefreshing, liveError } = useOpportunitySnapshot();
  const cards = React.useMemo(() => snapshot ? selectOpportunityCards(snapshot, { sort: 'decision' }) : [], [snapshot]);

  const load = useCallback(async () => {
    try {
      const h = await api.health();
      setStatus({ lastUpdated: h.lastUpdated, snapshotCount: h.snapshotCount, itemCount: h.itemCount });
    } catch (e) {
      // snapshot 自身的错误由 useOpportunitySnapshot 负责；状态卡失败不清空旧数据。
    }
  }, []);

  useEffect(() => {
    load();
    api.getSettings().then((s) => setCollectCount(s.refreshCount)).catch(() => undefined);
    // 扫描进度是全局状态：切页/前后台回来都实时显示
    const unsubScan = scanService.subscribe(setScan);
    // 设置页改扫描数量时，本页按钮上的数字实时刷新
    const unsubSettings = settingsEvents.subscribe((s) => setCollectCount(s.refreshCount));
    return () => {
      unsubScan();
      unsubSettings();
    };
  }, [load]);

  const collecting = scan.running;

  const startCollect = async () => {
    if (scan.running) return;
    setCollectError(null);
    try {
      const stats = await scanService.start(collectCount);
      await reload();
      void refreshLive(stats.candidateNames);
      await load();
      if (stats.success === 0 && stats.skipped === 0) setCollectError('采集失败：请检查网络后重试');
    } catch (e) {
      setCollectError(e instanceof Error ? e.message : '采集失败');
    }
  };

  const best: OpportunityCardViewModel | null = cards[0] ?? null;
  const signalOf = (card: OpportunityCardViewModel): string => card.decision === 'legacy'
    ? card.legacySignal ?? 'waiting'
    : card.decision === 'excellent' || card.decision === 'buy' ? 'buy' : card.decision === 'watch' ? 'wait' : 'avoid';
  const buyCount = cards.filter((q) => signalOf(q) === 'buy').length;
  const waitCount = cards.filter((q) => signalOf(q) === 'wait').length;
  const avoidCount = cards.filter((q) => signalOf(q) === 'avoid').length;
  const st = statusText(status?.lastUpdated ?? null);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void reload(); void load(); }} />}
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>宇额助手</Text>
            <Text style={styles.localMode}>完全本地运行</Text>
          </View>
          <View style={styles.statusBox}>
            <Text style={[styles.statusText, { color: st.color }]}>● {st.text}</Text>
            <Text style={styles.statusTime}>
              {status?.lastUpdated ? `更新 ${new Date(status.lastUpdated).toLocaleString()}` : '--'}
            </Text>
          </View>
        </View>

        {/* 一键扫描（进度为全局状态：切页/前后台回来不丢；中断后点卡片续扫） */}
        {collecting ? (
          <Card style={styles.collectCard}>
            <Text style={styles.collectTitle}>📡 正在扫描行情…</Text>
            <Text style={styles.collectDesc}>
              {scan.progress
                ? scan.progress.message ||
                  (scan.progress.stage === 'listing' ? '拉取热门武器箱榜单…' : `已扫描 ${scan.progress.done}/${scan.progress.total} 个`)
                : '准备中…'}
            </Text>
          </Card>
        ) : scan.progress && scan.progress.stage !== 'done' ? (
          <TouchableOpacity onPress={startCollect}>
            <Card style={styles.collectCard}>
              <Text style={styles.collectTitle}>
                ⏸ 上次扫描未完成（{scan.progress.done}/{scan.progress.total}），点击继续
              </Text>
              <Text style={styles.collectDesc}>已扫描的不会重复采集，只补缺的部分</Text>
            </Card>
          </TouchableOpacity>
        ) : (
          <View>
            <TouchableOpacity onPress={startCollect}>
              <Card style={styles.collectCard}>
                <Text style={styles.collectTitle}>📡 一键扫描（{collectCount} 个）</Text>
              </Card>
            </TouchableOpacity>
            {liveRefreshing ? <Text style={styles.collectDesc}>正在更新实时盘口…</Text> : null}
            {liveError ? <Text style={[styles.collectDesc, { color: colors.warning }]}>实时盘口更新失败，当前仍显示本地结果</Text> : null}
          </View>
        )}

        {loading ? <Loading msg="正在获取市场分析…" /> : null}
        {!loading && (error || collectError) ? <ErrorView message={error ?? collectError ?? '加载失败'} onRetry={load} /> : null}

        {!loading && !error && !collectError && cards.length === 0 ? (
          <Card>
            <Text style={styles.empty}>暂无本地行情数据。点击上方「一键扫描」拉取最新武器箱价格，或到底部「我的」页配置采集数量。</Text>
          </Card>
        ) : null}

        {!loading && !error && !collectError && best ? (
          <>
            {/* 核心：预计几折 */}
            {snapshot?.mode === 'v2' ? (
              <>
                <OpportunityCard card={best} />
                <TouchableOpacity style={styles.detailBtn} onPress={() => onOpenDetail(best.item)}>
                  <Text style={styles.detailBtnText}>查看 v2 详情</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Card style={styles.heroCard}>
                <View style={styles.heroHead}>
                  <Text style={styles.heroLabel} numberOfLines={1}>{best.displayNameZh}</Text>
                  <SignalBadge signal={signalOf(best)} />
                </View>
                <Text style={styles.heroBig}>{best.expectedDiscountText ?? '--'}</Text>
                <Text style={styles.heroHint}>预计几折（越低越划算）· 今日最值得关注</Text>
                <View style={styles.heroRow}>
                  <Text style={styles.heroTag}>C5 买入 {best.c5BuyPriceText ?? '--'}</Text>
                  <Text style={styles.heroArrow}>→</Text>
                  <Text style={[styles.heroTag, { color: colors.success }]}>Steam 到手 {best.steamNetReceiveText ?? '--'}</Text>
                </View>
                <View style={styles.heroBtns}>
                  <TouchableOpacity
                    style={[styles.buyBtn, best.c5BuyPriceText === '--' && { opacity: 0.5 }]}
                    onPress={() => runBuyFlow({ name: best.item })}
                    disabled={best.c5BuyPriceText === '--'}
                  >
                    <Text style={styles.buyBtnText}>🛒 一键买入</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.detailBtn} onPress={() => onOpenDetail(best.item)}>
                    <Text style={styles.detailBtnText}>查看详情</Text>
                  </TouchableOpacity>
                </View>
              </Card>
            )}

            {/* 结论聚合 */}
            <Card>
              <SectionTitle>今日结论</SectionTitle>
              <Row label="推荐购买" value={`${buyCount} 个`} valueColor={colors.success} />
              <Row label="可以观察" value={`${waitCount} 个`} valueColor={colors.warning} />
              <Row label="暂时别买" value={`${avoidCount} 个`} valueColor={colors.danger} />
            </Card>

            {/* 低价机会 Top 3 */}
            <SectionTitle>当前最划算 Top 3</SectionTitle>
            {cards.slice(0, 3).map((q, idx) => (
              <TouchableOpacity key={q.item} onPress={() => onOpenDetail(q.item)}>
                <Card style={styles.itemCard}>
                  <View style={styles.itemHeader}>
                    <Text style={styles.rank}>#{idx + 1}</Text>
                    <Text style={styles.itemName} numberOfLines={1}>{q.displayNameZh}</Text>
                    <Text style={[styles.itemZhe, { color: colors.warning }]}>
                      {q.expectedDiscountText ?? '--'}
                    </Text>
                  </View>
                  <Row label="预计赚/亏（7 天后）" value={q.netProfitText ?? '--'} valueColor={colors.textDim} />
                  <View style={styles.tagsRow}>
                    <Text style={[styles.tag, { color: colors.textDim }]}>结论：{q.decisionLabel}</Text>
                    <Text style={[styles.tag, { color: colors.info }]}>成交量 {q.steamVolumeText ?? '--'}</Text>
                  </View>
                </Card>
              </TouchableOpacity>
            ))}
          </>
        ) : null}

        {/* 资金模拟入口 */}
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
  localMode: { color: colors.textDim, fontSize: 11, marginTop: 2 },
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
  empty: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  simCard: { backgroundColor: colors.cardAlt, borderColor: colors.primary },
  simTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  simDesc: { color: colors.textDim, fontSize: 13, marginTop: 6, lineHeight: 18 },
});
