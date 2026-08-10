import { Pressable, ScrollView } from 'react-native';

import { Text } from '@/components/Text';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

/**
 * Recently sent prompts, as tappable chips above the composer.
 *
 * Typing on a phone is far more expensive than typing at a desk, and the same
 * handful of instructions come up over and over — "run the tests", "commit and
 * push", "keep going". This is the shortcut, borrowed from the Raycast
 * extension's prompt history and adapted to a surface with no keyboard
 * shortcuts to hang it off.
 *
 * Two deliberate restraints. It only appears when the composer is EMPTY, so it
 * never competes with something half-typed or covers the conversation while
 * someone is writing. And tapping fills the composer instead of sending — these
 * are instructions that act on a repository, and one that is nearly right needs
 * editing before it goes.
 */
export function PromptHistory({
  prompts,
  onPick,
}: {
  prompts: readonly string[];
  onPick: (text: string) => void;
}) {
  const { colors } = useTheme();
  if (prompts.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      contentContainerStyle={{ gap: spacing.xs, paddingHorizontal: spacing.md }}
      style={{ marginBottom: spacing.xs }}>
      {prompts.map((prompt) => (
        <Pressable
          key={prompt}
          onPress={() => {
            haptics.selection();
            onPick(prompt);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Reuse prompt: ${prompt}`}
          testID="prompt-chip"
          style={{
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.xs,
            borderRadius: radius.lg,
            backgroundColor: colors.secondarySystemBackground,
            borderWidth: 1,
            borderColor: colors.separator,
            maxWidth: 260,
          }}>
          {/* One line: a chip is a reminder of what you sent, not the text
              itself. The full prompt lands in the composer where it can be read
              and edited. */}
          <Text variant="footnote" color="secondary" numberOfLines={1}>
            {prompt}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
