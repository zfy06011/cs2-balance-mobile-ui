import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius, space } from '../theme/colors';

export const Card = React.memo(function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
});

export const SectionTitle = React.memo(function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
});

export const Row = React.memo(function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.card,
    marginBottom: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
    marginBottom: 10,
    letterSpacing: 0.8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
  },
  label: { color: colors.textDim, fontSize: 13, flexShrink: 1 },
  value: { color: colors.text, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'], textAlign: 'right', flexShrink: 1 },
});
