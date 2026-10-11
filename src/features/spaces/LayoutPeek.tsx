import { useCallback, useReducer, useRef, type ReactNode, type RefObject } from 'react';
import { Dimensions, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';

import { EscapeKeyView } from '../../../modules/herdr-keys/src/escape';
import { HoverView } from '../../../modules/herdr-keys/src/hover';
import { Glass } from '@/components/Glass';
import type { ListedChat } from '@/features/chats/listedChat';
import { spaceStats, spaceTitle } from '@/features/chats/rowText';
import { peekReducer, type Peek } from '@/lib/spaces/peek';
import { popoverPlacement } from '@/lib/spaces/popover';
import { motion, radius, screenPadding, spaceLayout, spacing } from '@/theme/tokens';
import { SpaceLayout } from './SpaceLayout';
import { SpaceLayoutTitle } from './SpaceLayoutSheet';
import { useHoverIntent } from './useHoverIntent';

/** What a space card hands over to have its layout shown beside it: its layout button. */
export type LayoutAnchor = RefObject<View | null>;

/**
 * The iPad's floating layout card (`peekReducer`): shown while a pointer
 * rests on a space card's layout button (or on the card), pinned by a tap.
 * All of it is state set from the pointer's and the finger's own handlers;
 * nothing here runs in an effect.
 *
 * `column` is the chats list's own frame, measured with the button, so the
 * card can float beside it (`popoverPlacement`).
 */
export function useLayoutPeek() {
  const [peek, dispatch] = useReducer(peekReducer, null);
  const column = useRef<View>(null);
  /** The button the pointer is on now: a measure that lands after it left must not show the card. */
  const hovering = useRef<string | null>(null);

  const show = useCallback((key: string, button: LayoutAnchor, how: 'hover' | 'pin') => {
    if (how === 'hover') hovering.current = key;
    const target = button.current;
    const list = column.current;
    if (target === null || list === null) return;
    target.measureInWindow((x, y, width, height) => {
      list.measureInWindow((cx, cy, cwidth, cheight) => {
        if (how === 'hover' && hovering.current !== key) return;
        const { width: ww, height: wh } = Dimensions.get('window');
        dispatch({
          type: 'show', key, how,
          anchor: { x, y, width, height },
          column: { x: cx, y: cy, width: cwidth, height: cheight },
          window: { x: 0, y: 0, width: ww, height: wh },
        });
      });
    });
  }, []);
  const leaveButton = useCallback((key: string) => {
    if (hovering.current === key) hovering.current = null;
    dispatch({ type: 'leave-button', key });
  }, []);
  const hoverCard = useCallback((over: boolean) => dispatch({ type: 'card', over }), []);
  const pin = useCallback(() => dispatch({ type: 'pin' }), []);
  const close = useCallback(() => {
    hovering.current = null;
    dispatch({ type: 'close' });
  }, []);

  return { peek, column, show, leaveButton, hoverCard, pin, close };
}

/**
 * The floating card, drawn over the whole window rather than the chats list
 * it came from: beside the iPad's sidebar, where it covers neither the list's
 * other buttons nor the thread's text. While pinned, a clear backdrop over
 * the whole window, the thread beside the list included, closes it on a tap,
 * so a tap meant to close it never lands in the composer.
 *
 * `column` marks the list's frame for the card's placement; it takes no touches.
 */
export function LayoutPeekOverlay({ column, peek, summary, onClose, onPin, onHoverCard }: {
  column: RefObject<View | null>;
  peek: Peek | null;
  /** The workspace's live summary; the card goes when the workspace does. */
  summary: ListedChat | null;
  onClose: () => void;
  onPin: () => void;
  onHoverCard: (over: boolean) => void;
}) {
  const { width, height } = useWindowDimensions();
  // Measured in a window of another size (rotated, or resized in Split
  // View): its place no longer means anything, so it is not drawn.
  const current = peek !== null && peek.window.width === width && peek.window.height === height;
  return (
    <>
      <View ref={column} collapsable={false} pointerEvents="none" style={StyleSheet.absoluteFill} />
      {current && summary !== null && (
        <FloatingLayer modal={peek.pinned}>
          {peek.pinned && (
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close layout"
              testID="space-layout-backdrop"
            />
          )}
          <LayoutCard peek={peek} summary={summary} onClose={onClose} onPin={onPin} onHoverCard={onHoverCard} />
        </FloatingLayer>
      )}
    </>
  );
}

/**
 * Above everything in the window on iOS (`FullWindowOverlay`, which passes
 * touches through except on what it holds); elsewhere, over the list.
 */
function FloatingLayer({ modal, children }: { modal: boolean; children: ReactNode }) {
  if (Platform.OS !== 'ios') {
    return <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>{children}</View>;
  }
  // Modal to VoiceOver only while pinned: a card the pointer is passing over
  // must not hide the list from it.
  return <FullWindowOverlay unstable_accessibilityContainerViewIsModal={modal}>{children}</FullWindowOverlay>;
}

function LayoutCard({ peek, summary, onClose, onPin, onHoverCard }: {
  peek: Peek;
  summary: ListedChat;
  onClose: () => void;
  onPin: () => void;
  onHoverCard: (over: boolean) => void;
}) {
  const place = popoverPlacement(peek.anchor, peek.column, peek.window, {
    width: spaceLayout.popoverWidth,
    maxHeight: spaceLayout.popoverMaxHeight,
    margin: screenPadding,
    gap: spacing.xs,
  });
  // On at once, off after a beat: long enough to cross back to the button.
  const hover = useHoverIntent({ onIn: () => onHoverCard(true), onOut: () => onHoverCard(false), delayOut: motion.hoverOut });
  return (
    <EscapeKeyView
      active={peek.pinned}
      onEscape={onClose}
      style={{ position: 'absolute', left: place.left, top: place.top, bottom: place.bottom, width: place.width }}>
      <HoverView onHoverChange={hover}>
        {/* A tap on the card pins it. Not an accessibility element itself,
            so its boxes stay reachable. */}
        <Pressable accessible={false} onPress={onPin} testID="space-layout-card">
          <Glass style={{ borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, maxHeight: place.maxHeight }}>
            <SpaceLayoutTitle title={spaceTitle(summary)} stats={spaceStats(summary)} onClose={onClose} closeLabel="Close" />
            <ScrollView style={{ flexShrink: 1 }}>
              <SpaceLayout summary={summary} onClose={onClose} />
            </ScrollView>
          </Glass>
        </Pressable>
      </HoverView>
    </EscapeKeyView>
  );
}
