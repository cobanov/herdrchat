import { View } from 'react-native';

import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { screenPadding, spacing } from '@/theme/tokens';

/**
 * A shaped skeleton rather than a bare spinner: the row layout is known, so
 * showing it stops the list from jumping when data lands.
 */
export function SkeletonRows() {
  const { colors } = useTheme();
  return (
    <View style={{ paddingHorizontal: screenPadding, paddingTop: spacing.sm, gap: spacing.lg }}>
      {[0, 1, 2, 3].map((index) => (
        <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View
            style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.fillSubtle }}
          />
          <View style={{ flex: 1, gap: spacing.sm }}>
            <View style={{ height: 14, width: '45%', borderRadius: 7, backgroundColor: colors.fillSubtle }} />
            <View style={{ height: 12, width: '75%', borderRadius: 6, backgroundColor: colors.fillSubtle }} />
          </View>
        </View>
      ))}
      <Text variant="footnote" color="tertiary" style={{ textAlign: 'center' }}>
        Connecting…
      </Text>
    </View>
  );
}
