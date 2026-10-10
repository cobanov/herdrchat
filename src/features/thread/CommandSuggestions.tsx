import { Pressable, ScrollView, View } from 'react-native';

import { Glass } from '@/components/Glass';
import { Text } from '@/components/Text';
import { haptics } from '@/lib/haptics';
import type { CatalogueCommand, CommandSection, PaletteSection } from '@/lib/slashCommands';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, size, spacing } from '@/theme/tokens';

const SECTION_TITLES: Record<CommandSection, string> = {
  builtin: 'Built-in',
  skills: 'Skills',
  commands: 'Commands',
  plugins: 'Plugins',
};

/**
 * A command's `testID`: `command-suggestion-<name>`, with the `:` of a
 * namespaced name (`notes:summarise`, `demo-tools:lint`) as `-`, so a Maestro
 * flow can name it without escaping.
 */
export function commandTestID(name: string): string {
  return `command-suggestion-${name.replace(/:/g, '-')}`;
}

/**
 * The `/` palette above the composer: every command the agent's terminal
 * would list for what has been typed, in its sections (Built-in, Skills,
 * Commands, Plugins), scrolling past `size.commandPaletteMaxHeight`.
 *
 * Each row is the name, the argument hint after it when the command takes
 * one, and its description. What a pick does is the caller's
 * (`pickSlashCommand`): a command that takes nothing is sent, one that takes
 * something is filled in.
 *
 * Taps never take the keyboard down (`keyboardShouldPersistTaps`): the
 * composer keeps its focus, so a filled command is ready for its argument.
 */
export function CommandSuggestions({
  sections,
  onPick,
}: {
  sections: readonly PaletteSection[];
  onPick: (command: CatalogueCommand) => void;
}) {
  const { colors } = useTheme();
  return (
    <Glass testID="command-suggestions" style={{ borderRadius: radius.lg, overflow: 'hidden' }}>
      <ScrollView
        testID="command-palette"
        style={{ maxHeight: size.commandPaletteMaxHeight }}
        contentContainerStyle={{ paddingVertical: spacing.xs }}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="none">
        {sections.map(({ section, commands }) => (
          <View key={section}>
            <Text
              testID={`command-section-${section}`}
              variant="caption"
              weight="600"
              color="tertiary"
              accessibilityRole="header"
              style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxs }}>
              {SECTION_TITLES[section].toUpperCase()}
            </Text>
            {commands.map((command) => (
              <Pressable
                key={`${command.source}:${command.name}`}
                onPress={() => {
                  haptics.selection();
                  onPick(command);
                }}
                accessibilityRole="button"
                accessibilityLabel={[`/${command.name}`, command.argumentHint, command.description]
                  .filter((part): part is string => part !== null && part !== '')
                  .join('. ')}
                testID={commandTestID(command.name)}
                style={({ pressed }) => ({
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.xs,
                  backgroundColor: pressed ? colors.fillSubtle : 'transparent',
                })}>
                <Text variant="subhead" numberOfLines={1}>
                  <Text variant="subhead" weight="600" mono>
                    /{command.name}
                  </Text>
                  {command.argumentHint !== null && (
                    <Text variant="subhead" color="tertiary" mono testID={`${commandTestID(command.name)}-hint`}>
                      {` ${command.argumentHint}`}
                    </Text>
                  )}
                </Text>
                {command.description !== '' && (
                  <Text variant="footnote" color="secondary" numberOfLines={1}>
                    {command.description}
                  </Text>
                )}
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </Glass>
  );
}
