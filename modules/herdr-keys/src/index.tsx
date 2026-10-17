import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import { View, type ViewProps } from 'react-native';

export interface SubmitShortcutViewProps extends ViewProps {
  /** Command-Return on a hardware keyboard, while a field inside has focus. */
  onSubmitShortcut: () => void;
  /**
   * Plain Return on a hardware keyboard. Given, the key is taken from the text
   * field and reported here; the software keyboard's Return is never a key
   * command, so it stays the field's own newline. Left out, Return is the
   * field's own everywhere.
   */
  onReturnShortcut?: () => void;
  /**
   * Shift-Return or Option-Return on a hardware keyboard, saying which. Given,
   * the key is taken from the text field and reported here. Left out, both are
   * the field's own.
   */
  onNewlineShortcut?: (modifiers: NewlineModifiers) => void;
  /**
   * Command-V with only a picture on the pasteboard. Given, that one paste is
   * taken from the text field and reported here; any paste with text in it is
   * still the field's own. Left out, Command-V is entirely the field's.
   */
  onPasteShortcut?: (pasteboard: PasteboardKinds) => void;
}

/** Which modifier made a newline shortcut. */
export interface NewlineModifiers {
  shift: boolean;
  option: boolean;
}

/** What the pasteboard held when Command-V was pressed. */
export interface PasteboardKinds {
  hasImage: boolean;
  hasText: boolean;
}

type NativeProps = ViewProps & {
  onSubmitShortcut: () => void;
  onReturnShortcut: () => void;
  onNewlineShortcut: (event: { nativeEvent: NewlineModifiers }) => void;
  onPasteShortcut: (event: { nativeEvent: PasteboardKinds }) => void;
  returnShortcut: boolean;
  newlineShortcut: boolean;
  pasteShortcut: boolean;
};

// Only in a build that contains the module: Jest or an older dev client has
// no native side, and the children still render, in a plain view.
const Native: ComponentType<NativeProps> | null =
  requireOptionalNativeModule('HerdrKeys') !== null
    ? requireNativeView<NativeProps>('HerdrKeys')
    : null;

/**
 * A container that turns Command-Return into `onSubmitShortcut`, and
 * optionally Return into `onReturnShortcut`, Shift-Return and Option-Return
 * into `onNewlineShortcut` and a pasted picture into `onPasteShortcut`, while
 * the text field inside it is focused. The shortcuts people expect from a chat
 * composer on a hardware keyboard (#113, #155); without one it is an ordinary
 * view. On Android the same keys with Ctrl (or Meta) for Command, and Alt for
 * Option.
 */
export function SubmitShortcutView({
  onSubmitShortcut,
  onReturnShortcut,
  onNewlineShortcut,
  onPasteShortcut,
  ...props
}: SubmitShortcutViewProps) {
  if (Native === null) return <View {...props} />;
  return (
    <Native
      {...props}
      onSubmitShortcut={() => onSubmitShortcut()}
      onReturnShortcut={() => onReturnShortcut?.()}
      returnShortcut={onReturnShortcut !== undefined}
      onNewlineShortcut={(event) => onNewlineShortcut?.(event.nativeEvent)}
      newlineShortcut={onNewlineShortcut !== undefined}
      onPasteShortcut={(event) => onPasteShortcut?.(event.nativeEvent)}
      pasteShortcut={onPasteShortcut !== undefined}
    />
  );
}
