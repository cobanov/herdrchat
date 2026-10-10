import { router } from 'expo-router';
import { createContext, useContext, useMemo } from 'react';
import { create } from 'zustand';

import type { HerdrClient } from '@/lib/herdr/client';
import type { DelegationState } from '@/lib/threadItems';
import { clientFor, useConnections } from '@/state/connections';

/**
 * What a subagent or workflow card needs to open what it started: the host
 * and the chat it is in, and the session folders its files can be under.
 *
 * Folders, plural: a workspace chat can merge two Claude agents, and a card
 * does not know which transcript its call came from. The screens try each,
 * and only by the call's own id (its meta's `toolUseId`, its run id, its
 * agent id), so trying a second folder can never open someone else's agent.
 * Empty while no transcript is open (offline, a Codex chat): the cards then
 * say what they know and open nothing.
 */
export interface DelegationScope {
  /** Null while the host is unknown; a workflow card then reads nothing. */
  client: HerdrClient | null;
  connectionId: string;
  workspaceId: string;
  sessionDirs: readonly string[];
  /**
   * The transcripts the cards are drawn from: the chat's Claude transcripts,
   * or a subagent's own. An agent's screen reads its end from there, since
   * the chat stops reading while the screen covers it.
   */
  transcripts: readonly string[];
}

const Scope = createContext<DelegationScope | null>(null);

export const DelegationScopeProvider = Scope.Provider;

export function useDelegationScope(): DelegationScope | null {
  return useContext(Scope);
}

/**
 * The last state a card or a run file reported for an agent, by its follow
 * key: the call's tool use id, or `<runId>/<agentId>` for a workflow's agent.
 *
 * The agent's screen reads it to know when to stop following: the agent is
 * done when its card says so, which the agent's own transcript cannot tell.
 * A store, not a route param, because the state changes after the screen
 * opened; the param is only where it starts.
 */
interface DelegationStates {
  states: Readonly<Record<string, DelegationState>>;
  report: (key: string, state: DelegationState) => void;
}

export const useDelegationStates = create<DelegationStates>((set, get) => ({
  states: {},
  report: (key, state) => {
    if (get().states[key] === state) return;
    set((current) => ({ states: { ...current.states, [key]: state } }));
  },
}));

/** A workflow agent's follow key. */
export function workflowAgentKey(runId: string, agentId: string): string {
  return `${runId}/${agentId}`;
}

/**
 * Which agent a subagent screen shows: one a call started, found by its
 * meta's `toolUseId`; or one whose id is already known (a background agent's
 * launch reports it, a workflow's run file lists it), under `runId` for a
 * workflow's.
 */
export type AgentTarget =
  | { kind: 'call'; toolUseId: string }
  | { kind: 'agent'; agentId: string; runId: string | null };

export interface SubagentRouteParams {
  connectionId: string;
  workspaceId: string;
  dirs: string;
  title: string;
  /** What the header says under the title before the agent's meta is read: type and model. */
  subtitle: string;
  followKey: string;
  state: DelegationState;
  /** The transcripts the call can be in, JSON like `dirs`; empty for a workflow's agent. */
  parents: string;
  /** The call that started it, whose end the screen looks for; absent for a workflow's agent. */
  callId?: string;
  toolUseId?: string;
  agentId?: string;
  runId?: string;
}

/**
 * Push a subagent's transcript. On iPad too: it goes above the split, the
 * way a pushed screen does, and its back control returns to the chat it came
 * from. Selecting it inside the split would replace the chat it belongs to.
 */
export function openSubagent(
  scope: DelegationScope,
  target: AgentTarget,
  details: { title: string; subtitle: string; followKey: string; state: DelegationState; callId: string | null }
) {
  const { callId, ...rest } = details;
  const params: SubagentRouteParams = {
    connectionId: scope.connectionId,
    workspaceId: scope.workspaceId,
    dirs: encodeDirs(scope.sessionDirs),
    parents: encodeDirs(callId === null ? [] : scope.transcripts),
    ...rest,
    ...(callId === null ? {} : { callId }),
    ...(target.kind === 'call'
      ? { toolUseId: target.toolUseId }
      : { agentId: target.agentId, ...(target.runId === null ? {} : { runId: target.runId }) }),
  };
  router.push({ pathname: '/chat/agent', params: { ...params } });
}

export interface WorkflowRouteParams {
  connectionId: string;
  workspaceId: string;
  dirs: string;
  runId: string;
  title: string;
  /** The card's state when opened, and the key it goes on reporting it under (the call's id). */
  state: DelegationState;
  followKey: string;
}

/** Push a workflow run's screen, the same way as a subagent's. */
export function openWorkflow(
  scope: DelegationScope,
  runId: string,
  details: { title: string; state: DelegationState; followKey: string }
) {
  const params: WorkflowRouteParams = {
    connectionId: scope.connectionId,
    workspaceId: scope.workspaceId,
    dirs: encodeDirs(scope.sessionDirs),
    runId,
    ...details,
  };
  router.push({ pathname: '/chat/workflow', params: { ...params } });
}

/** Session folders in a route param. JSON, since a folder can hold any character but NUL. */
export function encodeDirs(dirs: readonly string[]): string {
  return JSON.stringify(dirs);
}

export function decodeDirs(param: string | undefined): string[] {
  if (param === undefined || param.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(param);
    return Array.isArray(parsed) ? parsed.filter((dir): dir is string => typeof dir === 'string' && dir.length > 0) : [];
  } catch {
    return [];
  }
}

/**
 * The client for a host by its id, for a screen opened with one in its
 * params: the chat it came from may not be on the selected host any more by
 * the time it is read (another one picked on iPad), and the agent is on the
 * host it came from.
 */
export function useClientFor(connectionId: string | undefined): HerdrClient | null {
  const connection = useConnections((state) => state.connections.find((candidate) => candidate.id === connectionId) ?? null);
  return useMemo(() => (connection === null ? null : clientFor(connection)), [connection]);
}
