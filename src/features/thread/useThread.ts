import { useCallback, useEffect, useRef, useState } from 'react';
import type * as SQLite from 'expo-sqlite';

import { useSettings } from '@/state/settings';
import type { OutgoingImage } from '@/lib/attachments/upload';
import type { HerdrClient } from '@/lib/herdr/client';
import { chatKey } from '@/lib/chatKey';
import { titleAgent } from '@/lib/chatTitle';
import { sendTarget, sessionSignature, type AgentInfo, type AgentStatus } from '@/lib/herdr/models';
import type { ChatMessage } from '@/lib/transcript/message';
import type { BlockedPending, BlockedPrompt } from '@/lib/transcript/blockedPrompt';
import type { PaneOverlay } from '@/lib/transcript/paneOverlay';
import { modelDisplayName, type SessionMeta } from '@/lib/transcript/sessionMeta';
import { clearThreadCache } from '@/state/threadCache';
import { resumeStaleRuns } from '@/features/thread/workflowRuns';

import { usePollGate } from '../usePollGate';
import { useAgentPoll } from './useAgentPoll';
import { useBlockedPrompt } from './useBlockedPrompt';
import { useDelivery, withoutDeliveryWarning } from './useDelivery';
import { usePaneOverlay } from './usePaneOverlay';
import { useReportPresence } from './useReportPresence';
import { useSessionBinding, type SessionState } from './useSessionBinding';
import { useThreadHistory } from './useThreadHistory';
import { useTranscriptTails } from './useTranscriptTails';

export type { SessionState } from './useSessionBinding';

export interface ThreadState {
  loading: boolean;
  /** Changes only when a bounded host snapshot replaces the visible window. */
  historyVersion: number;
  canSend: boolean;
  messages: ChatMessage[];
  status: AgentStatus;
  agents: AgentInfo[];
  /**
   * The workspace's name on the host, from the last snapshot. A deep link or a
   * notification may arrive without one, and a rename elsewhere changes it.
   */
  workspaceLabel: string | null;
  /**
   * The title the chat's session gave itself, read from the bound agent on
   * every poll: a pane chat's one agent, or a workspace chat's one
   * conversational agent. Null with several, as the workspace's row keeps
   * its label then (`titleAgent`), so the list and the thread never disagree.
   */
  sessionTitle: string | null;
  /** That agent's herdr name, the title while the session has none. */
  agentName: string | null;
  blockedPrompt: BlockedPrompt | null;
  /** The blocked-prompt reply in flight, if any. Non-null disables the bar. */
  blockedPending: BlockedPending | null;
  isBlocked: boolean;
  /**
   * A slash command's panel open on the pane (`/model`, `/effort`), which the
   * agent's status does not report: it stays `idle` under one.
   */
  overlay: PaneOverlay | null;
  /** Keys are on their way to the panel; its controls wait. */
  overlayBusy: boolean;
  sendOverlayKeys: (keys: readonly string[]) => Promise<void>;
  sessionMeta: SessionMeta | null;
  livePreview: string | null;
  workingDirName: string | null;
  error: string | null;
  isSending: boolean;
  /** Fetch one page of history above the oldest message on screen. */
  loadOlder: () => Promise<void>;
  loadingOlder: boolean;
  /** True once the top of the transcript is on screen, nothing left to fetch. */
  reachedStart: boolean;
  /**
   * Whether this thread can be read at all.
   *
   * `ok`, an agent has reported its session, so the transcript is targetable.
   * `waiting`, an agent is here but has not reported yet; normal for a minute.
   * `missing`, long enough that the host is probably missing herdr's Claude
   *   integration, which is the only thing that reports the id.
   * `replaced`, the session this thread had open ended and a different agent
   *   now holds the workspace, not yet reporting its own. Sending is held.
   */
  sessionState: SessionState;
  /**
   * The Claude transcripts this thread has open, by the paths their session
   * ids named. A session's subagents and workflow runs are filed beside its
   * transcript, so this is where the thread's cards find them. Empty until a
   * transcript opens, and for Codex and OMP chats.
   */
  transcriptPaths: string[];
  /** The host could not be reached on the last poll; what shows is saved history. */
  offline: boolean;
  /** The live transcript stream failed and is being restarted. */
  paused: boolean;
  failedIds: Set<string>;
  /**
   * Resolves whether the message was taken. `false` comes back at once, before
   * anything is sent, so the composer can put the draft back (#100). Pictures
   * are uploaded to the host first; if one cannot be, nothing is sent and
   * `false` comes back with the reason in `actionError`.
   */
  send: (text: string, images?: readonly OutgoingImage[]) => Promise<boolean>;
  retry: (id: string) => Promise<void>;
  sendKeys: (keys: readonly string[]) => Promise<void>;
  /** Stop the working agent. `hard` sends Ctrl-C and may end the session. */
  interrupt: (hard?: boolean) => Promise<void>;
  clearError: () => void;
  reload: () => Promise<void>;
}

