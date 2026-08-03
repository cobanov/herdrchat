import { Pressable, ScrollView, View } from 'react-native';

import { Glass } from '@/components/Glass';
import { haptics } from '@/lib/haptics';
import { Text } from '@/components/Text';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { optionKeys, type BlockedPrompt } from '@/lib/transcript/blockedPrompt';

/**
 * Shown when an agent is waiting for input.
 *
 * When the pane's menu could be parsed, this shows the real question and one
 * full-width button per option labelled with its actual text — so you can see
 * what you are picking. That matters more here than anywhere else in the app:
 * the choices are frequently "allow this once" versus "allow this always", and
 * a bare "1 / 2" makes the destructive one indistinguishable from the safe one.
 *
 * When nothing could be parsed it falls back to generic chips rather than
 * inventing labels.
 */
export function BlockedBar({
  prompt,
  onKeys,
}: {
  prompt: BlockedPrompt | null;
  onKeys: (keys: readonly string[]) => void;
}) {
  const { colors } = useTheme();

  const press = (keys: readonly string[]) => {
    haptics.selection();
    onKeys(keys);
  };

  return (
    <Glass
      testID="blocked-bar"
      style={{
        borderRadius: radius.lg,
        overflow: 'hidden',
        padding: spacing.md,
        gap: spacing.sm,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 }}>
        <Icon
          name="exclamationmark.bubble.fill"
          size={14}
          tintColor={colors.attention}
          fallback={<Text variant="footnote" color="attention">!</Text>}
        />
        <Text variant="footnote" color="attention" weight="600" style={{ flex: 1 }}>
          {prompt?.question ?? 'Agent is waiting'}
        </Text>
      </View>

      {prompt !== null && prompt.options.length > 0 ? (
        prompt.options.map((option) => (
          <Pressable
            key={option.number}
            onPress={() => press(optionKeys(option))}
            accessibilityRole="button"
            accessibilityLabel={`Option ${option.number}: ${option.label}`}
            testID={`blocked-option-${option.number}`}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: spacing.sm,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm + 1,
              borderRadius: radius.sm,
              backgroundColor: pressed ? colors.fillSubtle : `${colors.attention}1F`,
            })}>
            <Text
              variant="footnote"
              color="attention"
              weight="700"
              style={{ fontVariant: ['tabular-nums'], minWidth: 16, textAlign: 'right' }}>
              {option.number}
            </Text>
            <Text variant="subhead" style={{ flex: 1 }}>
              {option.label}
            </Text>
          </Pressable>
        ))
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Chip label="Confirm" onPress={() => press(['Enter'])} />
            <Chip label="1" onPress={() => press(['1', 'Enter'])} />
            <Chip label="2" onPress={() => press(['2', 'Enter'])} />
            <Chip label="Esc" onPress={() => press(['Escape'])} />
          </View>
        </ScrollView>
      )}
    </Glass>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`blocked-chip-${label}`}
      style={({ pressed }) => ({
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        borderRadius: radius.full,
        backgroundColor: pressed ? colors.fillSubtle : `${colors.attention}1F`,
      })}>
      <Text variant="subhead" color="attention" weight="600">
        {label}
      </Text>
    </Pressable>
  );
}
