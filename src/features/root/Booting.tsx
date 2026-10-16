import { ActivityIndicator, useColorScheme, View } from 'react-native';

import { darkPalette, lightPalette } from '@/theme/tokens';

/**
 * Shown while the database opens. Outside `AppTheme` by necessity — the theme
 * provider needs the database this is waiting on — so it reads the system scheme
 * directly rather than going without a background and flashing white.
 */
export function Booting() {
  const scheme = useColorScheme();
  const colors = scheme === 'dark' ? darkPalette : lightPalette;
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.systemBackground,
      }}>
      <ActivityIndicator color={colors.tint} />
    </View>
  );
}
