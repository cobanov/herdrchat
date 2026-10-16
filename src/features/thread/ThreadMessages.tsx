import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useRef, type RefObject } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { WorkingIndicator } from '@/components/Activity';
import { Text } from '@/components/Text';
import { DelegationScopeProvider, type DelegationScope } from '@/features/thread/delegation';
import { LivePreviewBubble } from '@/features/thread/LivePreviewBubble';
import { OlderHistory } from '@/features/thread/OlderHistory';
import { ThreadRow } from '@/features/thread/ThreadRow';
import type { useThreadScroll } from '@/features/thread/useThreadScroll';
import type { PlacedItem } from '@/lib/threadItems';
import { minTouchTarget, screenPadding, spacing } from '@/theme/tokens';

/**
 * The conversation itself: the rows, older history above them, a failed
 * message's retry, and the agent at work below them.
 *
 * It takes the thread's fields one by one rather than the thread, so typing
 * in the composer, which re-renders the screen, does not re-render the list.
 */
export function ThreadMessages({
  rows, listRef, scroll, historyVersion, loadOlder, loadingOlder, reachedStart, failedIds, retry, livePreview, waiting,
  headerHeight, bottomClearance, delegationScope,
}: {
  rows: PlacedItem[];
  listRef: RefObject<FlashListRef<PlacedItem> | null>;
  scroll: ReturnType<typeof useThreadScroll<PlacedItem>>;
  historyVersion: number;
  loadOlder: () => Promise<void>;
  loadingOlder: boolean;
  reachedStart: boolean;
  failedIds: Set<string>;
  retry: (id: string) => Promise<void>;
  livePreview: string | null;
  /** The agent is working, or a message is on its way. */
  waiting: boolean;
  headerHeight: number;
  /** Room the floating controls take over the end of the list. */
  bottomClearance: number;
  delegationScope: DelegationScope;
}) {
  /** The history version the reader last scrolled, which allows paging up. */
  const historyInteraction = useRef<number | null>(null);
  return (
    // The cards in it open what they started on this host, under this
    // chat's session folders.
    <DelegationScopeProvider value={delegationScope}>
      <FlashList
        key={historyVersion}
        testID="thread-messages"
        ref={listRef}
        data={rows}
        keyExtractor={(row) => row.item.key}
        getItemType={(row) => row.item.kind}
        contentContainerStyle={{
          paddingHorizontal: screenPadding,
          paddingTop: spacing.sm,
        }}
        scrollIndicatorInsets={{ top: headerHeight }}
        /*
          Pulling the conversation down takes the keyboard with it, under
          the finger, the way Messages does; let go past the threshold and
          it finishes going. The list only shrinks and grows with the
          avoider: nothing here scrolls it, which stays useThreadScroll's.

          iOS only, on purpose. Android's ScrollView ignores `interactive`,
          and its `on-drag` would drop the keyboard the moment a reader
          scrolled back to check something while typing, so Android keeps
          the keyboard until "Hide keyboard" or a send, as before.
        */
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
        /**
         * The first frame is already at the end rather than scrolling there
         * after measuring, and rows keep their place as older history lands
         * above them. Following the end after that is `useThreadScroll`'s
         * alone: the list's own autoscroll (anyone within a fifth of a screen
         * of the end) raced it and pulled readers that had just left.
         */
        maintainVisibleContentPosition={{ startRenderingFromBottom: true }}
        {...scroll.listProps}
        /*
          Near the top is a request for more history, checked on every
          scroll rather than by onStartReached. That fires once on entering
          its threshold and again only after leaving it, and a page that
          prepends less than the threshold leaves the reader inside it: the
          reader sat at the top with nothing loading. Calling loadOlder
          again is safe; it walks a single anchor and ignores a call while
          one is running. Only after the reader has scrolled: a short first
          window starts at the top, and paging it in unasked moved the
          thread as it opened.
        */
        onScroll={(event) => {
          scroll.listProps.onScroll(event);
          if (historyInteraction.current === historyVersion && scroll.nearTop()) void loadOlder();
        }}
        onScrollBeginDrag={() => {
          scroll.listProps.onScrollBeginDrag();
          historyInteraction.current = historyVersion;
          if (scroll.nearTop()) void loadOlder();
        }}
        // A measured spacer keeps the first message clear of the overlay.
        ListHeaderComponent={<View />}
        ListHeaderComponentStyle={{ height: headerHeight }}
        scrollEventThrottle={64}
        renderItem={({ item: placed, index }) => {
          const { item } = placed;
          return (
            <View style={{ paddingTop: placed.startsTurn ? spacing.xl : spacing.sm }}>
              {/* FlashList bottom-aligns rows but not its ListHeader. Keep
                  this label with the oldest row, not above the glass. */}
              {index === 0 && (
                <OlderHistory loading={loadingOlder} reachedStart={reachedStart} />
              )}
              <ThreadRow placed={placed} />
              {(item.kind === 'user' || item.kind === 'agent') && failedIds.has(item.message.id) && (
                <Pressable
                  onPress={() => void retry(item.message.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Failed to send. Retry."
                  // A caption is ~16pt tall; the target is the full 44pt,
                  // since this is the one way back for a lost message (#112).
                  style={{
                    alignSelf: 'flex-end',
                    minHeight: minTouchTarget,
                    justifyContent: 'center',
                  }}>
                  <Text variant="caption" color="attention">
                    Failed to send, retry
                  </Text>
                </Pressable>
              )}
            </View>
          );
        }}
        ListFooterComponent={
          <View
            style={{
              paddingTop: waiting ? spacing.md : 0,
              // Keep the overlay clearance in the measured footer.
              // FlashList does not re-anchor for a container-padding-only
              // change, so a growing composer otherwise covers the last
              // bubble even though its new height has been measured.
              paddingBottom: bottomClearance,
            }}>
            {waiting && (
              <View style={{ gap: spacing.md }}>
                {livePreview !== null && <LivePreviewBubble text={livePreview} />}
                <WorkingIndicator writing={livePreview !== null} />
              </View>
            )}
          </View>
        }
      />
    </DelegationScopeProvider>
  );
}