/**
 * Drives one thread: tails the transcript into bubbles, tracks live
 * blocked/working state, and sends replies back through herdr.
 *
 * The thread is a workspace's, merging every agent in it, or with `paneId` the
 * one agent in that pane (see `chatAgents`).
 *
 * Transcripts are targeted by the agent's native session reference, herdr's
 * `agent_session.value` IS the Claude transcript filename, rather than by
 * guessing the newest file in the project directory, because that guess opens a
 * previous session's history under a reused workspace.
 *
 * The work is split by concern, and this hook wires the parts together:
 *
 * - `useThreadHistory`: the messages on screen, the cache, paging up.
 * - `useTranscriptTails`: the live transcript streams and the header's model.
 * - `useSessionBinding`: which session the thread shows, and its state.
 * - `useAgentPoll`: the status loop that drives the rest.
 * - `useBlockedPrompt`, `usePaneOverlay`: a question, or a command's panel.
 * - `useDelivery`: sending, and whether a message landed.
 */
export function useThread(
  db: SQLite.SQLiteDatabase,
  client: HerdrClient | null,
  connectionId: string,
  workspaceId: string,
  initialAgents: readonly AgentInfo[],
  paneId?: string,
  /** The session the chat list last saw for this chat, when it opened from there. */
  listedSig?: string
): ThreadState {
  /** Absent and empty both mean the workspace chat, as in `chatKey`. */
  const pane = paneId === undefined || paneId === '' ? undefined : paneId;
  /**
   * What the message cache and tail cursors are filed under. The workspace
   * chat's is its bare id, as it always was. A pane's chat needs its own: the
   * cache holds one session signature per key, so sharing the workspace's
   * would have each chat `rebind` away the other's history on every open.
   */
  const cacheKey = chatKey({ workspaceId, paneId: pane });
  const [loading, setLoading] = useState(client !== null);
  const [agents, setAgents] = useState<AgentInfo[]>([...initialAgents]);
  /*
    Errors live in three slots, because each has its own owner and its own
    reason to go away. The poll clears only what the poll raised: a warning
    from a send ("the agent never picked that up") is there to stop the user
    sending the same prompt twice into a live agent, and a successful poll two
    seconds later is no reason to take it down (#82).

    - `pollError` (`useAgentPoll`): the status loop's own failure. Cleared by
      its next success.
    - `actionError`, here: a send, a blocked-prompt reply, an interrupt.
      Cleared on dismiss, on the transcript receipt that answers it, or by the
      next send.
    - `tailError` (`useTranscriptTails`): the live transcript reader.
  */
  const [actionError, setActionError] = useState<string | null>(null);
  const polling = usePollGate();
  // The user's own battery/data tradeoff, applied on top of each screen's rate.
  const pollScale = useSettings((state) => state.pollScale);
  const aliveRef = useRef(true);
  /** The session the thread shows, by its signature; null while none is bound. */
  const boundSigRef = useRef<string | null>(null);
  /** Asks the running status loop to poll soon. Set by the effect that owns it. */
  const kickRef = useRef<() => void>(() => undefined);

  // Cache reads happen after the snapshot identifies the live session. A route
  // opens without initial agents, so seeding here could flash a recycled chat.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const deliveryLanded = useCallback(() => setActionError(withoutDeliveryWarning), [setActionError]);
  const history = useThreadHistory({ client, db, connectionId, cacheKey, aliveRef, boundSigRef, onConfirmed: deliveryLanded });
  const { shown, rebuild, seed, ingest, showEnd, anchorOlder, reset: resetWindow, markFailed, unmarkFailed } = history;
  const tails = useTranscriptTails({
    client, db, connectionId, cacheKey, aliveRef, boundSigRef, kickRef, shown, ingest, showEnd, anchorOlder, setLoading,
  });
  const { startTails, abortTails, stopTails, resetMeta, dropSilentTails, setTailError } = tails;

  const resetHistory = useCallback(() => {
    resetWindow();
    resetMeta();
  }, [resetWindow, resetMeta]);

  const primaryPane = sendTarget(agents);
  const overlay = usePaneOverlay({ client, aliveRef, kickRef, setActionError });
  const { readOverlay, watchOverlay, watchingOverlay, closeOverlay, overlaySeen } = overlay;
  const asking = useBlockedPrompt({ client, aliveRef, kickRef, setActionError, pollScale, agents, primaryPane });
  const { sessionState, bind } = useSessionBinding({
    client, db, connectionId, cacheKey, listedSig, aliveRef, boundSigRef, shown, seed, stopTails, resetHistory, setLoading,
  });
  const poll = useAgentPoll({
    client, db, connectionId, cacheKey, workspaceId, pane, polling, pollScale, aliveRef, boundSigRef, kickRef, agents,
    setAgents, setLoading, shown, seed, bind, startTails, abortTails, dropSilentTails,
    readQuestion: asking.readQuestion, watchingOverlay, readOverlay, closeOverlay,
  });
  const { resetBackoff, setPollError } = poll;
  const delivery = useDelivery({
    client, workspaceId, pane, aliveRef, boundSigRef, kickRef, setActionError, agents, primaryPane, loading, sessionState,
    shown, rebuild, markFailed, unmarkFailed, watchOverlay, overlaySeen,
  });

  const blockedPane = asking.blockedPane;
  const status: AgentStatus = blockedPane !== null
    ? 'blocked'
    : agents.some((a) => a.agentStatus === 'working')
      ? 'working'
      : agents.some((a) => a.agentStatus === 'done')
        ? 'done'
        : agents.length === 0
          ? 'unknown'
          : 'idle';

  const sessionMeta = primaryPane === null ? null
    : tails.sessionMetadata[sessionSignature([primaryPane]) ?? ''] ?? null;

  // Publish "driven from a phone, on this model" to the host's sidebar. Gated on
  // `polling` so a backgrounded app stops claiming presence it does not have.
  useReportPresence(
    client,
    primaryPane?.paneId ?? null,
    modelDisplayName(sessionMeta?.model ?? null),
    polling
  );

  const reload = useCallback(async () => {
    // A workflow given up on as gone quiet is looked at again.
    resumeStaleRuns();
    stopTails();
    // Reload must replace the persisted messages too, otherwise a cold reopen
    // resurrects stale parsed bubbles that the fresh host read has removed.
    await clearThreadCache(db, connectionId, cacheKey);
    if (!aliveRef.current) return;
    resetHistory();
    setLoading(true);
    resetBackoff();
    kickRef.current();
  }, [db, connectionId, cacheKey, resetHistory, stopTails, resetBackoff]);

  const titled = titleAgent(agents);

  return {
    loading,
    historyVersion: history.historyVersion,
    canSend:
      client !== null &&
      primaryPane !== null &&
      !loading &&
      !poll.offline &&
      sessionState !== 'unsupported' &&
      sessionState !== 'replaced',
    offline: poll.offline,
    paused: tails.tailError !== null,
    transcriptPaths: tails.transcriptPaths,
    messages: history.messages,
    status,
    agents,
    workspaceLabel: poll.workspaceLabel,
    sessionTitle: titled?.title ?? null,
    agentName: titled?.name ?? null,
    blockedPrompt: asking.blockedPrompt,
    blockedPending: asking.blockedPending,
    isBlocked: blockedPane !== null,
    overlay: overlay.overlay,
    overlayBusy: overlay.overlayBusy,
    sendOverlayKeys: overlay.sendOverlayKeys,
    sessionMeta,
    livePreview: poll.livePreview,
    workingDirName: primaryPane?.cwd.split('/').filter(Boolean).pop() ?? null,
    error: actionError ?? poll.pollError ?? tails.tailError,
    isSending: delivery.isSending,
    loadOlder: history.loadOlder,
    loadingOlder: history.loadingOlder,
    reachedStart: history.reachedStart,
    sessionState,
    failedIds: history.failedIds,
    send: delivery.send,
    retry: delivery.retry,
    sendKeys: asking.sendKeys,
    interrupt: delivery.interrupt,
    clearError: () => {
      setActionError(null);
      setPollError(null);
      setTailError(null);
    },
    reload,
  };
}
