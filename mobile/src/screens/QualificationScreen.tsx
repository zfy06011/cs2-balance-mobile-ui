import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, Row, SectionTitle } from '../components/Card';
import { colors } from '../theme/colors';
import { api } from '../api/client';
import {
  QUALIFICATION_BURNIN_ROUNDS,
  QUALIFICATION_INTERVAL_MS,
  QUALIFICATION_V2_ROUNDS,
  confirmBackgroundCheckpoint,
  confirmOfflineCheckpoint,
  confirmOnlineCheckpoint,
  confirmProcessRestartCheckpoint,
  isQualificationDue,
  loadQualificationState,
  qualificationSummary,
  resetQualification,
  runNextQualificationRound,
  startQualification,
  type QualificationState,
} from '../data/qualificationRunner';

interface Props { onBack: () => void; }

function stageText(stage: QualificationState['stage']): string {
  const labels: Record<QualificationState['stage'], string> = {
    idle: '未开始', burn_in: '运行中 · Live Burn-in', v2_refresh: '运行中 · v2 刷新',
    await_offline: '等待用户断网', await_online: '等待恢复网络', process_restart: '等待重启确认',
    background: '等待后台/前台确认', complete: '完成', failed: '失败',
  };
  return labels[stage];
}

function countdown(nextEligibleAt: number | null, now: number): string {
  if (!nextEligibleAt) return '--';
  const left = Math.max(0, nextEligibleAt - now);
  const minutes = Math.floor(left / 60000);
  const seconds = Math.floor((left % 60000) / 1000);
  return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
}

