/**
 * 库存管理：本地库存、C5 同步入口、解锁倒计时、卖出建议（PRD 第十节）。
 *
 * v1.8.6 精简 + 修复：
 * - 卡片从 8 行压到 4 行；顶部 2×2 总览（总投入/当前估值/浮动盈亏/可上架）
 * - 加「全部 / 冷却中 / 可上架」筛选（参考 C5GAME 库存页）
 * - 整张卡片可点 → 进详情页看该箱子的持仓与行情
 * - 修 Bug1：倒计时用 unlock_at − now 现算 + 每分钟 tick（原来被 analysisCache 冻住）
 * - 修 Bug1：进页时距上次同步 >10 分钟且已配置 → 静默自动同步
 * - 修 Bug2：同步时自动移除已不在 Steam 库存的箱子（engine 层处理）
 * - 手动录入表单默认折叠
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList, KeyboardAvoidingView, Platform, RefreshControl, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, InventoryEntry } from '../api/client';
import { Card, SectionTitle } from '../components/Card';
import { ErrorView, Loading } from '../components/Loading';
import { colors } from '../theme/colors';
import { displayNameOf } from '../utils/format';
import {
  summarizeHoldings, summarizePortfolio, cooldownProgress, fmtRemainHours, fmtAgo,
  type PortfolioOverview,
} from '../core/holdings';
import type { HoldingsSummary } from '../core/types';

/** 距上次同步超过该时长 → 进页自动静默同步 */
const AUTO_SYNC_AFTER_MS = 10 * 60 * 1000;
/** 倒计时刷新间隔 */
const TICK_MS = 60 * 1000;

interface Props {
  onOpenDetail: (name: string) => void;
}

function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined) return '--';
  return `¥${v.toFixed(2)}`;
}

type FilterKey = 'all' | 'cooling' | 'tradable';

/** 同种武器箱堆叠成一条 */
interface Stack {
  name: string;
  entries: InventoryEntry[];
  summary: HoldingsSummary;
}

