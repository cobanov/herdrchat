import { View } from 'react-native';

import { Glass } from '@/components/Glass';
import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, size, spacing } from '@/theme/tokens';

/**
 * One line above the composer while the draft starts with `!` in a Claude
 * chat: the line will run in the agent's shell, as it would typed into the
 * terminal, and Claude will not see it. Drawn like the `/` palette, which sits
 * in the same place for the same kind of reason.
 */
export function ShellHint() {
  const { colors } = useTheme();
  return (
    <Glass testID="shell-hint" style={{ borderRadius: radius.lg, overflow: 'hidden' }}>
      <View
        accessible
        accessibilityRole="text"
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}>
        <Icon name="terminal" size={size.toolGlyph} tintColor={colors.secondaryLabel} fallback={<Text color="secondary">$</Text>} />
        <Text variant="footnote" color="secondary" style={{ flexShrink: 1 }}>
          Runs in the agent&apos;s shell, not sent to Claude
        </Text>
      </View>
    </Glass>
  );
}
