/**
 * 首页：回答最终首页应该回答的 5 个问题（PRD 第十八节）：
 * 1. 现在有哪些武器箱值得关注？
 * 2. 现在买入，7 天后大概率能不能赚钱？
 * 3. 扣除费用后真实预期净利润是多少？
 * 4. 现在买还是等几天更好？
 * 5. 如果有 X 元资金，怎样分配最适合倒余额？
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, RadarItem } from '../api/client';
import type { CollectProgress } from '../data/collector';
import { Card, Row, SectionTitle } from '../components/Card';
import { ErrorView, Loading } from '../components/Loading';
import { SignalBadge } from '../components/SignalBadge';
import { colors, riskColors } from '../theme/colors';

interface Props {
  onOpenRadar: () => void;
  onOpenSimulate: () => void;
  onOpenDetail: (name: string) => void;
}

function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined) return '--';
  return `¥${v.toFixed(2)}`;
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return '--';
  return `${(v * 100).toFixed(1)}%`;
}

export function HomeScreen({ onOpenRadar, onOpenSimulate, onOpenDetail }: Props) {
  const [radar, setRadar] = useState<RadarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [progress, setProgress] = useState<CollectProgress | null>(null);
  const [collectCount, setCollectCount] = useState(20);

  const load = useCallback(async () => {
    try {
      const data = await api.radar();
      setRadar(data);
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
      await api.refresh({ count: collectCount, onProgress: setProgress });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '采集失败');
    } finally {
      setCollecting(false);
      setRefreshing(false);
    }
  };

  const top = radar.slice(0, 5);
  const buyCount = radar.filter((r) => r.signal === 'buy').length;
  const best = radar[0];
  // 盈利概率取第一个有 details 的
  const bestProfitProb = best ? (best.details.prob_profit ?? 0) : 0;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        <Text style={styles.title}>CS2 余额助手</Text>
        <Text style={styles.subtitle}>C5GAME 买入 → 7 天限制期 → Steam 市场卖出</Text>

        {collecting ? (
          <Card style={styles.collectCard}>
            <Text style={styles.collectTitle}>📡 正在采集行情…</Text>
            <Text style={styles.collectDesc}>
              {progress
                ? progress.stage === 'listing'
                  ? progress.message
                  : `${progress.done}/${progress.total} ${progress.currentName || ''} · 成功 ${progress.success} 失败 ${progress.failed}`
                : '准备中…'}
            </Text>
          </Card>
        ) : (
          <TouchableOpacity onPress={startCollect}>
            <Card style={styles.collectCard}>
              <Text style={styles.collectTitle}>📡 一键采集最新行情</Text>
              <Text style={styles.collectDesc}>从 Steam 拉取成交量 Top {collectCount} 个武器箱价格，本地完成分析与预测（无需电脑）</Text>
            </Card>
          </TouchableOpacity>
        )}

        {loading ? <Loading msg="正在获取市场分析…" /> : null}
        {!loading && error ? <ErrorView message={error} onRetry={load} /> : null}

        {!loading && !error && radar.length === 0 ? (
          <Card>
            <Text style={styles.empty}>暂无本地行情数据。点击上方「一键采集」拉取最新武器箱价格，或到「设置」页配置采集数量。</Text>
          </Card>
        ) : null}

        {!loading && !error && radar.length > 0 ? (
          <>
            {/* Q1/Q2/Q4：值得关注的箱子 */}
            <SectionTitle>Q1 现在有哪些武器箱值得关注？</SectionTitle>
            {top.map((r) => (
              <TouchableOpacity key={r.market_hash_name} onPress={() => onOpenDetail(r.market_hash_name)}>
                <Card style={styles.itemCard}>
                  <View style={styles.itemHeader}>
                    <Text style={styles.itemName} numberOfLines={1}>{r.market_hash_name}</Text>
                    <SignalBadge signal={r.signal} />
                  </View>
                  <Row label="预期 7 日 ROI" value={fmtPct(r.expected_roi)} valueColor={r.expected_roi != null && r.expected_roi > 0 ? colors.success : colors.danger} />
                  <View style={styles.tagsRow}>
                    <Text style={[styles.tag, { color: riskColors[r.risk_level] ?? colors.textDim }]}>
                      风险：{r.risk_level}
                    </Text>
                    <Text style={[styles.tag, { color: colors.info }]}>流动性：{r.liquidity}</Text>
                    <Text style={[styles.tag, { color: colors.gold }]}>评分 {r.score}</Text>
                  </View>
                </Card>
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={onOpenRadar}>
              <Text style={styles.moreLink}>查看全部机会雷达 →</Text>
            </TouchableOpacity>

            {/* Q2：7 天后大概率能不能赚钱 */}
            <SectionTitle>Q2 现在买入，7 天后能赚钱吗？</SectionTitle>
            {best ? (
              <Card>
                <Text style={styles.bigText} numberOfLines={1}>{best.market_hash_name}</Text>
                <Row label="盈利概率" value={fmtPct(bestProfitProb)} valueColor={bestProfitProb >= 0.5 ? colors.success : colors.danger} />
                <Row label="预测 7 日 P50 卖价" value={fmtMoney(best.details.predicted_p50)} />
                <Row label="盈亏平衡卖出价" value={fmtMoney(best.details.breakeven_price)} />
                <Row label="模型置信度" value={fmtPct(best.details.confidence)} />
              </Card>
            ) : null}

            {/* Q3：真实净利润 */}
            <SectionTitle>Q3 扣除费用后真实净利润</SectionTitle>
            {top.slice(0, 3).map((r) => (
              <Card key={r.market_hash_name}>
                <Text style={styles.itemName} numberOfLines={1}>{r.market_hash_name}</Text>
                <Row label="C5 买入价" value={fmtMoney(r.c5_buy_price)} />
                <Row label="Steam 当前卖价" value={fmtMoney(r.steam_sell_price)} />
                <Row
                  label="净到账（扣 15%+1%）"
                  value={r.c5_buy_price != null && r.steam_sell_price != null ? `≈ ${fmtMoney(r.steam_sell_price * 0.8696)}` : '--'}
                />
                <Row label="预期净 ROI" value={fmtPct(r.expected_roi)} valueColor={r.expected_roi != null && r.expected_roi >= 0.05 ? colors.success : colors.warning} />
              </Card>
            ))}

            {/* Q4 结论聚合 */}
            <SectionTitle>Q4 现在买还是等？</SectionTitle>
            <Card>
              <Row label="买入候选" value={`${buyCount} 个`} valueColor={colors.success} />
              <Row label="等待" value={`${radar.filter((r) => r.signal === 'wait').length} 个`} valueColor={colors.warning} />
              <Row label="不建议" value={`${radar.filter((r) => r.signal === 'avoid').length} 个`} valueColor={colors.danger} />
              <Text style={styles.note}>信号综合预测 ROI、流动性、风险与事件因子，仅作参考，不构成投资建议。</Text>
            </Card>
          </>
        ) : null}

        {/* Q5：资金模拟入口 */}
        <SectionTitle>Q5 我有 X 元，怎么分配？</SectionTitle>
        <TouchableOpacity onPress={onOpenSimulate}>
          <Card style={styles.simCard}>
            <Text style={styles.simTitle}>🎯 资金模拟与目标余额反推</Text>
            <Text style={styles.simDesc}>输入预算，自动给出稳健/平衡/激进组合；或输入目标 Steam 余额反推所需本金。</Text>
          </Card>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 14, paddingBottom: 32 },
  title: { color: colors.text, fontSize: 24, fontWeight: '800' },
  subtitle: { color: colors.textDim, fontSize: 13, marginTop: 4, marginBottom: 16 },
  itemCard: { paddingVertical: 10 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  itemName: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  tagsRow: { flexDirection: 'row', gap: 12, marginTop: 6 },
  tag: { fontSize: 12 },
  moreLink: { color: colors.primary, fontSize: 14, fontWeight: '600', textAlign: 'center', paddingVertical: 8 },
  bigText: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  empty: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  note: { color: colors.textDim, fontSize: 12, marginTop: 8, lineHeight: 17 },
  collectCard: { backgroundColor: colors.cardAlt, borderColor: colors.primary },
  collectTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  collectDesc: { color: colors.textDim, fontSize: 13, marginTop: 6, lineHeight: 18 },
  simCard: { backgroundColor: colors.cardAlt, borderColor: colors.primary },
  simTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  simDesc: { color: colors.textDim, fontSize: 13, marginTop: 6, lineHeight: 18 },
});

