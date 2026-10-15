import { View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { size, spacing } from '@/theme/tokens';
import type { MachineNoticeRow } from './useHostChats';

/**
 * One line per machine whose last poll failed, below the rows.
 *
 * Never the list's error: the host answered, and its own chats are fine. The
 * machine's rows stay as last seen above, so the line says why they stopped
 * moving rather than taking them away.
 */
export function MachineNotices({ notices }: { notices: readonly MachineNoticeRow[] }) {
  const { colors } = useTheme();
  if (notices.length === 0) return null;
  return (
    <View style={{ gap: spacing.xs, paddingTop: spacing.sm }}>
      {notices.map((notice) => (
        <View
          key={notice.machineId}
          testID={`machine-notice-${notice.machineId}`}
          accessible
          accessibilityLabel={notice.text}
          style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.xs }}>
          <Icon name="exclamationmark.triangle" size={size.rowBadgeGlyph} tintColor={colors.secondaryLabel} />
          {/* Whole, not cut to two lines: a refused login or an untrusted
              host key says what to change on the host, and that is the end of
              the sentence. */}
          <Text variant="footnote" color="secondary" style={{ flex: 1, minWidth: 0 }}>
            {notice.text}
          </Text>
        </View>
      ))}
    </View>
  );
}
