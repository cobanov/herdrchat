import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { backoffDelay, needsTheUser } from '@/lib/poll';
import { useHostEvents } from '../useHostEvents';
import { usePollGate } from '../usePollGate';
import { useHostVersion } from '@/state/hostVersion';
import { checkHostTheme } from '@/state/hostTheme';
import { refreshHostMachines } from '@/state/hostMachines';
import { useSettings } from '@/state/settings';
import { themeCheckDue } from '@/lib/theme/hostThemeClient';
import { machineListDue, splitMachineConnectionId } from '@/lib/herdr/machines';

import type { HerdrClient } from '@/lib/herdr/client';
import { HerdrError } from '@/lib/herdr/protocol';
import {
  needsAttention,
  sessionSignature,
  hasSessionReference,
  isConversationalAgent,
  type AgentInfo,
  type AgentStatus,
  type RestoreError,
  type Workspace,
} from '@/lib/herdr/models';
import { TranscriptStore, previewText, type PreviewRequest } from '@/lib/transcript/store';
import { titleAgent } from '@/lib/chatTitle';

/** A row's last message: the Messages-style snippet and its time. */
export interface ChatPreview {
  text: string;
  timestamp: number | null;
  fromUser: boolean;
}

/**
 * One conversational agent in a workspace: what its own chat row needs.
 *
 * A workspace with two agents used to be one row that named one of them and
 * merged both transcripts, so the second agent was invisible except as
 * unattributed lines in the first one's thread.
 */
export interface PaneSummary {
  paneId: string;
  agent: AgentInfo;
  /**
   * `sessionSignature([agent])`: herdr recycles pane ids too, so this, not the
   * pane id, says which conversation the pane holds. Null until it reports one.
   */
  sessionSig: string | null;
  preview: ChatPreview | null;
  /** The agent's own status, `blocked` while a menu waits for its keys. */
  status: AgentStatus;
  /** The session's own title, which titles this agent's row and thread (`chatTitle`). */
  sessionTitle: string | null;
  /** The agent's herdr name, the title while the session has none. */
  agentName: string | null;
}

/** One row in the chat list: a workspace, plus the agents running in it. */
export interface ChatSummary {
  workspaceId: string;
  /**
   * The workspace's label on the host: a folder or a slot name, not what the
   * row is titled by when the chat has a session title (`rowTitle`).
   */
  title: string;
  /**
   * The title the workspace chat's one conversational agent gave its session.
   * Null with two or more, whose workspace row stands for all of them and
   * keeps its label; each of their rows has its own (`PaneSummary`).
   */
  sessionTitle: string | null;
  /** That same agent's herdr name, the title while the session has none. */
  agentName: string | null;
  number: number;
  status: AgentStatus;
  agents: AgentInfo[];
  /**
   * The conversational agents (claude, codex, omp), in snapshot order. A
   * workspace with two or more of them lists each as a chat of its own.
   */
  panes: PaneSummary[];
  /** The newest of the panes' last messages: what the workspace row shows. */
  preview: ChatPreview | null;
  /**
   * Which conversation currently occupies this workspace slot. Null until an
   * agent reports a session id. The unread dot needs it: a read marker left by
   * the previous chat in a recycled workspace must not silence this one.
   */
  sessionSig: string | null;
  /**
   * Why herdr could not bring this chat back after a restart, if it couldn't.
   * Without it a failed restore looked like an empty chat (#119).
   */
  restoreError: string | null;
}

export interface WorkspacesState {
  summaries: ChatSummary[];
  loading: boolean;
  error: string | null;
  /** The failure's code (`auth_failed`, `connect_failed`, …), for choosing a way out. */
  errorCode: string | null;
  /** True when the connect failed because herdr isn't installed on the host. */
  herdrMissing: boolean;
  /**
   * True when herdr IS installed but its server isn't up.
   *
   * Distinct from `herdrMissing` because the fix is different and much smaller:
   * nothing to download, just a process to start.
   */
  serverStopped: boolean;
  refresh: () => Promise<void>;
}

const POLL_INTERVAL_MS = 3000;
/**
 * The poll's rate while the host's event stream is delivering. Events carry
 * every change the list cares about; this is the safety net for the ones a
 * dropped stream would lose, and it should almost never be what updates a row.
 */
const LIVE_POLL_INTERVAL_MS = 30_000;
/** Coalesce a burst of events (working → done → idle) into one refresh. */
const EVENT_DEBOUNCE_MS = 250;