export function InventoryScreen({ onOpenDetail }: Props) {
  // v1.8.2 切页提速：命中缓存则同步初始化
  const warm = api.peekInventory();
  const [items, setItems] = useState<InventoryEntry[]>(warm ?? []);
  const [loading, setLoading] = useState(warm == null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [showForm, setShowForm] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const autoSyncTried = useRef(false);

  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // 倒计时实时：每分钟 tick 一次（unlock_at 固定，剩余时间现算）
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api.inventory();
      setItems(data);
      setError(null);
      // 上次同步时间 = 所有记录里最新的 steam_synced_at
      let latest: string | null = null;
      for (const e of data) {
        const t = e.steam_synced_at ?? null;
        if (t && (!latest || t > latest)) latest = t;
      }
      setLastSync(latest);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** 唯一同步入口：C5 OpenAPI（app-key）。silent=true 时不显示「同步中」、不弹错误 */
  const syncSmart = useCallback(async (silent = false) => {
    if (!silent) setSyncing(true);
    if (!silent) setSyncMsg(null);
    try {
      const res = await api.syncSteamInventorySmart();
      setLastSync(res.at);
      const src = '来源：C5 OpenAPI（官方）';
      if (res.empty) {
        if (!silent) {
          setSyncMsg(`同步完成但未找到武器箱（总量 ${res.totalInventoryCount ?? 0}）${res.reason ?? ''}（${src}）`);
        }
        return;
      }
      if (!silent) {
        const removedPart = res.removed > 0 ? `，已移除 ${res.removed} 件（已不在 Steam 库存）` : '';
        setSyncMsg(
          `同步完成：本地匹配 ${res.matched} 件（可上架 ${res.unlocked} 件），新导入 ${res.imported} 件，未找到 ${res.notFound} 件${removedPart}（${src}）`,
        );
      }
      await load();
    } catch (e) {
      // 静默模式（进页自动同步）不打扰用户；手动模式才提示
      if (!silent) setSyncMsg(`同步失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      if (!silent) setSyncing(false);
    }
  }, [load]);

  // 进页自动静默同步：距上次同步 >10 分钟且已配置 C5 app-key + SteamID64（每进程只自动试一次）
  useEffect(() => {
    if (autoSyncTried.current) return;
    autoSyncTried.current = true;
    (async () => {
      try {
        const s = await api.getSettings();
        if (!(s.c5AppKey || '').trim() || !(s.steamId || '').trim()) return;
        const inv = await api.inventory();
        let latest: string | null = null;
        for (const e of inv) {
          const t = e.steam_synced_at ?? null;
          if (t && (!latest || t > latest)) latest = t;
        }
        const stale = !latest || Date.now() - new Date(latest).getTime() > AUTO_SYNC_AFTER_MS;
        if (stale) await syncSmart(true);
      } catch {
        // 自动同步失败静默，不打扰用户
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 按箱子分组 + 汇总（now 变化时重算，倒计时实时）
  const stacks = useMemo<Stack[]>(() => {
    const map = new Map<string, InventoryEntry[]>();
    for (const it of items) {
      const arr = map.get(it.item_name) ?? [];
      arr.push(it);
      map.set(it.item_name, arr);
    }
    const out: Stack[] = [];
    for (const [name, entries] of map) {
      entries.sort((a, b) => a.unlock_at.localeCompare(b.unlock_at));
      const summary = summarizeHoldings(entries, now);
      if (summary) out.push({ name, entries, summary });
    }
    out.sort((a, b) => a.summary.earliestUnlockAt.localeCompare(b.summary.earliestUnlockAt));
    return out;
  }, [items, now]);

  const overview: PortfolioOverview = useMemo(
    () => summarizePortfolio(stacks.map((s) => s.summary)),
    [stacks],
  );

  const shown = useMemo(() => {
    if (filter === 'all') return stacks;
    if (filter === 'tradable') return stacks.filter((s) => s.summary.allTradable);
    return stacks.filter((s) => !s.summary.allTradable);
  }, [stacks, filter]);

  const add = async () => {
    if (!name.trim() || !qty.trim() || !price.trim()) return;
    setSaving(true);
    setSavedMsg(null);
    try {
      const res = await api.addInventory({
        item_name: name.trim(),
        quantity: parseInt(qty, 10) || 1,
        buy_price: parseFloat(price),
      });
      setSavedMsg(`已添加，预计 ${new Date(res.unlock_at).toLocaleString()} 解锁（${res.days} 天）`);
      setName(''); setQty('1'); setPrice('');
      await load();
    } catch (e) {
      setSavedMsg(`添加失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Text style={styles.header}>库存与解锁倒计时</Text>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={shown}
          keyExtractor={(g) => g.name}
          renderItem={({ item: g }) => <InventoryRow g={g} now={now} onOpenDetail={onOpenDetail} />}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); syncSmart(true); }} />
          }
          // v1.8.3 切页提速：只渲染可见行
          // v1.8.4：不加 removeClippedSubviews（Android 会脱离屏外子视图导致首帧内容上跳）
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={10}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <InventoryHeader
              overview={overview}
              lastSync={lastSync}
              now={now}
              filter={filter}
              setFilter={setFilter}
              counts={{ all: stacks.length, cooling: overview.coolingKinds, tradable: overview.tradableKinds }}
              showForm={showForm}
              setShowForm={setShowForm}
              name={name} setName={setName}
              qty={qty} setQty={setQty}
              price={price} setPrice={setPrice}
              saving={saving} savedMsg={savedMsg} add={add}
              syncing={syncing} syncMsg={syncMsg} syncSmart={() => syncSmart(false)}
            />
          }
          ListEmptyComponent={
            loading ? <Loading height={160} /> : error ? <ErrorView message={error} onRetry={load} /> : (
              <Card>
                <Text style={styles.empty}>
                  {items.length === 0 ? '还没有库存记录。用上方「同步库存」从 C5 拉取，或手动录入。' : '当前筛选下没有箱子。'}
                </Text>
              </Card>
            )
          }
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

interface HeaderProps {
  overview: PortfolioOverview;
  lastSync: string | null;
  now: number;
  filter: FilterKey;
  setFilter: (f: FilterKey) => void;
  counts: { all: number; cooling: number; tradable: number };
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  name: string; setName: (v: string) => void;
  qty: string; setQty: (v: string) => void;
  price: string; setPrice: (v: string) => void;
  saving: boolean; savedMsg: string | null; add: () => void;
  syncing: boolean; syncMsg: string | null; syncSmart: () => void;
}

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'cooling', label: '冷却中' },
  { key: 'tradable', label: '可上架' },
];

