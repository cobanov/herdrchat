import { useCallback, useEffect, useRef, useState } from 'react';

import { backoffDelay } from '@/lib/poll';
import { usePollGate } from '../usePollGate';
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
  refresh: () => Promise<void>;
}

const POLL_INTERVAL_MS = 3000;

/**
 * Polls the herdr host for workspaces and agent statuses and publishes chat
 * rows.
 *
 * Polling rather than herdr's socket event stream: the transport is one SSH
 * connection running shell commands, and a 3-second poll is both simpler and
 * plenty responsive for a phone. Each poll also refreshes the per-workspace
 * "last message" previews in ONE batched round-trip, so rows read like Messages
 * — title, snippet, time.
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

  const polling = usePollGate();
  // The user's own battery/data tradeoff, applied on top of each screen's rate.
  const pollScale = useSettings((state) => state.pollScale);
  /**
   * Consecutive failures, for the backoff. A host that is down used to get a
   * failing SSH round-trip every three seconds forever, on a metered radio.
   */
  const failures = useRef(0);

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
      const workspaces = snapshot.workspaces ?? (await client.workspaces());
      // Unmounted mid-flight: not a failure, just nothing left to do with it.
      if (!alive.current) return false;

      const store = new TranscriptStore(client.transport);
      invalidateStalePreviews(snapshot.agents, previews.current, previewSessions.current);
      await refreshPreviews(store, snapshot.agents, previews.current, tick);
      if (!alive.current) return false;

      setSummaries(buildSummaries(workspaces, snapshot.agents, previews.current));
      setError(null);
      setHerdrMissing(false);
      return false;
    } catch (thrown) {
      if (!alive.current) return true;
      const failure = thrown instanceof HerdrError ? thrown : null;
      setError(failure?.message ?? (thrown instanceof Error ? thrown.message : String(thrown)));
      setHerdrMissing(failure?.code === 'herdr_not_found');
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

    // A chained timeout rather than an interval: an interval on a slow host
    // stacks overlapping polls, and each one costs a round-trip.
    const loop = async () => {
      const failed = await refresh();
      if (!alive.current) return;
      failures.current = failed ? failures.current + 1 : 0;
      timer = setTimeout(() => void loop(), backoffDelay(POLL_INTERVAL_MS * pollScale, failures.current));
    };
    void loop();

    return () => {
      alive.current = false;
      if (timer !== null) clearTimeout(timer);
    };
  }, [client, refresh, polling, pollScale]);

  return {
    summaries,
    loading,
    error,
    herdrMissing,
    // A manual pull is a fresh start: clear the backoff so an explicit retry is
    // never made to wait out a penalty the user did not cause.
    refresh: useCallback(async () => {
      failures.current = 0;
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
async function refreshPreviews(
  store: TranscriptStore,
  agents: readonly AgentInfo[],
  previews: Map<string, ChatSummary['preview']>,
  tick: { current: number }
): Promise<void> {
  tick.current += 1;
  const fullSweep = tick.current % 5 === 1; // includes the very first poll

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
    const agent = group.find((item) => item.focused && hasSessionId(item)) ?? group.find(hasSessionId);
    const sessionId = agent?.agentSession?.value ?? null;
    if (agent === undefined || sessionId === null) continue;

    const active = group.some((item) => item.agentStatus !== 'idle' && item.agentStatus !== 'unknown');
    if (!fullSweep && !active && previews.has(workspaceId)) continue;

    requests.push({ workspaceId, cwd: agent.cwd, sessionId });
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
