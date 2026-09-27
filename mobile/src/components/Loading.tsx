import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

/**
 * 加载中占位。
 * height：固定占位高度（v1.8.4）。放进列表头/空态时高度必须稳定，
 * 否则加载完成瞬间高度塌陷，下方内容会整体上跳。
 */
export function Loading({ msg = '加载中…', height }: { msg?: string; height?: number }) {
  return (
    <View style={[styles.center, height != null && { flex: 0, height }]}>
      <ActivityIndicator size="large" color={colors.primaryText} />
      <Text style={styles.text}>{msg}</Text>
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={styles.error}>⚠️ {message}</Text>
      {onRetry ? <Text style={styles.retry} onPress={onRetry}>点击重试</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  text: { color: colors.textDim, marginTop: 12, fontSize: 14 },
  error: { color: colors.danger, fontSize: 14, textAlign: 'center' },
  retry: { color: colors.primaryText, marginTop: 12, fontSize: 14, fontWeight: '600' },
});