/** 列表头部：总览 + 筛选 + 同步/录入入口（与库存行分离） */
function InventoryHeader(p: HeaderProps) {
  const profitColor = p.overview.netProfit >= 0 ? colors.success : colors.danger;
  return (
    <>
      {/* 2×2 总览 */}
      <View style={styles.overviewGrid}>
        <Stat label="总投入" value={fmtMoney(p.overview.totalCost)} />
        <Stat label="当前估值" value={fmtMoney(p.overview.currentValue)} valueColor={colors.info} />
        <Stat
          label="浮动盈亏"
          value={`${p.overview.netProfit >= 0 ? '+' : ''}${fmtMoney(p.overview.netProfit)}`}
          valueColor={profitColor}
          sub={p.overview.roi != null ? `${p.overview.netProfit >= 0 ? '+' : ''}${(p.overview.roi * 100).toFixed(1)}%` : undefined}
        />
        <Stat label="可上架" value={`${p.overview.tradableKinds} 种`} sub={`共 ${p.overview.quantity} 件`} />
      </View>

      <Text style={styles.syncMeta}>上次同步：{fmtAgo(p.lastSync, p.now)}</Text>

      {/* 同步入口 */}
      <Card>
        <SectionTitle>同步库存（C5 OpenAPI）</SectionTitle>
        <Text style={styles.hint}>
          库存走 C5GAME 官方接口（app-key）：需在设置页配置 app-key 与 SteamID64。同步后自动导入武器箱、更新冷却倒计时，并移除已不在 Steam 库存的箱子。
        </Text>
        <TouchableOpacity style={[styles.addBtn, p.syncing && { opacity: 0.6 }]} onPress={p.syncSmart} disabled={p.syncing}>
          <Text style={styles.addBtnText}>{p.syncing ? '同步中…' : '⟳ 同步库存'}</Text>
        </TouchableOpacity>
        {p.syncMsg ? <Text style={styles.saved}>{p.syncMsg}</Text> : null}
      </Card>

      {/* 筛选 */}
      <View style={styles.tabs}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.tab, p.filter === f.key && styles.tabActive]}
            onPress={() => p.setFilter(f.key)}
          >
            <Text style={[styles.tabText, p.filter === f.key && styles.tabTextActive]}>
              {f.label} {p.counts[f.key]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <SectionTitle>我的库存（{p.counts.all} 种）</SectionTitle>

      {/* 手动录入（默认折叠） */}
      <TouchableOpacity onPress={() => p.setShowForm(!p.showForm)}>
        <Text style={styles.collapseToggle}>{p.showForm ? '▾ 收起手动录入' : '▸ 手动录入购买记录'}</Text>
      </TouchableOpacity>
      {p.showForm ? (
        <Card>
          <TextInput style={styles.input} placeholder="武器箱名称（如：狂牙武器箱）" placeholderTextColor={colors.textDim} value={p.name} onChangeText={p.setName} />
          <View style={styles.inputRow}>
            <TextInput style={[styles.input, styles.inputHalf]} placeholder="数量" placeholderTextColor={colors.textDim} value={p.qty} onChangeText={p.setQty} keyboardType="numeric" />
            <TextInput style={[styles.input, styles.inputHalf]} placeholder="买入价 ¥" placeholderTextColor={colors.textDim} value={p.price} onChangeText={p.setPrice} keyboardType="decimal-pad" />
          </View>
          <TouchableOpacity style={[styles.addBtn, p.saving && { opacity: 0.6 }]} onPress={p.add} disabled={p.saving}>
            <Text style={styles.addBtnText}>{p.saving ? '保存中…' : '＋ 录入库存'}</Text>
          </TouchableOpacity>
          {p.savedMsg ? <Text style={styles.saved}>{p.savedMsg}</Text> : null}
        </Card>
      ) : null}
    </>
  );
}

/** 总览小卡片 */
function Stat({ label, value, valueColor, sub }: { label: string; value: string; valueColor?: string; sub?: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, valueColor ? { color: valueColor } : null]} numberOfLines={1}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

