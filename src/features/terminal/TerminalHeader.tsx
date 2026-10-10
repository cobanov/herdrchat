import { Pressable, View } from 'react-native';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Glass } from '@/components/Glass';
import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, radius, screenPadding, size, spacing } from '@/theme/tokens';
import { canReconnect, phaseLabel, phaseMessage, type TerminalPhase } from './status';

/**
 * The terminal's header: back, the pane's name with where it is and whether
 * it is connected, and Reconnect once the shell has gone.
 *
 * In the flow above the terminal, not floating over it like the thread's: a
 * terminal's top rows are its screen, and a header over them would hide the
 * one line `htop` or `vim` puts its title on.
 */
export function TerminalHeader({ title, place, phase, onBack, onReconnect }: {
  title: string;
  /** The machine's label, for a pane on one of the host's machines. */
  place: string | null;
  phase: TerminalPhase;
  onBack: () => void;
  onReconnect: () => void;
}) {
  const { colors } = useTheme();
  const subtitle = [place, phaseLabel(phase)].filter((part): part is string => part !== null).join(' · ');
  const dot = phase.kind === 'open' ? colors.positive : canReconnect(phase) ? colors.attention : colors.tertiaryLabel;
  const message = phaseMessage(phase);
  return (
    <View testID="terminal-header">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: screenPadding, paddingVertical: spacing.sm }}>
        <Glass interactive style={{ borderRadius: radius.full, overflow: 'hidden' }}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            testID="terminal-back"
            style={{ width: minTouchTarget, height: minTouchTarget, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chevron.left" size={size.headerGlyph} tintColor={colors.label} fallback={<Text>‹</Text>} />
          </Pressable>
        </Glass>
        <View style={{ flex: 1, minWidth: 0, gap: spacing.xxs }}>
          <Text testID="terminal-title" variant="headline" numberOfLines={1}>
            {title}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <View style={{ width: size.statusDot, height: size.statusDot, borderRadius: radius.full, backgroundColor: dot }} />
            <Text testID="terminal-status" variant="caption" color={canReconnect(phase) ? 'attention' : 'secondary'} numberOfLines={1} style={{ flexShrink: 1 }}>
              {subtitle}
            </Text>
          </View>
        </View>
        {canReconnect(phase) && (
          <Glass interactive style={{ borderRadius: radius.full, overflow: 'hidden' }}>
            <Pressable
              onPress={() => {
                haptics.light();
                onReconnect();
              }}
              accessibilityRole="button"
              accessibilityLabel="Reconnect"
              testID="terminal-reconnect"
              style={{ height: minTouchTarget, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <Icon name="arrow.clockwise" size={size.rowBadgeGlyph} tintColor={colors.tint} fallback={<Text color="tint">↻</Text>} />
              <Text variant="subhead" weight="600" color="tint">
                Reconnect
              </Text>
            </Pressable>
          </Glass>
        )}
      </View>
      {message !== null && <ErrorBanner message={message} />}
    </View>
  );
}
