/**
 * 首页（HANDOFF v2.0 第 15 节）：极简决策页。
 * 视觉优先级：预计几折 → 推荐结论 → 预计赚多少 → 风险。
 * - 顶部：市场状态 + 最后更新时间
 * - 最大字号「预计 X.X 折」+ 结论行
 * - 推荐卡片 + 一键买入（主按钮） / 查看详情（次按钮）
 * - 一键扫描采集
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { scanService, ScanState } from '../data/scanService';
import { settingsEvents } from '../data/storage';
import { Card } from '../components/Card';
import { ErrorView, Loading } from '../components/Loading';
import { SignalBadge } from '../components/SignalBadge';
import { HomeInsights } from '../components/HomeInsights';
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
  const scanPercent = scan.progress?.total
    ? Math.min(100, Math.round((scan.progress.done / scan.progress.total) * 100))
    : 0;
  const progressAnimation = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progressAnimation, { toValue: scanPercent, duration: 300, useNativeDriver: false }).start();
  }, [progressAnimation, scanPercent]);
  const progressWidth = progressAnimation.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void reload(); void load(); }} />}
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>CS2 MARKET BRIEF</Text>
            <Text style={styles.title}>宇额助手</Text>
            <Text style={styles.localMode}>CS2 箱子行情 · 本地分析</Text>
          </View>
          <View style={styles.statusBox}>
            <Text style={[styles.statusText, { color: st.color }]}>● {st.text}</Text>
            <Text style={styles.statusTime}>
              {status?.lastUpdated ? `更新 ${new Date(status.lastUpdated).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '等待首次扫描'}
            </Text>
          </View>
        </View>

        {/* 一键扫描（进度为全局状态：切页/前后台回来不丢；中断后点卡片续扫） */}
        {collecting ? (
          <Card style={styles.collectCard}>
            <View style={styles.scanRow}>
              <View style={styles.scanMark}><Text style={styles.scanMarkText}>↻</Text></View>
              <View style={styles.scanCopy}>
                <Text style={styles.collectTitle}>正在扫描行情</Text>
                <Text style={styles.collectDesc} numberOfLines={1}>
                  {scan.progress?.message || (scan.progress ? `已完成 ${scan.progress.done}/${scan.progress.total} 个` : '正在准备数据…')}
                </Text>
              </View>
              <Text style={styles.scanPercent}>{scanPercent}%</Text>
            </View>
            <View style={styles.scanProgressTrack} accessibilityLabel={`扫描完成 ${scanPercent}%`}>
              <Animated.View style={[styles.scanProgressFill, { width: progressWidth }]} />
            </View>
          </Card>
        ) : scan.progress && scan.progress.stage !== 'done' ? (
          <TouchableOpacity onPress={startCollect} activeOpacity={0.78} accessibilityRole="button" accessibilityLabel="继续上次未完成的扫描">
            <Card style={styles.collectCard}>
              <View style={styles.scanRow}>
                <View style={styles.scanMark}><Text style={styles.scanMarkText}>↻</Text></View>
                <View style={styles.scanCopy}>
                  <Text style={styles.collectTitle}>继续扫描</Text>
                  <Text style={styles.collectDesc}>已完成 {scan.progress.done}/{scan.progress.total} · 只补充缺失数据</Text>
                </View>
                <Text style={styles.scanChevron}>›</Text>
              </View>
              <View style={styles.scanProgressTrack} accessibilityLabel={`已完成 ${scanPercent}%`}>
                <Animated.View style={[styles.scanProgressFill, { width: progressWidth }]} />
              </View>
            </Card>
          </TouchableOpacity>
        ) : (
          <View>
            <TouchableOpacity onPress={startCollect} activeOpacity={0.78} accessibilityRole="button" accessibilityLabel={`扫描行情，采集 ${collectCount} 个武器箱`}>
              <Card style={styles.collectCard}>
                <View style={styles.scanRow}>
                  <View style={styles.scanMark}><Text style={styles.scanMarkText}>↻</Text></View>
                  <View style={styles.scanCopy}>
                    <Text style={styles.collectTitle}>扫描行情</Text>
                    <Text style={styles.collectDesc}>采集 {collectCount} 个箱子 · 自动生成分析</Text>
                  </View>
                  <View style={styles.scanAction}><Text style={styles.scanActionText}>开始</Text></View>
                </View>
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
                    <Text style={styles.buyBtnText}>一键买入</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.detailBtn} onPress={() => onOpenDetail(best.item)}>
                    <Text style={styles.detailBtnText}>查看详情</Text>
                  </TouchableOpacity>
                </View>
              </Card>
            )}

            <HomeInsights
              cards={cards.slice(0, 3)}
              buyCount={buyCount}
              waitCount={waitCount}
              avoidCount={avoidCount}
              onOpenDetail={onOpenDetail}
            />
          </>
        ) : null}

        {/* 资金模拟入口 */}
        <TouchableOpacity onPress={onOpenSimulate}>
          <Card style={styles.simCard}>
            <Text style={styles.simEyebrow}>工具</Text>
            <Text style={styles.simTitle}>资金模拟</Text>
            <Text style={styles.simDesc}>按预算估算组合，或反推目标余额所需本金。</Text>
          </Card>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 36 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 },
  eyebrow: { color: colors.primary, fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: 1.2, marginBottom: 3 },
  title: { color: colors.text, fontSize: 25, lineHeight: 30, fontWeight: '800', letterSpacing: -0.6 },
  localMode: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  statusBox: { alignItems: 'flex-end', maxWidth: 155, paddingLeft: 12 },
  statusText: { fontSize: 11, fontWeight: '700', backgroundColor: colors.card, overflow: 'hidden', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: colors.border },
  statusTime: { color: colors.textDim, fontSize: 10, marginTop: 5, textAlign: 'right', fontVariant: ['tabular-nums'] },
  collectCard: { backgroundColor: colors.card, borderColor: colors.border, paddingVertical: 13, marginBottom: 20 },
  scanRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  scanMark: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  scanMarkText: { color: colors.primary, fontSize: 23, lineHeight: 28, fontWeight: '600' },
  scanCopy: { flex: 1, minWidth: 0 },
  scanAction: { minHeight: 40, minWidth: 56, paddingHorizontal: 13, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  scanActionText: { color: colors.onPrimary, fontSize: 12, fontWeight: '700' },
  scanChevron: { color: colors.primaryText, fontSize: 24, paddingHorizontal: 6 },
  scanPercent: { color: colors.primary, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  scanProgressTrack: { height: 5, borderRadius: 3, backgroundColor: colors.primarySoft, overflow: 'hidden', marginTop: 12 },
  scanProgressFill: { height: 5, borderRadius: 3, backgroundColor: colors.primary },
  collectTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  collectDesc: { color: colors.textDim, fontSize: 11, marginTop: 3, lineHeight: 16 },
  heroCard: { backgroundColor: colors.card, borderColor: colors.borderStrong, padding: 18 },
  heroHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  heroLabel: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  heroBig: { color: colors.primary, fontSize: 60, fontWeight: '800', marginTop: 10, fontVariant: ['tabular-nums'], letterSpacing: -1.4 },
  heroHint: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  heroTag: { color: colors.text, fontSize: 13, fontWeight: '600' },
  heroArrow: { color: colors.textDim, fontSize: 13 },
  heroBtns: { flexDirection: 'row', gap: 10, marginTop: 16 },
  buyBtn: { flex: 1.4, minHeight: 48, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  buyBtnText: { color: colors.onPrimary, fontSize: 14, fontWeight: '700' },
  detailBtn: {
    flex: 1, minHeight: 48, backgroundColor: colors.card, borderRadius: 14, paddingVertical: 12, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  detailBtnText: { color: colors.primaryText, fontSize: 14, fontWeight: '600' },
  empty: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  simCard: { backgroundColor: colors.card, borderColor: colors.border },
  simEyebrow: { color: colors.textDim, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, marginBottom: 4 },
  simTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  simDesc: { color: colors.textDim, fontSize: 12, marginTop: 4, lineHeight: 17 },
});
