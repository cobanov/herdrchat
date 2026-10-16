import { ActivityIndicator } from 'react-native';

import { Icon } from '@/components/Icon';
import { shownStatus } from '@/lib/statusMark';
import type { AgentStatus } from '@/lib/herdr/models';
import { useTheme } from '@/theme/ThemeProvider';
import { size, STATUS_COLORS } from '@/theme/tokens';

const GLYPH = {
  blocked: 'exclamationmark.circle',
  working: 'ellipsis.circle',
  done: 'circle.fill',
  idle: 'circle',
  unknown: 'circle',
} as const;

/** A row's state mark, in herdr's colours (`shownStatus`): a spinner while working. */
export function StatusMark({ status, unread }: { status: AgentStatus; unread: boolean }) {
  const { colors, scheme, reduceMotion } = useTheme();
  const shown = shownStatus(status, unread);
  const tint = shown === 'unknown' ? colors.secondaryLabel : STATUS_COLORS[scheme === 'dark' ? 'dark' : 'light'][shown];
  if (shown === 'working' && !reduceMotion) return <ActivityIndicator size="small" color={tint} />;
  return <Icon name={GLYPH[shown]} size={size.rowStatusGlyph} tintColor={tint} />;
}