/**
 * Publishes chat rows: workspaces, agent statuses and per-workspace "last
 * message" previews, refreshed in ONE batched round-trip so rows read like
 * Messages — title, snippet, time.
 *
 * Refreshed on the host's word where the host can give it: one
 * `events.subscribe` stream over the SSH connection says when an agent's status
 * flips, a turn ends or a workspace comes and goes, and each event triggers a
 * refresh. The poll loop stays underneath as a safety net, slowed right down
 * while the stream is live and back at its old rate when it is not (a host
 * with no socket bridge, or a stream between reconnects).
 */
export function useWorkspaces(client: HerdrClient | null, connectionId: string | null = null): WorkspacesState {
  const [summaries, setSummaries] = useState<ChatSummary[]>([]);
  // Starts true and is only ever cleared, never re-armed: switching servers
  // remounts the screen (it is keyed by connection id), which is React's own
  // answer to "reset state when a prop changes" and avoids a setState in an
  // effect body just to get back to the initial value.
  const [loading, setLoading] = useState(client !== null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [herdrMissing, setHerdrMissing] = useState(false);
  const [serverStopped, setServerStopped] = useState(false);

  const polling = usePollGate();
  // The user's own battery/data tradeoff, applied on top of each screen's rate.
  const pollScale = useSettings((state) => state.pollScale);
  /**
   * Consecutive failures, for the backoff. A host that is down used to get a
   * failing SSH round-trip every three seconds forever, on a metered radio.
   */
  const failures = useRef(0);
  /** The code of the last failure, to tell a pause from a retry. */
  const lastCode = useRef<string | null>(null);

  /** Every agent pane the last refresh saw; what the event stream watches. */
  const [paneIds, setPaneIds] = useState<string[]>([]);
  /** Asks the running loop for a refresh soon. Set by the effect that owns the loop. */
  const kick = useRef<() => void>(() => undefined);
  const forcePreviews = useRef(true);
  const live = useHostEvents(client, paneIds, polling, () => {
    // The event may report the final idle state after a fast turn. Its preview
    // is still new, even though this agent is no longer working.
    forcePreviews.current = true;
    kick.current();
  });
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  /**
   * When the host theme was last checked; null asks for a check on the next
   * poll that works. The check rides on this loop rather than a timer of its
   * own (see `themeCheckDue`): it needs a live connection, and this loop is
   * already the one that knows when there is one.
   */
  const lastThemeCheck = useRef<number | null>(null);
  const useHostThemes = useSettings((state) => state.useHostThemes);
  const themeEnabled = useRef(useHostThemes);
  useEffect(() => {
    themeEnabled.current = useHostThemes;
  }, [useHostThemes]);
  /**
   * When the host's machine list was last asked for, the same way: null asks
   * on the next poll that works (the first after connecting, a pull, coming
   * back to the app), and otherwise once a minute (`machineListDue`).
   */
  const lastMachineCheck = useRef<number | null>(null);
  // Back from the background, the theme may have been changed by the agent
  // the person left to do it. Checked on the first poll after, not 10 s later.
  // A machine may have been added at the host meanwhile, too.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      lastThemeCheck.current = null;
      lastMachineCheck.current = null;
    });
    return () => subscription.remove();
  }, []);

  const previews = useRef(new Map<string, CachedPreview>());
  const tick = useRef(0);
  const seqs = useRef(new Map<string, number>());
  const alive = useRef(true);

  /** Resolves true when the poll failed, so the loop knows whether to back off. */
  const refresh = useCallback(async (): Promise<boolean> => {
    if (client === null) return false;
    try {
      // One call, not two. `api snapshot` returns the whole session — workspaces
      // and agents together — so asking `workspace list` as well was a second
      // SSH round-trip for data we already had.
      //
      // The fallback is not defensive padding: `snapshot.workspaces` is null
      // only when this herdr does not send the field, which is a real
      // possibility on a host we have not seen. Null means ask; empty means
      // there genuinely are none, and asking again would be pointless.
      const snapshot = await client.snapshot();
      // Rides along with the poll that already runs. Settings reads this rather
      // than asking the host itself — see `state/hostVersion`. The host's
      // only: a machine's poll (a connection id with a slash) runs alongside
      // it and would otherwise overwrite it with the machine's herdr.
      if (connectionId === null || splitMachineConnectionId(connectionId) === null) {
        useHostVersion.getState().setVersion(snapshot.version);
      }
      const workspaces = snapshot.workspaces ?? (await client.workspaces());
      // Unmounted mid-flight: not a failure, just nothing left to do with it.
      if (!alive.current) return false;

      const store = new TranscriptStore(client.transport);
      dropStalePreviews(snapshot.agents, previews.current);
      const force = forcePreviews.current;
      forcePreviews.current = false;
      await refreshPreviews(store, snapshot.agents, previews.current, tick, force, seqs.current);
      if (!alive.current) return false;

      setSummaries(buildSummaries(workspaces, snapshot.agents, previews.current, snapshot.restoreErrors));
      setPaneIds(snapshot.agents.map((agent) => agent.paneId));
      setError(null);
      setErrorCode(null);
      lastCode.current = null;
      setHerdrMissing(false);
      setServerStopped(false);
      // After the list is published, and not awaited: the theme is a side
      // task of this poll, and a slow or failing check must neither delay the
      // rows nor turn into the list's error. `checkHostTheme` never rejects.
      //
      // Both are the HOST's. A machine's list (a connection id with a slash)
      // asks neither: the host's theme applies to its machines, and a
      // machine's own machines are not federated a second hop.
      const now = Date.now();
      const isHost = connectionId !== null && splitMachineConnectionId(connectionId) === null;
      if (isHost && themeEnabled.current && themeCheckDue(lastThemeCheck.current, now)) {
        lastThemeCheck.current = now;
        void checkHostTheme(connectionId, client.transport);
      }
      // The same side task for the machines saved on the host: a failed ask
      // keeps the last list and never reaches this list's error.
      // `refreshHostMachines` never rejects.
      if (isHost && machineListDue(lastMachineCheck.current, now)) {
        lastMachineCheck.current = now;
        void refreshHostMachines(connectionId, client);
      }
      return false;
    } catch (thrown) {
      if (!alive.current) return true;
      const failure = thrown instanceof HerdrError ? thrown : null;
      setError(failure?.message ?? (thrown instanceof Error ? thrown.message : String(thrown)));
      setErrorCode(failure?.code ?? null);
      lastCode.current = failure?.code ?? null;
      setHerdrMissing(failure?.code === 'herdr_not_found');
      setServerStopped(failure?.code === 'server_not_running');
      return true;
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [client, connectionId]);

  useEffect(() => {
    alive.current = true;
    // Backgrounded, or a conversation open on top of us: either way nobody is
    // reading this list, and the thread's own poll covers what they ARE reading.
    // Expo Router's native stack keeps this screen mounted underneath a pushed
    // route, so without the gate both loops ran at once.
    if (client === null || !polling) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let again = false;
    let stopped = false;

    // A chained timeout rather than an interval: an interval on a slow host
    // stacks overlapping polls, and each one costs a round-trip.
    const loop = async () => {
      if (stopped) return;
      if (inFlight) {
        // A kick landed mid-refresh. Its cause may postdate what that refresh
        // read, so run once more when it finishes rather than dropping it.
        again = true;
        return;
      }
      inFlight = true;
      const failed = await refresh();
      inFlight = false;
      if (!alive.current || stopped) return;
      failures.current = failed ? failures.current + 1 : 0;
      // Paused, not retried: see `needsTheUser`. A kick (a pull to refresh)
      // starts it again.
      if (failed && needsTheUser(lastCode.current) && !again) return;
      const base = liveRef.current ? LIVE_POLL_INTERVAL_MS : POLL_INTERVAL_MS * pollScale;
      schedule(again ? EVENT_DEBOUNCE_MS : backoffDelay(base, failures.current));
      again = false;
    };
    const schedule = (delayMs: number) => {
      if (stopped) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => void loop(), delayMs);
    };
    // Mid-refresh, a kick only asks for one more round. Scheduling a timer
    // instead lost it: the refresh's own `schedule(backoff)` cleared that timer
    // when it finished first, and "Needs you" waited for the next slow poll (#88).
    kick.current = () => {
      if (inFlight) again = true;
      else schedule(EVENT_DEBOUNCE_MS);
    };
    void loop();

    return () => {
      stopped = true;
      alive.current = false;
      kick.current = () => undefined;
      if (timer !== null) clearTimeout(timer);
    };
  }, [client, refresh, polling, pollScale]);

  return {
    summaries,
    loading,
    error,
    errorCode,
    herdrMissing,
    serverStopped,
    // A manual pull is a fresh start: clear the backoff so an explicit retry is
    // never made to wait out a penalty the user did not cause.
    refresh: useCallback(async () => {
      failures.current = 0;
      forcePreviews.current = true;
      lastThemeCheck.current = null;
      lastMachineCheck.current = null;
      // Resumes a loop paused on a failure that needed the user.
      if (!(await refresh())) kick.current();
    }, [refresh]),
  };
}

