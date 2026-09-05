import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, signalColors } from '../theme/colors';
import { SIGNAL_TEXT } from '../utils/format';

const SIGNAL_ICON: Record<string, string> = {
  buy: '🟢',
  wait: '🟡',
  waiting: '⏳',
  avoid: '🔴',
};

export function SignalBadge({ signal }: { signal: string }) {
  const color = signalColors[signal] ?? colors.textDim;
  const text = SIGNAL_TEXT[signal] ?? signal;
  const icon = SIGNAL_ICON[signal] ?? '•';
  return (
    <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color }]}>
      <Text style={[styles.text, { color }]}>{icon} {text}</Text>
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
