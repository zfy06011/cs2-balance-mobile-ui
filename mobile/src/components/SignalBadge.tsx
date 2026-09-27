import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, signalColors } from '../theme/colors';
import { SIGNAL_TEXT } from '../utils/format';

export const SignalBadge = React.memo(function SignalBadge({ signal }: { signal: string }) {
  const color = signalColors[signal] ?? colors.textDim;
  const text = SIGNAL_TEXT[signal] ?? signal;
  return (
    <View style={[styles.badge, { backgroundColor: color + '12', borderColor: color + '40' }]} accessibilityLabel={text}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.text, { color }]}>{text}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  badge: {
    minHeight: 28,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 11, fontWeight: '700' },
});
