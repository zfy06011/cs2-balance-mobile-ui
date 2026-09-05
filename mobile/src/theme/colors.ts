export const colors = {
  bg: '#0B1220',
  card: '#151E2E',
  cardAlt: '#1B2740',
  border: '#24334D',
  text: '#E9EEF7',
  textDim: '#8FA0BC',
  primary: '#3B82F6',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#38BDF8',
  gold: '#FACC15',
};

export const signalColors: Record<string, string> = {
  buy: colors.success,
  waiting: colors.warning,
  wait: colors.warning,
  avoid: colors.danger,
  waiting2: colors.textDim,
};

export const riskColors: Record<string, string> = {
  low: colors.success,
  medium: colors.warning,
  high: colors.danger,
};
