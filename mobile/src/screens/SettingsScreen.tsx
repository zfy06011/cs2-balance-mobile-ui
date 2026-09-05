/** 设置：本地数据源配置、一键采集、数据状态（纯手机版，无需后端地址） */
import React, { useEffect, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, HealthResult } from '../api/client';
import type { CollectProgress } from '../data/collector';
import { Card, Row, SectionTitle } from '../components/Card';
import { colors } from '../theme/colors';

const COUNT_OPTIONS = [12, 20, 50];

export function SettingsScreen() {
  const [status, setStatus] = useState<HealthResult | null>(null);
  const [c5Key, setC5Key] = useState('');
  const [cookie, setCookie] = useState('');
  const [steamId, setSteamId] = useState('');
  const [count, setCount] = useState(20);
  const [msg, setMsg] = useState<string | null>(null);
  const [buyMaxPrice, setBuyMaxPrice] = useState('0');
  const [buyTargetZhe, setBuyTargetZhe] = useState('0');
  const [buyMaxBudget, setBuyMaxBudget] = useState('0');
  const [radarTargetZhe, setRadarTargetZhe] = useState('7');
  const [collecting, setCollecting] = useState(false);
  const [progress, setProgress] = useState<CollectProgress | null>(null);

  const loadStatus = async () => {
    try {
      const s = await api.health();
      setStatus(s);
      const settings = await api.getSettings();
      setC5Key(settings.c5AppKey);
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
    setMsg('正在测试 Steam 连接…');
    try {
      const { searchCases } = await import('../data/steam');
      const hits = await searchCases(5, cookie.trim());
      setMsg(hits.length > 0 ? `Steam 连接正常 ✅ 返回 ${hits.length} 个武器箱（如：${hits[0].name}）` : 'Steam 返回为空，请稍后重试');
    } catch (e) {
      setMsg(`Steam 连接失败 ❌ ${e instanceof Error ? e.message : '未知错误'}`);
    }
  };

  const startCollect = async () => {
    setCollecting(true);
    setProgress(null);
    try {
      const stats = await api.refresh({ count, onProgress: setProgress });
      setMsg(`采集完成：成功 ${stats.success} / ${stats.total}，失败 ${stats.failed}（耗时 ${stats.elapsedSec}s）`);
    } catch (e) {
      setMsg(`采集失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setCollecting(false);
      loadStatus();
    }
  };

  const clearData = () => {
    Alert.alert('确认清空', '将删除全部本地快照、库存与设置，确定？', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空', style: 'destructive', onPress: async () => {
          await api.clearAllData();
          setMsg('已清空本地数据');
          loadStatus();
        },
      },
    ]);
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
            <SectionTitle>一键采集</SectionTitle>
            <Text style={styles.hint}>从 Steam「热门物品 → 武器箱」拉取价格并存入手机本地，配置 C5 app-key 时同时批量获取买入价。采集数量越大耗时越长（每个约 2 秒）。</Text>
            <View style={styles.countRow}>
              {COUNT_OPTIONS.map((c) => (
                <TouchableOpacity key={c} style={[styles.countBtn, count === c && styles.countActive]} onPress={() => setCount(c)}>
                  <Text style={[styles.countText, count === c && styles.countTextActive]}>{c} 个</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={[styles.btnPrimary, collecting && { opacity: 0.6 }]} onPress={startCollect} disabled={collecting}>
              <Text style={styles.btnPrimaryText}>{collecting ? '采集中…' : '📡 开始采集'}</Text>
            </TouchableOpacity>
            {progress ? (
              <Text style={styles.progress}>
                {progress.stage === 'listing' ? '拉取热门武器箱榜单…' : `已采集 ${progress.done} / ${progress.total} 个`}
              </Text>
            ) : null}
          </Card>

          <Card>
            <SectionTitle>数据源配置</SectionTitle>
            <Text style={styles.hint}>C5GAME 买入价可填 app-key 自动获取（需申请），也可以直接在商品详情页手动录入。</Text>
            <TextInput
              style={styles.input}
              value={c5Key}
              onChangeText={setC5Key}
              placeholder="C5GAME app-key（选填）"
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.hint}>Steam cookie 可选：登录 Steam 后在浏览器复制 Cookie 填入，可提高价格接口稳定性。</Text>
            <TextInput
              style={styles.input}
              value={cookie}
              onChangeText={setCookie}
              placeholder="Steam Cookie（选填）"
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.hint}>SteamID64（/profiles/ 后的 17 位数字）用于库存页「同步 Steam 冷却」，获取真实冷却天数并精确到小时。</Text>
            <TextInput
              style={styles.input}
              value={steamId}
              onChangeText={setSteamId}
              placeholder="SteamID64（选填）"
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.btnRow}>
              <TouchableOpacity style={[styles.btnPrimary, { flex: 1 }]} onPress={saveSettings}>
                <Text style={styles.btnPrimaryText}>保存设置</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnGhost, { flex: 1 }]} onPress={testSteam}>
                <Text style={styles.btnGhostText}>测试 Steam 连接</Text>
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
            <Text style={styles.btnDangerText}>清空本地数据</Text>
          </TouchableOpacity>

          {msg ? <Text style={styles.msg}>{msg}</Text> : null}
          <Text style={styles.footer}>CS2 余额助手 v1.3.0（纯手机版）· 仅供学习研究，不构成投资建议</Text>
        </ScrollView>
      </KeyboardAvoidingView>
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
  countBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999,
    backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border,
  },
  countActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  countText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  countTextActive: { color: '#FFFFFF' },
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
