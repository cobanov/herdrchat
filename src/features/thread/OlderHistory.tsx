import { ActivityIndicator, View } from 'react-native';

import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

/**
 * The top of a thread: either history still being fetched, or the fact that
 * there is none left.
 *
 * It always occupies a row rather than collapsing to nothing, because this sits
 * above the oldest bubble in a list that anchors itself to the bottom. A header
 * that appeared and disappeared would change the content height under that
 * anchor, and the reader would see the conversation twitch as they scrolled.
 */
export function OlderHistory({
  loading,
  reachedStart,
}: {
  loading: boolean;
  reachedStart: boolean;
}) {
  const { colors } = useTheme();

  return (
    <View
      style={{
        minHeight: spacing.xl,
        alignItems: 'center',
        justifyContent: 'center',
        paddingBottom: spacing.sm,
      }}>
      {loading ? (
        <ActivityIndicator color={colors.secondaryLabel} />
      ) : reachedStart ? (
        <Text variant="caption2" color="tertiary">
          Beginning of conversation
        </Text>
      ) : null}
    </View>
  );
}
