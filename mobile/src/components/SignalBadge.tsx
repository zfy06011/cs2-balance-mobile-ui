import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, signalColors } from '../theme/colors';

const SIGNAL_TEXT: Record<string, string> = {
  buy: '🟢 买入候选',
  wait: '🟡 等待',
  waiting: '🟡 等待',
  avoid: '🔴 不建议',
};

export function SignalBadge({ signal }: { signal: string }) {
  const color = signalColors[signal] ?? colors.textDim;
  const text = SIGNAL_TEXT[signal] ?? signal;
  return (
    <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color }]}>
      <Text style={[styles.text, { color }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  text: { fontSize: 12, fontWeight: '700' },
});
