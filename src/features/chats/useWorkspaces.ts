import { useCallback, useEffect, useRef, useState } from 'react';

import { backoffDelay } from '@/lib/poll';
import { useHostEvents } from '../useHostEvents';
import { usePollGate } from '../usePollGate';
import { useHostVersion } from '@/state/hostVersion';
import { useSettings } from '@/state/settings';

import type { HerdrClient } from '@/lib/herdr/client';
import { HerdrError } from '@/lib/herdr/protocol';
import {
  needsAttention,
  sessionSignature,
  hasSessionId,
  type AgentInfo,
  type AgentStatus,
  type Workspace,
} from '@/lib/herdr/models';
import { TranscriptStore, previewText, type PreviewRequest } from '@/lib/transcript/store';

/** One row in the chat list: a workspace, plus the agents running in it. */
export interface ChatSummary {
  workspaceId: string;
  title: string;
  number: number;
  status: AgentStatus;
  agents: AgentInfo[];
  preview: { text: string; timestamp: number | null; fromUser: boolean } | null;
  /**
   * Which conversation currently occupies this workspace slot. Null until an
   * agent reports a session id. The unread dot needs it: a read marker left by
   * the previous chat in a recycled workspace must not silence this one.
   */
  sessionSig: string | null;
}

export interface WorkspacesState {
  summaries: ChatSummary[];
  loading: boolean;
  error: string | null;
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
export function useWorkspaces(client: HerdrClient | null): WorkspacesState {
  const [summaries, setSummaries] = useState<ChatSummary[]>([]);
  // Starts true and is only ever cleared, never re-armed: switching servers
  // remounts the screen (it is keyed by connection id), which is React's own
  // answer to "reset state when a prop changes" and avoids a setState in an
  // effect body just to get back to the initial value.
  const [loading, setLoading] = useState(client !== null);
  const [error, setError] = useState<string | null>(null);
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

  const previews = useRef(new Map<string, ChatSummary['preview']>());
  const previewSessions = useRef(new Map<string, string>());
  const tick = useRef(0);
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
      // than asking the host itself — see `state/hostVersion`.
      useHostVersion.getState().setVersion(snapshot.version);
      const workspaces = snapshot.workspaces ?? (await client.workspaces());
      // Unmounted mid-flight: not a failure, just nothing left to do with it.
      if (!alive.current) return false;

      const store = new TranscriptStore(client.transport);
      invalidateStalePreviews(snapshot.agents, previews.current, previewSessions.current);
      const force = forcePreviews.current;
      forcePreviews.current = false;
      await refreshPreviews(store, snapshot.agents, previews.current, tick, force);
      if (!alive.current) return false;

      setSummaries(buildSummaries(workspaces, snapshot.agents, previews.current));
      setPaneIds(snapshot.agents.map((agent) => agent.paneId));
      setError(null);
      setHerdrMissing(false);
      setServerStopped(false);
      return false;
    } catch (thrown) {
      if (!alive.current) return true;
      const failure = thrown instanceof HerdrError ? thrown : null;
      setError(failure?.message ?? (thrown instanceof Error ? thrown.message : String(thrown)));
      setHerdrMissing(failure?.code === 'herdr_not_found');
      setServerStopped(failure?.code === 'server_not_running');
      return true;
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [client]);

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
    herdrMissing,
    serverStopped,
    // A manual pull is a fresh start: clear the backoff so an explicit retry is
    // never made to wait out a penalty the user did not cause.
    refresh: useCallback(async () => {
      failures.current = 0;
      forcePreviews.current = true;
      await refresh();
    }, [refresh]),
  };
}

// MARK: - Internals

