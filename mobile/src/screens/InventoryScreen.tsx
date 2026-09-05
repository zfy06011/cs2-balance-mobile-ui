/** 库存管理：录入购买记录、7 天倒计时、当前/解除限制时估值（PRD 第十节） */
import React, { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, InventoryEntry } from '../api/client';
import { Card, Row, SectionTitle } from '../components/Card';
import { ErrorView, Loading } from '../components/Loading';
import { colors } from '../theme/colors';
import { displayNameOf, fmtZhe } from '../utils/format';

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

  const sync = async () => {
    if (!steamId.trim()) {
      setSyncMsg('请先填写 SteamID64（个人资料页 /profiles/ 后面的 17 位数字）');
      return;
    }
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await api.syncSteamInventory(steamId.trim());
      setSyncMsg(`同步完成：匹配 ${res.matched} 件，其中可上架 ${res.unlocked} 件，未在 Steam 找到 ${res.notFound} 件`);
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
            <SectionTitle>同步 Steam 冷却（精确到小时）</SectionTitle>
            <Text style={styles.hint}>填入 SteamID64（个人资料页 /profiles/ 后的 17 位数字），从 Steam 库存拉取真实冷却天数，并按首次观察到的时间推算剩余小时。下拉刷新可重复同步，越接近解锁越准。</Text>
            <TextInput
              style={styles.input}
              value={steamId}
              onChangeText={setSteamId}
              placeholder="SteamID64 / profiles/7656119… 链接"
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity style={[styles.addBtn, syncing && { opacity: 0.6 }]} onPress={sync} disabled={syncing}>
              <Text style={styles.addBtnText}>{syncing ? '同步中…' : '⟳ 同步 Steam 冷却'}</Text>
            </TouchableOpacity>
            {syncMsg ? <Text style={styles.saved}>{syncMsg}</Text> : null}
          </Card>

          <SectionTitle>我的库存（{items.length}）</SectionTitle>
          {loading ? <Loading /> : null}
          {!loading && error ? <ErrorView message={error} onRetry={load} /> : null}
          {!loading && !error && items.length === 0 ? (
            <Card><Text style={styles.empty}>还没有库存记录，录入第一笔吧。</Text></Card>
          ) : null}
          {items.map((it) => (
            <Card key={it.id}>
              <View style={styles.itemHeader}>
                <Text style={styles.name} numberOfLines={1}>{displayNameOf(it.item_name)}</Text>
                <View style={[styles.countdown, it.days_left <= 1 && { borderColor: colors.danger }]}>
                  <Text style={[styles.countdownText, it.days_left <= 1 && { color: colors.danger }]}>
                    {it.days_left <= 0 ? '可上架' : `解锁倒计时 ${fmtRemainHours(it.hours_left)}`}
                  </Text>
                </View>
              </View>
              <Row label="数量 × 买入价" value={`${it.quantity} × ¥${it.buy_price.toFixed(2)}`} />
              <Row label="买入时间" value={new Date(it.buy_at).toLocaleString()} />
              <Row label="预计可卖时间" value={new Date(it.unlock_at).toLocaleString()} />
              {it.steam_synced ? (
                <Row
                  label="冷却来源"
                  value={it.steam_tradable ? 'Steam：已可上架' : it.unlock_source === 'steam' ? 'Steam 真实冷却（推算）' : 'Steam 估算'}
                  valueColor={it.steam_tradable ? colors.success : colors.gold}
                />
              ) : null}
              <Row label="当前市场估值" value={fmtMoney(it.current_estimate)} />
              <Row label="预计几折（越低越划算）" value={fmtZhe(it.expected_discount_estimate)} valueColor={it.expected_discount_estimate != null && it.expected_discount_estimate <= 0.95 ? colors.success : colors.warning} />
              <Row label="预计可到账（扣费后）" value={fmtMoney(it.net_receive_estimate)} valueColor={colors.success} />
              <Row label="预计净利 / 回报率" value={`${fmtMoney(it.net_profit_estimate)} / ${it.roi_estimate != null ? `${(it.roi_estimate * 100).toFixed(1)}%` : '--'}`} valueColor={it.net_profit_estimate != null && it.net_profit_estimate >= 0 ? colors.success : colors.danger} />
            </Card>
          ))}
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
  empty: { color: colors.textDim, fontSize: 14 },
  hint: { color: colors.textDim, fontSize: 12, marginBottom: 10, lineHeight: 17 },
});
