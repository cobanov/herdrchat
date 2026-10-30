import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type * as SQLite from 'expo-sqlite';

import type { HerdrClient } from '@/lib/herdr/client';
import { concernsWorkspace } from '@/lib/herdr/events';
import { sameAgents, type AgentInfo } from '@/lib/herdr/models';
import { errorText, HerdrError } from '@/lib/herdr/protocol';
import { backoffDelay, needsTheUser, pollsFast, statusPollMs } from '@/lib/poll';
import type { ThreadWindow } from '@/lib/threadWindow';
import { extractLivePreview } from '@/lib/transcript/livePreview';
import { drawsAgentsPane, hasRunningAgents, parseAgentsPane, type AgentsPane } from '@/lib/transcript/agentsPane';
import type { ChatMessage } from '@/lib/transcript/message';
import { seedIfSession, seedMessages } from '@/state/threadCache';

import { useHostEvents } from '../useHostEvents';

/** Coalesce a burst of events (working → done → idle) into one poll. */
const EVENT_DEBOUNCE_MS = 250;
/**
 * How much of a working pane's screen the poll reads. Enough for the prose
 * above Claude's spinner line and, under its composer and footer, the agents
 * pane: a header, five rows and `↓ N more`, with Claude's update notice and
 * compaction hint between them.
 */
const LIVE_SCREEN_LINES = 40;

/**
 * The panes a thread is about, out of a host snapshot: every pane in the
 * workspace, or with `paneId` only that one.
 *
 * Everything the thread does derives from this list, so a pane's chat binds,
 * tails, sends and reports presence for its own agent and nothing else, while
 * the workspace chat keeps every pane exactly as it always has. When the pane
 * is gone the list is empty, which unbinds the thread and holds sending the
 * way an emptied workspace does. Matching on the pane id rather than following
 * the session to another pane is deliberate: the pane is what the user picked
 * out of the list, and its row disappears with it.
 */
export function chatAgents(agents: readonly AgentInfo[], workspaceId: string, paneId: string | undefined): AgentInfo[] {
  return agents.filter((agent) => agent.workspaceId === workspaceId && (paneId === undefined || agent.paneId === paneId));
}

interface Options {
  client: HerdrClient | null;
  db: SQLite.SQLiteDatabase;
  connectionId: string;
  cacheKey: string;
  /** The session the chat list last saw for this chat, when it opened from there. */
  listedSig: string | undefined;
  workspaceId: string;
  pane: string | undefined;
  polling: boolean;
  pollScale: number;
  aliveRef: RefObject<boolean>;
  boundSigRef: RefObject<string | null>;
  kickRef: RefObject<() => void>;
  agents: readonly AgentInfo[];
  setAgents: (update: (previous: AgentInfo[]) => AgentInfo[]) => void;
  setLoading: (loading: boolean) => void;
  shown: ThreadWindow;
  seed: (cached: ChatMessage[]) => void;
  bind: (live: readonly AgentInfo[], stopped: () => boolean) => Promise<{ conversational: AgentInfo[] } | null>;
  startTails: (live: readonly AgentInfo[]) => Promise<void>;
  abortTails: () => void;
  dropSilentTails: (conversational: readonly AgentInfo[]) => void;
  readQuestion: (
    live: readonly AgentInfo[],
    visible: (paneId: string, lines: number) => Promise<string>
  ) => Promise<{ blocked: AgentInfo | undefined; panel: boolean }>;
  watchingOverlay: () => boolean;
  readOverlay: (paneId: string) => Promise<string | null>;
  closeOverlay: () => void;
}

/**
 * The status poll: one snapshot every couple of seconds while an agent works
 * or asks, or Claude's background agents run, every 30 s while the host's
 * events say the rest (`pollsFast`, `statusPollMs`), backed off on
 * failure. Each snapshot goes to the session binding, the tails, the
 * question, the panel and the preview, in that order. It doubles as the tail
 * watchdog.
 */