// MARK: - Internals

/**
 * A pane's last message, with the session it was read from.
 *
 * A chat's identity is its session, not its slot: herdr reuses workspace ids
 * and pane ids. Keyed by slot alone, a preview outlived its chat. A new chat in
 * the same slot showed the old chat's last line until its agent reported a
 * session id (about 48 s), and a slot with no agent kept it until the list
 * remounted (#86). Stored with its session, it is shown only while that
 * session is still the one in the pane.
 *
 * Filed by pane id. Filed by workspace, two agents in one workspace shared one
 * entry, so only one of them could ever have a line.
 */
export interface CachedPreview {
  sessionSig: string;
  preview: ChatPreview;
}

export function buildSummaries(
  workspaces: readonly Workspace[],
  agents: readonly AgentInfo[],
  previews: Map<string, CachedPreview>,
  restoreErrors: readonly RestoreError[] = []
): ChatSummary[] {
  const byWorkspace = groupByWorkspace(agents);

  return [...workspaces]
    .sort((a, b) => a.number - b.number)
    .map((workspace) => {
      const group = byWorkspace.get(workspace.workspaceId) ?? [];
      const sessionSig = sessionSignature(group);
      const panes = group.filter(isConversationalAgent).map((agent) => paneSummary(agent, previews));
      // herdr calls an agent idle while a menu waits for its keys (Claude's
      // folder-trust question on a first start), so the row would never
      // say the chat needs you.
      const herdrStatus = workspace.agentStatus !== 'working' && group.some((agent) => agent.inputPending)
        ? 'blocked'
        : workspace.agentStatus;
      const titled = titleAgent(group);
      return {
        workspaceId: workspace.workspaceId,
        title: workspace.label,
        sessionTitle: titled?.title ?? null,
        agentName: titled?.name ?? null,
        number: workspace.number,
        status: panes.length >= 2 ? groupStatus(panes, herdrStatus) : herdrStatus,
        agents: group,
        panes,
        preview: sessionSig === null ? null : newestPreview(electionOrder(panes)),
        sessionSig,
        restoreError:
          restoreErrors.find((error) => error.workspaceId === workspace.workspaceId)?.message ?? null,
      };
    });
}

