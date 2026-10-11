import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import { Platform, View, type ViewProps } from 'react-native';

export interface EscapeKeyViewProps extends ViewProps {
  /** While true, Esc on a hardware keyboard calls `onEscape`. */
  active: boolean;
  onEscape: () => void;
}

type NativeProps = ViewProps & { active: boolean; onEscape: () => void };

// iOS only, and only in a build that contains the module: Android, Jest and
// an older dev client have no native side, and get a plain view (Esc then
// does nothing; the card's own close and a tap outside still work).
const Native: ComponentType<NativeProps> | null =
  Platform.OS === 'ios' && requireOptionalNativeModule('HerdrEscape') !== null
    ? requireNativeView<NativeProps>('HerdrEscape')
    : null;

/**
 * A container that turns Esc into `onEscape` while `active`. It takes keyboard
 * focus to hear the key, since with nothing focused UIKit asks no view at all,
 * so keep it active only while what it holds is meant to be closed by Esc.
 */
export function EscapeKeyView({ active, onEscape, ...props }: EscapeKeyViewProps) {
  if (Native === null) return <View {...props} />;
  return <Native {...props} active={active} onEscape={() => onEscape()} />;
}
