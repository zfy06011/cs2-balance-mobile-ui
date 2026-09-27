export const colors = {
  bg: '#F3F0E8',
  card: '#FFFEFA',
  cardAlt: '#F8F5EE',
  surfaceRaised: '#EEE8DC',
  surfaceInset: '#F7F4ED',
  border: '#E2DACE',
  borderStrong: '#CBB8A2',
  text: '#202927',
  textDim: '#626D69',
  primary: '#B15A28',
  primaryText: '#9C4D21',
  onPrimary: '#FFFCF7',
  primarySoft: '#F7E7D9',
  primaryBorder: '#E4C3AA',
  success: '#24735A',
  warning: '#925B13',
  danger: '#AB413D',
  info: '#4B6986',
  gold: '#8D6B2B',
};

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  card: 16,
  group: 24,
  section: 32,
} as const;

export const radius = {
  sm: 10,
  md: 16,
  lg: 20,
  pill: 999,
} as const;

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
