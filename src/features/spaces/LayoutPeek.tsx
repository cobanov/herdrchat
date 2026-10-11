import { useCallback, useReducer, useRef, type RefObject } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { EscapeKeyView } from '../../../modules/herdr-keys/src/escape';
import { Glass } from '@/components/Glass';
import type { ListedChat } from '@/features/chats/listedChat';
import { spaceStats, spaceTitle } from '@/features/chats/rowText';
import { peekReducer, type Peek } from '@/lib/spaces/peek';
import { popoverPlacement } from '@/lib/spaces/popover';
import { motion, radius, screenPadding, spaceLayout, spacing } from '@/theme/tokens';
import { SpaceLayout } from './SpaceLayout';
import { SpaceLayoutTitle } from './SpaceLayoutSheet';

/** What a space card hands over to have its layout shown beside it: its layout button. */
export type LayoutAnchor = RefObject<View | null>;

/**
 * The iPad's floating layout card (`peekReducer`): shown while a pointer
 * rests on a space card's layout button (or on the card), pinned by a tap.
 * All of it is state set from the pointer's and the finger's own handlers;
 * nothing here runs in an effect.
 */
export function useLayoutPeek() {
  const [peek, dispatch] = useReducer(peekReducer, null);
  const host = useRef<View>(null);
  /** The button the pointer is on now: a measure that lands after it left must not show the card. */
  const hovering = useRef<string | null>(null);

  const show = useCallback((key: string, button: LayoutAnchor, how: 'hover' | 'pin') => {
    if (how === 'hover') hovering.current = key;
    const target = button.current;
    const into = host.current;
    if (target === null || into === null) return;
    target.measureInWindow((x, y, width, height) => {
      into.measureInWindow((hx, hy, hwidth, hheight) => {
        if (how === 'hover' && hovering.current !== key) return;
        dispatch({ type: 'show', key, how, anchor: { x, y, width, height }, host: { x: hx, y: hy, width: hwidth, height: hheight } });
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

  return { peek, host, show, leaveButton, hoverCard, pin, close };
}

/**
 * Where the floating card is drawn: over the whole chats list, letting
 * touches through to the list except on the card, and, while pinned, on a
 * clear backdrop that closes it.
 */
export function LayoutPeekOverlay({ host, peek, summary, onClose, onPin, onHoverCard }: {
  host: RefObject<View | null>;
  peek: Peek | null;
  /** The workspace's live summary; the card goes when the workspace does. */
  summary: ListedChat | null;
  onClose: () => void;
  onPin: () => void;
  onHoverCard: (over: boolean) => void;
}) {
  const shown = peek !== null && summary !== null;
  return (
    <View ref={host} collapsable={false} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {shown && peek.pinned && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close layout"
          testID="space-layout-backdrop"
        />
      )}
      {shown && <LayoutCard peek={peek} summary={summary} onClose={onClose} onPin={onPin} onHoverCard={onHoverCard} />}
    </View>
  );
}

function LayoutCard({ peek, summary, onClose, onPin, onHoverCard }: {
  peek: Peek;
  summary: ListedChat;
  onClose: () => void;
  onPin: () => void;
  onHoverCard: (over: boolean) => void;
}) {
  const place = popoverPlacement(peek.anchor, peek.host, {
    width: spaceLayout.popoverWidth,
    maxHeight: spaceLayout.popoverMaxHeight,
    margin: screenPadding,
    gap: spacing.xs,
  });
  return (
    <EscapeKeyView
      active={peek.pinned}
      onEscape={onClose}
      style={{ position: 'absolute', left: place.left, top: place.top, bottom: place.bottom, width: place.width }}>
      {/* A tap on the card pins it; the pointer on it keeps it. Not an
          accessibility element itself, so its boxes stay reachable. */}
      <Pressable
        accessible={false}
        onPress={onPin}
        onHoverIn={() => onHoverCard(true)}
        onHoverOut={() => onHoverCard(false)}
        delayHoverOut={motion.hoverOut}
        testID="space-layout-card">
        <Glass style={{ borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, maxHeight: place.maxHeight }}>
          <SpaceLayoutTitle title={spaceTitle(summary)} stats={spaceStats(summary)} onClose={onClose} closeLabel="Close" />
          <ScrollView style={{ flexShrink: 1 }}>
            <SpaceLayout summary={summary} onClose={onClose} />
          </ScrollView>
        </Glass>
      </Pressable>
    </EscapeKeyView>
  );
}
