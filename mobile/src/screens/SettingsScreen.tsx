/** 设置：后端地址配置、采集信息、数据源说明 */
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getApiBase, setApiBase } from '../api/client';
import { Card, Row, SectionTitle } from '../components/Card';
import { colors } from '../theme/colors';

export function SettingsScreen() {
  const [base, setBase] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    getApiBase().then(setBase).catch(() => {});
  }, []);

  const save = async () => {
    try {
      await setApiBase(base.trim());
      setStatus('已保存 ✅');
    } catch (e) {
      setStatus(`保存失败：${e instanceof Error ? e.message : '未知错误'}`);
    }
  };

  const test = async () => {
    setTestResult('测试中…');
    try {
      const { api } = await import('../api/client');
      const r = await api.health();
      setTestResult(`连接成功 ✅ ${r.app} (${r.status})`);
    } catch (e) {
      setTestResult(`连接失败 ❌ ${e instanceof Error ? e.message : '未知错误'}`);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Text style={styles.header}>设置</Text>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content}>
          <Card>
            <SectionTitle>后端服务地址</SectionTitle>
            <Text style={styles.hint}>手机与后端需在同一网络。真机请填写电脑局域网 IP，末尾不需要 /api/v1。</Text>
            <TextInput
              style={styles.input}
              value={base}
              onChangeText={setBase}
              placeholder="http://192.168.x.x:8000/api/v1"
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.btnRow}>
              <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={save}>
                <Text style={styles.btnText}>保存</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={test}>
                <Text style={[styles.btnText, { color: colors.primary }]}>测试连接</Text>
              </TouchableOpacity>
            </View>
            {status ? <Text style={styles.status}>{status}</Text> : null}
            {testResult ? <Text style={styles.status}>{testResult}</Text> : null}
          </Card>

          <Card>
            <SectionTitle>采集与业务规则</SectionTitle>
            <Row label="默认采集频率" value="每 30 分钟" />
            <Row label="7 天限制期" value="购买 +168 小时精确计时" />
            <Row label="Steam 卖出费率" value="约 15%（卖家实得 86.96%）" />
            <Row label="C5GAME 买入费率" value="1%（VIP 0.5%）" />
            <Text style={styles.note}>费率与规则均在后端配置化，版本可追溯；一切以官方最新公告为准。</Text>
          </Card>

          <Card>
            <SectionTitle>数据源</SectionTitle>
            <Row label="买入端" value="C5GAME（OpenAPI / 备用网页接口）" />
            <Row label="卖出端" value="Steam Community Market" />
            <Row label="事件系统" value="Event Database（人工+后续自动）" />
            <Text style={styles.note}>所有价格、成交量、手续费与预测均标记来源与时间戳，系统不做自动买卖。</Text>
          </Card>

          <Text style={styles.footer}>CS2 余额助手 v1.0.0 · 仅供学习研究，不构成投资建议</Text>
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
    color: colors.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 12,
  },
  btnRow: { flexDirection: 'row', gap: 10 },
  btn: { borderRadius: 10, paddingVertical: 11, alignItems: 'center', flex: 1 },
  btnPrimary: { backgroundColor: colors.primary },
  btnGhost: { backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.primary },
  btnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  status: { color: colors.info, fontSize: 13, marginTop: 10 },
  note: { color: colors.textDim, fontSize: 12, marginTop: 8, lineHeight: 17 },
  footer: { color: colors.textDim, fontSize: 11, textAlign: 'center', marginTop: 16 },
});
