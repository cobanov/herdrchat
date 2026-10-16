import type { ComponentProps, ReactNode } from 'react';
import Animated from 'react-native-reanimated';

import { BlockedBar } from '@/features/thread/BlockedBar';
import { CommandPanelBar } from '@/features/thread/CommandPanelBar';
import { CommandSuggestions } from '@/features/thread/CommandSuggestions';
import { ShellHint } from '@/features/thread/ShellHint';
import type { CatalogueCommand, PaletteSection } from '@/lib/slashCommands';
import type { BlockedPending, BlockedPrompt } from '@/lib/transcript/blockedPrompt';
import type { PaneOverlay } from '@/lib/transcript/paneOverlay';
import { screenPadding, spacing } from '@/theme/tokens';

/**
 * The controls under the conversation: a command's panel, the `/` palette or
 * the shell hint, an agent's question, and the composer (`children`).
 *
 * They OVERLAY the list rather than sitting in a row beneath it. That is what
 * gives the glass something to refract: messages scroll underneath the pill
 * instead of stopping above a flat bar. It is also why the list footer carries
 * matching clearance, from the height this reports.
 */
export function ThreadControls({
  keyboardStyle, restingInset, onHeight, overlay, overlayBusy, onOverlayKeys, sections, onPick, shellHint,
  isBlocked, blockedPrompt, blockedPending, onBlockedKeys, children,
}: {
  /** Follows the keyboard (`useThreadKeyboard`). */
  keyboardStyle: ComponentProps<typeof Animated.View>['style'];
  restingInset: number;
  onHeight: (height: number) => void;
  overlay: PaneOverlay | null;
  overlayBusy: boolean;
  onOverlayKeys: (keys: readonly string[]) => void;
  sections: readonly PaletteSection[];
  onPick: (command: CatalogueCommand) => void;
  shellHint: boolean;
  isBlocked: boolean;
  blockedPrompt: BlockedPrompt | null;
  blockedPending: BlockedPending | null;
  onBlockedKeys: (keys: readonly string[]) => void;
  children: ReactNode;
}) {
  return (
    <Animated.View
      testID="thread-controls"
      // The footer's clearance follows, and the list follows its content
      // size change.
      onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          gap: spacing.sm,
          paddingHorizontal: screenPadding,
          paddingTop: spacing.sm,
          paddingBottom: restingInset,
        },
        keyboardStyle,
      ]}>
      {overlay !== null && !isBlocked && (
        <CommandPanelBar overlay={overlay} busy={overlayBusy} onKeys={onOverlayKeys} />
      )}
      {sections.length > 0 && overlay === null && (
        <CommandSuggestions sections={sections} onPick={onPick} />
      )}
      {shellHint && overlay === null && <ShellHint />}
      {isBlocked && (
        <BlockedBar prompt={blockedPrompt} pending={blockedPending} onKeys={onBlockedKeys} />
      )}
      {children}
    </Animated.View>
  );
}
