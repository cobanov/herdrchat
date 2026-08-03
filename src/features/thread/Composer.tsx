import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Platform, Pressable, TextInput } from 'react-native';

import { Glass } from '@/components/Glass';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { composerLineHeight, radius, spacing, typography } from '@/theme/tokens';

/**
 * A floating pill that hovers above the keyboard, with the send control inside
 * it on the trailing edge.
 *
 * No full-width bar behind it: the pill sits on the chat background with
 * breathing room on every side, so there is no flat edge trying — and failing —
 * to meet the keyboard's rounded top.
 */
export function Composer({
  onSend,
  disabled = false,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState('');
  const canSend = draft.trim().length > 0 && !disabled;

  const send = () => {
    if (!canSend) return;
    if (Platform.OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSend(draft);
    setDraft('');
  };

  return (
    <Glass
      style={{
        borderRadius: radius.composer,
        overflow: 'hidden',
        flexDirection: 'row',
        // `flex-end`, not centre: as the field grows the send control stays
        // beside the LAST line, the way Messages does it. Centred, it drifts
        // into the middle of a tall pill and looks unmoored from the text.
        alignItems: 'flex-end',
        gap: spacing.xs + 2,
      }}>
      <TextInput
        testID="composer-input"
        accessibilityLabel="Message"
        placeholder="Message"
        placeholderTextColor={colors.tertiaryLabel}
        value={draft}
        onChangeText={setDraft}
        multiline
        style={{
          flex: 1,
          minHeight: composerLineHeight,
          maxHeight: composerLineHeight * 5,
          paddingLeft: spacing.lg,
          paddingVertical: spacing.sm,
          color: colors.label,
          fontSize: typography.body.fontSize,
        }}
      />
      <Pressable
        onPress={send}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Send"
        accessibilityState={{ disabled: !canSend }}
        testID="composer-send"
        style={{ padding: spacing.xs + 1, opacity: canSend ? 1 : 0.35 }}>
        <SymbolView
          name="arrow.up.circle.fill"
          size={30}
          type="hierarchical"
          tintColor={canSend ? colors.tint : colors.secondaryLabel}
          fallback={<Text variant="title2" color={canSend ? 'tint' : 'secondary'}>↑</Text>}
        />
      </Pressable>
    </Glass>
  );
}