function paneSummary(agent: AgentInfo, previews: Map<string, CachedPreview>): PaneSummary {
  const sessionSig = sessionSignature([agent]);
  const cached = previews.get(agent.paneId);
  return {
    paneId: agent.paneId,
    agent,
    sessionSig,
    preview: cached !== undefined && sessionSig !== null && cached.sessionSig === sessionSig ? cached.preview : null,
    status: agent.agentStatus !== 'working' && agent.inputPending ? 'blocked' : agent.agentStatus,
    sessionTitle: agent.title,
    agentName: agent.name,
  };
}

/**
 * A workspace row over several agents says the most urgent thing any of them
 * is doing: one agent waiting on you is not hidden behind another one working.
 * herdr's own workspace status already says so when it can; this also covers a
 * menu herdr reports as idle on one pane while another works.
 */
function groupStatus(panes: readonly PaneSummary[], herdrStatus: AgentStatus): AgentStatus {
  if (herdrStatus === 'blocked' || panes.some((pane) => pane.status === 'blocked')) return 'blocked';
  if (herdrStatus === 'working' || panes.some((pane) => pane.status === 'working')) return 'working';
  return herdrStatus;
}

/** The pane the workspace chat answers from: focused with a session, else the first with one. */
function electionOrder(panes: readonly PaneSummary[]): PaneSummary[] {
  return [...panes].sort((a, b) => rank(a) - rank(b));
}

function rank(pane: PaneSummary): number {
  if (!hasSessionReference(pane.agent)) return 2;
  return pane.agent.focused ? 0 : 1;
}

/**
 * The workspace row's line. With one agent it is that agent's line, as it
 * always was; with several it is whichever spoke last, so the row reads like
 * the group's latest news. A line without a time loses to one with a time, and
 * ties keep election order (focused first).
 */
function newestPreview(panes: readonly PaneSummary[]): ChatPreview | null {
  let newest: ChatPreview | null = null;
  for (const pane of panes) {
    if (pane.preview === null) continue;
    if (newest === null || (pane.preview.timestamp ?? -Infinity) > (newest.timestamp ?? -Infinity)) newest = pane.preview;
  }
  return newest;
}

