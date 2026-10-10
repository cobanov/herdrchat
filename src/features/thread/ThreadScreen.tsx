import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, View } from 'react-native';
import {
  KeyboardAvoidingView,
  KeyboardController,
  useKeyboardHandler,
  useKeyboardState,
} from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { showActionSheet } from '@/components/ActionSheet';
import { Bubble } from '@/components/Bubble';
import { ErrorBanner } from '@/components/ErrorBanner';
import { EdgeFade, Glass } from '@/components/Glass';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TypingDots, WorkingIndicator } from '@/components/Activity';
import {
  clipboardHasImage,
  MAX_ATTACHMENTS,
  pasteAttachment,
  pickAttachments,
  type Attachment,
} from '@/features/thread/attachments';
import { BlockedBar } from '@/features/thread/BlockedBar';
import { CommandNote } from '@/features/thread/CommandNote';
import { CommandPanelBar } from '@/features/thread/CommandPanelBar';
import { CommandSuggestions } from '@/features/thread/CommandSuggestions';
import { Composer } from '@/features/thread/Composer';
import { JumpToBottom } from '@/features/thread/JumpToBottom';
import { LivePreviewBubble } from '@/features/thread/LivePreviewBubble';
import { OlderHistory } from '@/features/thread/OlderHistory';
import { StopButton } from '@/features/thread/StopButton';
import { ToolActivityToggle } from '@/features/thread/ToolActivityToggle';
import { SubagentCard, ToolRun } from '@/features/thread/ToolRun';
import { MissingHost, ThreadPlaceholder } from '@/features/thread/ThreadPlaceholders';
import { useThread } from '@/features/thread/useThread';
import { useFloatingKeyboardGap } from '@/features/thread/useFloatingKeyboardGap';
import { useThreadScroll } from '@/features/thread/useThreadScroll';
import { chatKey } from '@/lib/chatKey';
import { chatTitle, sameName, titledBySession } from '@/lib/chatTitle';
import { agentName, sessionSignature } from '@/lib/herdr/models';
import { draftKey, useDrafts, visibleDraft } from '@/state/drafts';
import { installCodexLauncher } from '@/lib/herdr/codexLauncher';
import { composerInset } from '@/lib/composerInset';
import { haptics } from '@/lib/haptics';
import { CLAUDE_COMMANDS, commandSuggestions } from '@/lib/slashCommands';
import { HerdrError } from '@/lib/herdr/protocol';
import {
  clientFor,
  isMachineConnection,
  useConnectionFor,
  useConnections,
  useSelectedConnection,
} from '@/state/connections';
import { splitMachineConnectionId } from '@/lib/herdr/machines';
import { markThreadRead } from '@/state/db';
import { threadItems, type PlacedItem } from '@/lib/threadItems';
import { modelDisplayName, settingsFromNotes } from '@/lib/transcript/sessionMeta';
import { useHostMachines } from '@/state/hostMachines';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/theme/ThemeProvider';
import { glass, minTouchTarget, radius, screenPadding, size, spacing, threadLayout } from '@/theme/tokens';

/**
 * One conversation: a workspace's, or with `paneId` the one agent in that pane
 * of a workspace that holds several.
 */
