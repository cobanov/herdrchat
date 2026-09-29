import { Pressable, View } from 'react-native';

import { Glass } from '@/components/Glass';
import { Text } from '@/components/Text';
import { haptics } from '@/lib/haptics';
import type { SlashCommand } from '@/lib/slashCommands';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

/**
 * The slash commands that match what is being typed, above the composer.
 *
 * A pick fills the composer rather than sending: `/effort` takes an argument,
 * and a command sent by a tap nobody meant is a panel opened on the terminal.
 */
export function CommandSuggestions({
  commands,
  onPick,
}: {
  commands: readonly SlashCommand[];
  onPick: (command: SlashCommand) => void;
}) {
  const { colors } = useTheme();
  return (
    <Glass testID="command-suggestions" style={{ borderRadius: radius.lg, overflow: 'hidden', paddingVertical: spacing.xs }}>
      {commands.map((command) => (
        <Pressable
          key={command.name}
          onPress={() => {
            haptics.selection();
            onPick(command);
          }}
          accessibilityRole="button"
          accessibilityLabel={`/${command.name}. ${command.detail}`}
          testID={`command-suggestion-${command.name}`}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'baseline',
            gap: spacing.md,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.sm,
            backgroundColor: pressed ? colors.fillSubtle : 'transparent',
          })}>
          <Text variant="subhead" weight="600" mono>
            /{command.name}
          </Text>
          <View style={{ flex: 1 }}>
            <Text variant="footnote" color="secondary" numberOfLines={1}>
              {command.detail}
            </Text>
          </View>
        </Pressable>
      ))}
    </Glass>
  );
}