/** 单行（React.memo：滚动时不重复渲染未变化的行）。整卡可点 → 进详情页 */
const InventoryRow = React.memo(function InventoryRow({
  g, now, onOpenDetail,
}: {
  g: Stack;
  now: number;
  onOpenDetail: (name: string) => void;
}) {
  const s = g.summary;
  const progress = cooldownProgress(g.entries, now);
  const profitColor = s.netProfit == null ? colors.textDim : s.netProfit >= 0 ? colors.success : colors.danger;
  const profitText =
    s.netProfit == null
      ? '暂无行情'
      : `${s.netProfit >= 0 ? '+' : ''}${fmtMoney(s.netProfit)}${s.roi != null ? ` (${s.netProfit >= 0 ? '+' : ''}${(s.roi * 100).toFixed(1)}%)` : ''}`;

  return (
    <TouchableOpacity onPress={() => onOpenDetail(g.name)}>
      <Card>
        <View style={styles.itemHeader}>
          <Text style={styles.name} numberOfLines={1}>{displayNameOf(g.name)}</Text>
          <View style={[styles.badge, s.allTradable ? styles.badgeOk : styles.badgeCool]}>
            <Text style={[styles.badgeText, s.allTradable ? styles.badgeTextOk : styles.badgeTextCool]}>
              {s.allTradable ? '可上架' : '冷却中'}
            </Text>
          </View>
        </View>

        <Text style={styles.stackMeta}>× {s.quantity} 件 · {s.records} 笔记录</Text>

        <View style={styles.progressRow}>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.round(progress * 100)}%` },
                s.allTradable && { backgroundColor: colors.success },
              ]}
            />
          </View>
          <Text style={[styles.remain, s.allTradable && { color: colors.success }]}>
            {s.allTradable ? '可上架' : `还有 ${fmtRemainHours(s.hoursLeft)}`}
          </Text>
        </View>

        <View style={styles.priceRow}>
          <Text style={styles.priceLabel}>均价 {fmtMoney(s.avgBuyPrice)}</Text>
          <Text style={styles.priceArrow}>→</Text>
          <Text style={styles.priceNow}>当前 {s.currentValue != null ? fmtMoney(s.currentValue / Math.max(1, s.quantity)) : '--'}</Text>
          <Text style={[styles.profit, { color: profitColor }]} numberOfLines={1}>{profitText}</Text>
        </View>
      </Card>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { color: colors.text, fontSize: 22, fontWeight: '800', paddingHorizontal: 14, paddingTop: 8, paddingBottom: 8 },
  content: { padding: 14, paddingBottom: 40 },

  overviewGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  statCard: {
    flexGrow: 1, flexBasis: '47%', backgroundColor: colors.card, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: colors.border,
  },
  statLabel: { color: colors.textDim, fontSize: 12 },
  statValue: { color: colors.text, fontSize: 19, fontWeight: '800', marginTop: 4, fontVariant: ['tabular-nums'] },
  statSub: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  syncMeta: { color: colors.textDim, fontSize: 11, marginBottom: 10, textAlign: 'right' },

  tabs: { flexDirection: 'row', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  tab: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#FFFFFF' },

  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  name: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1 },
  badgeOk: { borderColor: colors.success },
  badgeCool: { borderColor: colors.gold },
  badgeText: { fontSize: 11, fontWeight: '800' },
  badgeTextOk: { color: colors.success },
  badgeTextCool: { color: colors.gold },

  stackMeta: { color: colors.textDim, fontSize: 12, marginBottom: 8 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  progressTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.gold },
  remain: { color: colors.gold, fontSize: 12, fontWeight: '700' },

  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  priceLabel: { color: colors.textDim, fontSize: 13 },
  priceArrow: { color: colors.textDim, fontSize: 12 },
  priceNow: { color: colors.text, fontSize: 13, fontWeight: '600' },
  profit: { fontSize: 13, fontWeight: '700', marginLeft: 'auto', flexShrink: 1 },

  input: {
    backgroundColor: colors.cardAlt, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    color: colors.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 10,
  },
  inputRow: { flexDirection: 'row', gap: 10 },
  inputHalf: { flex: 1 },
  addBtn: {
    backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 2,
  },
  addBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  saved: { color: colors.info, fontSize: 12, marginTop: 8 },
  collapseToggle: { color: colors.primary, fontSize: 14, fontWeight: '600', paddingVertical: 8 },
  hint: { color: colors.textDim, fontSize: 12, marginBottom: 10, lineHeight: 17 },
  empty: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
});
