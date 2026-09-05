import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

export function Loading({ msg = '加载中…' }: { msg?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
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
  retry: { color: colors.primary, marginTop: 12, fontSize: 14, fontWeight: '600' },
});