function groupByWorkspace(agents: readonly AgentInfo[]): Map<string, AgentInfo[]> {
  const byWorkspace = new Map<string, AgentInfo[]>();
  for (const agent of agents) {
    const list = byWorkspace.get(agent.workspaceId) ?? [];
    list.push(agent);
    byWorkspace.set(agent.workspaceId, list);
  }
  return byWorkspace;
}

/**
 * Refresh the last-message previews in one batched round-trip, one line per
 * conversational agent. Active or preview-less panes refresh every poll;
 * everything else joins a full sweep every fifth poll, so steady-state traffic
 * stays small.
 *
 * One per agent rather than one per workspace: a workspace with two agents
 * used to fetch only the elected one's line, so the other agent's row had
 * nothing to show and its unread dot could never light.
 *
 * `seqs` holds each pane's `stateChangeSeq` from the last successful refresh. A
 * turn that starts and ends between two polls looks idle both times, so it
 * used to wait for the sweep, up to five polls, for its reply to show and its
 * dot to light. A moved counter refreshes that pane now (#115).
 */
export async function refreshPreviews(
  store: TranscriptStore,
  agents: readonly AgentInfo[],
  previews: Map<string, CachedPreview>,
  tick: { current: number },
  force = false,
  seqs: Map<string, number> = new Map()
): Promise<void> {
  tick.current += 1;
  const fullSweep = force || tick.current % 5 === 1; // includes the very first poll

  const requests: PreviewRequest[] = [];
  /** The session each request was made for; the answer is filed under it. */
  const requestedFor = new Map<string, string>();
  for (const agent of agents) {
    // A chat's identity is its session, not its slot. Until an agent reports a
    // concrete session id we cannot tell a new chat's transcript from the
    // previous one's under the same project dir — so we never fall back to the
    // newest .jsonl here. The row shows its live status line instead of a
    // preview that might belong to a foreign conversation.
    if (!isConversationalAgent(agent) || !hasSessionReference(agent)) continue;
    const sessionId = agent.agentSession?.value ?? null;
    const sessionSig = sessionSignature([agent]);
    if (sessionId === null || sessionSig === null) continue;

    const active = agent.agentStatus !== 'idle' && agent.agentStatus !== 'unknown';
    const last = seqs.get(agent.paneId);
    const moved = agent.stateChangeSeq !== null && last !== undefined && last !== agent.stateChangeSeq;
    if (!fullSweep && !active && !moved && previews.get(agent.paneId)?.sessionSig === sessionSig) continue;

    requests.push({
      workspaceId: agent.workspaceId,
      key: agent.paneId,
      cwd: agent.cwd,
      sessionId,
      sessionKind: agent.agentSession?.kind,
      agent: agent.agent ?? undefined,
    });
    requestedFor.set(agent.paneId, sessionSig);
  }
  // Only after a refresh that worked, so a failed one is retried next poll.
  const remember = () => {
    seqs.clear();
    for (const agent of agents) {
      if (agent.stateChangeSeq !== null) seqs.set(agent.paneId, agent.stateChangeSeq);
    }
  };
  if (requests.length === 0) {
    remember();
    return;
  }

  // Best-effort: a failed fetch keeps the previous snippets rather than
  // erroring the whole list.
  let latest: Awaited<ReturnType<TranscriptStore['latestMessages']>>;
  try {
    latest = await store.latestMessages(requests);
  } catch {
    return;
  }
  remember();

  for (const [paneId, message] of latest) {
    const text = previewText(message);
    const sessionSig = requestedFor.get(paneId);
    if (text === null || sessionSig === undefined) continue;
    previews.set(paneId, {
      sessionSig,
      preview: { text, timestamp: message.timestamp, fromUser: message.role === 'user' },
    });
  }
}

/**
 * Forget cached previews that can no longer be shown: a pane that left the
 * snapshot, or one whose session is gone or different. `buildSummaries` would
 * hide them anyway; dropping them keeps the map from growing and makes the next
 * poll fetch the new chat's line.
 */
export function dropStalePreviews(
  agents: readonly AgentInfo[],
  previews: Map<string, CachedPreview>
): void {
  const byPane = new Map(agents.map((agent) => [agent.paneId, agent]));
  for (const [paneId, cached] of previews) {
    const agent = byPane.get(paneId);
    if (agent === undefined || sessionSignature([agent]) !== cached.sessionSig) previews.delete(paneId);
  }
}

export function summaryNeedsAttention(summary: ChatSummary): boolean {
  return needsAttention(summary.status);
}

/** A thrown value, as something a person can read. */
export function errorText(thrown: unknown): string {
  if (thrown instanceof HerdrError) return thrown.message;
  return thrown instanceof Error ? thrown.message : String(thrown);
}