export function QualificationScreen({ onBack }: Props) {
  const [state, setState] = useState<QualificationState | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [preflight, setPreflight] = useState<{ c5Configured: boolean; itemCount: number } | null>(null);

  const reload = useCallback(async () => {
    const [nextState, health] = await Promise.all([loadQualificationState(), api.health().catch(() => null)]);
    setState(nextState);
    if (health) setPreflight({ c5Configured: health.c5Configured, itemCount: health.itemCount });
  }, []);
  const run = useCallback(async (action: () => Promise<QualificationState>) => {
    if (busy) return;
    setBusy(true);
    try { setState(await action()); } finally { setBusy(false); }
  }, [busy]);

  useEffect(() => {
    reload();
    const timer = setInterval(() => setClock(Date.now()), 10_000);
    const sub = AppState.addEventListener('change', (next) => { if (next === 'active') reload(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [reload]);

  useEffect(() => {
    if (!state || busy || !['burn_in', 'v2_refresh'].includes(state.stage) || !isQualificationDue(state, clock)) return;
    run(runNextQualificationRound);
  }, [state, clock, busy, run]);

  const current = state ?? {
    runId: '', stage: 'idle' as const, currentRound: 0, startedAt: null, lastRoundAt: null,
    nextEligibleAt: null, records: [], v2RefreshCount: 0, offlineCheckedAt: null,
    onlineRecoveredAt: null, processRestartCheckedAt: null, backgroundCheckedAt: null,
  };
  const qualified = current.records.filter((record) => record.snapshot.valid && record.accounting.unaccountedItems === 0 && record.highRiskViolationCount === 0).length;
  const summary = useMemo(() => qualificationSummary(current), [current]);
  const preflightReady = preflight?.c5Configured === true && (preflight.itemCount ?? 0) > 0;
  const share = async () => { await Share.share({ title: '宇额助手 RC 真机检测报告', message: summary }); };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.nav}><Text style={styles.back} onPress={onBack}>‹ 返回</Text><Text style={styles.title}>真机资格检测</Text><View style={{ width: 60 }} /></View>
      <View style={styles.content}>
        <Card style={styles.rcBanner}><Text style={styles.rcTitle}>宇额助手 RC · v2 Qualification</Text><Text style={styles.hint}>真实 live feed；预计约 1 小时。保持充电，App 被杀后会从 kv 状态继续。</Text></Card>
        <Card>
          <Row label="状态" value={stageText(current.stage)} />
          <Row label="自动 Burn-in" value={`${Math.min(QUALIFICATION_BURNIN_ROUNDS, current.records.length)} / ${QUALIFICATION_BURNIN_ROUNDS}`} />
          <Row label="合格轮次" value={`${qualified} / ${current.records.length}`} />
          <Row label="连续 v2 刷新" value={`${current.v2RefreshCount} / ${QUALIFICATION_V2_ROUNDS}`} />
          <Row label="真实断网恢复" value={current.onlineRecoveredAt ? '通过' : current.offlineCheckedAt ? '等待恢复' : '未完成'} />
          <Row label="进程重启" value={current.processRestartCheckedAt ? '通过' : '未完成'} />
          <Row label="后台/前台" value={current.backgroundCheckedAt ? '通过' : '未完成'} />
          <Row label="下一轮" value={countdown(current.nextEligibleAt, clock)} />
        </Card>
        {current.stage === 'idle' ? (
          <Card>
            <SectionTitle>开始前检查</SectionTitle>
            <Row label="C5 app-key" value={preflight?.c5Configured ? '已配置' : '未配置'} />
            <Row label="候选池" value={preflight && preflight.itemCount > 0 ? `${preflight.itemCount} 个` : '为空'} />
            {!preflightReady ? <Text style={styles.error}>请先返回“我的 → 设置”填写 C5 app-key，并回首页点击“一键扫描”建立本 RC 的本地候选池。</Text> : null}
            <TouchableOpacity style={[styles.primary, !preflightReady && { opacity: 0.45 }]} disabled={!preflightReady} onPress={() => run(startQualification)}><Text style={styles.primaryText}>开始自动检测</Text></TouchableOpacity>
          </Card>
        ) : null}
        {current.stage === 'await_offline' ? <Card><Text style={styles.instruction}>请关闭 Wi-Fi 和移动数据，或打开飞行模式，然后点击下方按钮。</Text><TouchableOpacity style={styles.primary} onPress={() => run(confirmOfflineCheckpoint)}><Text style={styles.primaryText}>我已断网</Text></TouchableOpacity></Card> : null}
        {current.stage === 'await_online' ? <Card><Text style={styles.instruction}>断网状态已记录。请恢复 Wi-Fi/移动数据，然后点击下方按钮。</Text><TouchableOpacity style={styles.primary} onPress={() => run(confirmOnlineCheckpoint)}><Text style={styles.primaryText}>我已恢复网络</Text></TouchableOpacity></Card> : null}
        {current.stage === 'process_restart' ? <Card><Text style={styles.instruction}>请从最近任务中彻底关闭“宇额助手 RC”，重新打开后进入本页，再点击确认。</Text><TouchableOpacity style={styles.primary} onPress={() => run(confirmProcessRestartCheckpoint)}><Text style={styles.primaryText}>已重启并恢复</Text></TouchableOpacity></Card> : null}
        {current.stage === 'background' ? <Card><Text style={styles.instruction}>请把 App 切到后台约 5 分钟，再回来点击确认。</Text><TouchableOpacity style={styles.primary} onPress={() => run(confirmBackgroundCheckpoint)}><Text style={styles.primaryText}>已完成后台/前台</Text></TouchableOpacity></Card> : null}
        {current.lastError ? <Text style={styles.error}>本轮失败：{current.lastError}</Text> : null}
        <SectionTitle>检测报告</SectionTitle>
        <TouchableOpacity style={styles.secondary} onPress={share}><Text style={styles.secondaryText}>导出/分享检测摘要</Text></TouchableOpacity>
        {current.stage !== 'idle' ? <TouchableOpacity style={styles.reset} onPress={() => run(resetQualification)}><Text style={styles.resetText}>重置本次检测</Text></TouchableOpacity> : null}
        <Text style={styles.hint}>RC 包不会修改正式 App、默认算法、版本号或远程配置。完成后请把摘要分享给 Codex 审核。</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  back: { color: colors.primary, fontSize: 15, width: 60 },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  content: { padding: 14, gap: 10 },
  rcBanner: { backgroundColor: colors.cardAlt, borderColor: colors.primary },
  rcTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  hint: { color: colors.textDim, fontSize: 12, lineHeight: 18, marginTop: 8 },
  instruction: { color: colors.text, fontSize: 14, lineHeight: 21, marginBottom: 12 },
  primary: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondary: { borderColor: colors.primary, borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  secondaryText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  reset: { alignItems: 'center', paddingVertical: 10 },
  resetText: { color: colors.danger, fontSize: 12 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18 },
});