export function useAgentPoll({
  client, db, connectionId, cacheKey, listedSig, workspaceId, pane, polling, pollScale, aliveRef, boundSigRef, kickRef, agents,
  setAgents, setLoading, shown, seed, bind, startTails, abortTails, dropSilentTails, readQuestion,
  watchingOverlay, readOverlay, closeOverlay,
}: Options) {
  /**
   * The workspace's name on the host, from the last snapshot. A deep link or a
   * notification may arrive without one, and a rename elsewhere changes it.
   */
  const [workspaceLabel, setWorkspaceLabel] = useState<string | null>(null);
  const [livePreview, setLivePreview] = useState<string | null>(null);
  const [agentsRead, setAgentsRead] = useState<{ pane: AgentsPane; at: number } | null>(null);
  /** The last screen read had an agents pane. Read by the poll, which must not re-run on it. */
  const agentsPaneShown = useRef(false);
  /** The status loop's own failure. Cleared by its next success. */
  const [pollError, setPollError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  /** The saved history was already put on screen for an unreachable host. */
  const offlineSeeded = useRef(false);
  /** Consecutive failed polls, for the backoff. Reset by any success. */
  const failures = useRef(0);
  /** The screen the last poll read, which the next one asks for with its snapshot. */
  const screenWant = useRef<{ paneId: string; lines: number } | null>(null);
  const streamLive = useHostEvents(
    client,
    agents.map((agent) => agent.paneId),
    polling,
    (event) => {
      if (concernsWorkspace(event, workspaceId)) kickRef.current();
    }
  );
  const streamLiveRef = useRef(streamLive);
  useEffect(() => {
    streamLiveRef.current = streamLive;
  }, [streamLive]);

  useEffect(() => {
    // Backgrounded: iOS suspends these timers anyway, but the socket usually
    // dies with them, so the honest thing is to stop and re-poll immediately on
    // resume, which is what remounting this effect does.
    if (client === null || !polling) return;
    // A panel may already be open: opened from the desk, or left open when
    // the app went to the background. Look once each time polling starts.
    let lookForPanel = true;
    // Whether the last poll saw the agent working: the first idle screen after
    // a turn is read for the agents pane, see `readAgents`.
    let wasWorking = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let again = false;
    let stopped = false;

    const schedule = (delayMs: number) => {
      if (stopped) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => void poll(), delayMs);
    };

    const poll = async () => {
      if (stopped) return;
      if (inFlight) {
        // A kick landed mid-poll. Its cause may postdate what this poll read,
        // so go once more when it finishes rather than dropping it.
        again = true;
        return;
      }
      inFlight = true;
      // Until a poll gets far enough to say otherwise, the fast rate.
      let keepFast = true;
      let needsUser = false;
      try {
        // The screen the last poll read rides with the snapshot: while an agent
        // works or waits, every poll reads one, and on its own channel that was
        // half of what an open chat asked the host.
        const asked = screenWant.current;
        const polled = await client.pollSnapshot(asked);
        const snapshot = polled.snapshot;
        let nextWant: { paneId: string; lines: number } | null = null;
        /** A pane's visible screen: the one the batch brought, or a read of its own. */
        const visible = async (paneId: string, lines: number): Promise<string> => {
          nextWant ??= { paneId, lines };
          return polled.screen !== null && asked?.paneId === paneId && asked.lines === lines
            ? polled.screen
            : client.paneVisible(paneId, lines);
        };
        if (!aliveRef.current || stopped) return;
        const live = chatAgents(snapshot.agents, workspaceId, pane);
        setAgents((previous) => (sameAgents(previous, live) ? previous : live));
        const workspace = snapshot.workspaces?.find((item) => item.workspaceId === workspaceId);
        if (workspace !== undefined) setWorkspaceLabel(workspace.label.length > 0 ? workspace.label : null);

        const bound = await bind(live, () => stopped);
        if (bound === null) return;
        const { conversational } = bound;

        void startTails(conversational);

        const { blocked, panel } = await readQuestion(live, visible);
        if (panel) lookForPanel = true;

        const primary =
          live.find((a) => a.focused) ?? live.find((a) => a.agent !== null) ?? live[0];
        const working = live.some((agent) => agent.agentStatus === 'working');
        let watchingPanel = false;
        let agentsRunning = false;

        // A panel only sits over an idle Claude, and never beside a question.
        const watching = watchingOverlay();
        const panelAgent = primary?.agent === 'claude' || primary?.agent === 'codex';
        let idleScreen: string | null = null;
        if ((watching || lookForPanel) && blocked === undefined && !working && primary !== undefined && panelAgent) {
          lookForPanel = false;
          watchingPanel = watching;
          idleScreen = await readOverlay(primary.paneId);
        } else {
          closeOverlay();
        }
        // The agents pane stays on screen after the turn that started its
        // agents ends: Claude idles while they run. So the screen is read on
        // while the last read had one, until a read has none. While the
        // agent works it is the live preview's read, and while it idles a
        // look for a slash command's panel serves too, never a second read.
        // A turn can start a background agent and end between two polls, so
        // no working read saw the pane; the first idle poll after a working
        // one reads the screen once to catch it. Only Claude draws the pane,
        // so none of these idle reads happen for any other agent.
        const drawsPane = drawsAgentsPane(primary?.agent);
        const justIdled = wasWorking && !working;
        wasWorking = working;
        const readAgents =
          drawsPane && (agentsPaneShown.current || idleScreen !== null || justIdled) && blocked === undefined;
        if ((working || readAgents) && primary !== undefined) {
          const raw = idleScreen ?? await visible(primary.paneId, LIVE_SCREEN_LINES);
          if (stopped) return;
          setLivePreview(working ? extractLivePreview(raw) : null);
          const found = drawsPane ? parseAgentsPane(raw) : null;
          agentsPaneShown.current = found !== null;
          agentsRunning = hasRunningAgents(found);
          setAgentsRead(found === null ? null : { pane: found, at: Date.now() });
        } else {
          setLivePreview(null);
          // Under a question the pane is out of sight; the last read stands.
          if (blocked === undefined) {
            agentsPaneShown.current = false;
            setAgentsRead(null);
          }
        }
        screenWant.current = nextWant;
        keepFast = pollsFast({ working, blocked: blocked !== undefined, watchingPanel, agentsRunning });

        if (working) dropSilentTails(conversational);
        setPollError(null);
        setOffline(false);
        failures.current = 0;
      } catch (thrown) {
        if (!aliveRef.current || stopped) return;
        setLoading(false);
        failures.current += 1;
        needsUser = thrown instanceof HerdrError && needsTheUser(thrown.code);
        setPollError(errorText(thrown));
        setOffline(true);
        /*
          The host cannot be reached and nothing is on screen yet. The saved
          messages were cut short before: they were read only after a snapshot
          named the session, so an offline thread said "No agent is running"
          over a conversation the phone had on disk (#97). Show them, read-only.
          The cache belongs to the session last bound to this chat; when the
          host is back and names a different one, `rebind` drops it and the
          history is reset, as it always was.

          Opened from the list, only the session the list saw: herdr reuses
          workspace slots, and a cache of the slot's previous chat showed under
          the new chat's title until the host answered (HC-18). From a link or
          a notification there is no such session to check against.
        */
        if (!offlineSeeded.current && boundSigRef.current === null && shown.isEmpty) {
          offlineSeeded.current = true;
          const cached = listedSig === undefined || listedSig === ''
            ? await seedMessages(db, connectionId, cacheKey)
            : await seedIfSession(db, connectionId, cacheKey, listedSig);
          if (!aliveRef.current || stopped || boundSigRef.current !== null || cached.length === 0) return;
          seed(cached);
        }
      } finally {
        inFlight = false;
        // The banner stays up throughout: backing off must never read as
        // recovery. Only the interval changes. A failure only the user can fix
        // pauses the loop instead (`needsTheUser`); Reload kicks it again.
        if (aliveRef.current && !stopped && !(needsUser && !again)) {
          const base = statusPollMs({ streamLive: streamLiveRef.current, fast: keepFast, pollScale });
          schedule(again ? EVENT_DEBOUNCE_MS : backoffDelay(base, failures.current));
          again = false;
        }
      }
    };
    // Mid-poll, a kick only asks for one more round. Scheduling a timer
    // instead lost it: the poll's own `schedule(backoff)` cleared that timer
    // when it finished first (#88).
    kickRef.current = () => {
      if (inFlight) again = true;
      else schedule(EVENT_DEBOUNCE_MS);
    };
    void poll();

    return () => {
      stopped = true;
      kickRef.current = () => undefined;
      if (timer !== null) clearTimeout(timer);
      abortTails();
    };
  }, [
    client,
    db,
    connectionId,
    workspaceId,
    pane,
    cacheKey,
    listedSig,
    polling,
    pollScale,
    aliveRef,
    boundSigRef,
    kickRef,
    setAgents,
    setLoading,
    shown,
    seed,
    bind,
    startTails,
    abortTails,
    dropSilentTails,
    readQuestion,
    watchingOverlay,
    readOverlay,
    closeOverlay,
  ]);

  /** Start the backoff over: the user asked for a fresh look. */
  const resetBackoff = useCallback(() => {
    failures.current = 0;
  }, []);

  return {
    workspaceLabel, livePreview, pollError, setPollError, offline, resetBackoff,
    agentsPane: agentsRead?.pane ?? null,
    agentsPaneAt: agentsRead?.at ?? null,
  };
}
