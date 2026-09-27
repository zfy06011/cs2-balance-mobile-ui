import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../theme/colors';

export type AppTabIconName = 'home' | 'market' | 'inventory' | 'radar' | 'settings';

interface Props {
  readonly name: AppTabIconName;
  readonly selected: boolean;
}

const ICON_PATHS: Record<AppTabIconName, readonly string[]> = {
  home: ['M3 10.5 12 3l9 7.5', 'M5 9v12h14V9', 'M9 21v-7h6v7'],
  market: ['M4 8h16l-1.2 13H5.2L4 8Z', 'M8 8V6a4 4 0 0 1 8 0v2'],
  inventory: ['m12 3 9 4.5-9 4.5-9-4.5L12 3Z', 'M3 7.5v9L12 21l9-4.5v-9', 'M12 12v9'],
  radar: ['M20.2 9A8.5 8.5 0 1 1 15 4.2', 'M12 12l7-7', 'M12 7v5h5'],
  settings: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4 21a8 8 0 0 1 16 0'],
};

export function AppTabIcon({ name, selected }: Props) {
  const color = selected ? colors.primary : colors.textDim;

  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" accessibilityElementsHidden>
      {ICON_PATHS[name].map((path) => (
        <Path
          key={path}
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}
