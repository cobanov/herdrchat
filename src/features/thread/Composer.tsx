import { useState } from 'react';
import { Pressable, TextInput } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Glass } from '@/components/Glass';
import { haptics } from '@/lib/haptics';
import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeProvider';
import {
  composerLineHeight,
  minTouchTarget,
  motion,
  radius,
  spacing,
  typography,
} from '@/theme/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * The composer: a floating Liquid Glass pill with the send control inside it,
 * the way iMessage does.
 *
 * Two things this gets right that the first version did not.
 *
 * **It floats.** There is no full-width bar behind it — the pill sits on the
 * chat with real margin on every side, so there is no flat edge trying and
 * failing to meet the keyboard's rounded top, and the glass has actual content
 * behind it to refract. Glass over a flat opaque bar is invisible glass.
 *
 * **It is reachable.** The pill is a full 44pt tall and the send button is its
 * own 44pt target; the caller keeps the whole thing clear of the home
 * indicator. A control pinned to the very bottom edge of a modern iPhone is one
 * you have to aim at.
 */
export function Composer({
  onSend,
  disabled = false,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const { colors, reduceMotion } = useTheme();
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const canSend = draft.trim().length > 0 && !disabled;

  const sendScale = useSharedValue(1);
  const sendStyle = useAnimatedStyle(() => ({ transform: [{ scale: sendScale.get() }] }));

  const send = () => {
    if (!canSend) return;
    haptics.light();
    onSend(draft);
    setDraft('');
  };

  return (
    <Glass
      variant="regular"
      style={{
        borderRadius: radius.lg,
        overflow: 'hidden',
        flexDirection: 'row',
        // `flex-end`, not centre: as the field grows the send control stays
        // beside the LAST line, the way Messages does it. Centred, it drifts
        // into the middle of a tall pill and looks unmoored from the text.
        alignItems: 'flex-end',
        // A hairline rim, brightened on focus. On glass it reads as the edge of
        // a physical surface; without it the pill dissolves into a light
        // background entirely.
        borderWidth: 1,
        borderColor: focused ? colors.tint : colors.separator,
      }}>
      <TextInput
        testID="composer-input"
        accessibilityLabel="Message"
        placeholder="Message"
        placeholderTextColor={colors.tertiaryLabel}
        value={draft}
        onChangeText={setDraft}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        multiline
        style={{
          flex: 1,
          minHeight: composerLineHeight,
          // Four lines, then it scrolls. Past that the composer starts eating
          // the conversation it is meant to serve.
          maxHeight: composerLineHeight * 4,
          paddingLeft: spacing.lg,
          paddingRight: spacing.sm,
          // Padding rather than lineHeight, so a single line sits centred in the
          // 44pt pill while the field still grows correctly.
          paddingTop: spacing.md,
          paddingBottom: spacing.md,
          color: colors.label,
          fontSize: typography.body.fontSize,
        }}
      />

      <AnimatedPressable
        onPress={send}
        onPressIn={() => {
          if (!reduceMotion) sendScale.set(withSpring(0.88, motion.press));
        }}
        onPressOut={() => sendScale.set(withSpring(1, motion.press))}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Send"
        accessibilityState={{ disabled: !canSend }}
        testID="composer-send"
        // A full-size target even though the glyph is smaller, so the button is
        // hittable without aiming at it.
        style={[
          {
            width: minTouchTarget,
            height: minTouchTarget,
            alignItems: 'center',
            justifyContent: 'center',
          },
          sendStyle,
        ]}>
        <Icon
          name={canSend ? 'arrow.up.circle.fill' : 'arrow.up.circle'}
          size={28}
          tintColor={canSend ? colors.tint : colors.tertiaryLabel}
          fallback={
            <Text variant="title2" color={canSend ? 'tint' : 'tertiary'}>
              ↑
            </Text>
          }
        />
      </AnimatedPressable>
    </Glass>
  );
}
