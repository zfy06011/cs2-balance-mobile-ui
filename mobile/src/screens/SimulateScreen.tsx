/** 资金模拟：预算组合 + 目标余额反推（PRD 第九节） */
import React, { useState } from 'react';
import {
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, Simulation } from '../api/client';
import { Card, Row, SectionTitle } from '../components/Card';
import { colors } from '../theme/colors';
import { displayNameOf } from '../utils/format';

const ALLOCATIONS = [
  { key: 'conservative', label: '稳健', desc: '最多 3 个、低风险高流动性' },
  { key: 'balanced', label: '平衡', desc: '最多 5 个、风险适中' },
  { key: 'aggressive', label: '激进', desc: '最多 8 个、追求高 ROI' },
] as const;

function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined) return '--';
  return `¥${v.toFixed(2)}`;
}

interface Props {
  onBack?: () => void;
}

export function SimulateScreen({ onBack }: Props) {
  const [mode, setMode] = useState<'budget' | 'target'>('budget');
  const [budget, setBudget] = useState('1000');
  const [allocation, setAllocation] = useState<string>('balanced');
  const [result, setResult] = useState<Simulation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [target, setTarget] = useState('1000');
  const [reverse, setReverse] = useState<{ required_budget: number; expected_profit: number } | null>(null);
  const [reverseLoading, setReverseLoading] = useState(false);
  const [reverseError, setReverseError] = useState<string | null>(null);

  const run = async () => {
    const b = parseFloat(budget);
    if (!b || b <= 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.simulate(b, allocation);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : '模拟失败');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const runReverse = async () => {
    const t = parseFloat(target);
    if (!t || t <= 0 || reverseLoading) return;
    setReverseLoading(true);
    setReverseError(null);
    try {
      const res = await api.simulateReverse(t);
      setReverse(res);
    } catch (e) {
      setReverseError(e instanceof Error ? e.message : '反推失败');
    } finally {
      setReverseLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.headerRow}>
        {onBack ? (
          <TouchableOpacity style={styles.backBtn} onPress={onBack} accessibilityRole="button" accessibilityLabel="返回首页">
            <Text style={styles.backBtnText}>← 返回</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={styles.header}>资金模拟</Text>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.modeTabs}>
            {([['budget', '按预算模拟'], ['target', '按目标反推']] as const).map(([key, label]) => (
              <TouchableOpacity
                key={key}
                style={[styles.modeTab, mode === key && styles.modeTabActive]}
                onPress={() => setMode(key)}
                accessibilityRole="button"
                accessibilityState={{ selected: mode === key }}
              >
                <Text style={[styles.modeTabText, mode === key && styles.modeTabTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {mode === 'budget' ? (
            <>
          <Card>
            <SectionTitle>预算组合模拟</SectionTitle>
            <TextInput
              style={styles.input}
              placeholder="预算（元）如 1000 / 5000 / 10000"
              placeholderTextColor={colors.textDim}
              value={budget}
              onChangeText={setBudget}
              keyboardType="numeric"
            />
            <View style={styles.allocRow}>
              {ALLOCATIONS.map((a) => (
                <TouchableOpacity
                  key={a.key}
                  style={[styles.allocCard, allocation === a.key && styles.allocActive]}
                  onPress={() => setAllocation(a.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: allocation === a.key }}
                >
                  <Text style={[styles.allocTitle, allocation === a.key && styles.allocTextActive]}>{a.label}</Text>
                  <Text style={[styles.allocDesc, allocation === a.key && styles.allocTextActive]}>{a.desc}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={[styles.btn, loading && { opacity: 0.6 }]} onPress={run} disabled={loading} accessibilityRole="button" accessibilityState={{ disabled: loading, busy: loading }}>
              <Text style={styles.btnText}>{loading ? '计算中…' : '开始模拟'}</Text>
            </TouchableOpacity>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </Card>

          {result ? (
            <Card>
              <SectionTitle>模拟结果（{result.allocation}）</SectionTitle>
              {result.items.map((it, idx) => (
                <View key={`${it.name}-${idx}`} style={styles.resultItem}>
                  <Text style={styles.resultName} numberOfLines={1}>{it.qty} × {displayNameOf(it.name)}</Text>
                  <Row label="投入" value={fmtMoney(it.buy_cost)} />
                  <Row label="预计 7 天到账" value={fmtMoney(it.expected_receive)} valueColor={colors.success} />
                  <Row label="预计回报" value={`${(it.expected_roi * 100).toFixed(1)}%`} valueColor={it.expected_roi >= 0 ? colors.success : colors.danger} />
                  <Row label="亏损概率" value={`${(it.prob_loss * 100).toFixed(1)}%`} />
                </View>
              ))}
              <View style={styles.hr} />
              <Row label="总投入" value={fmtMoney(result.total_buy_cost)} />
              <Row label="预计 Steam 到账" value={fmtMoney(result.expected_steam_receive)} valueColor={colors.success} />
              <Row label="预计净利润" value={fmtMoney(result.expected_net_profit)} valueColor={result.expected_net_profit >= 0 ? colors.success : colors.danger} />
              <Row label="组合预计回报" value={`${(result.expected_roi * 100).toFixed(1)}%`} />
              <Row label="加权亏损概率" value={`${(result.weighted_loss_prob * 100).toFixed(1)}%`} />
            </Card>
          ) : null}
            </>
          ) : (
          <Card>
            <SectionTitle>目标余额反推</SectionTitle>
            <Text style={styles.hint}>输入希望获得的 Steam 钱包余额，反推需要投入多少本金。</Text>
            <TextInput
              style={styles.input}
              placeholder="目标 Steam 余额（元）"
              placeholderTextColor={colors.textDim}
              value={target}
              onChangeText={setTarget}
              keyboardType="numeric"
            />
            <TouchableOpacity style={[styles.btn, reverseLoading && { opacity: 0.6 }]} onPress={runReverse} disabled={reverseLoading} accessibilityRole="button" accessibilityState={{ disabled: reverseLoading, busy: reverseLoading }}>
              <Text style={styles.btnText}>{reverseLoading ? '计算中…' : '反推所需资金'}</Text>
            </TouchableOpacity>
            {reverseError ? <Text style={styles.error}>{reverseError}</Text> : null}
            {reverse ? (
              <View style={styles.reverseBox}>
                <Row label="目标余额" value={fmtMoney(parseFloat(target))} />
                <Row label="预计所需本金" value={fmtMoney(reverse.required_budget)} valueColor={colors.warning} />
                <Row label="预期 7 日盈利" value={fmtMoney(reverse.expected_profit)} valueColor={colors.success} />
              </View>
            ) : null}
          </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 8 },
  backBtn: { marginRight: 10, paddingVertical: 6 },
  backBtnText: { color: colors.primaryText, fontSize: 15, fontWeight: '700' },
  header: { color: colors.text, fontSize: 24, fontWeight: '800', paddingBottom: 8, flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40 },
  modeTabs: { flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: colors.surfaceRaised, marginBottom: 16 },
  modeTab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  modeTabActive: { backgroundColor: colors.card },
  modeTabText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  modeTabTextActive: { color: colors.primaryText, fontWeight: '800' },
  input: {
    backgroundColor: colors.cardAlt, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    color: colors.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 12,
  },
  allocRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  allocCard: {
    flex: 1, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border,
    borderRadius: 10, padding: 10,
  },
  allocActive: { borderColor: colors.primaryBorder, backgroundColor: colors.primarySoft },
  allocTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  allocDesc: { color: colors.textDim, fontSize: 11, marginTop: 4 },
  allocTextActive: { color: colors.primaryText },
  btn: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  btnText: { color: colors.onPrimary, fontSize: 15, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 13, marginTop: 8 },
  resultItem: { marginBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 6 },
  resultName: { color: colors.text, fontSize: 14, fontWeight: '700', marginBottom: 2 },
  hr: { height: 1, backgroundColor: colors.border, marginVertical: 10 },
  hint: { color: colors.textDim, fontSize: 12, marginBottom: 10 },
  reverseBox: { marginTop: 10, backgroundColor: colors.cardAlt, borderRadius: 10, padding: 10 },
});
