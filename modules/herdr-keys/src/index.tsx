import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import { Platform, View, type ViewProps } from 'react-native';

export interface SubmitShortcutViewProps extends ViewProps {
  /** Command-Return on a hardware keyboard, while a field inside has focus. */
  onSubmitShortcut: () => void;
}

type NativeProps = ViewProps & { onSubmitShortcut: () => void };

// iOS only, and only in a build that contains the module: Android has no
// implementation, and Jest or an older dev client has no native side. Either
// way the children still render, in a plain view.
const Native: ComponentType<NativeProps> | null =
  Platform.OS === 'ios' && requireOptionalNativeModule('HerdrKeys') !== null
    ? requireNativeView<NativeProps>('HerdrKeys')
    : null;

/**
 * A container that turns Command-Return into `onSubmitShortcut` while the text
 * field inside it is focused. The shortcut iPad users expect from a chat
 * composer (#113); without a hardware keyboard it is an ordinary view.
 */
export function SubmitShortcutView({ onSubmitShortcut, ...props }: SubmitShortcutViewProps) {
  if (Native === null) return <View {...props} />;
  return <Native {...props} onSubmitShortcut={() => onSubmitShortcut()} />;
}
