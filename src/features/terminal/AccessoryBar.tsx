import { Pressable, ScrollView, View } from 'react-native';

import { Glass } from '@/components/Glass';
import { Icon, type IconName } from '@/components/Icon';
import { Text } from '@/components/Text';
import { haptics } from '@/lib/haptics';
import { ACCESSORY_KEYS, encodeKey, type AccessoryKey } from '@/lib/terminal/keys';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, radius, screenPadding, spacing, terminal } from '@/theme/tokens';

/** The bar's sticky modifiers: held from a tap until the next key, here or on the keyboard. */
export interface StickyModifiers {
  control: boolean;
  alt: boolean;
}

/**
 * The keys a phone's keyboard does not have, above it: Esc, Tab, Ctrl and Alt
 * (sticky), the arrows, the punctuation a shell wants most, Home and End,
 * then Paste and the keyboard's own show/hide.
 *
 * A key here is written to the shell as xterm encodes it (`encodeKey`), with
 * the held modifiers, which it then lets go. Ctrl and Alt also reach the
 * software keyboard through the view (`controlModifier`/`metaModifier`), so
 * Ctrl then C typed on the keyboard is a Ctrl-C; a hardware keyboard has its
 * own and never needs these.
 */
export function AccessoryBar({ modifiers, onModifiers, onSend, onPaste, keyboardShown, onToggleKeyboard, disabled }: {
  modifiers: StickyModifiers;
  onModifiers: (next: StickyModifiers) => void;
  /** The bytes of one key press. */
  onSend: (text: string) => void;
  onPaste: () => void;
  keyboardShown: boolean;
  onToggleKeyboard: () => void;
  /** No shell to send to: the keys stay, dimmed, so the bar does not jump. */
  disabled: boolean;
}) {
  const press = (key: AccessoryKey) => {
    haptics.selection();
    if (key.modifier === 'control') return onModifiers({ ...modifiers, control: !modifiers.control });
    if (key.modifier === 'alt') return onModifiers({ ...modifiers, alt: !modifiers.alt });
    if (key.press === null) return;
    onSend(encodeKey(key.press, modifiers));
    if (modifiers.control || modifiers.alt) onModifiers({ control: false, alt: false });
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: screenPadding, paddingVertical: spacing.xs }}>
      <Glass style={{ flex: 1, minWidth: 0, borderRadius: radius.full, overflow: 'hidden' }}>
        <ScrollView
          horizontal
          testID="terminal-keys"
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          contentContainerStyle={{ alignItems: 'center', gap: terminal.keyGap, paddingHorizontal: spacing.xs, paddingRight: terminal.barTail }}>
          {ACCESSORY_KEYS.map((key) => {
            const held = (key.modifier === 'control' && modifiers.control) || (key.modifier === 'alt' && modifiers.alt);
            return (
              <BarKey
                key={key.id}
                testID={`terminal-key-${key.id}`}
                label={key.label}
                accessibilityLabel={key.accessibilityLabel}
                held={held}
                sticky={key.modifier !== undefined}
                disabled={disabled}
                onPress={() => press(key)}
              />
            );
          })}
        </ScrollView>
      </Glass>
      <GlyphKey testID="terminal-paste" symbol="doc.on.clipboard" label="Paste" fallback="⎘" disabled={disabled} onPress={onPaste} />
      <GlyphKey
        testID="terminal-keyboard"
        symbol={keyboardShown ? 'keyboard.chevron.compact.down' : 'keyboard'}
        label={keyboardShown ? 'Hide keyboard' : 'Show keyboard'}
        fallback="⌨"
        disabled={false}
        onPress={onToggleKeyboard}
      />
    </View>
  );
}

function BarKey({ testID, label, accessibilityLabel, held, sticky, disabled, onPress }: {
  testID: string;
  label: string;
  accessibilityLabel: string;
  held: boolean;
  sticky: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={sticky ? 'togglebutton' : 'button'}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={sticky ? { checked: held, disabled } : { disabled }}
      testID={testID}
      style={({ pressed }) => ({
        minWidth: minTouchTarget,
        height: minTouchTarget,
        paddingHorizontal: spacing.sm,
        borderRadius: radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: held ? colors.tint : pressed ? colors.fillSubtle : 'transparent',
        opacity: disabled ? terminal.disabledOpacity : 1,
      })}>
      <Text variant="subhead" mono weight="600" color={held ? 'onTint' : 'label'}>
        {label}
      </Text>
    </Pressable>
  );
}

function GlyphKey({ testID, symbol, label, fallback, disabled, onPress }: {
  testID: string;
  symbol: IconName;
  label: string;
  fallback: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Glass interactive style={{ borderRadius: radius.full, overflow: 'hidden' }}>
      <Pressable
        onPress={() => {
          haptics.selection();
          onPress();
        }}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        testID={testID}
        style={{ width: minTouchTarget, height: minTouchTarget, alignItems: 'center', justifyContent: 'center', opacity: disabled ? terminal.disabledOpacity : 1 }}>
        <Icon name={symbol} size={terminal.glyph} tintColor={colors.label} fallback={<Text>{fallback}</Text>} />
      </Pressable>
    </Glass>
  );
}
