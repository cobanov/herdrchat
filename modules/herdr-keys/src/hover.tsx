import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import { Platform, View, type ViewProps } from 'react-native';

export interface HoverViewProps extends ViewProps {
  /** A pointer came onto the view or anything in it (`true`), or left it (`false`). */
  onHoverChange: (over: boolean) => void;
}

type NativeProps = ViewProps & { onHoverChange: (event: { nativeEvent: { over: boolean } }) => void };

// iOS only, and only in a build that contains the module. Elsewhere (Jest,
// web, an older dev client) a plain view hears the W3C pointer events where
// the platform sends them; on iOS without the module there is no hover, and a
// tap still shows what the hover would have.
const Native: ComponentType<NativeProps> | null =
  Platform.OS === 'ios' && requireOptionalNativeModule('HerdrHover') !== null
    ? requireNativeView<NativeProps>('HerdrHover')
    : null;

/**
 * A container that says when a pointer rests on it: a trackpad or mouse on
 * iPad. React Native's own `onHoverIn` never fires on iOS here (see
 * `HerdrHoverModule.swift`), so this is what hover goes through.
 */
export function HoverView({ onHoverChange, ...props }: HoverViewProps) {
  if (Native === null) {
    return <View {...props} onPointerEnter={() => onHoverChange(true)} onPointerLeave={() => onHoverChange(false)} />;
  }
  return <Native {...props} onHoverChange={(event) => onHoverChange(event.nativeEvent.over)} />;
}
