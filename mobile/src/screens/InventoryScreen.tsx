/** 库存管理：录入购买记录、7 天倒计时、当前/解除限制时估值（PRD 第十节） */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, InventoryEntry } from '../api/client';
import { Card, Row, SectionTitle } from '../components/Card';
import { ErrorView, Loading } from '../components/Loading';
import { colors } from '../theme/colors';
import { displayNameOf } from '../utils/format';

function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined) return '--';
  return `¥${v.toFixed(2)}`;
}

/** 小时级剩余：>=24h 显示「x 天 y 小时」，<24h 显示「x 小时」，<=0 显示可上架 */
function fmtRemainHours(h: number): string {
  if (h <= 0) return '可上架';
  const total = Math.ceil(h);
  if (total < 24) return `${total} 小时`;
  const d = Math.floor(total / 24);
  const hh = total % 24;
  return hh > 0 ? `${d} 天 ${hh} 小时` : `${d} 天`;
}

export function InventoryScreen() {
  const [items, setItems] = useState<InventoryEntry[]>([]);

  // 同名武器箱堆叠：合并数量/成本/利润，按最早解锁排序
  interface Stack {
    name: string;
    totalQty: number;
    records: number;
    totalCost: number;
    totalProfit: number | null;
    entries: InventoryEntry[];
  }
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
      const totalQty = entries.reduce((s, e) => s + e.quantity, 0);
      const totalCost = entries.reduce((s, e) => s + e.buy_price * e.quantity, 0);
      const profits = entries.map((e) => (e.net_profit_estimate != null ? e.net_profit_estimate * e.quantity : null));
      const totalProfit = profits.every((p) => p == null) ? null : profits.reduce<number>((s, p) => s + (p ?? 0), 0);
      out.push({ name, totalQty, records: entries.length, totalCost, totalProfit, entries });
    }
    out.sort((a, b) => a.entries[0].unlock_at.localeCompare(b.entries[0].unlock_at));
    return out;
  }, [items]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [steamId, setSteamId] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.inventory();
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

  useEffect(() => {
    api.getSettings().then((s) => setSteamId(s.steamId || '')).catch(() => undefined);
  }, []);

  /** 唯一同步入口：Steam Web API + 双 Context（context 2 普通 + context 16 交易保护） */
  const syncSmart = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await api.syncSteamInventorySmart();
      if (res.steamId) setSteamId(res.steamId);
      const src = '来源：Steam Web API（官方）';
      const warn = res.ctx16Error ? `；注意：交易保护箱通道（context 16）失败：${res.ctx16Error}` : '';
      if (res.empty) {
        setSyncMsg(`同步完成但未找到武器箱（总量 ${res.totalInventoryCount ?? 0}）${res.reason ?? ''}（${src}${warn}）`);
        return;
      }
      setSyncMsg(
        `同步完成：本地匹配 ${res.matched} 件（可上架 ${res.unlocked} 件），新导入 ${res.imported} 件，未找到 ${res.notFound} 件（${src}${warn}）`,
      );
      await load();
    } catch (e) {
      setSyncMsg(`同步失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setSyncing(false);
    }
  };

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
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        >
          <Card>
            <SectionTitle>手动录入购买记录</SectionTitle>
            <TextInput style={styles.input} placeholder="武器箱名称（如：狂牙武器箱）" placeholderTextColor={colors.textDim} value={name} onChangeText={setName} />
            <View style={styles.inputRow}>
              <TextInput style={[styles.input, styles.inputHalf]} placeholder="数量" placeholderTextColor={colors.textDim} value={qty} onChangeText={setQty} keyboardType="numeric" />
              <TextInput style={[styles.input, styles.inputHalf]} placeholder="买入价 ¥" placeholderTextColor={colors.textDim} value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
            </View>
            <TouchableOpacity style={[styles.addBtn, saving && { opacity: 0.6 }]} onPress={add} disabled={saving}>
              <Text style={styles.addBtnText}>{saving ? '保存中…' : '＋ 录入库存'}</Text>
            </TouchableOpacity>
            {savedMsg ? <Text style={styles.saved}>{savedMsg}</Text> : null}
          </Card>

          <Card>
            <SectionTitle>同步 Steam 库存</SectionTitle>
            <Text style={styles.hint}>需在设置页配置 Steam Web API Key（免费申请）；未做过「Steam 一键登录」时，还需填写你的 SteamID64（或自定义 URL），Web API 即可同步、无需登录。官方接口可含交易保护箱（context 16）。同步后自动导入武器箱、更新精确冷却倒计时。</Text>
            <TouchableOpacity style={[styles.addBtn, syncing && { opacity: 0.6 }]} onPress={syncSmart} disabled={syncing}>
              <Text style={styles.addBtnText}>{syncing ? '同步中…' : '⟳ 同步 Steam 库存'}</Text>
            </TouchableOpacity>
            {syncMsg ? <Text style={styles.saved}>{syncMsg}</Text> : null}
          </Card>

          <SectionTitle>我的库存（{items.length} 条 · 堆叠后 {stacks.length} 种）</SectionTitle>
          {loading ? <Loading /> : null}
          {!loading && error ? <ErrorView message={error} onRetry={load} /> : null}
          {!loading && !error && items.length === 0 ? (
            <Card><Text style={styles.empty}>还没有库存记录，录入第一笔吧。</Text></Card>
          ) : null}
          {stacks.map((g) => {
            const first = g.entries[0];
            return (
              <Card key={g.name}>
                <View style={styles.itemHeader}>
                  <Text style={styles.name} numberOfLines={1}>{displayNameOf(g.name)}</Text>
                  <View style={[styles.countdown, first.days_left <= 1 && { borderColor: colors.danger }]}>
                    <Text style={[styles.countdownText, first.days_left <= 1 && { color: colors.danger }]}>
                      {first.days_left <= 0 ? '可上架' : `最快解锁 ${fmtRemainHours(first.hours_left)}`}
                    </Text>
                  </View>
                </View>
                <View style={styles.stackRow}>
                  <Text style={styles.stackBadge}>× {g.totalQty}</Text>
                  <Text style={styles.stackMeta}>{g.records > 1 ? `${g.records} 笔记录堆叠` : '1 笔记录'}</Text>
                </View>
                <Row label="总数量 × 均买入价" value={`${g.totalQty} × ¥${(g.totalCost / g.totalQty).toFixed(2)}`} />
                <Row label="总成本（含 1% 费用）" value={fmtMoney(g.totalCost * 1.01)} />
                <Row label="预计可卖时间（最早）" value={new Date(first.unlock_at).toLocaleString()} />
                {first.steam_synced ? (
                  <Row
                    label="冷却来源"
                    value={first.steam_tradable ? 'Steam：已可上架' : first.unlock_source === 'steam' ? 'Steam 真实冷却（推算）' : 'Steam 估算'}
                    valueColor={first.steam_tradable ? colors.success : colors.gold}
                  />
                ) : null}
                <Row label="当前市场估值 / 预计可到账" value={`${fmtMoney(first.current_estimate)} / ${fmtMoney(first.net_receive_estimate)}`} valueColor={colors.success} />
                <Row
                  label={`预计净利 / 回报率（按 ${g.totalQty} 件）`}
                  value={`${fmtMoney(g.totalProfit)} / ${g.totalCost > 0 && g.totalProfit != null ? `${((g.totalProfit / g.totalCost) * 100).toFixed(1)}%` : '--'}`}
                  valueColor={g.totalProfit != null && g.totalProfit >= 0 ? colors.success : colors.danger}
                />
                {first.sell_advice_text ? (
                  <Text style={[styles.saved, first.sell_advice_code === 'wait_event_pass' || first.sell_advice_code === 'wait_recovery' ? { color: colors.gold } : { color: colors.success }]}>
                    ⏱ {first.sell_advice_text}
                  </Text>
                ) : null}
              </Card>
            );
          })}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { color: colors.text, fontSize: 22, fontWeight: '800', paddingHorizontal: 14, paddingTop: 8, paddingBottom: 8 },
  content: { padding: 14, paddingBottom: 40 },
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
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  name: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  countdown: {
    borderWidth: 1, borderColor: colors.gold, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
  },
  countdownText: { color: colors.gold, fontSize: 11, fontWeight: '700' },
  stackRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  stackBadge: {
    color: colors.primary, fontSize: 13, fontWeight: '800',
    backgroundColor: colors.cardAlt, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3,
    overflow: 'hidden', borderWidth: 1, borderColor: colors.primary,
  },
  stackMeta: { color: colors.textDim, fontSize: 11 },
  empty: { color: colors.textDim, fontSize: 14 },
  hint: { color: colors.textDim, fontSize: 12, marginBottom: 10, lineHeight: 17 },
});
