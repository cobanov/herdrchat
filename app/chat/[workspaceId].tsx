import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Bubble } from '@/components/Bubble';
import { ErrorBanner } from '@/components/ErrorBanner';
import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { TypingDots, WaitingBar } from '@/components/Activity';
import { BlockedBar } from '@/features/thread/BlockedBar';
import { Composer } from '@/features/thread/Composer';
import { JumpToBottom } from '@/features/thread/JumpToBottom';
import { LivePreviewBubble } from '@/features/thread/LivePreviewBubble';
import { useThread } from '@/features/thread/useThread';
import { sessionSignature } from '@/lib/herdr/models';
import { clientFor, useSelectedConnection } from '@/state/connections';
import { markThreadRead } from '@/state/db';
import { isToolOnly, type ChatMessage } from '@/lib/transcript/message';
import { modelDisplayName } from '@/lib/transcript/sessionMeta';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, screenPadding, spacing } from '@/theme/tokens';

/**
 * How close to the end still counts as "at the bottom": enough slack to survive
 * a rubber-band and sub-pixel rounding, small enough that a scrolled-back reader
 * is never mistaken for one at the end.
 */
const BOTTOM_SLACK = 48;

/** One workspace conversation. */
export default function ThreadScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ workspaceId: string; title?: string }>();
  const connection = useSelectedConnection();
  const client = useMemo(() => (connection === null ? null : clientFor(connection)), [connection]);
  const listRef = useRef<FlashListRef<Row>>(null);

  const showToolActivity = useSettings((state) => state.showToolActivity);
  const showSidechain = useSettings((state) => state.showSidechain);

  const [atBottom, setAtBottom] = useState(true);
  // Measured height of the floating control stack, so the list can reserve
  // exactly that much room underneath its content.
  const [controlsHeight, setControlsHeight] = useState(96);

  const thread = useThread(db, client, connection?.id ?? '', params.workspaceId, []);

  // The agents array is rebuilt by every status poll, so it cannot go in the
  // dependency list below — the effect would re-run every couple of seconds and
  // write to SQLite each time. A ref gives the callback the current value while
  // staying stable itself.
  const agentsRef = useRef(thread.agents);
  useEffect(() => {
    agentsRef.current = thread.agents;
  }, [thread.agents]);

  useFocusEffect(
    useCallback(() => {
      const connectionId = connection?.id;
      if (connectionId === undefined || connectionId === '') return;
      const stamp = () => {
        // No session id yet means there is nothing to bind the marker to, and a
        // marker under the wrong signature is worse than none: it would silence
        // the chat that actually lands in this workspace slot.
        const sig = sessionSignature(agentsRef.current);
        if (sig === null) return;
        void markThreadRead(db, connectionId, params.workspaceId, sig, Date.now());
      };
      stamp();
      // Again on the way out, so a message that arrived while you were reading
      // it counts as seen rather than re-lighting the row you just left.
      return stamp;
    }, [db, connection, params.workspaceId])
  );

  const rows = useMemo(
    () => buildRows(thread.messages, { showToolActivity, showSidechain }),
    [thread.messages, showToolActivity, showSidechain]
  );
  const waiting = !thread.isBlocked && (thread.status === 'working' || thread.isSending);

  /**
   * Whether the viewport sits at the end, measured rather than inferred.
   *
   * Earlier versions tracked this with a "did the reader drag" flag and an
   * imperative `scrollToEnd` in an effect, and it kept losing: FlashList lays
   * out asynchronously, so a scroll issued the moment `messages` changed
   * resolved against estimated heights and landed short. The list now anchors
   * itself natively (see `maintainVisibleContentPosition` below) and this
   * measurement is used only to decide whether to show the jump button.
   */
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromEnd = contentSize.height - contentOffset.y - layoutMeasurement.height;
    setAtBottom(distanceFromEnd <= BOTTOM_SLACK);
  }, []);

  const jumpToBottom = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
    setAtBottom(true);
  }, []);

  const subtitle = [
    modelDisplayName(thread.sessionMeta?.model ?? null),
    thread.workingDirName,
    statusWord(thread.status),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  // Floating controls clear the home indicator. Without this the composer sits
  // on the very bottom edge, where it is genuinely hard to hit.
  const bottomInset = Math.max(insets.bottom, spacing.md);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.systemBackground }} edges={['top']}>
      {/* A conversation header, not a screen header: a centred title with a
          back affordance, so it reads as "inside something" rather than as
          another top-level page. It still starts at the same screen margin as
          every other page — the back chevron's optical left edge lines up with
          the large titles elsewhere. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: screenPadding,
          paddingBottom: spacing.sm,
          minHeight: minTouchTarget,
        }}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to chats"
          testID="thread-back"
          hitSlop={spacing.md}
          style={{
            width: minTouchTarget - spacing.md,
            height: minTouchTarget,
            alignItems: 'flex-start',
            justifyContent: 'center',
          }}>
          <Icon
            name="chevron.left"
            size={20}
            tintColor={colors.tint}
            fallback={<Text color="tint">‹</Text>}
          />
        </Pressable>

        <View style={{ flex: 1, alignItems: 'center', gap: 1 }}>
          <Text variant="headline" numberOfLines={1}>
            {params.title ?? params.workspaceId}
          </Text>
          {subtitle.length > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: statusColor(thread.status, colors),
                }}
              />
              <Text
                variant="caption2"
                color={thread.status === 'blocked' ? 'attention' : 'secondary'}
                numberOfLines={1}>
                {subtitle}
              </Text>
              {thread.status === 'working' && <TypingDots size={3.5} />}
            </View>
          )}
        </View>

        {/* Balances the back control so the title is optically centred. */}
        <View style={{ width: minTouchTarget - spacing.md }} />
      </View>

      <View style={{ flex: 1 }}>
        {/*
          The list is mounted only once there is something to show.

          `startRenderingFromBottom` positions the FIRST render at the end — so
          mounting an empty list and letting messages stream in afterwards means
          it anchors to the bottom of nothing, and every later batch arrives as
          an append the reader has to chase. History arrives in phases here
          (disk cache → recent window → live tail), which is exactly the case
          that defeats it. Waiting for the first batch is what makes the native
          anchoring do its job instead of fighting it from JS.
        */}
        {rows.length === 0 ? (
          <ThreadPlaceholder waiting={waiting} title={params.title ?? params.workspaceId} />
        ) : (
        <FlashList
          ref={listRef}
          data={rows}
          keyExtractor={(row) => row.message.id}
          contentContainerStyle={{
            paddingHorizontal: screenPadding,
            paddingTop: spacing.sm,
            // Room for the floating controls that overlay the list. Measured
            // rather than guessed, because the blocked bar changes the height
            // and a wrong value either clips the newest bubble or leaves a gap.
            // The extra step is breathing room: the live-preview bubble grows
            // while the agent writes, and landing flush against the composer
            // reads as clipped even when it technically isn't.
            paddingBottom: controlsHeight + spacing.lg,
          }}
          /**
           * The fix for "the chat isn't at the bottom".
           *
           * This is native and runs during layout, so it cannot lose a race the
           * way a JS `scrollToEnd` does. `startRenderingFromBottom` means the
           * first frame is already at the end rather than scrolling there after
           * measuring, and the threshold keeps it pinned as the tail appends —
           * but only while the reader is near the end, so scrolling back through
           * history is never yanked.
           */
          maintainVisibleContentPosition={{
            startRenderingFromBottom: true,
            autoscrollToBottomThreshold: 0.2,
            animateAutoScrollToBottom: false,
          }}
          onScroll={onScroll}
          scrollEventThrottle={64}
          renderItem={({ item }) => (
            <View style={{ paddingTop: item.startsGroup ? spacing.sm + 2 : 2 }}>
              {item.startsGroup &&
                item.message.agentLabel !== null &&
                item.message.role !== 'user' && (
                  <Text
                    variant="caption2"
                    color="secondary"
                    style={{ paddingLeft: spacing.md, paddingBottom: 2 }}>
                    {item.message.agentLabel}
                  </Text>
                )}
              <Bubble
                message={item.message}
                isLastInGroup={item.endsGroup}
                timeLabel={item.endsGroup ? formatTime(item.message.timestamp) : null}
              />
              {thread.failedIds.has(item.message.id) && (
                <Pressable
                  onPress={() => void thread.retry(item.message.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Failed to send. Retry."
                  style={{ alignSelf: 'flex-end', paddingVertical: spacing.xs }}>
                  <Text variant="caption" color="attention">
                    Failed to send — retry
                  </Text>
                </Pressable>
              )}
            </View>
          )}
          ListFooterComponent={
            <View style={{ paddingTop: waiting ? spacing.md : 0 }}>
              {waiting &&
                (thread.livePreview !== null ? (
                  <LivePreviewBubble text={thread.livePreview} />
                ) : (
                  <View style={{ paddingHorizontal: spacing.xxl, paddingVertical: spacing.md }}>
                    <WaitingBar />
                  </View>
                ))}
            </View>
          }
        />
        )}

        {/* Sits just above the composer, so it never covers the newest bubble. */}
        <View
          pointerEvents="box-none"
          style={{ position: 'absolute', left: 0, right: 0, bottom: controlsHeight }}>
          <JumpToBottom
            visible={!atBottom && rows.length > 0}
            unreadBelow={!atBottom && waiting}
            onPress={jumpToBottom}
          />
        </View>
      </View>

      {thread.error !== null && <ErrorBanner message={thread.error} onDismiss={thread.clearError} />}

      {/*
        The controls OVERLAY the list rather than sitting in a row beneath it.
        That is what gives the glass something to refract: messages scroll
        underneath the pill instead of stopping above a flat bar. It is also why
        the list carries a matching bottom padding.
      */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <View
          onLayout={(event) => setControlsHeight(event.nativeEvent.layout.height)}
          style={{
            gap: spacing.sm,
            paddingHorizontal: screenPadding,
            paddingTop: spacing.sm,
            paddingBottom: bottomInset,
          }}>
          {thread.isBlocked && (
            <BlockedBar prompt={thread.blockedPrompt} onKeys={(keys) => void thread.sendKeys(keys)} />
          )}
          <Composer onSend={(text) => void thread.send(text)} disabled={thread.isSending} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * What the thread shows before its first batch of history arrives, and when a
 * workspace genuinely has no messages.
 *
 * Not a bare spinner: which of the two it is depends on whether the agent is
 * working, and telling someone "no messages yet" while their agent is mid-task
 * would be wrong.
 */
function ThreadPlaceholder({ waiting, title }: { waiting: boolean; title: string }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.xxl,
        gap: spacing.sm,
      }}>
      {waiting ? (
        <>
          <WaitingBar />
          <Text variant="subhead" color="secondary">
            Loading the conversation…
          </Text>
        </>
      ) : (
        <>
          <Text variant="title3">No messages yet</Text>
          <Text variant="subhead" color="secondary" style={{ textAlign: 'center' }}>
            Send your first message — {title} is ready.
          </Text>
        </>
      )}
    </View>
  );
}

