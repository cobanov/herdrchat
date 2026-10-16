import type { FlashListRef } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Screen } from '@/components/Screen';
import { Composer } from '@/features/thread/Composer';
import { JumpToBottom } from '@/features/thread/JumpToBottom';
import type { DelegationScope } from '@/features/thread/delegation';
import { openTerminal } from '@/features/terminal/navigation';
import { isTerminalAvailable } from '../../../modules/herdr-terminal/src';
import { MissingHost, ThreadPlaceholder } from '@/features/thread/ThreadPlaceholders';
import { statusText, ThreadHeader, threadHeading } from '@/features/thread/ThreadHeader';
import { ThreadControls } from '@/features/thread/ThreadControls';
import { ThreadMessages } from '@/features/thread/ThreadMessages';
import { useAttachments } from '@/features/thread/useAttachments';
import { useIntegrationInstall } from '@/features/thread/useIntegrationInstall';
import { useReadMarker } from '@/features/thread/useReadMarker';
import { useThread } from '@/features/thread/useThread';
import { useThreadConnection } from '@/features/thread/useThreadConnection';
import { useThreadKeyboard } from '@/features/thread/useThreadKeyboard';
import { paletteAgent, useProjectSlashScan, useSlashCommands } from '@/features/thread/useSlashCommands';
import { useThreadScroll } from '@/features/thread/useThreadScroll';
import { chatKey } from '@/lib/chatKey';
import { sessionSignature } from '@/lib/herdr/models';
import { draftKey, useDrafts, visibleDraft } from '@/state/drafts';
import { paletteSections, pickSlashCommand, type CatalogueCommand } from '@/lib/slashCommands';
import { isShellDraft } from '@/lib/shellMode';
import { sessionDir } from '@/lib/subagents/paths';
import { threadItems, type PlacedItem } from '@/lib/threadItems';
import { settingsFromNotes } from '@/lib/transcript/sessionMeta';
import { useSettings } from '@/state/settings';
import { size, spacing, threadLayout } from '@/theme/tokens';

/**
 * One conversation: a workspace's, or with `paneId` the one agent in that pane
 * of a workspace that holds several.
 */

