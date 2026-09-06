/** 武器箱详情：预计几折为核心，价格流程 C5→7天→Steam，简单趋势 + 折叠详细数据，底部固定一键买入。 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, Prediction, Quote, HistoryPoint, C5StatsResult, C5BuyAdvice, SkinportStats } from '../api/client';
import { Card, Row, SectionTitle } from '../components/Card';
import { ErrorView, Loading } from '../components/Loading';
import { SignalBadge } from '../components/SignalBadge';
import { colors } from '../theme/colors';
import { displayNameOf, fmtMoney, fmtPct, fmtZhe, SIGNAL_TEXT } from '../utils/format';
import { runBuyFlow } from '../utils/buyFlow';

interface Props {
  name: string;
  onBack: () => void;
}

function conclusionOf(q: Quote | null, momentum: number | null): string {
  if (!q) return '加载中…';
  if (q.signal === 'buy') return `预计 ${fmtZhe(q.expected_discount)} 即可倒成 Steam 余额，当前看是划算的选择`;
  if (q.signal === 'avoid') return '预计到手可能低于投入，暂时别买，等待价格回落';
  if (q.signal === 'wait') return '折扣一般，还有更好的候选，可以再观察';
  if (momentum != null && momentum > 0.02) return '近 7 天价格总体上涨，值得关注';
  if (momentum != null && momentum < -0.02) return '近 7 天价格总体下跌，等企稳后再入手';
  return '近 7 天价格相对平稳';
}

export function DetailScreen({ name, onBack }: Props) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [pred, setPred] = useState<Prediction | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [c5Input, setC5Input] = useState('');
  const [c5Msg, setC5Msg] = useState<string | null>(null);
  const [refreshingOne, setRefreshingOne] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [buying, setBuying] = useState(false);
  const [c5Stats, setC5Stats] = useState<C5StatsResult | null>(null);
  const [c5StatsMsg, setC5StatsMsg] = useState<string | null>(null);
  const [c5StatsLoading, setC5StatsLoading] = useState(false);
  const [c5Advice, setC5Advice] = useState<C5BuyAdvice | null>(null);
  const [skStats, setSkStats] = useState<SkinportStats | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [q, p, h, adv, sk] = await Promise.all([
        api.quote(name),
        api.prediction(name),
        api.history(name, 7),
        api.c5BuyAdvice(name).catch(() => null),
        api.skinportStats(name).catch(() => null),
      ]);
      setQuote(q);
      setPred(p);
      setHistory(h);
      setC5Advice(adv);
      setSkStats(sk);
      setC5Input(q.c5_buy_price != null ? String(q.c5_buy_price) : '');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
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

  // 简单 7 天趋势：历史真实柱（实心）+ 未来预测区间（描边），明显区分
  const trend = useMemo(() => {
    const hs = history.map((h) => h.price);
    const max = Math.max(...hs, pred?.p90 ?? 0, 0.01);
    const bars = hs.slice(-7).map((p, i) => ({ price: p, h: Math.max(6, (p / max) * 60) }));
    return {
      bars,
      max,
      p25: pred?.p25 ?? null,
      p50: pred?.p50 ?? null,
      p75: pred?.p75 ?? null,
    };
  }, [history, pred]);

  const buyDisabled = quote?.c5_buy_price == null || buying;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.navBar}>
        <Text style={styles.back} onPress={onBack}>‹ 返回</Text>
        <View style={styles.navCenter}>
          <Text style={styles.navTitle} numberOfLines={1}>{displayNameOf(name)}</Text>
          <Text style={styles.navRaw} numberOfLines={1}>{name}</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        {loading ? <Loading /> : null}
        {!loading && error ? <ErrorView message={error} onRetry={load} /> : null}

        {quote ? (
          <>
            <Card style={styles.hero}>
              <View style={styles.heroHead}>
                <Text style={styles.heroName} numberOfLines={1}>{displayNameOf(name)}</Text>
                <SignalBadge signal={quote.signal} />
              </View>
              <Text style={styles.heroBig}>{fmtZhe(quote.expected_discount)}</Text>
              <Text style={styles.heroHint}>预计几折余额 · 越低越划算</Text>
              <Text style={styles.conclusion}>{conclusionOf(quote, momentum)}</Text>
            </Card>

            {/* 价格流程 C5 → 7 天 → Steam */}
            <SectionTitle>价格流程</SectionTitle>
            <Card>
              <Row label="① C5GAME 买入价" value={fmtMoney(quote.c5_buy_price)} valueColor={colors.warning} />
              <Row label="C5 买入费用（1%）" value={quote.c5_buy_price != null ? fmtMoney(quote.c5_buy_price * quote.c5_fee_ratio) : '--'} />
              <Row label="实际总成本" value={quote.c5_buy_price != null ? fmtMoney(quote.c5_buy_price * (1 + quote.c5_fee_ratio)) : '--'} />
              <Row label="② 当前 Steam 卖价" value={fmtMoney(quote.steam_sell_price)} />
              <Row label="7 天后预计卖价（P50）" value={fmtMoney(pred?.p50 ?? null)} valueColor={colors.info} />
              <Row label="③ Steam 预计到手（扣费后）" value={fmtMoney(quote.steam_net_receive)} valueColor={colors.success} />
              <Row label="预计赚/亏" value={quote.net_profit != null ? `${quote.net_profit >= 0 ? '+' : ''}${fmtMoney(quote.net_profit)}` : '--'} valueColor={quote.net_profit != null && quote.net_profit >= 0 ? colors.success : colors.danger} />
              <Row label="盈亏平衡卖出价" value={fmtMoney(quote.breakeven_sell_price)} valueColor={colors.warning} />
              <Row label="限制期" value={`约 ${quote.lock_days} 天（168 小时）`} />
            </Card>


            {/* C5 买入时机参考（近几天统计 + 较昨日变化 + 事件影响 + 趋势） */}
            {c5Advice ? (
              <>
                <SectionTitle>C5 买入时机参考</SectionTitle>
                <Card>
                  <Row label="当前 C5 价" value={fmtMoney(c5Advice.now)} valueColor={colors.warning} />
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
                  {pred?.features?.event_names ? (
                    <Row
                      label="活动影响"
                      value={String(pred.features.event_names)}
                      valueColor={colors.info}
                    />
                  ) : null}
                  <Text style={[styles.hint, c5Advice.suggested === 'good' && { color: colors.success }, c5Advice.suggested === 'wait' && { color: colors.danger }]}>
                    {c5Advice.suggested === 'good' ? '✅ ' : c5Advice.suggested === 'wait' ? '⏸ ' : '• '}
                    {c5Advice.reason}
                  </Text>
                  {c5Advice.suggested === 'good' ? (
                    <Text style={styles.hint}>未来 7 天 Steam 侧预计 {fmtMoney(pred?.p50 ?? null)}（{c5Advice.trend === 'down' ? 'C5 短线仍在走低，可分批买' : '当前价位买入的预计几折见顶部'}）。</Text>
                  ) : null}
                  {skStats ? (
                    <>
                      <Row
                        label="实际成交 近7天 均价 / 最低"
                        value={`${fmtMoney(skStats.d7.avg)} / ${fmtMoney(skStats.d7.min)}`}
                        valueColor={colors.info}
                      />
                      <Row
                        label="实际成交 近30天 均价 / 最低"
                        value={`${fmtMoney(skStats.d30.avg)} / ${fmtMoney(skStats.d30.min)}`}
                        valueColor={colors.info}
                      />
                      <Row
                        label="实际成交 近90天 均价 / 成交量"
                        value={`${fmtMoney(skStats.d90.avg)} / ${skStats.d90.volume != null ? skStats.d90.volume : '--'}`}
                        valueColor={colors.info}
                      />
                      <Text style={styles.hint}>「实际成交」来自 Skinport 公开成交数据（免 Key 免登录），反映真实买家成交价，与 C5 挂牌价对照可判断当前挂牌偏贵还是便宜。</Text>
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

            {/* 简单 7 天趋势 */}

            <SectionTitle>7 天趋势（历史 vs 预测）</SectionTitle>
            <Card>
              <View style={styles.legendRow}>
                <Text style={[styles.legend, { color: colors.primary }]}>■ 历史真实</Text>
                <Text style={[styles.legend, { color: colors.gold }]}>▨ 未来预测区</Text>
              </View>
              {quote.data_insufficient === true ? (
                <Text style={[styles.predNote, { color: colors.warning }]}>⚠️ 历史数据不足（少于 4 次采集），预测仅供参考，信号已保守处理</Text>
              ) : null}
              <View style={styles.chart}>
                <View style={styles.histArea}>
                  {trend.bars.map((b, i) => (
                    <View key={i} style={styles.histCol}>
                      <View style={[styles.histBar, { height: b.h, backgroundColor: colors.primary }]} />
                      <Text style={styles.barVal} numberOfLines={1}>{b.price.toFixed(1)}</Text>
                    </View>
                  ))}
                </View>
                <View style={styles.predArea}>
                  {trend.p25 != null && trend.p75 != null ? (
                    <>
                      <View style={styles.predLabelRow}>
                        <Text style={styles.predLabel}>预测区间</Text>
                        <Text style={styles.predLabelVal}>{fmtMoney(trend.p25)} ~ {fmtMoney(trend.p75)}</Text>
                      </View>
                      <View style={styles.predTrack}>
                        <View
                          style={[styles.predRange, {
                            left: `${Math.max(0, (trend.p25 / trend.max) * 100)}%`,
                            width: `${Math.max(4, ((trend.p75 - trend.p25) / trend.max) * 100)}%`,
                          }]}
                        >
                          <View style={[styles.predMid, { left: `${((trend.p50 ?? 0) - trend.p25) / Math.max(0.01, trend.p75 - trend.p25) * 100}%` }]} />
                        </View>
                      </View>
                      <Text style={styles.predNote}>P50 预计 {fmtMoney(trend.p50)} · 上涨可能 {fmtPct(pred?.prob_profit ?? null)}</Text>
                    </>
                  ) : (
                    <Text style={styles.predNote}>历史不足，暂无预测区间</Text>
                  )}
                </View>
              </View>
            </Card>

            {/* 详细数据（折叠） */}
            <TouchableOpacity onPress={() => setShowDetails(!showDetails)}>
              <Text style={styles.collapseToggle}>{showDetails ? '▾ 收起详细数据' : '▸ 展开详细数据'}</Text>
            </TouchableOpacity>
            {showDetails && pred ? (
              <Card>
                <Row label="7 天预测区间" value={`${fmtMoney(pred.p10)} ~ ${fmtMoney(pred.p90)}`} />
                <Row label="P10 / P25 / P50" value={`${fmtMoney(pred.p10)} / ${fmtMoney(pred.p25)} / ${fmtMoney(pred.p50)}`} />
                <Row label="P75 / P90" value={`${fmtMoney(pred.p75)} / ${fmtMoney(pred.p90)}`} />
                <Row label="上涨 / 下跌可能" value={`${fmtPct(pred.prob_profit)} / ${fmtPct(pred.prob_loss)}`} />
                <Row label="模型置信度" value={fmtPct(pred.confidence)} />
                <Row label="模型版本" value={pred.model_version} />
                <Row label="价格稳定程度" value={typeof pred.features.volatility === 'number' ? fmtPct(pred.features.volatility, 2) : '--'} />
                <Row label="近 24h 成交量" value={quote.steam_volume != null ? String(quote.steam_volume) : '--'} />
                <Row label="Steam 热门排名" value={quote.popular_rank != null ? `#${quote.popular_rank}` : '--'} />
                <Row label="预计可卖时点" value={new Date(pred.target_at).toLocaleString()} />
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
            {buying ? '处理中…' : quote?.c5_buy_price == null ? '暂无买入价' : `🛒 一键买入 · ${fmtZhe(quote.expected_discount)}`}
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
    paddingHorizontal: 14, paddingVertical: 8,
  },
  back: { color: colors.primary, fontSize: 15, fontWeight: '600', width: 60 },
  navCenter: { flex: 1, alignItems: 'center' },
  navTitle: { color: colors.text, fontSize: 16, fontWeight: '800', maxWidth: '100%' },
  navRaw: { color: colors.textDim, fontSize: 10, marginTop: 2, maxWidth: '100%' },
  content: { padding: 14, paddingBottom: 100 },
  hero: { backgroundColor: colors.cardAlt, borderColor: colors.primary, padding: 18 },
  heroHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  heroName: { color: colors.text, fontSize: 16, fontWeight: '800', flex: 1 },
  heroBig: { color: colors.text, fontSize: 56, fontWeight: '900', marginTop: 8, fontVariant: ['tabular-nums'] },
  heroHint: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  conclusion: { color: colors.text, fontSize: 14, marginTop: 10, lineHeight: 20 },
  legendRow: { flexDirection: 'row', gap: 16, marginBottom: 8 },
  legend: { fontSize: 12, fontWeight: '600' },
  chart: { marginTop: 4 },
  histArea: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 84, gap: 4 },
  histCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  histBar: { width: '70%', borderRadius: 4, minHeight: 4 },
  barVal: { color: colors.textDim, fontSize: 9, marginTop: 3 },
  predArea: { marginTop: 14, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  predLabelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  predLabel: { color: colors.gold, fontSize: 12, fontWeight: '700' },
  predLabelVal: { color: colors.text, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  predTrack: { height: 18, backgroundColor: colors.card, borderRadius: 9, marginTop: 8, position: 'relative' },
  predRange: {
    position: 'absolute', top: 2, bottom: 2, borderRadius: 8,
    borderWidth: 1, borderColor: colors.gold, backgroundColor: colors.gold + '18',
  },
  predMid: { position: 'absolute', top: 0, bottom: 0, width: 3, backgroundColor: colors.gold },
  predNote: { color: colors.textDim, fontSize: 12, marginTop: 8, lineHeight: 17 },
  collapseToggle: { color: colors.primary, fontSize: 14, fontWeight: '600', textAlign: 'center', paddingVertical: 8 },
  hint: { color: colors.textDim, fontSize: 12, marginBottom: 10, lineHeight: 17 },
  inputRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  input: {
    backgroundColor: colors.cardAlt, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    color: colors.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
  },
  smallBtn: {
    backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  smallBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  btnGhost: {
    backgroundColor: colors.cardAlt, borderRadius: 10, paddingVertical: 11, alignItems: 'center',
    borderWidth: 1, borderColor: colors.primary,
  },
  btnGhostText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  c5Msg: { color: colors.info, fontSize: 12, marginTop: 10 },
  disclaimer: { color: colors.textDim, fontSize: 11, marginTop: 12, lineHeight: 16 },
  bottomBar: {
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border,
  },
  buyBtn: { backgroundColor: colors.success, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  buyBtnText: { color: '#06210F', fontSize: 16, fontWeight: '800' },
});
