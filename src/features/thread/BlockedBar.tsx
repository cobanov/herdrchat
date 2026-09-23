import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { Glass } from '@/components/Glass';
import { haptics } from '@/lib/haptics';
import { Text } from '@/components/Text';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, size, spacing } from '@/theme/tokens';
import {
  CONTINUE_KEYS,
  isPendingKeys,
  optionKeys,
  type BlockedPending,
  type BlockedPrompt,
} from '@/lib/transcript/blockedPrompt';

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
 *
 * While a reply is in flight (`pending`), every option is disabled and the
 * tapped one shows a spinner: the bar only leaves when a status poll sees the
 * agent move on, and until then a second tap would send a second digit + Enter
 * into a live agent. The dim is done with colour, not opacity — this sits on
 * glass, and opacity on any part of its subtree kills the effect.
 */
export function BlockedBar({
  prompt,
  pending,
  onKeys,
}: {
  prompt: BlockedPrompt | null;
  pending: BlockedPending | null;
  onKeys: (keys: readonly string[]) => void;
}) {
  const { colors } = useTheme();
  const busy = pending !== null;

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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
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
        <>
          {prompt.options.map((option) => {
            const keys = optionKeys(option, prompt);
            // An option this app cannot type is still SHOWN, just not offered.
            // Hiding it would renumber the menu against the one on the terminal,
            // and then "option 9" means two different things in two places.
            const untypable = keys === null;
            const tapped = keys !== null && isPendingKeys(pending, keys);
            const dim = busy || untypable;
            return (
              <Pressable
                key={option.number}
                onPress={keys === null ? undefined : () => press(keys)}
                disabled={dim}
                accessibilityRole={option.checked === undefined ? 'button' : 'checkbox'}
                accessibilityLabel={
                  untypable
                    ? `Option ${option.number}: ${option.label}. Not available from this app.`
                    : `Option ${option.number}: ${option.label}`
                }
                accessibilityState={{ disabled: dim, busy: tapped, checked: option.checked }}
                testID={`blocked-option-${option.number}`}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: spacing.sm,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  borderRadius: radius.sm,
                  backgroundColor:
                    dim || pressed ? colors.fillSubtle : colors.attentionMuted,
                })}>
                {tapped ? (
                  <ActivityIndicator size="small" color={colors.attention} style={{ minWidth: size.optionNumber }} />
                ) : (
                  <Text
                    variant="footnote"
                    color={dim ? 'secondary' : 'attention'}
                    weight="700"
                    style={{ fontVariant: ['tabular-nums'], minWidth: size.optionNumber, textAlign: 'right' }}>
                    {option.number}
                  </Text>
                )}
                {option.checked !== undefined && (
                  <Icon
                    name={option.checked ? 'checkmark.square.fill' : 'square'}
                    size={16}
                    tintColor={dim ? colors.secondaryLabel : colors.attention}
                    fallback={<Text variant="subhead" color={dim ? 'secondary' : 'attention'}>{option.checked ? '☑' : '☐'}</Text>}
                  />
                )}
                <Text variant="subhead" color={dim ? 'secondary' : 'label'} style={{ flex: 1 }}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
          {prompt.multiSelect === true && (
            // Ticking sends nothing to the agent. This moves on, to the next
            // question or to the review, which is an ordinary menu.
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Chip label="Continue" keys={CONTINUE_KEYS} pending={pending} onPress={press} />
            </View>
          )}
          {prompt.options.some((option) => optionKeys(option, prompt) === null) && (
            <Text variant="caption" color="secondary">
              Options above 9 can’t be typed from here. Answer this one in the terminal.
            </Text>
          )}
        </>
      ) : prompt?.dismissOnly === true ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Chip label="Close picker" keys={['Escape']} pending={pending} onPress={press} />
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Chip label="Confirm" keys={['Enter']} pending={pending} onPress={press} />
            <Chip label="1" keys={['1', 'Enter']} pending={pending} onPress={press} />
            <Chip label="2" keys={['2', 'Enter']} pending={pending} onPress={press} />
            <Chip label="Esc" keys={['Escape']} pending={pending} onPress={press} />
          </View>
        </ScrollView>
      )}
    </Glass>
  );
}

function Chip({
  label,
  keys,
  pending,
  onPress,
}: {
  label: string;
  keys: readonly string[];
  pending: BlockedPending | null;
  onPress: (keys: readonly string[]) => void;
}) {
  const { colors } = useTheme();
  const busy = pending !== null;
  const tapped = isPendingKeys(pending, keys);
  return (
    <Pressable
      onPress={() => onPress(keys)}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy, busy: tapped }}
      testID={`blocked-chip-${label}`}
      style={({ pressed }) => ({
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        borderRadius: radius.full,
        backgroundColor: busy || pressed ? colors.fillSubtle : colors.attentionMuted,
      })}>
      {tapped ? (
        <ActivityIndicator size="small" color={colors.attention} />
      ) : (
        <Text variant="subhead" color={busy ? 'secondary' : 'attention'} weight="600">
          {label}
        </Text>
      )}
    </Pressable>
  );
}