export default function ThreadScreen({ connectionId, workspaceId, paneId, listedSig, title, onBack }: {
  /**
   * The host the chat is on. Absent (a notification, an older link): the
   * selected host.
   */
  connectionId?: string;
  workspaceId: string;
  /** Absent: the workspace chat, every agent in it. */
  paneId?: string;
  /** The session the chat list saw for this chat, which lets it open from its cache at once. */
  listedSig?: string;
  title?: string;
  onBack?: () => void;
}) {
  const router = useRouter();
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { connection, client, hostLabel, hostGone } = useThreadConnection(connectionId);
  const listRef = useRef<FlashListRef<PlacedItem>>(null);


  const showSidechain = useSettings((state) => state.showSidechain);

  // Measured height of the floating control stack, so the list can reserve
  // exactly that much room underneath its content.
  const [controlsHeight, setControlsHeight] = useState<number>(threadLayout.initialControlsHeight);
  const [headerHeight, setHeaderHeight] = useState<number>(insets.top + threadLayout.initialHeaderHeight);

  const thread = useThread(db, client, connection?.id ?? '', workspaceId, [], paneId, listedSig);
  /** Where this chat's read marker and draft are kept; the bare workspace id for the workspace chat. */
  const chat = chatKey({ workspaceId, paneId });
  const scroll = useThreadScroll(listRef, thread.historyVersion);

  useReadMarker(db, connection?.id, chat, thread.agents);

  const rows = useMemo(
    () => threadItems(thread.messages, { showSidechain }),
    [thread.messages, showSidechain]
  );
  // Where this chat's subagents and workflow runs are: beside each Claude
  // transcript the thread has open, never guessed from the folder.
  const transcriptKey = thread.transcriptPaths.join('\n');
  const delegationScope = useMemo<DelegationScope>(() => ({
    client,
    connectionId: connection?.id ?? '',
    workspaceId,
    sessionDirs: transcriptKey.split('\n').map(sessionDir).filter((dir): dir is string => dir !== null),
    transcripts: transcriptKey.length === 0 ? [] : transcriptKey.split('\n'),
  }), [client, connection?.id, workspaceId, transcriptKey]);
  const waiting = !thread.isBlocked && (thread.status === 'working' || thread.isSending);

  // A /model or /effort that has just run wins over the last reply's.
  const commanded = useMemo(() => settingsFromNotes(thread.messages), [thread.messages]);
  const { heading, parts } = threadHeading(thread, { title, paneId, hostLabel, commanded });

  // The pane the header's Terminal opens: this chat's own, or for a
  // workspace's chat the agent herdr has focused (the first, when none is).
  const terminalPane = paneId !== undefined && paneId !== ''
    ? paneId
    : (thread.agents.find((agent) => agent.focused) ?? thread.agents[0])?.paneId;

  /**
   * The draft lives in a store rather than inside the composer: the send
   * handler needs it, the composer should stay presentational, and it has to
   * outlive this screen so leaving a chat doesn't lose half a prompt (#113).
   */
  const key = draftKey(connection?.id ?? '', chat);
  const sessionSig = sessionSignature(thread.agents);
  const draft = visibleDraft(useDrafts((state) => state.drafts[key]), sessionSig);
  const saveDraft = useDrafts((state) => state.save);
  const setDraft = (text: string) => saveDraft(key, text, sessionSig);
  /**
   * The `/` palette: what the agent's own terminal offers for the same `/`,
   * for the agent the thread sends to (Claude's catalogue as read off this
   * connection, Codex's fixed list, nothing for OMP). The folder's own
   * commands are read once the first window is on screen, never before it.
   */
  const palette = paletteAgent(thread.agents);
  const commands = useSlashCommands(connection?.id ?? null, palette?.kind ?? null, palette?.cwd ?? null);
  useProjectSlashScan(
    connection?.id ?? null,
    client?.transport ?? null,
    palette?.kind ?? null,
    palette?.cwd ?? null,
    !thread.loading
  );
  const sections = useMemo(() => paletteSections(draft, commands), [draft, commands]);
  /**
   * The last command a pick filled in, with its argument hint: the composer
   * shows the hint after it while the draft is exactly that, as the terminal
   * does until something is typed.
   */
  const [filled, setFilled] = useState<{ text: string; placeholder: string } | null>(null);
  const composerHint = filled !== null && filled.placeholder !== '' && draft === filled.text ? filled.placeholder : undefined;

  const pictures = useAttachments();
  /**
   * A pick in the palette, the terminal's way (`pickSlashCommand`): a command
   * that can run as it is is sent at once, as Enter on it does; one that
   * needs an argument, one that would end the agent or the session, or one
   * that commits, pushes or rewrites (`fillsOnPick`), is filled in to wait for the person's own send. A send the thread refuses
   * puts back what was typed.
   */
  const pickCommand = (command: CatalogueCommand) => {
    const pick = pickSlashCommand(command);
    if (pick.action === 'fill') {
      setFilled({ text: pick.text, placeholder: pick.placeholder });
      setDraft(pick.text);
      return;
    }
    const typed = draft;
    setDraft('');
    scroll.followEnd(false);
    void thread.send(pick.text).then((accepted) => {
      if (!accepted) setDraft(typed);
    });
  };
  const sendWithAttachments = async (text: string) => {
    // Before the send, so the message lands in a list already following the end.
    scroll.followEnd(false);
    const accepted = await thread.send(text, pictures.attachments);
    if (accepted) pictures.clearAttachments();
    return accepted;
  };

  const integration = useIntegrationInstall(client, thread.agents);


  // A command's panel needs the room the keyboard takes, and nothing typed
  // goes to it: its rows and actions are taps.
  const panelOpen = thread.overlay !== null;
  useEffect(() => {
    if (panelOpen) Keyboard.dismiss();
  }, [panelOpen]);

  const { followKeyboard, restingInset, keyboardTakes } = useThreadKeyboard(insets.bottom);
  /** Room the floating controls take over the end of the list or the screen. */
  const bottomClearance = controlsHeight - keyboardTakes + spacing.lg;

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
                onBack={onBack}
                onHosts={() => router.navigate('/hosts')}
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
                agentKind={integration.agentKind ?? undefined}
                onInstallIntegration={integration.install}
                installing={integration.installing}
                installError={integration.installError}
              />
            </View>
          ) : (
            <ThreadMessages
              rows={rows}
              listRef={listRef}
              scroll={scroll}
              historyVersion={thread.historyVersion}
              loadOlder={thread.loadOlder}
              loadingOlder={thread.loadingOlder}
              reachedStart={thread.reachedStart}
              failedIds={thread.failedIds}
              retry={thread.retry}
              livePreview={thread.livePreview}
              waiting={waiting}
              headerHeight={headerHeight}
              // Less what the settled keyboard takes of the controls' resting
              // inset, since they sit that much lower then.
              bottomClearance={bottomClearance}
              delegationScope={delegationScope}
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

          {/* No composer without a host to send to: a text field that cannot
              deliver anything is a promise the screen can't keep. */}
          {!hostGone && (
            <ThreadControls
              keyboardStyle={followKeyboard}
              restingInset={restingInset}
              onHeight={(height) => {
                if (height !== controlsHeight) setControlsHeight(height);
              }}
              overlay={thread.overlay}
              overlayBusy={thread.overlayBusy}
              onOverlayKeys={(keys) => void thread.sendOverlayKeys(keys)}
              sections={sections}
              onPick={pickCommand}
              shellHint={isShellDraft(draft, palette?.kind ?? null)}
              isBlocked={thread.isBlocked}
              blockedPrompt={thread.blockedPrompt}
              blockedPending={thread.blockedPending}
              onBlockedKeys={(keys) => void thread.sendKeys(keys)}>
              <Composer
                draft={draft}
                onDraftChange={setDraft}
                // Prompt history was removed with the chips that displayed it.
                // Storing what someone typed for a feature that no longer exists
                // is a liability, not a convenience, the table and its cleanup
                // stay only so existing rows are still erased by Reset app data.
                onSend={sendWithAttachments}
                disabled={thread.isSending || !thread.canSend}
                attachments={pictures.attachments}
                onAttach={() => void pictures.offerAttachment()}
                onRemoveAttachment={pictures.removeAttachment}
                uploading={pictures.preparing || (thread.isSending && pictures.attachments.length > 0)}
                onPasteImage={() => void pictures.addAttachments('paste')}
                placeholder={composerHint}
              />
            </ThreadControls>
          )}
        </View>
      </KeyboardAvoidingView>
      <ThreadHeader
        heading={heading}
        parts={parts}
        status={thread.status}
        dimmed={thread.offline || thread.paused}
        statusText={statusText(thread.status, thread.offline, thread.paused)}
        onBack={onBack}
        // Not where no terminal can open (Android): it would lead nowhere.
        onTerminal={isTerminalAvailable && terminalPane !== undefined && connection !== null ? () => {
          Keyboard.dismiss();
          openTerminal({
            connectionId: connection.id,
            paneId: terminalPane,
            kind: 'agent',
            terminalId: thread.agents.find((agent) => agent.paneId === terminalPane)?.terminalId ?? '',
            title: heading,
          });
        } : undefined}
        onStop={(hard) => void thread.interrupt(hard)}
        onReload={() => {
          // The reloaded list remounts (its key is the history version) and
          // starts at the end by itself.
          scroll.followEnd(false);
          void thread.reload();
        }}
        onHeight={setHeaderHeight}>
        {pictures.attachError !== null && (
          <ErrorBanner message={pictures.attachError} onDismiss={pictures.dismissAttachError} />
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
      </ThreadHeader>
    </Screen>
  );
}
