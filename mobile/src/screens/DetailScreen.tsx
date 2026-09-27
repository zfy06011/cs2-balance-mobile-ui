/** 武器箱详情：预计几折为核心，价格流程 C5→7天→Steam，简单趋势 + 折叠详细数据，底部固定一键买入。 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, Prediction, Quote, HistoryPoint, C5StatsResult, C5BuyAdvice, SkinportStats } from '../api/client';
import { Card, Row, SectionTitle } from '../components/Card';
import { ErrorView, Loading } from '../components/Loading';
import { HoldingsCard } from '../components/HoldingsCard';
import { SignalBadge } from '../components/SignalBadge';
import { PriceTrendChart, ChartPoint, PredictionBand } from '../components/PriceTrendChart';
import { colors } from '../theme/colors';
import { displayNameOf, fmtMoney, fmtPct, fmtZhe } from '../utils/format';
import { runBuyFlow } from '../utils/buyFlow';
import type { HoldingsSummary, InventoryEntry } from '../core/types';
import { useOpportunitySnapshot } from '../ui/opportunity/useOpportunitySnapshot';
import { selectOpportunityCard, type OpportunityCardViewModel } from '../ui/opportunity/opportunityViewModel';
import { OpportunityCard } from '../ui/opportunity/OpportunityCard';

interface Props {
  name: string;
  onBack: () => void;
}

function conclusionOf(q: Quote | null, card: OpportunityCardViewModel | null, momentum: number | null): string {
  if (card?.decision === 'excellent') return `预计 ${card.expectedDiscountText ?? '--'}，当前属于强机会`;
  if (card?.decision === 'buy') return `预计 ${card.expectedDiscountText ?? '--'}，可以关注买入`;
  if (card?.decision === 'watch') return '当前条件适合观察，暂不把它当作确定机会';
  if (card?.decision === 'avoid') return '预计到账不足以覆盖成本，暂不适合';
  if (!q) return '加载中…';
  if (q.signal === 'buy') return `预计 ${fmtZhe(q.expected_discount)} 即可倒成 Steam 余额，当前看是划算的选择`;
  if (q.signal === 'avoid') return '预计到手可能低于投入，暂时别买，等待价格回落';
  if (q.signal === 'wait') return '折扣一般，还有更好的候选，可以再观察';
  if (momentum != null && momentum > 0.02) return '近 7 天价格总体上涨，值得关注';
  if (momentum != null && momentum < -0.02) return '近 7 天价格总体下跌，等企稳后再入手';
  return '近 7 天价格相对平稳';
}

export function DetailScreen({ name, onBack }: Props) {
  const { width: winWidth } = useWindowDimensions();
  const chartWidth = Math.max(240, Math.min(winWidth - 72, 640));
  const [quote, setQuote] = useState<Quote | null>(null);
  const [pred, setPred] = useState<Prediction | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [auxLoading, setAuxLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [c5Input, setC5Input] = useState('');
  const [c5Msg, setC5Msg] = useState<string | null>(null);
  const [refreshingOne, setRefreshingOne] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [chartRange, setChartRange] = useState<7 | 30 | 90>(30);
  const [buying, setBuying] = useState(false);
  const [c5Stats, setC5Stats] = useState<C5StatsResult | null>(null);
  const [c5StatsMsg, setC5StatsMsg] = useState<string | null>(null);
  const [c5StatsLoading, setC5StatsLoading] = useState(false);
  const [c5Advice, setC5Advice] = useState<C5BuyAdvice | null>(null);
  const [skStats, setSkStats] = useState<SkinportStats | null>(null);
  // v1.8.6：我的持仓（该箱子的买入记录汇总）+ 每分钟 tick 驱动冷却倒计时实时
  const [holdings, setHoldings] = useState<{ summary: HoldingsSummary; entries: InventoryEntry[] } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { snapshot: opportunitySnapshot, refreshLive } = useOpportunitySnapshot();
  const opportunityCard = opportunitySnapshot ? selectOpportunityCard(opportunitySnapshot, name) : null;
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // 两段式加载：核心（本地，快）先渲染；辅助（网络）到达后补图表与成交参考
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAuxLoading(true);
    // 核心：一次取齐报价 + 预测 + 我的持仓（本地 SQLite，含 60s 缓存）
    // 持仓与核心同批：首帧就位，避免加载完再插入一块导致页面往下跳（v1.8.4 教训）
    Promise.all([api.detail(name), api.holdingsOf(name).catch(() => null)])
      .then(([{ quote: q, prediction: p }, h]) => {
        if (!aliveRef.current) return;
        setQuote(q);
        setPred(p);
        setHoldings(h);
        setC5Input(q.c5_buy_price != null ? String(q.c5_buy_price) : '');
        setError(null);
      })
      .catch((e) => { if (aliveRef.current) setError(e instanceof Error ? e.message : '加载失败'); })
      .finally(() => { if (aliveRef.current) setLoading(false); });
    Promise.allSettled([
      api.history(name, 120).then((h) => { if (aliveRef.current) setHistory(h); }),
      api.c5BuyAdvice(name).then((a) => { if (aliveRef.current) setC5Advice(a); }),
      api.skinportStats(name).then((s) => { if (aliveRef.current) setSkStats(s); }),
    ]).finally(() => { if (aliveRef.current) setAuxLoading(false); });
  }, [name]);

  useEffect(() => {
    load();
  }, [load]);

  const saveC5 = async () => {
    const v = parseFloat(c5Input);
    if (!Number.isFinite(v) || v <= 0) {
      setC5Msg('请输入有效的 C5 买入价');
      return;
    }
    try {
      await api.setC5Price(name, v);
      setC5Msg(`已保存 C5 买入价 ¥${v.toFixed(2)} ✅`);
      await load();
    } catch (e) {
      setC5Msg(`保存失败：${e instanceof Error ? e.message : '未知错误'}`);
    }
  };

  const refreshOne = async () => {
    setRefreshingOne(true);
    try {
      const stats = await api.collectOne(name);
      if (stats.success > 0) {
        setC5Msg(
          stats.c5Price != null
            ? `已刷新价格 ✅（Steam + C5 ¥${stats.c5Price.toFixed(2)}）`
            : '已刷新 Steam 价格 ✅（C5 未配 app-key 或暂无价，可手动录入）',
        );
      } else {
        setC5Msg('刷新失败，请稍后重试');
      }
      await load();
      void refreshLive(stats.candidateNames);
    } catch (e) {
      setC5Msg(`刷新失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setRefreshingOne(false);
    }
  };

  const queryC5Stats = async () => {
    setC5StatsLoading(true);
    setC5StatsMsg(null);
    try {
      const st = await api.fetchC5Stats(name);
      if (!st) {
        setC5Stats(null);
        setC5StatsMsg('未配置 C5 app-key 或暂无数据，请在「我的 → 设置」填写 app-key');
        return;
      }
      setC5Stats(st);
      setC5StatsMsg(st.purchaseMaxPrice != null ? '已获取 C5 求购参考价 ✅' : '该商品暂无求购数据');
    } catch (e) {
      setC5StatsMsg(`查询失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setC5StatsLoading(false);
    }
  };

  const momentum = useMemo(() => {
    const m = pred?.features?.momentum;
    return typeof m === 'number' ? m : null;
  }, [pred]);

  // 以最近一条可用快照为终点切换走势范围，避免旧快照被误当成今天的数据。
  const chartPoints: ChartPoint[] = useMemo(() => {
    const validTimes = history.map((point) => new Date(point.fetchedAt).getTime()).filter(Number.isFinite);
    const newest = validTimes.length ? Math.max(...validTimes) : 0;
    const cutoff = newest - chartRange * 24 * 60 * 60 * 1000;
    return history.filter((point) => new Date(point.fetchedAt).getTime() >= cutoff).map((h) => ({
      date: h.fetchedAt.slice(0, 10),
      price: h.price,
      volume: h.volume ?? null,
    }));
  }, [history, chartRange]);

  const predictionBand: PredictionBand | null = useMemo(() => {
    if (!pred) return null;
    return { p25: pred.p25, p50: pred.p50, p75: pred.p75, label: '7天预测' };
  }, [pred]);

  const buyDisabled = quote?.c5_buy_price == null || buying;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.navBar}>
        <Text style={styles.back} onPress={onBack} accessibilityRole="button" accessibilityLabel="返回市场">‹ 返回</Text>
        <View style={styles.navCenter}>
          <Text style={styles.navTitle} numberOfLines={1}>{displayNameOf(name)}</Text>
          <Text style={styles.navRaw} numberOfLines={1}>MARKET DETAIL · {name}</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        {loading && !quote ? <Loading /> : null}
        {!loading && error ? <ErrorView message={error} onRetry={load} /> : null}

        {quote ? (
          <>
            {/* 我的持仓（v1.8.6：只有买过的箱子才显示；从市场点进来的未持有箱子整块不出现） */}
            {holdings ? <HoldingsCard summary={holdings.summary} entries={holdings.entries} now={now} /> : null}

            <Card style={styles.hero}>
              <View style={styles.heroHead}>
                <Text style={styles.heroEyebrow}>核心估值</Text>
                <SignalBadge signal={opportunityCard ? opportunityCard.decision === 'legacy' ? opportunityCard.legacySignal ?? 'waiting' : opportunityCard.decision === 'excellent' || opportunityCard.decision === 'buy' ? 'buy' : opportunityCard.decision === 'watch' ? 'wait' : 'avoid' : quote.signal} />
              </View>
              <Text style={styles.heroBig}>{opportunityCard?.expectedDiscountText ?? fmtZhe(quote.expected_discount)}</Text>
              <Text style={styles.heroHint}>预估折扣 · 数值越低越划算</Text>
              <Text style={styles.conclusion}>{conclusionOf(quote, opportunityCard, momentum)}</Text>
            </Card>

            {opportunityCard && opportunitySnapshot?.mode === 'v2' ? (
              <>
                <SectionTitle>余额转换结论</SectionTitle>
                <OpportunityCard card={opportunityCard} />
              </>
            ) : null}

            {/* 价格流程 C5 → Steam → 预测 → 到手 */}
            <SectionTitle>价格流程</SectionTitle>
            <Card>
              <Row label="① C5GAME 买入价" value={opportunitySnapshot?.mode === 'v2' ? opportunityCard?.c5BuyPriceText ?? '--' : fmtMoney(quote.c5_buy_price)} valueColor={colors.warning} />
              <Row label={opportunitySnapshot?.mode === 'v2' ? '② 当前 Steam 最低卖单' : '② 当前 Steam 卖价'} value={opportunityCard?.steamSellPriceText ?? fmtMoney(quote.steam_sell_price)} />
              {opportunitySnapshot?.mode === 'v2' && opportunityCard?.steamHighestBuyText ? (
                <Row label="当前 Steam 最高买单" value={opportunityCard.steamHighestBuyText} />
              ) : null}
              <Row label="7 天后预计卖价（P50）" value={fmtMoney(pred?.p50 ?? null)} valueColor={colors.info} />
              <Row label="③ Steam 预计到手（扣费后）" value={opportunitySnapshot?.mode === 'v2' ? opportunityCard?.steamNetReceiveText ?? '--' : fmtMoney(quote.steam_net_receive)} valueColor={colors.success} />
              <Row label="预计赚/亏" value={opportunitySnapshot?.mode === 'v2' ? opportunityCard?.netProfitText ?? '--' : quote.net_profit != null ? `${quote.net_profit >= 0 ? '+' : ''}${fmtMoney(quote.net_profit)}` : '--'} valueColor={colors.success} />
              <Row label="盈亏平衡卖出价" value={fmtMoney(quote.breakeven_sell_price)} valueColor={colors.warning} />
              {opportunityCard?.listingDiscountText && opportunityCard.listingDiscountText !== '--' ? (
                <Row label="理想挂单参考" value={opportunityCard.listingDiscountText} />
              ) : null}
            </Card>

            {opportunityCard && opportunitySnapshot?.mode === 'v2' ? (
              <>
                <SectionTitle>流动性与风险</SectionTitle>
                <Card>
                  <Row label="当前可执行容量" value={opportunityCard.capacityText?.replace('当前可执行容量 ', '') ?? '--'} />
                  <Row label="买卖价差" value={opportunityCard.spreadText ?? '--'} />
                  <Row label="市场状态" value={opportunityCard.marketStateText ?? '--'} />
                  {opportunityCard.warningLabels.map((warning) => <Text key={warning} style={styles.predNote}>{warning}</Text>)}
                  {opportunityCard.freshnessLabel ? <Text style={styles.predNote}>{opportunityCard.freshnessLabel}</Text> : null}
                  <Text style={styles.predNote}>当前可执行容量只描述当前 Steam 买盘深度，不代表 7 天后仍有相同流动性。</Text>
                </Card>
              </>
            ) : null}

            {/* C5 买入时机参考（近几天统计 + 较昨日变化 + 趋势） */}
            {c5Advice ? (
              <>
                <SectionTitle>C5 买入时机参考</SectionTitle>
                <Card>
                  <Row label="近 7 天均值 / 最低 / 最高" value={`${fmtMoney(c5Advice.avg7d)} / ${fmtMoney(c5Advice.min7d)} / ${fmtMoney(c5Advice.max7d)}`} />
                  {c5Advice.change1d != null ? (
                    <Row
                      label="较昨日"
                      value={`${c5Advice.change1d >= 0 ? '+' : ''}${(c5Advice.change1d * 100).toFixed(1)}%`}
                      valueColor={c5Advice.change1d <= 0 ? colors.success : colors.danger}
                    />
                  ) : null}
                  {c5Advice.percentile7d != null ? (
                    <Row label="近 7 天价格分位" value={`${c5Advice.percentile7d}%（越低越便宜）`} />
                  ) : null}
                  <Row label="近 7 天趋势" value={c5Advice.trend === 'up' ? '上行 ↗' : c5Advice.trend === 'down' ? '下行 ↘' : '平稳 →'} />
                  <Text style={[styles.hint, c5Advice.suggested === 'good' && { color: colors.success }, c5Advice.suggested === 'wait' && { color: colors.danger }]}>
                    {c5Advice.suggested === 'good' ? '✅ ' : c5Advice.suggested === 'wait' ? '⏸ ' : '• '}
                    {c5Advice.reason}
                  </Text>
                  {skStats ? (
                    <>
                      <Row
                        label="Skinport 实际成交 近7天 均价 / 最低"
                        value={`${fmtMoney(skStats.d7.avg)} / ${fmtMoney(skStats.d7.min)}`}
                        valueColor={colors.info}
                      />
                      <Row
                        label="Skinport 实际成交 近30天 均价 / 最低"
                        value={`${fmtMoney(skStats.d30.avg)} / ${fmtMoney(skStats.d30.min)}`}
                        valueColor={colors.info}
                      />
                    </>
                  ) : null}
                </Card>
              </>
            ) : null}

            {/* C5 卖出参考（求购价） */}
            <SectionTitle>C5 卖出参考（求购价）</SectionTitle>
            <Card>
              <TouchableOpacity
                style={[styles.btnGhost, c5StatsLoading && { opacity: 0.6 }]}
                onPress={queryC5Stats}
                disabled={c5StatsLoading}
              >
                <Text style={styles.btnGhostText}>
                  {c5StatsLoading ? '查询中…' : c5Stats ? '重新查询 C5 求购价' : '查询 C5 求购参考价'}
                </Text>
              </TouchableOpacity>
              {c5Stats ? (
                <>
                  <Row label="求购最高价（可秒出）" value={fmtMoney(c5Stats.purchaseMaxPrice)} valueColor={colors.success} />
                  <Row label="在售最低价" value={fmtMoney(c5Stats.sellPrice)} />
                  <Row label="在售数量" value={c5Stats.sellCount != null ? String(c5Stats.sellCount) : '--'} />
                  <Row label="求购数量" value={c5Stats.purchaseCount != null ? String(c5Stats.purchaseCount) : '--'} />
                  <Text style={styles.hint}>C5 求购价仅供参考（卖家「可秒出」的参考），与买入成本无关，不计入收益计算。</Text>
                </>
              ) : null}
              {c5StatsMsg ? <Text style={styles.c5Msg}>{c5StatsMsg}</Text> : null}
            </Card>

            {/* 价格走势（SVG 折线 + 预测扇区 + 成交量柱，参考 C5 交易详情页） */}
            <SectionTitle>价格走势</SectionTitle>
            <Card>
              <View style={styles.chartToolbar}>
                <Text style={styles.chartCaption}>截至最近快照 · 近 {chartRange} 天</Text>
                <View style={styles.chartRanges}>
                  {([7, 30, 90] as const).map((days) => (
                    <TouchableOpacity
                      key={days}
                      style={[styles.chartRange, chartRange === days && styles.chartRangeActive]}
                      onPress={() => setChartRange(days)}
                      accessibilityRole="button"
                      accessibilityLabel={`查看近 ${days} 天价格走势`}
                      accessibilityState={{ selected: chartRange === days }}
                    >
                      <Text style={[styles.chartRangeText, chartRange === days && styles.chartRangeTextActive]}>{days}天</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              {quote.data_insufficient === true ? (
                <Text style={[styles.predNote, { color: colors.warning }]}>⚠️ 历史数据不足，预测仅供参考，信号已保守处理</Text>
              ) : null}
              {/* v1.8.5 闪退修复：历史未到位时不渲染图表（原来会传空 points + 有预测，
                  拼出非法 SVG 路径导致 react-native-svg 原生解析抛异常杀进程） */}
              {chartPoints.length >= 2 ? (
                <PriceTrendChart
                  points={chartPoints}
                  prediction={predictionBand}
                  width={chartWidth}
                  height={160}
                  volumeHeight={40}
                />
              ) : (
                <Text style={styles.predNote}>
                  {auxLoading ? '正在载入走势…' : '历史数据不足，暂无法绘制走势图。去首页点一次「一键扫描」补齐历史。'}
                </Text>
              )}
            </Card>

            {/* 详细数据（折叠）——精简版 */}
            <TouchableOpacity onPress={() => setShowDetails(!showDetails)}>
              <Text style={styles.collapseToggle}>{showDetails ? '▾ 收起详细数据' : '▸ 展开详细数据'}</Text>
            </TouchableOpacity>
            {showDetails && pred ? (
              <Card>
                <Row label="7 天预测区间" value={`${fmtMoney(pred.p10)} ~ ${fmtMoney(pred.p90)}`} />
                <Row label="上涨 / 下跌可能" value={`${fmtPct(pred.prob_profit)} / ${fmtPct(pred.prob_loss)}`} />
                <Row label="价格稳定程度" value={typeof pred.features.volatility === 'number' ? fmtPct(pred.features.volatility, 2) : '--'} />
                <Row label="近 24h 成交量" value={quote.steam_volume != null ? String(quote.steam_volume) : '--'} />
                <Row label="Steam 热门排名" value={quote.popular_rank != null ? `#${quote.popular_rank}` : '--'} />
              </Card>
            ) : null}

            {/* 数据维护 */}
            <SectionTitle>数据维护</SectionTitle>
            <Card>
              <Text style={styles.hint}>未配置 C5 app-key 时可手动录入买入价；Steam 价格可实时刷新。所有数据仅存手机本地。</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={c5Input}
                  onChangeText={setC5Input}
                  placeholder="C5 买入价 ¥（选填）"
                  placeholderTextColor={colors.textDim}
                  keyboardType="decimal-pad"
                />
                <TouchableOpacity style={styles.smallBtn} onPress={saveC5}>
                  <Text style={styles.smallBtnText}>保存</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[styles.btnGhost, refreshingOne && { opacity: 0.6 }]}
                onPress={refreshOne}
                disabled={refreshingOne}
              >
                <Text style={styles.btnGhostText}>{refreshingOne ? '刷新中…' : '⟳ 刷新价格（Steam + C5）'}</Text>
              </TouchableOpacity>
              {c5Msg ? <Text style={styles.c5Msg}>{c5Msg}</Text> : null}
            </Card>

            <Text style={styles.disclaimer}>
              数据来源：Steam Community Market / C5GAME 快照。预测为统计模型输出，仅供参考，不构成投资建议。系统不自动买卖。
            </Text>
          </>
        ) : null}
      </ScrollView>

      {/* 底部固定一键买入 */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.buyBtn, buyDisabled && { opacity: 0.5 }]}
          disabled={buyDisabled}
          onPress={async () => {
            setBuying(true);
            await runBuyFlow({ name, onDone: () => setBuying(false) });
            load();
          }}
        >
          <Text style={styles.buyBtnText}>
            {buying ? '处理中…' : quote?.c5_buy_price == null ? '暂无买入价' : `一键买入 · ${fmtZhe(quote.expected_discount)}`}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 8, minHeight: 56,
  },
  back: { color: colors.primary, fontSize: 14, fontWeight: '700', width: 64, minHeight: 48, textAlignVertical: 'center' },
  navCenter: { flex: 1, alignItems: 'center' },
  navTitle: { color: colors.text, fontSize: 16, fontWeight: '800', maxWidth: '100%' },
  navRaw: { color: colors.textDim, fontSize: 9, marginTop: 3, maxWidth: '100%', letterSpacing: 0.8 },
  content: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 110 },
  hero: { backgroundColor: colors.card, borderColor: colors.borderStrong, padding: 20 },
  heroHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 },
  heroEyebrow: { color: colors.textDim, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  heroBig: { color: colors.primary, fontSize: 58, lineHeight: 66, fontWeight: '800', marginTop: 8, fontVariant: ['tabular-nums'], letterSpacing: -1.4 },
  heroHint: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  conclusion: { color: colors.text, fontSize: 14, marginTop: 10, lineHeight: 20 },
  predNote: { color: colors.textDim, fontSize: 12, marginTop: 8, lineHeight: 17 },
  chartToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  chartCaption: { color: colors.textDim, fontSize: 11, flexShrink: 1 },
  chartRanges: { flexDirection: 'row', padding: 3, borderRadius: 12, backgroundColor: colors.surfaceRaised },
  chartRange: { minWidth: 42, minHeight: 40, borderRadius: 9, justifyContent: 'center', alignItems: 'center' },
  chartRangeActive: { backgroundColor: colors.card },
  chartRangeText: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
  chartRangeTextActive: { color: colors.primaryText, fontWeight: '800' },
  collapseToggle: { color: colors.primary, fontSize: 14, fontWeight: '600', textAlign: 'center', paddingVertical: 10, minHeight: 48 },
  hint: { color: colors.textDim, fontSize: 12, marginBottom: 10, lineHeight: 17 },
  inputRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  input: {
    backgroundColor: colors.surfaceInset, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    color: colors.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
  },
  smallBtn: {
    backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  smallBtnText: { color: colors.onPrimary, fontSize: 13, fontWeight: '700' },
  btnGhost: {
    backgroundColor: colors.card, borderRadius: 12, paddingVertical: 11, alignItems: 'center', minHeight: 48,
    borderWidth: 1, borderColor: colors.primaryBorder,
  },
  btnGhostText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  c5Msg: { color: colors.info, fontSize: 12, marginTop: 10 },
  disclaimer: { color: colors.textDim, fontSize: 11, marginTop: 12, lineHeight: 16 },
  bottomBar: {
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border,
  },
  buyBtn: { minHeight: 48, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  buyBtnText: { color: colors.onPrimary, fontSize: 16, fontWeight: '700' },
});
