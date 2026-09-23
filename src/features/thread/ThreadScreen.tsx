import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Keyboard,
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
import { Glass } from '@/components/Glass';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TypingDots, WaitingBar } from '@/components/Activity';
import { BlockedBar } from '@/features/thread/BlockedBar';
import { Composer } from '@/features/thread/Composer';
import { JumpToBottom } from '@/features/thread/JumpToBottom';
import { LivePreviewBubble } from '@/features/thread/LivePreviewBubble';
import { OlderHistory } from '@/features/thread/OlderHistory';
import { StopButton } from '@/features/thread/StopButton';
import { MissingHost, ThreadPlaceholder } from '@/features/thread/ThreadPlaceholders';
import { useThread } from '@/features/thread/useThread';
import { sessionSignature } from '@/lib/herdr/models';
import { draftKey, useDrafts, visibleDraft } from '@/state/drafts';
import { installCodexLauncher } from '@/lib/herdr/codexLauncher';
import { haptics } from '@/lib/haptics';
import { HerdrError } from '@/lib/herdr/protocol';
import { clientFor, useConnections, useSelectedConnection } from '@/state/connections';
import { markThreadRead } from '@/state/db';
import { isToolOnly, type ChatMessage } from '@/lib/transcript/message';
import { modelDisplayName } from '@/lib/transcript/sessionMeta';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, radius, screenPadding, size, spacing, threadLayout } from '@/theme/tokens';

/**
 * How close to the end still counts as "at the bottom": enough slack to survive
 * a rubber-band and sub-pixel rounding, small enough that a scrolled-back reader
 * is never mistaken for one at the end.
 */
const BOTTOM_SLACK = threadLayout.bottomSlack;

