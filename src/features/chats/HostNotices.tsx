import { View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { size, spacing } from '@/theme/tokens';
import type { HostNoticeRow } from './useHostChats';

/**
 * One line per other host whose last poll failed, below the rows.
 *
 * Never the list's error: that is the selected host's. The other host's rows
 * stay as last seen above, so the line says why they stopped moving rather
 * than taking them away.
 */
export function HostNotices({ notices }: { notices: readonly HostNoticeRow[] }) {
  const { colors } = useTheme();
  if (notices.length === 0) return null;
  return (
    <View style={{ gap: spacing.xs, paddingTop: spacing.sm }}>
      {notices.map((notice) => (
        <View
          key={notice.hostId}
          testID={`host-notice-${notice.hostId}`}
          accessible
          accessibilityLabel={notice.text}
          style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.xs }}>
          <Icon name="exclamationmark.triangle" size={size.rowBadgeGlyph} tintColor={colors.secondaryLabel} />
          {/* Whole, not cut to two lines: a refused login or an untrusted
              host key says what to change, and that is the end of the sentence. */}
          <Text variant="footnote" color="secondary" style={{ flex: 1, minWidth: 0 }}>
            {notice.text}
          </Text>
        </View>
      ))}
    </View>
  );
}
