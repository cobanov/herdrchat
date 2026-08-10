import { View } from 'react-native';

import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, spacing } from '@/theme/tokens';
import { AVATAR_SIZE } from './ChatRow';

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
          {/* The real avatar's size, imported rather than copied — and
              `radius.full` rather than half of it, so the circle stays a circle
              without a second number to keep in step. */}
          <View
            style={{
              width: AVATAR_SIZE,
              height: AVATAR_SIZE,
              borderRadius: radius.full,
              backgroundColor: colors.fillSubtle,
            }}
          />
          <View style={{ flex: 1, gap: spacing.sm }}>
            <View style={{ height: spacing.lg, width: '45%', borderRadius: radius.full, backgroundColor: colors.fillSubtle }} />
            <View style={{ height: spacing.md, width: '75%', borderRadius: radius.full, backgroundColor: colors.fillSubtle }} />
          </View>
        </View>
      ))}
      <Text variant="footnote" color="tertiary" style={{ textAlign: 'center' }}>
        Connecting…
      </Text>
    </View>
  );
}
