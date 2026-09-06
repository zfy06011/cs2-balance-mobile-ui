/** 设置：本地数据源配置、采集数量、数据状态（纯手机版，无需后端地址） */
import React, { useEffect, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { api, HealthResult } from '../api/client';
import { Card, Row, SectionTitle } from '../components/Card';
import { colors } from '../theme/colors';
import type { CookieLoginKind } from './CookieLoginScreen';

interface Props {
  /** 打开 App 内一键登录（Steam / C5） */
  onCookieLogin?: (kind: CookieLoginKind) => void;
}

export function SettingsScreen({ onCookieLogin }: Props) {
  const [status, setStatus] = useState<HealthResult | null>(null);
  const [c5Key, setC5Key] = useState('');
  const [c5Cookie, setC5Cookie] = useState('');
  const [cookie, setCookie] = useState('');
  const [steamId, setSteamId] = useState('');
  const [count, setCount] = useState(20);
  const [msg, setMsg] = useState<string | null>(null);
  const [buyMaxPrice, setBuyMaxPrice] = useState('0');
  const [buyTargetZhe, setBuyTargetZhe] = useState('0');
  const [buyMaxBudget, setBuyMaxBudget] = useState('0');
  const [radarTargetZhe, setRadarTargetZhe] = useState('7');
  const [clearModal, setClearModal] = useState(false);
  const [clearSel, setClearSel] = useState({ snapshots: true, inventory: true, orders: true });

  const loadStatus = async () => {
    try {
      const s = await api.health();
      setStatus(s);
      const settings = await api.getSettings();
      setC5Key(settings.c5AppKey);
      setC5Cookie(settings.c5Cookie || '');
      setCookie(settings.steamCookie);
      setSteamId(settings.steamId || '');
      setCount(settings.refreshCount);
      setBuyMaxPrice(String(settings.buyMaxPrice));
      setBuyTargetZhe(String(settings.buyTargetZhe));
      setBuyMaxBudget(String(settings.buyMaxBudget));
      setRadarTargetZhe(String(settings.radarTargetZhe));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const saveSettings = async () => {
    try {
      await api.updateSettings({
        c5AppKey: c5Key.trim(),
        c5Cookie: c5Cookie.trim(),
        steamCookie: cookie.trim(),
        steamId: steamId.trim(),
        refreshCount: count,
        buyMaxPrice: parseFloat(buyMaxPrice) || 0,
        buyTargetZhe: parseFloat(buyTargetZhe) || 0,
        buyMaxBudget: parseFloat(buyMaxBudget) || 0,
        radarTargetZhe: parseFloat(radarTargetZhe) || 0,
      });
      setMsg('设置已保存 ✅');
      loadStatus();
    } catch (e) {
      setMsg(`保存失败：${e instanceof Error ? e.message : '未知错误'}`);
    }
  };

  const testSteam = async () => {
    setMsg('正在测试 Steam 搜索连接…');
    try {
      const { searchCases } = await import('../data/steam');
      const hits = await searchCases(5, cookie.trim());
      setMsg(hits.length > 0 ? `Steam 连接正常 ✅ 返回 ${hits.length} 个武器箱（如：${hits[0].name}）` : 'Steam 返回为空，请稍后重试');
    } catch (e) {
      setMsg(`Steam 连接失败 ❌ ${e instanceof Error ? e.message : '未知错误'}`);
    }
  };

  const clearData = () => {
    setClearModal(true);
  };

  const clearConfirm = async () => {
    const parts = { snapshots: clearSel.snapshots, inventory: clearSel.inventory, orders: clearSel.orders };
    if (!parts.snapshots && !parts.inventory && !parts.orders) return;
    await api.clearAllData(parts);
    setClearModal(false);
    const cleared = [
      parts.snapshots ? '价格快照' : '',
      parts.inventory ? '库存记录' : '',
      parts.orders ? '订单流水' : '',
    ].filter(Boolean).join('、');
    Alert.alert('已清除', `已删除：${cleared}（设置与登录凭证保留）`);
    setMsg(`已清除：${cleared}`);
    loadStatus();
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Text style={styles.header}>设置</Text>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content}>
          <Card>
            <SectionTitle>运行模式：纯手机本地版</SectionTitle>
            <Text style={styles.hint}>所有采集、预测、收益计算都在手机内完成，不依赖电脑后端。</Text>
            <Row label="本地快照数" value={status ? String(status.snapshotCount) : '--'} />
            <Row label="监控商品数" value={status ? String(status.itemCount) : '--'} />
            <Row label="C5 app-key" value={status?.c5Configured ? '已配置' : '未配置（可手动录入买入价）'} />
            <Row label="最后更新时间" value={status?.lastUpdated ? new Date(status.lastUpdated).toLocaleString() : '--'} />
          </Card>

          <Card>
            <SectionTitle>扫描数量</SectionTitle>
            <Text style={styles.hint}>首页「📡 一键扫描」每次扫描的武器箱数量，拖动即改、即时生效（1-100 个）。数量越大耗时越长（每个约 2 秒）；中断后重扫只补缺的。</Text>
            <Text style={styles.countValue}>{count} 个</Text>
            <Slider
              style={styles.slider}
              minimumValue={1}
              maximumValue={100}
              step={1}
              value={count}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.border}
              thumbTintColor={colors.primary}
              onValueChange={(v) => setCount(Math.round(v))}
              onSlidingComplete={(v) => {
                const c = Math.round(v);
                setCount(c);
                api.updateSettings({ refreshCount: c }).catch(() => undefined);
              }}
            />
            <View style={styles.sliderScale}>
              <Text style={styles.sliderScaleText}>1</Text>
              <Text style={styles.sliderScaleText}>50</Text>
              <Text style={styles.sliderScaleText}>100</Text>
            </View>
          </Card>

          <Card>
            <SectionTitle>数据源配置</SectionTitle>
            <Text style={styles.hint}>库存与价格统一走 C5GAME 官方 OpenAPI（app-key，免费注册：opendoc.c5game.com）。「⟳ 同步库存」与 C5 买入价都需要它，历史价格另需 C5 登录凭证。</Text>
            <TextInput
              style={styles.input}
              value={c5Key}
              onChangeText={setC5Key}
              placeholder="C5GAME app-key（选填）"
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.hint}>推荐用「一键登录」：App 内登录一次，凭证自动保存——Steam 登录仅供识别 SteamID64 与搜索加速（库存已改走 C5 app-key），C5 登录供首页「快速导入历史」（官方趋势）与买入参考使用。手填 Cookie 仅作备用（浏览器 F12 复制整行 Cookie）。</Text>
            <View style={styles.countRow}>
              <TouchableOpacity style={[styles.btnPrimary, styles.halfBtn]} onPress={() => onCookieLogin?.('steam')}>
                <Text style={styles.btnPrimaryText}>🔐 Steam 一键登录</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnPrimary, styles.halfBtn]} onPress={() => onCookieLogin?.('c5')}>
                <Text style={styles.btnPrimaryText}>🔐 C5 一键登录</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              value={cookie}
              onChangeText={setCookie}
              placeholder="Steam Cookie（搜索加速，可留空）"
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              style={styles.input}
              value={c5Cookie}
              onChangeText={setC5Cookie}
              placeholder="C5 Cookie（备用，可留空）"
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.hint}>SteamID64（资料页 /profiles/ 后的 17 位数字）：配合上面的 C5 app-key 即可同步库存（库存仅走 C5 官方接口）。已做过「一键登录」（Steam/C5）会自动识别，此项可留空。自定义 URL 需先在 Steam 资料页查看数字 ID。</Text>
            <TextInput
              style={styles.input}
              value={steamId}
              onChangeText={setSteamId}
              placeholder="SteamID64 或自定义 URL（选填）"
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.btnRow}>
              <TouchableOpacity style={[styles.btnPrimary, { flex: 1 }]} onPress={saveSettings}>
                <Text style={styles.btnPrimaryText}>保存设置</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnGhost, { flex: 1 }]} onPress={testSteam}>
                <Text style={styles.btnGhostText}>测试 Steam 搜索</Text>
              </TouchableOpacity>
            </View>
          </Card>

          <Card>
            <SectionTitle>购买保护与目标折扣</SectionTitle>
            <Text style={styles.hint}>0 表示不限制。一键买入前自动核验：超过限价/预算、未达到目标折扣会直接拦截；异常波动会二次确认。雷达目标折扣：预计折扣低于该值才提醒。</Text>
            <TextInput
              style={styles.input}
              value={buyMaxPrice}
              onChangeText={setBuyMaxPrice}
              placeholder="最高买入价 ¥（0 = 不限）"
              placeholderTextColor={colors.textDim}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={styles.input}
              value={buyTargetZhe}
              onChangeText={setBuyTargetZhe}
              placeholder="最低目标折扣 折数（如 9.5，0 = 不限）"
              placeholderTextColor={colors.textDim}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={styles.input}
              value={buyMaxBudget}
              onChangeText={setBuyMaxBudget}
              placeholder="单笔预算上限 ¥（0 = 不限）"
              placeholderTextColor={colors.textDim}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={styles.input}
              value={radarTargetZhe}
              onChangeText={setRadarTargetZhe}
              placeholder="雷达目标折扣 折数（如 7）"
              placeholderTextColor={colors.textDim}
              keyboardType="decimal-pad"
            />
            <TouchableOpacity style={[styles.btnPrimary]} onPress={saveSettings}>
              <Text style={styles.btnPrimaryText}>保存设置</Text>
            </TouchableOpacity>
          </Card>

          <Card>
            <SectionTitle>业务规则</SectionTitle>
            <Row label="7 天限制期" value="购买 +168 小时精确计时" />
            <Row label="Steam 卖出费率" value="约 15%（卖家实得 86.96%）" />
            <Row label="C5GAME 买入费率" value="1%" />
            <Text style={styles.note}>费率可配置版本化，一切以官方最新公告为准。系统只做分析，不自动买卖。</Text>
          </Card>

          <TouchableOpacity style={styles.btnDanger} onPress={clearData}>
            <Text style={styles.btnDangerText}>清除本地数据（可按板块选择）</Text>
          </TouchableOpacity>

          {msg ? <Text style={styles.msg}>{msg}</Text> : null}
          <Text style={styles.footer}>宇额助手 v{Constants.expoConfig?.version ?? '未知'}（纯手机版）· 仅供学习研究，不构成投资建议</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* 分板块清除弹窗 */}
      <Modal visible={clearModal} transparent animationType="fade" onRequestClose={() => setClearModal(false)}>
        <View style={styles.modalMask}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>清除本地数据</Text>
            <Text style={styles.modalHint}>勾选要删除的板块（设置、C5 app-key、登录凭证始终保留）：</Text>
            {([
              { key: 'snapshots', title: '价格快照', desc: 'Steam/C5 历史、官方历史导入数据；清除后需重新扫描' },
              { key: 'inventory', title: '库存记录', desc: '购买记录与冷却倒计时；Steam 导入的箱子也会删除' },
              { key: 'orders', title: '订单流水', desc: '一键买入的订单历史' },
            ] as const).map((row) => (
              <TouchableOpacity
                key={row.key}
                style={styles.modalRow}
                onPress={() => setClearSel((s) => ({ ...s, [row.key]: !s[row.key] }))}
              >
                <Text style={[styles.modalCheck, clearSel[row.key] && styles.modalCheckOn]}>{clearSel[row.key] ? '☑' : '☐'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalRowTitle}>{row.title}</Text>
                  <Text style={styles.modalRowDesc}>{row.desc}</Text>
                </View>
              </TouchableOpacity>
            ))}
            <View style={styles.btnRow}>
              <TouchableOpacity style={[styles.btnGhost, { flex: 1 }]} onPress={() => setClearModal(false)}>
                <Text style={styles.btnGhostText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnDanger, { flex: 1 }, !clearSel.snapshots && !clearSel.inventory && !clearSel.orders && { opacity: 0.4 }]}
                disabled={!clearSel.snapshots && !clearSel.inventory && !clearSel.orders}
                onPress={clearConfirm}
              >
                <Text style={styles.btnDangerText}>确认清除</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { color: colors.text, fontSize: 22, fontWeight: '800', paddingHorizontal: 14, paddingTop: 8, paddingBottom: 8 },
  content: { padding: 14, paddingBottom: 40 },
  hint: { color: colors.textDim, fontSize: 12, marginBottom: 10, lineHeight: 17 },
  input: {
    backgroundColor: colors.cardAlt, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    color: colors.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 10,
  },
  countRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  halfBtn: { flex: 1, paddingVertical: 12 },
  modalMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  modalBox: {
    backgroundColor: colors.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border,
  },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: 6 },
  modalHint: { color: colors.textDim, fontSize: 12, marginBottom: 10, lineHeight: 17 },
  modalRow: { flexDirection: 'row', gap: 10, paddingVertical: 8, alignItems: 'flex-start' },
  modalCheck: { color: colors.primary, fontSize: 20, lineHeight: 24 },
  modalCheckOn: { color: colors.primary },
  modalRowTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  modalRowDesc: { color: colors.textDim, fontSize: 11, marginTop: 2, lineHeight: 15 },
  countValue: { color: colors.text, fontSize: 20, fontWeight: '800', marginBottom: 4 },
  slider: { width: '100%', height: 40 },
  sliderScale: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  sliderScaleText: { color: colors.textDim, fontSize: 11 },
  btnPrimary: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  btnPrimaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 2 },
  btnGhost: {
    backgroundColor: colors.cardAlt, borderRadius: 10, paddingVertical: 12, alignItems: 'center',
    borderWidth: 1, borderColor: colors.primary,
  },
  btnGhostText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  btnDanger: {
    borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 10,
    borderWidth: 1, borderColor: colors.danger,
  },
  btnDangerText: { color: colors.danger, fontSize: 14, fontWeight: '700' },
  progress: { color: colors.info, fontSize: 12, marginTop: 10, lineHeight: 17 },
  note: { color: colors.textDim, fontSize: 12, marginTop: 8, lineHeight: 17 },
  msg: { color: colors.info, fontSize: 13, marginTop: 12, textAlign: 'center' },
  footer: { color: colors.textDim, fontSize: 11, textAlign: 'center', marginTop: 16 },
});