interface Row {
  message: ChatMessage;
  startsGroup: boolean;
  endsGroup: boolean;
}

/**
 * Bubbles worth showing, with run boundaries precomputed.
 *
 * Sidechain chatter (subagent internals) and raw tool-result turns are hidden:
 * a tool result arrives as a "user" turn, and rendering it as something the
 * person typed would be actively wrong.
 */
function buildRows(
  messages: readonly ChatMessage[],
  options: { showToolActivity: boolean; showSidechain: boolean }
): Row[] {
  const visible = messages.filter((message) => {
    if (message.isSidechain && !options.showSidechain) return false;
    // A tool result arrives as a "user" turn; rendering it as something the
    // person typed would be actively wrong, so it never shows.
    if (message.role === 'user' && isToolOnly(message)) return false;
    // With chips hidden, an assistant turn that was pure machinery has nothing
    // left to draw — an empty bubble is worse than no bubble.
    if (!options.showToolActivity && isToolOnly(message)) return false;
    return true;
  });
  return visible.map((message, index) => {
    const previous = index > 0 ? visible[index - 1] : undefined;
    const next = index + 1 < visible.length ? visible[index + 1] : undefined;
    return {
      message,
      startsGroup:
        previous === undefined ||
        previous.role !== message.role ||
        previous.agentLabel !== message.agentLabel,
      endsGroup:
        next === undefined || next.role !== message.role || next.agentLabel !== message.agentLabel,
    };
  });
}

function statusWord(status: string): string | null {
  switch (status) {
    case 'working':
      return 'working';
    case 'blocked':
      return 'waiting for reply';
    case 'done':
      return 'done';
    case 'idle':
      return 'online';
    default:
      return null;
  }
}

function statusColor(status: string, colors: ReturnType<typeof useTheme>['colors']): string {
  if (status === 'blocked') return colors.attention;
  if (status === 'working' || status === 'done') return colors.tint;
  return colors.tertiaryLabel;
}

function formatTime(timestamp: number | null): string | null {
  if (timestamp === null) return null;
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
