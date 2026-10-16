import { Icon } from '@/components/Icon';
import { useDeviceIcon } from '@/state/deviceIcons';
import { useTheme } from '@/theme/ThemeProvider';
import { size } from '@/theme/tokens';

/**
 * The glyph chosen for the host or machine a row is on (Hosts), so the chats
 * of several computers in one list say which is which at a glance. Nothing
 * when none was chosen.
 */
export function DeviceIconMark({ connectionId, glyphSize = size.rowBadgeGlyph }: { connectionId: string | null | undefined; glyphSize?: number }) {
  const icon = useDeviceIcon(connectionId);
  const { colors } = useTheme();
  if (icon === null) return null;
  return <Icon name={icon} size={glyphSize} tintColor={colors.secondaryLabel} />;
}
