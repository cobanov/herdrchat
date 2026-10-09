import { useRef, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, Pressable, ScrollView, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Glass } from '@/components/Glass';
import { SubmitShortcutView } from '../../../modules/herdr-keys/src';
import { insertNewline, pasteAction, returnAction } from '@/lib/composerKeys';
import { haptics } from '@/lib/haptics';
import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/theme/ThemeProvider';
import {
  composerMaxHeight,
  minTouchTarget,
  motion,
  radius,
  size,
  spacing,
  typography,
  useComposerMinHeight,
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
 *
 * Pictures chosen for the message wait above the text as thumbnails, each with
 * its own remove badge, and a message may be pictures alone.
 */
export function Composer({
  onSend,
  disabled = false,
  draft,
  onDraftChange,
  attachments = [],
  onAttach,
  onRemoveAttachment,
  uploading = false,
  onPasteImage,
}: {
  /** Resolves `false` when the message was not taken, and the draft comes back. */
  onSend: (text: string) => Promise<boolean> | void;
  disabled?: boolean;
  /** Pictures waiting to go with the message. The parent owns them. */
  attachments?: readonly { name: string; uri: string }[];
  /** Offer a picture. Without it there is no picture button. */
  onAttach?: () => void;
  onRemoveAttachment?: (name: string) => void;
  /** Pictures are on their way to the host: the send control shows it. */
  uploading?: boolean;
  /**
   * Attach the picture on the pasteboard, for Command-V on a hardware
   * keyboard. Leave it out when there is no room for another picture: then
   * Command-V is the text field's own paste and nothing else.
   */
  onPasteImage?: () => void;
  /**
   * The draft lives in the parent so a prompt-history chip can fill it. Kept
   * controlled rather than exposing an imperative `setText` handle, because the
   * parent already needs to know whether the composer is empty — that is what
   * decides whether the history chips are shown at all.
   */
  draft: string;
  onDraftChange: (text: string) => void;
}) {
  const { colors, reduceMotion } = useTheme();
  const minHeight = useComposerMinHeight();
  const [focused, setFocused] = useState(false);
  const draftEmpty = draft.trim().length === 0 && attachments.length === 0;
  const canSend = !draftEmpty && !disabled;
  const returnSends = useSettings((state) => state.returnSends);
  const input = useRef<TextInput>(null);
  // Where the caret is, for Shift-Return to put its newline. Only the native
  // side knows; it reports every move, and nothing renders from it.
  const selection = useRef({ start: 0, end: 0 });

  const sendScale = useSharedValue(1);
  const sendStyle = useAnimatedStyle(() => ({ transform: [{ scale: sendScale.get() }] }));

  const send = () => {
    if (!canSend) return;
    haptics.light();
    const text = draft;
    onDraftChange('');
    // A refusal (another send still in flight, the chat just changed hands)
    // answers at once, so putting the draft back cannot overwrite anything
    // typed since. It used to be cleared regardless, and the text was lost.
    void Promise.resolve(onSend(text)).then((accepted) => {
      if (accepted === false) onDraftChange(text);
    });
  };

  const newline = () => {
    const { start, end } = selection.current;
    const next = insertNewline(draft, { start, end });
    selection.current = { start: next.caret, end: next.caret };
    onDraftChange(next.text);
    // The field keeps the caret's distance from the end of the text, which is
    // right after a newline typed at a caret but not after one that replaced a
    // selection. Then put it where it belongs, once the new text is on screen.
    if (start !== end) requestAnimationFrame(() => input.current?.setSelection(next.caret, next.caret));
  };

  // Every way of pressing Return asks the one table in `composerKeys`.
  const pressReturn = (modifiers: { shift: boolean; command: boolean }) => {
    const action = returnAction({ returnSends, draftEmpty, disabled: disabled || uploading, ...modifiers });
    if (action === 'send') send();
    else if (action === 'newline') newline();
  };

  return (
    // Command-Return sends from an iPad's hardware keyboard whichever way the
    // setting points (#113). While Return sends, Shift-Return comes through
    // here too: the text field alone cannot tell it from Return.
    <SubmitShortcutView
      onSubmitShortcut={() => pressReturn({ shift: false, command: true })}
      onNewlineShortcut={returnSends ? () => pressReturn({ shift: true, command: false }) : undefined}
      // Command-V with a lone picture attaches it; text still pastes as text.
      // Not while a send or upload is in flight, the same as the picture button.
      onPasteShortcut={
        onPasteImage !== undefined && !disabled && !uploading
          ? (pasteboard) => {
              if (pasteAction({ ...pasteboard, room: true }) === 'image') onPasteImage();
            }
          : undefined
      }>
      <Glass
        variant="regular"
        style={{
          borderRadius: radius.lg,
          overflow: 'hidden',
          // A hairline rim, brightened on focus. On glass it reads as the edge of
          // a physical surface; without it the pill dissolves into a light
          // background entirely.
          borderWidth: 1,
          borderColor: focused ? colors.tint : colors.separator,
        }}>
        {attachments.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md }}>
            {attachments.map((attachment, index) => (
              <View key={attachment.name}>
                <Image
                  source={{ uri: attachment.uri }}
                  accessibilityIgnoresInvertColors
                  style={{
                    width: size.attachmentThumb,
                    height: size.attachmentThumb,
                    borderRadius: radius.xs,
                    backgroundColor: colors.fillSubtle,
                  }}
                />
                <Pressable
                  onPress={() => onRemoveAttachment?.(attachment.name)}
                  disabled={uploading}
                  hitSlop={spacing.sm}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove picture ${index + 1}`}
                  testID={`composer-attachment-remove-${index}`}
                  // A label-coloured disc on a ring of the background, as Messages
                  // does it: a bare glyph vanished on a dark screenshot in light mode.
                  style={{
                    position: 'absolute',
                    top: spacing.xxs,
                    right: spacing.xxs,
                    width: size.attachmentRemove,
                    height: size.attachmentRemove,
                    borderRadius: radius.full,
                    backgroundColor: colors.label,
                    borderWidth: size.attachmentRemoveRing,
                    borderColor: colors.systemBackground,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <Icon
                    name="xmark"
                    size={size.attachmentRemoveGlyph}
                    tintColor={colors.systemBackground}
                    fallback={<Text variant="caption2" style={{ color: colors.systemBackground }}>✕</Text>}
                  />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}
        <View
          style={{
            flexDirection: 'row',
            // `flex-end`, not centre: as the field grows the send control stays
            // beside the LAST line, the way Messages does it. Centred, it drifts
            // into the middle of a tall pill and looks unmoored from the text.
            alignItems: 'flex-end',
          }}>
          {onAttach !== undefined && (
            <Pressable
              onPress={onAttach}
              disabled={disabled || uploading}
              accessibilityRole="button"
              accessibilityLabel="Add a picture"
              testID="composer-attach"
              style={{ width: minTouchTarget, height: minTouchTarget, alignItems: 'center', justifyContent: 'center' }}>
              <Icon
                name="photo.on.rectangle"
                size={size.composerAccessoryGlyph}
                tintColor={disabled || uploading ? colors.tertiaryLabel : colors.tint}
                fallback={<Text variant="title3" color="tint">＋</Text>}
              />
            </Pressable>
          )}
          <TextInput
            ref={input}
            testID="composer-input"
            accessibilityLabel="Message"
            placeholder="Message"
            placeholderTextColor={colors.tertiaryLabel}
            value={draft}
            onChangeText={onDraftChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSelectionChange={(event) => {
              selection.current = event.nativeEvent.selection;
            }}
            multiline
            // Return sends, from the software keyboard and a hardware one; the
            // field refuses the "\n" and reports a submit instead. Off, Return
            // is a newline as #113 made it.
            submitBehavior={returnSends ? 'submit' : 'newline'}
            returnKeyType={returnSends ? 'send' : 'default'}
            onSubmitEditing={() => pressReturn({ shift: false, command: false })}
            style={{
              flex: 1,
              minHeight,
              // Four lines, then it scrolls — see `composerMaxHeight`.
              maxHeight: composerMaxHeight,
              paddingLeft: onAttach !== undefined ? spacing.xs : spacing.lg,
              paddingRight: spacing.sm,
              // Padding rather than lineHeight, so a single line sits centred in the
              // 44pt pill while the field still grows correctly.
              paddingTop: spacing.md,
              paddingBottom: spacing.md,
              color: colors.label,
              fontSize: typography.body.fontSize,
            }}
          />

          {/* While typing, the keyboard and a long draft can take the whole
              screen and hide the chat. This puts it away without sending; the
              draft stays. */}
          {focused && (
            <Pressable
              onPress={() => Keyboard.dismiss()}
              accessibilityRole="button"
              accessibilityLabel="Hide keyboard"
              testID="composer-hide-keyboard"
              style={{ width: minTouchTarget, height: minTouchTarget, alignItems: 'center', justifyContent: 'center' }}>
              <Icon
                name="keyboard.chevron.compact.down"
                size={size.composerAccessoryGlyph}
                tintColor={colors.secondaryLabel}
                fallback={<Text variant="title3" color="secondary">⌄</Text>}
              />
            </Pressable>
          )}

          <AnimatedPressable
            onPress={send}
            onPressIn={() => {
              if (!reduceMotion) sendScale.set(withSpring(0.88, motion.press));
            }}
            onPressOut={() => sendScale.set(withSpring(1, motion.press))}
            disabled={!canSend || uploading}
            accessibilityRole="button"
            accessibilityLabel={uploading ? 'Sending pictures' : 'Send'}
            accessibilityState={{ disabled: !canSend || uploading, busy: uploading }}
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
            {uploading ? (
              <ActivityIndicator color={colors.tint} />
            ) : (
              <Icon
                name={canSend ? 'arrow.up.circle.fill' : 'arrow.up.circle'}
                size={size.composerGlyph}
                tintColor={canSend ? colors.tint : colors.tertiaryLabel}
                fallback={
                  <Text variant="title2" color={canSend ? 'tint' : 'tertiary'}>
                    ↑
                  </Text>
                }
              />
            )}
          </AnimatedPressable>
        </View>
      </Glass>
    </SubmitShortcutView>
  );
}