export default function ThreadScreen({ connectionId, workspaceId, paneId, title, onBack }: {
  /**
   * The connection the chat is on: a host, or one of a host's machines
   * (`${hostId}/${machineId}`). Absent (a notification, an older link): the
   * selected host.
   */
  connectionId?: string;
  workspaceId: string;
  /** Absent: the workspace chat, every agent in it. */
  paneId?: string;
  title?: string;
  onBack?: () => void;
}) {
  const router = useRouter();
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // From the route, not the selected host: a chat on one of the host's
  // machines is read, followed and sent to through the machine's client,
  // whose transport jumps through the host. `useThread` and the transcript
  // store see only a transport, so nothing below knows the difference.
  const selected = useSelectedConnection();
  const wantedId = connectionId !== undefined && connectionId !== '' ? connectionId : selected?.id ?? null;
  const connection = useConnectionFor(wantedId);
  const client = useMemo(() => (connection === null ? null : clientFor(connection)), [connection]);
  /** The machine's label, which leads the subtitle, when the chat is on one. */
  const machineLabel = connection !== null && isMachineConnection(connection) ? connection.name : null;
  const listRef = useRef<FlashListRef<PlacedItem>>(null);
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
  // A machine is gone when its host is still here but no longer lists it as
  // enabled; the placeholder then says so, rather than that the host is gone.
  const machineIds = wantedId === null ? null : splitMachineConnectionId(wantedId);
  const viaHost = useConnectionFor(machineIds?.hostId ?? null);
  const machineGone = hostGone && viaHost !== null;
  // A disabled machine stays in its host's cached list, so its label is
  // usually still known, for the command that brings it back.
  const goneLabel = useHostMachines((state) =>
    machineIds === null ? null : state.byHost[machineIds.hostId]?.find((item) => item.id === machineIds.machineId)?.label ?? null);

  const showSidechain = useSettings((state) => state.showSidechain);

  // Measured height of the floating control stack, so the list can reserve
  // exactly that much room underneath its content.
  const [controlsHeight, setControlsHeight] = useState<number>(threadLayout.initialControlsHeight);
  const [headerHeight, setHeaderHeight] = useState<number>(insets.top + threadLayout.initialHeaderHeight);

  const thread = useThread(db, client, connection?.id ?? '', workspaceId, [], paneId);
  /** Where this chat's read marker and draft are kept; the bare workspace id for the workspace chat. */
  const chat = chatKey({ workspaceId, paneId });
  const scroll = useThreadScroll(listRef, thread.historyVersion);

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
        void markThreadRead(db, connectionId, chat, sig, Date.now());
      };
      stamp();
      // Again on the way out, so a message that arrived while you were reading
      // it counts as seen rather than re-lighting the row you just left.
      return stamp;
    }, [db, connection, chat])
  );

  const rows = useMemo(
    () => threadItems(thread.messages, { showSidechain }),
    [thread.messages, showSidechain]
  );
  const waiting = !thread.isBlocked && (thread.status === 'working' || thread.isSending);

  /**
   * The draft lives in a store rather than inside the composer: the send
   * handler needs it, the composer should stay presentational, and it has to
   * outlive this screen so leaving a chat doesn't lose half a prompt (#113).
   */
  /**
   * What the chat is called: its session's title, as the row has it
   * (`chatTitle`). What the host says now wins over what the link carried,
   * which may be stale after a rename or a retitle; the link's is shown only
   * until the first poll lands. Without either, 'Chat' rather than an
   * internal id like 'w7' (#113).
   */
  const polledTitle = chatTitle({
    sessionTitle: thread.sessionTitle,
    agentName: thread.agentName,
    workspaceLabel: thread.workspaceLabel,
    workspaceId: null,
  });
  const linkTitle = title?.trim() ?? '';
  const heading = polledTitle !== '' ? polledTitle : linkTitle !== '' ? linkTitle : 'Chat';

  const key = draftKey(connection?.id ?? '', chat);
  const sessionSig = sessionSignature(thread.agents);
  const draft = visibleDraft(useDrafts((state) => state.drafts[key]), sessionSig);
  const saveDraft = useDrafts((state) => state.save);
  const setDraft = (text: string) => saveDraft(key, text, sessionSig);
  // Only Claude's built-ins are offered; a Codex chat still sends what is typed.
  const suggestions = thread.agents.some((agent) => agent.agent === 'claude')
    ? commandSuggestions(draft, CLAUDE_COMMANDS)
    : [];

  // Pictures waiting to go with the next message. They stay until a send is
  // taken, so a failed upload leaves them in place with the draft.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const addAttachments = async (source: 'library' | 'paste') => {
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) return;
    setPreparing(true);
    setAttachError(null);
    try {
      const added = source === 'library' ? await pickAttachments(room) : [await pasteAttachment()];
      const ready = added.filter((item): item is Attachment => item !== null);
      if (ready.length > 0) setAttachments((previous) => [...previous, ...ready].slice(0, MAX_ATTACHMENTS));
    } catch (thrown) {
      setAttachError(`Couldn't add the picture: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
    } finally {
      setPreparing(false);
    }
  };
  // Straight to the library, unless the clipboard holds a picture to paste.
  const offerAttachment = async () => {
    if (attachments.length >= MAX_ATTACHMENTS) {
      setAttachError(`A message can carry ${MAX_ATTACHMENTS} pictures.`);
      return;
    }
    if (!(await clipboardHasImage())) {
      await addAttachments('library');
      return;
    }
    showActionSheet({
      title: 'Add a picture',
      actions: [
        { label: 'Photo Library', onPress: () => void addAttachments('library') },
        { label: 'Paste Picture', onPress: () => void addAttachments('paste') },
      ],
    });
  };
  const sendWithAttachments = async (text: string) => {
    // Before the send, so the message lands in a list already following the end.
    scroll.followEnd(false);
    const accepted = await thread.send(text, attachments);
    if (accepted) setAttachments([]);
    return accepted;
  };

  /**
   * Installing herdr's missing chat-agent integration from here.
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
  const agentKind: 'claude' | 'codex' | 'omp' = integrationKind?.agent === 'codex'
    ? 'codex'
    : integrationKind?.agent === 'omp' ? 'omp' : 'claude';
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

  // A /model or /effort that has just run wins over the last reply's.
  const commanded = useMemo(() => settingsFromNotes(thread.messages), [thread.messages]);
  const effort = commanded.effort ?? thread.sessionMeta?.effort ?? null;
  /**
   * A chat titled by its session names its workspace here instead, first, as
   * its row's line does. One agent of several also says which agent it is,
   * after the workspace. Both read from the agents the poll bound, so they
   * wait for the first poll rather than guessing.
   */
  const paneAgent = paneId === undefined || paneId === '' ? undefined : thread.agents[0];
  const workspaceLine = thread.workspaceLabel !== null && titledBySession(thread) ? thread.workspaceLabel : null;
  const subtitle = [
    // The machine first: the same folder on two computers is two chats.
    machineLabel,
    workspaceLine,
    paneAgent === undefined ? null : agentName(paneAgent.agent),
    commanded.model ?? modelDisplayName(thread.sessionMeta?.model ?? null),
    // "high effort", not a bare "high" that could be anything.
    effort === null ? null : `${effort} effort`,
    // The folder, unless it is the workspace's own name already said first:
    // the line is one line, and the less said the less of it is cut.
    sameName(workspaceLine, thread.workingDirName) ? null : thread.workingDirName,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
  /**
   * The connection before the agent: "online" under a banner saying the chat
   * is offline or paused contradicted it (#4 acceptance). Its own text after
   * the line, which never shrinks: at the end of one truncated line it was the
   * first word cut, and a machine's label in front made that the usual case,
   * leaving the dot's colour as the only status on a phone.
   */
  const statusText = thread.offline ? 'offline' : thread.paused ? 'reconnecting' : statusWord(thread.status);

  // A command's panel needs the room the keyboard takes, and nothing typed
  // goes to it: its rows and actions are taps.
  const panelOpen = thread.overlay !== null;
  useEffect(() => {
    if (panelOpen) Keyboard.dismiss();
  }, [panelOpen]);

  /**
   * The bottom safe-area inset exists to clear the home indicator. A raised
   * keyboard already covers it, so keeping the inset then would leave the
   * composer floating a thumb's width above the keys.
   *
   * This was a `keyboardUp` flag from React Native's `Keyboard` events, `will*`
   * on iOS so the change rode the keyboard's curve. Those events say nothing
   * while a finger drags the keyboard down (iOS posts only the end), so once
   * the list could dismiss it interactively the composer would have jumped by
   * the whole inset after the drag. The keyboard's height now comes frame by
   * frame from react-native-keyboard-controller, on the UI thread, and
   * `composerInset` turns it into the gap; see there for the rule.
   *
   * The controls keep their resting inset as layout and are TRANSLATED down by
   * what the keyboard takes of it. Animating their padding instead would
   * re-measure them, and set `controlsHeight`, on every frame of the drag.
   *
   * Seeded from the keyboard as it is now, not 0: the thread can open with a
   * keyboard or an iPad's assistant bar already up (split view, focus left in
   * another field), and the avoider and the footer read that state at once.
   * Starting at 0 left the controls an inset higher than both until the next
   * keyboard event.
   */
  const keyboardHeight = useSharedValue(KeyboardController.state().height);
  useKeyboardHandler(
    {
      onMove: (event) => {
        'worklet';
        keyboardHeight.set(event.height);
      },
      onInteractive: (event) => {
        'worklet';
        keyboardHeight.set(event.height);
      },
      onEnd: (event) => {
        'worklet';
        keyboardHeight.set(event.height);
      },
    },
    []
  );
  const safeBottom = insets.bottom;
  // Floating controls clear the home indicator. Without this the composer sits
  // on the very bottom edge, where it is genuinely hard to hit.
  const restingInset = composerInset(0, safeBottom, spacing.md);
  /*
    The keyboard controller measures a keyboard by its frame's height and
    assumes it rests on the bottom edge, so the avoider lifts the controls by
    that much. The input-assistant bar an iPad shows with a hardware keyboard
    can float above the edge, and the composer stayed that gap behind it. The
    gap comes from the frame's origin and is added to the lift; for any docked
    keyboard it is 0. Settled, not per frame: a hardware keyboard's bar has no
    drag to follow.
  */
  const floatingGap = useFloatingKeyboardGap();
  const followKeyboard = useAnimatedStyle(() => ({
    transform: [
      { translateY: restingInset - composerInset(keyboardHeight.get(), safeBottom, spacing.md) - floatingGap },
    ],
  }));
  // The list's clearance is layout, so it takes the settled keyboard only: a
  // footer that changed size every frame would move the rows under the reader.
  const settledKeyboard = useKeyboardState((state) => state.height);
  const keyboardTakes = restingInset - composerInset(settledKeyboard, safeBottom, spacing.md) - floatingGap;

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

        Android was once left on the default behaviour, `adjustResize`, which
        shrank the window, so padding on top of it would have double-counted.
        Now Android pads too: edge-to-edge stops the window resizing, and the
        keyboard controller keeps it so. Under edge-to-edge it treats the
        navigation bar as translucent and reports the IME's whole height, nav
        bar included, which is exactly what the window loses; `composerInset`
        then drops the safe-area inset the IME covers, so the composer sits
        just above the IME with no nav-bar-sized gap.

        The avoider is react-native-keyboard-controller's, not React Native's.
        React Native's hears `keyboardWillChangeFrame`, which iOS posts only at
        the end of an interactive drag, so pulling the list down left the
        composer parked mid-screen while the keyboard slid away under it; and
        an iPad with a hardware keyboard drew its floating input-assistant bar
        over the composer. This one follows the keyboard's real frame on the UI
        thread, the drag and the assistant bar included.
      */}
      <KeyboardAvoidingView
        // Padding on Android too: with edge-to-edge (Android 15 enforces it) the
        // window no longer resizes for the keyboard, which covered the composer.
        // The keyboard controller keeps it that way (it takes the insets itself
        // rather than resizing the window), so this padding is the only one.
        behavior="padding"
        // The viewport now starts at the window edge, not below the status bar.
        keyboardVerticalOffset={0}
        // Measure where the avoider really is in the window, not relative to
        // its parent: on iPad the thread is one pane of a split view.
        automaticOffset
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
              <MissingHost
                machine={machineGone ? { label: goneLabel, host: viaHost.name } : null}
                onBack={onBack}
                onHosts={() => router.navigate('/hosts')}
                onChats={() => router.navigate('/')}
              />
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
                if (historyInteraction.current === thread.historyVersion && scroll.nearTop()) void thread.loadOlder();
              }}
              onScrollBeginDrag={() => {
                scroll.listProps.onScrollBeginDrag();
                historyInteraction.current = thread.historyVersion;
                if (scroll.nearTop()) void thread.loadOlder();
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
                      <OlderHistory loading={thread.loadingOlder} reachedStart={thread.reachedStart} />
                    )}
                    {item.kind === 'agent' && placed.startsTurn && item.message.agentLabel !== null && (
                      <Text variant="caption2" color="secondary" style={{ paddingBottom: spacing.xxs }}>
                        {item.message.agentLabel}
                      </Text>
                    )}
                    {item.kind === 'tools' ? (
                      <ToolRun runKey={item.runKey} calls={item.calls} thoughts={item.thoughts.length} />
                    ) : item.kind === 'subagent' ? (
                      <SubagentCard call={item.call} />
                    ) : item.kind === 'note' ? (
                      <CommandNote message={item.message} />
                    ) : (
                      <Bubble
                        message={item.message}
                        isLastInGroup={placed.endsGroup}
                        timeLabel={item.kind === 'user' && placed.endsGroup ? formatTime(item.message.timestamp) : null}
                      />
                    )}
                    {(item.kind === 'user' || item.kind === 'agent') && thread.failedIds.has(item.message.id) && (
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
                    // Less what the settled keyboard takes of the controls'
                    // resting inset, since they sit that much lower then.
                    paddingBottom: controlsHeight - keyboardTakes + spacing.lg,
                  }}>
                  {waiting && (
                    <View style={{ gap: spacing.md }}>
                      {thread.livePreview !== null && <LivePreviewBubble text={thread.livePreview} />}
                      <WorkingIndicator writing={thread.livePreview !== null} />
                    </View>
                  )}
                </View>
              }
            />
          )}

          {/* Sits just above the composer, so it never covers the newest bubble. */}
          <Animated.View
            pointerEvents="box-none"
            style={[
              {
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: controlsHeight,
              },
              followKeyboard,
            ]}>
            <JumpToBottom
              visible={scroll.awayFromEnd && rows.length > 0}
              unreadBelow={scroll.awayFromEnd && waiting}
              onPress={() => scroll.followEnd(true)}
            />
          </Animated.View>

          {/*
            The controls OVERLAY the list rather than sitting in a row beneath it.
            That is what gives the glass something to refract: messages scroll
            underneath the pill instead of stopping above a flat bar. It is also why
            the list footer carries matching clearance.
          */}
          {/* No composer without a host to send to: a text field that cannot
              deliver anything is a promise the screen can't keep. */}
          {!hostGone && (
            <Animated.View
              testID="thread-controls"
              onLayout={(event) => {
                const height = event.nativeEvent.layout.height;
                // The footer's clearance follows, and the list follows its
                // content size change.
                if (height !== controlsHeight) setControlsHeight(height);
              }}
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
                followKeyboard,
              ]}>
              {thread.overlay !== null && !thread.isBlocked && (
                <CommandPanelBar
                  overlay={thread.overlay}
                  busy={thread.overlayBusy}
                  onKeys={(keys) => void thread.sendOverlayKeys(keys)}
                />
              )}
              {suggestions.length > 0 && thread.overlay === null && (
                <CommandSuggestions commands={suggestions} onPick={(command) => setDraft(`/${command.name} `)} />
              )}
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
                onSend={sendWithAttachments}
                disabled={thread.isSending || !thread.canSend}
                attachments={attachments}
                onAttach={() => void offerAttachment()}
                onRemoveAttachment={(name) => setAttachments((previous) => previous.filter((item) => item.name !== name))}
                uploading={preparing || (thread.isSending && attachments.length > 0)}
                onPasteImage={() => void addAttachments('paste')}
              />
            </Animated.View>
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
        {/* No bar: the conversation scrolls up under the controls and blurs
            into the page (EdgeFade), the way a document's top edge does. The
            extra room below the controls is the fade's own tail. */}
        <View testID="thread-header" style={{ paddingBottom: glass.edgeTail }}>
          <EdgeFade />
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
                  <Text testID="thread-title" variant="headline" numberOfLines={1}>
                    {heading}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                    <View style={{ width: size.statusDot, height: size.statusDot, borderRadius: radius.full, backgroundColor: thread.offline || thread.paused ? colors.secondaryLabel : statusColor(thread.status, colors) }} />
                    {subtitle.length > 0 && (
                      <Text testID="thread-meta" variant="caption" color={thread.status === 'blocked' ? 'attention' : 'secondary'} style={{ flexShrink: 1 }} numberOfLines={1}>
                        {subtitle}
                      </Text>
                    )}
                    <Text testID="thread-status" variant="caption" color={thread.status === 'blocked' ? 'attention' : 'secondary'} style={{ flexShrink: 0 }} numberOfLines={1}>
                      {subtitle.length > 0 ? `· ${statusText}` : statusText}
                    </Text>
                    {thread.status === 'working' && <TypingDots size={3.5} />}
                  </View>
                </View>
                <ToolActivityToggle />
                <Glass interactive style={{ borderRadius: radius.full, overflow: 'hidden' }}>
                  {thread.status === 'working' ? (
                    <StopButton onStop={(hard) => void thread.interrupt(hard)} />
                  ) : (
                    <Pressable
                      onPress={() => {
                        haptics.light();
                        // The reloaded list remounts (its key is the history
                        // version) and starts at the end by itself.
                        scroll.followEnd(false);
                        void thread.reload();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Reload this conversation"
                      testID="thread-reload"
                      style={{ width: minTouchTarget, height: minTouchTarget, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="arrow.clockwise" size={size.headerGlyph} tintColor={colors.label} fallback={<Text>↻</Text>} />
                    </Pressable>
                  )}
                </Glass>
              </View>
              {attachError !== null && (
                <ErrorBanner message={attachError} onDismiss={() => setAttachError(null)} />
              )}
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
        </View>
      </View>
    </Screen>
  );
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
