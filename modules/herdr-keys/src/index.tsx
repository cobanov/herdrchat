import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import { Platform, View, type ViewProps } from 'react-native';

export interface SubmitShortcutViewProps extends ViewProps {
  /** Command-Return on a hardware keyboard, while a field inside has focus. */
  onSubmitShortcut: () => void;
  /**
   * Shift-Return on a hardware keyboard. Given, the key is taken from the text
   * field and reported here, because a field that sends on Return cannot tell
   * Shift-Return apart from it. Left out, Shift-Return is the field's own.
   */
  onNewlineShortcut?: () => void;
}

type NativeProps = ViewProps & {
  onSubmitShortcut: () => void;
  onNewlineShortcut: () => void;
  newlineShortcut: boolean;
};

// iOS only, and only in a build that contains the module: Android has no
// implementation, and Jest or an older dev client has no native side. Either
// way the children still render, in a plain view.
const Native: ComponentType<NativeProps> | null =
  Platform.OS === 'ios' && requireOptionalNativeModule('HerdrKeys') !== null
    ? requireNativeView<NativeProps>('HerdrKeys')
    : null;

/**
 * A container that turns Command-Return into `onSubmitShortcut`, and
 * optionally Shift-Return into `onNewlineShortcut`, while the text field inside
 * it is focused. The shortcuts iPad users expect from a chat composer (#113);
 * without a hardware keyboard it is an ordinary view.
 */
export function SubmitShortcutView({ onSubmitShortcut, onNewlineShortcut, ...props }: SubmitShortcutViewProps) {
  if (Native === null) return <View {...props} />;
  return (
    <Native
      {...props}
      onSubmitShortcut={() => onSubmitShortcut()}
      onNewlineShortcut={() => onNewlineShortcut?.()}
      newlineShortcut={onNewlineShortcut !== undefined}
    />
  );
}