export function buildSummaries(
  workspaces: readonly Workspace[],
  agents: readonly AgentInfo[],
  previews: Map<string, ChatSummary['preview']>
): ChatSummary[] {
  const byWorkspace = new Map<string, AgentInfo[]>();
  for (const agent of agents) {
    const list = byWorkspace.get(agent.workspaceId) ?? [];
    list.push(agent);
    byWorkspace.set(agent.workspaceId, list);
  }

  return [...workspaces]
    .sort((a, b) => a.number - b.number)
    .map((workspace) => ({
      workspaceId: workspace.workspaceId,
      title: workspace.label,
      number: workspace.number,
      status: workspace.agentStatus,
      agents: byWorkspace.get(workspace.workspaceId) ?? [],
      preview: previews.get(workspace.workspaceId) ?? null,
      sessionSig: sessionSignature(byWorkspace.get(workspace.workspaceId) ?? []),
    }));
}

/**
 * Refresh the last-message previews in one batched round-trip. Active or
 * preview-less workspaces refresh every poll; everything else joins a full sweep
 * every fifth poll, so steady-state traffic stays small.
 */
export async function refreshPreviews(
  store: TranscriptStore,
  agents: readonly AgentInfo[],
  previews: Map<string, ChatSummary['preview']>,
  tick: { current: number },
  force = false
): Promise<void> {
  tick.current += 1;
  const fullSweep = force || tick.current % 5 === 1; // includes the very first poll

  const byWorkspace = new Map<string, AgentInfo[]>();
  for (const agent of agents) {
    if (agent.agent === null) continue;
    const list = byWorkspace.get(agent.workspaceId) ?? [];
    list.push(agent);
    byWorkspace.set(agent.workspaceId, list);
  }

  const requests: PreviewRequest[] = [];
  for (const [workspaceId, group] of byWorkspace) {
    // A chat's identity is its Claude session, not its workspace slot. Until an
    // agent reports a concrete session id we cannot tell a new chat's transcript
    // from the previous one's under the same project dir — so we never fall back
    // to the newest .jsonl here. The row shows its live status line instead of a
    // preview that might belong to a foreign conversation.
    const agent =
      group.find((item) => item.focused && hasSessionId(item)) ?? group.find(hasSessionId);
    const sessionId = agent?.agentSession?.value ?? null;
    if (agent === undefined || sessionId === null) continue;

    const active = group.some(
      (item) => item.agentStatus !== 'idle' && item.agentStatus !== 'unknown'
    );
    if (!fullSweep && !active && previews.has(workspaceId)) continue;

    requests.push({ workspaceId, cwd: agent.cwd, sessionId, agent: agent.agent ?? undefined });
  }
  if (requests.length === 0) return;

  // Best-effort: a failed fetch keeps the previous snippets rather than
  // erroring the whole list.
  let latest: Awaited<ReturnType<TranscriptStore['latestMessages']>>;
  try {
    latest = await store.latestMessages(requests);
  } catch {
    return;
  }

  for (const [workspaceId, message] of latest) {
    const text = previewText(message);
    if (text === null) continue;
    previews.set(workspaceId, {
      text,
      timestamp: message.timestamp,
      fromUser: message.role === 'user',
    });
  }
}

/**
 * Drop a workspace's cached last message when its session changed, so the list
 * never previews a previous chat's line under a reused workspace.
 */
function invalidateStalePreviews(
  agents: readonly AgentInfo[],
  previews: Map<string, ChatSummary['preview']>,
  sessions: Map<string, string>
): void {
  const byWorkspace = new Map<string, AgentInfo[]>();
  for (const agent of agents) {
    if (agent.agent === null) continue;
    const list = byWorkspace.get(agent.workspaceId) ?? [];
    list.push(agent);
    byWorkspace.set(agent.workspaceId, list);
  }

  for (const [workspaceId, group] of byWorkspace) {
    const signature = sessionSignature(group);
    if (signature === null) continue;
    if (sessions.get(workspaceId) !== undefined && sessions.get(workspaceId) !== signature) {
      previews.delete(workspaceId);
    }
    sessions.set(workspaceId, signature);
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