/** One workspace conversation. */
export default function ThreadScreen({ workspaceId, title, onBack }: {
  workspaceId: string;
  title?: string;
  onBack?: () => void;
}) {
  const router = useRouter();
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const connection = useSelectedConnection();
  const client = useMemo(() => (connection === null ? null : clientFor(connection)), [connection]);
  const listRef = useRef<FlashListRef<Row>>(null);
  const historyInteraction = useRef<number | null>(null);

  /**
   * This route outlives its host: delete the connection, or follow a deep link
   * or a notification into one that is gone, and the screen still opens. It
   * used to answer that with "No messages yet · Send your first message" over a
   * composer whose every send failed silently.
   *
   * Hydration is what makes the difference honest, before the store has read
   * the device, a null connection means "not loaded", not "deleted".
   */
  const hydrated = useConnections((state) => state.hydrated);
  const hostGone = hydrated && connection === null;

  const showToolActivity = useSettings((state) => state.showToolActivity);
  const showSidechain = useSettings((state) => state.showSidechain);

  const [atBottom, setAtBottom] = useState(true);
  /**
   * Content and viewport heights, kept so `atBottom` can be recomputed when the
   * list grows rather than only when someone scrolls.
   */
  const pinnedToBottom = useRef(true);
  const anchorAfterControlsResize = useRef(false);
  const viewportHeight = useRef(0);
  const scrollOffset = useRef(0);
  // Measured height of the floating control stack, so the list can reserve
  // exactly that much room underneath its content.
  const [controlsHeight, setControlsHeight] = useState<number>(threadLayout.initialControlsHeight);
  const [headerHeight, setHeaderHeight] = useState<number>(insets.top + threadLayout.initialHeaderHeight);

  const thread = useThread(db, client, connection?.id ?? '', workspaceId, []);

  // The agents array is rebuilt by every status poll, so it cannot go in the
  // dependency list below, the effect would re-run every couple of seconds and
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
        void markThreadRead(db, connectionId, workspaceId, sig, Date.now());
      };
      stamp();
      // Again on the way out, so a message that arrived while you were reading
      // it counts as seen rather than re-lighting the row you just left.
      return stamp;
    }, [db, connection, workspaceId])
  );

  const rows = useMemo(
    () => buildRows(thread.messages, { showToolActivity, showSidechain }),
    [thread.messages, showToolActivity, showSidechain]
  );
  const waiting = !thread.isBlocked && (thread.status === 'working' || thread.isSending);

  /**
   * The draft lives in a store rather than inside the composer: the send
   * handler needs it, the composer should stay presentational, and it has to
   * outlive this screen so leaving a chat doesn't lose half a prompt (#113).
   */
  /**
   * What the chat is called. The host's current label wins over the one the
   * link carried, which may be stale after a rename. Without either, 'Chat'
   * rather than an internal id like 'w7' (#113).
   */
  const heading = thread.workspaceLabel ?? (title !== undefined && title.length > 0 ? title : 'Chat');

  const key = draftKey(connection?.id ?? '', workspaceId);
  const sessionSig = sessionSignature(thread.agents);
  const draft = visibleDraft(useDrafts((state) => state.drafts[key]), sessionSig);
  const saveDraft = useDrafts((state) => state.save);
  const setDraft = (text: string) => saveDraft(key, text, sessionSig);

  /**
   * Installing herdr's Claude integration from here.
   *
   * The thread already works out that this is what is wrong, an agent that
   * reports no session id for eighty seconds is almost always a host missing
   * the integration. Naming the command was better than nothing, but it still
   * meant putting the phone down and finding a terminal.
   */
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const integrationKind = thread.agents.find(agent => agent.agent === 'codex' && agent.agentSession === null)
    ?? thread.agents.find(agent => agent.agentSession === null)
    ?? thread.agents[0];
  const agentKind = integrationKind?.agent === 'codex' ? 'codex' : 'claude';
  const installIntegration = useCallback(() => {
    if (client === null || installing) return;
    setInstalling(true);
    setInstallError(null);
    void client
      .installIntegration(agentKind)
      .then(() => agentKind === 'codex' ? installCodexLauncher(client.transport) : undefined)
      .then(() => {
        // Deliberately no success banner. The integration binds at SessionStart,
        // so this agent keeps reporting nothing until it is restarted, and a
        // cheerful "Installed" over a screen that has not changed is exactly the
        // confusion this is meant to remove. The copy above already says so.
        setInstallError(null);
      })
      .catch((thrown: unknown) => {
        setInstallError(thrown instanceof HerdrError ? thrown.message : String(thrown));
      })
      .finally(() => setInstalling(false));
  }, [client, installing, agentKind]);

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
    viewportHeight.current = layoutMeasurement.height;
    scrollOffset.current = contentOffset.y;
    const distanceFromEnd = contentSize.height - contentOffset.y - layoutMeasurement.height;
    pinnedToBottom.current = distanceFromEnd <= BOTTOM_SLACK;
    setAtBottom(distanceFromEnd <= BOTTOM_SLACK);
  }, []);

  /**
   * The native scroll view, scrolled directly. FlashList's own `scrollToEnd`
   * finishes in a timer that dereferences its scroll view without a check, and
   * a list that unmounts in between (a reload remounts it by `key`) threw there:
   * Reload crashed the app every time on Android (#4 acceptance), and an
   * uncaught error is fatal in any release build.
   */
  const scrollListToEnd = useCallback((animated: boolean) => {
    listRef.current?.getNativeScrollRef()?.scrollToEnd({ animated });
  }, []);

  const restoreBottom = useCallback(() => {
    pinnedToBottom.current = true;
    scrollListToEnd(false);
  }, [scrollListToEnd]);

  useFocusEffect(
    useCallback(() => {
      restoreBottom();
    }, [restoreBottom])
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') restoreBottom();
    });
    return () => subscription.remove();
  }, [restoreBottom]);

  const jumpToBottom = useCallback(() => {
    pinnedToBottom.current = true;
    scrollListToEnd(true);
    setAtBottom(true);
  }, [scrollListToEnd]);

  const subtitle = [
    modelDisplayName(thread.sessionMeta?.model ?? null),
    thread.sessionMeta?.effort ?? null,
    thread.workingDirName,
    statusWord(thread.status),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  /**
   * The bottom safe-area inset exists to clear the home indicator. A raised
   * keyboard already covers it, so keeping the inset then would leave the
   * composer floating a thumb's width above the keys.
   *
   * `will*` on iOS so the change rides the same curve as the keyboard rather
   * than snapping after it lands; Android has no `will` phase.
   */
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardUp(true)
    );
    const hidden = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardUp(false)
    );
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  // Floating controls clear the home indicator. Without this the composer sits
  // on the very bottom edge, where it is genuinely hard to hit.
  const bottomInset = keyboardUp ? spacing.md : Math.max(insets.bottom, spacing.md);

  return (
    <Screen presentation="edge-to-edge">
      {/*
        The keyboard avoider is the whole conversation area, not just the
        composer.

        It used to wrap only the floating controls, which were themselves
        absolutely positioned over the list, so the pill rose with the keyboard
        and nothing else did. The list kept its full height and its bottom
        padding still only reserved room for the controls, which left the newest
        messages sitting behind the keys with no way to scroll to them.

        As the flex container it makes the list SHRINK by the keyboard's height,
        which is what pushes the conversation up. The controls stay absolutely
        positioned inside it: Yoga lays out absolute children against the padding
        box, so `bottom: 0` now means "just above the keyboard" rather than "at
        the bottom of the window", and the overlay, the whole reason the glass
        has anything to refract, is preserved.

        Android is left on the default behaviour: `adjustResize` already shrinks
        the window, and adding padding on top of that would double-count it.
      */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        // The viewport now starts at the window edge, not below the status bar.
        keyboardVerticalOffset={0}
        style={{ flex: 1, width: '100%', maxWidth: size.contentMaxWidth, alignSelf: 'center' }}>
        {/*
          The controls anchor to this wrapper, NOT to the avoider itself.

          Measured, not assumed: an absolutely positioned child resolves against
          its parent's border box, so `bottom: 0` on a child of the avoider means
          the bottom of the avoider, behind the keyboard, no matter how much
          bottom padding the avoider has taken on. The composer disappeared under
          the keys exactly that way.

          This wrapper is a flex child, so it SHRINKS by that padding instead of
          absorbing it, and carries none of its own. `bottom: 0` against it lands
          just above the keyboard, which is what the controls want, while the
          list still overlays correctly.
        */}
        <View style={{ flex: 1 }}>
          {/*
            The list is mounted only once there is something to show.

            `startRenderingFromBottom` positions the FIRST render at the end, so
            mounting an empty list and letting messages stream in afterwards means
            it anchors to the bottom of nothing, and every later batch arrives as
            an append the reader has to chase. History arrives in phases here
            (disk cache → recent window → live tail), which is exactly the case
            that defeats it. Waiting for the first batch is what makes the native
            anchoring do its job instead of fighting it from JS.
          */}
          {hostGone ? (
            <View style={{ flex: 1, paddingTop: headerHeight }}>
              <MissingHost onBack={onBack} onHosts={() => router.navigate('/hosts')} />
            </View>
          ) : thread.loading || rows.length === 0 ? (
            <View style={{ flex: 1, paddingTop: headerHeight }}>
              <ThreadPlaceholder
                waiting={waiting}
                loading={thread.loading}
                canSend={thread.canSend}
                onBack={onBack}
                title={heading}
                sessionState={thread.sessionState}
                agentKind={agentKind}
                onInstallIntegration={client === null ? undefined : installIntegration}
                installing={installing}
                installError={installError}
              />
            </View>
          ) : (
            <FlashList
              key={thread.historyVersion}
              testID="thread-messages"
              ref={listRef}
              data={rows}
              keyExtractor={(row) => row.message.id}
              contentContainerStyle={{
                paddingHorizontal: screenPadding,
                paddingTop: spacing.sm,
              }}
              scrollIndicatorInsets={{ top: headerHeight }}
              /**
               * The fix for "the chat isn't at the bottom".
               *
               * This is native and runs during layout, so it cannot lose a race the
               * way a JS `scrollToEnd` does. `startRenderingFromBottom` means the
               * first frame is already at the end rather than scrolling there after
               * measuring, and the threshold keeps it pinned as the tail appends :
               * but only while the reader is near the end, so scrolling back through
               * history is never yanked.
               */
              maintainVisibleContentPosition={{
                startRenderingFromBottom: true,
                autoscrollToBottomThreshold: 0.2,
                animateAutoScrollToBottom: false,
              }}
              // Reaching the top is a request for more history. Safe to fire more
              // than once: loadOlder walks a single anchor, so a repeat call either
              // finds the previous one still running or continues from where it
              // left off, it cannot fetch the same page twice.
              onStartReached={() => {
                if (historyInteraction.current === thread.historyVersion) void thread.loadOlder();
              }}
              onStartReachedThreshold={0.5}
              onScrollBeginDrag={() => {
                historyInteraction.current = thread.historyVersion;
                // A short first window may already be at the top before the
                // reader drags, so onStartReached will not fire a second time.
                if (scrollOffset.current <= 0) void thread.loadOlder();
              }}
              // A measured spacer keeps the first message clear of the overlay.
              ListHeaderComponent={<View />}
              ListHeaderComponentStyle={{ height: headerHeight }}
              onScroll={onScroll}
              onLayout={(event) => {
                viewportHeight.current = event.nativeEvent.layout.height;
                if (pinnedToBottom.current) restoreBottom();
              }}
              scrollEventThrottle={64}
              /**
               * `atBottom` starts true and, before this, only ever changed on a
               * scroll event, so a thread that opened NOT at the bottom, or whose
               * content grew past the viewport without the reader touching it, kept
               * claiming it was at the end. The jump button is suppressed while
               * that flag is true, which left the one control for getting back to
               * the newest message hidden exactly when it was needed.
               *
               * Content size changes on every batch of history, so this is where
               * the flag can be honest without waiting for a finger.
               */
              onContentSizeChange={(_width, height) => {
                if (anchorAfterControlsResize.current) {
                  anchorAfterControlsResize.current = false;
                  restoreBottom();
                  setAtBottom(true);
                  return;
                }
                const distance = height - scrollOffset.current - viewportHeight.current;
                setAtBottom(distance <= BOTTOM_SLACK);
              }}
              renderItem={({ item, index }) => (
                <View
                  style={{
                    paddingTop: item.startsGroup ? spacing.md : spacing.xxs,
                  }}>
                  {/* FlashList bottom-aligns rows but not its ListHeader. Keep
                      this label with the oldest bubble, not above the glass. */}
                  {index === 0 && (
                    <OlderHistory loading={thread.loadingOlder} reachedStart={thread.reachedStart} />
                  )}
                  {item.startsGroup &&
                    item.message.agentLabel !== null &&
                    item.message.role !== 'user' && (
                      <Text
                        variant="caption2"
                        color="secondary"
                        style={{
                          paddingLeft: spacing.md,
                          paddingBottom: spacing.xxs,
                        }}>
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
              )}
              ListFooterComponent={
                <View
                  style={{
                    paddingTop: waiting ? spacing.md : 0,
                    // Keep the overlay clearance in the measured footer.
                    // FlashList does not re-anchor for a container-padding-only
                    // change, so a growing composer otherwise covers the last
                    // bubble even though its new height has been measured.
                    paddingBottom: controlsHeight + spacing.lg,
                  }}>
                  {waiting &&
                    (thread.livePreview !== null ? (
                      <LivePreviewBubble text={thread.livePreview} />
                    ) : (
                      <View
                        style={{
                          paddingHorizontal: spacing.xxl,
                          paddingVertical: spacing.md,
                        }}>
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
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: controlsHeight,
            }}>
            <JumpToBottom
              visible={!atBottom && rows.length > 0}
              unreadBelow={!atBottom && waiting}
              onPress={jumpToBottom}
            />
          </View>

          {/*
            The controls OVERLAY the list rather than sitting in a row beneath it.
            That is what gives the glass something to refract: messages scroll
            underneath the pill instead of stopping above a flat bar. It is also why
            the list footer carries matching clearance.
          */}
          {/* No composer without a host to send to: a text field that cannot
              deliver anything is a promise the screen can't keep. */}
          {!hostGone && (
            <View
              onLayout={(event) => {
                const height = event.nativeEvent.layout.height;
                if (height === controlsHeight) return;
                // Wait until the matching footer has actually been laid out.
                // Scrolling here still uses the previous, shorter content size.
                anchorAfterControlsResize.current = pinnedToBottom.current;
                setControlsHeight(height);
              }}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                gap: spacing.sm,
                paddingHorizontal: screenPadding,
                paddingTop: spacing.sm,
                paddingBottom: bottomInset,
              }}>
              {thread.isBlocked && (
                <BlockedBar
                  prompt={thread.blockedPrompt}
                  pending={thread.blockedPending}
                  onKeys={(keys) => void thread.sendKeys(keys)}
                />
              )}
              <Composer
                draft={draft}
                onDraftChange={setDraft}
                // Prompt history was removed with the chips that displayed it.
                // Storing what someone typed for a feature that no longer exists
                // is a liability, not a convenience, the table and its cleanup
                // stay only so existing rows are still erased by Reset app data.
                onSend={(text) => thread.send(text)}
                disabled={thread.isSending || !thread.canSend}
              />
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
      {/* Render after the list so native blur samples its scrolling content.
          The material reaches the screen edge; only the controls take insets. */}
      <View
        testID="thread-header-overlay"
        pointerEvents="box-none"
        onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
        style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
        <Glass edgeAttached testID="thread-header">
          <SafeAreaView testID="thread-header-safe-area" edges={['top', 'left', 'right']}>
            <View style={{ width: '100%', maxWidth: size.contentMaxWidth, alignSelf: 'center' }}>
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                paddingHorizontal: screenPadding,
                paddingVertical: spacing.sm,
              }}>
                {onBack !== undefined && (
                  <Glass interactive style={{ borderRadius: radius.full, overflow: 'hidden' }}>
                    <Pressable
                      onPress={onBack}
                      accessibilityRole="button"
                      accessibilityLabel="Back to chats"
                      testID="thread-back"
                      style={{ width: minTouchTarget, height: minTouchTarget, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="chevron.left" size={20} tintColor={colors.label} fallback={<Text>‹</Text>} />
                    </Pressable>
                  </Glass>
                )}
                <View style={{ flex: 1, minWidth: 0, gap: spacing.xxs }}>
                  <Text testID="thread-title" variant="title3" numberOfLines={1}>
                    {heading}
                  </Text>
                  {subtitle.length > 0 && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                      <View style={{ width: size.statusDot, height: size.statusDot, borderRadius: radius.full, backgroundColor: statusColor(thread.status, colors) }} />
                      <Text testID="thread-meta" variant="caption" color={thread.status === 'blocked' ? 'attention' : 'secondary'} style={{ flexShrink: 1 }} numberOfLines={1}>
                        {subtitle}
                      </Text>
                      {thread.status === 'working' && <TypingDots size={3.5} />}
                    </View>
                  )}
                </View>
                <Glass interactive style={{ borderRadius: radius.full, overflow: 'hidden' }}>
                  {thread.status === 'working' ? (
                    <StopButton onStop={(hard) => void thread.interrupt(hard)} />
                  ) : (
                    <Pressable
                      onPress={() => {
                        haptics.light();
                        // No scroll: the reloaded list remounts (its key is the
                        // history version) and starts at the bottom by itself.
                        void thread.reload().then(() => {
                          pinnedToBottom.current = true;
                          setAtBottom(true);
                        });
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Reload this conversation"
                      testID="thread-reload"
                      style={{ width: minTouchTarget, height: minTouchTarget, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="arrow.clockwise" size={19} tintColor={colors.label} fallback={<Text>↻</Text>} />
                    </Pressable>
                  )}
                </Glass>
              </View>
              {thread.error !== null && (
                <ErrorBanner
                  message={
                    thread.offline && rows.length > 0
                      ? `Showing saved messages. ${thread.error}`
                      : thread.error
                  }
                  onDismiss={thread.clearError}
                />
              )}
            </View>
          </SafeAreaView>
        </Glass>
      </View>
    </Screen>
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
    // left to draw, an empty bubble is worse than no bubble.
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
