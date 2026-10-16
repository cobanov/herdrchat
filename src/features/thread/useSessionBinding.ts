import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type * as SQLite from 'expo-sqlite';

import type { HerdrClient } from '@/lib/herdr/client';
import { isConversationalAgent, sessionSignature, type AgentInfo } from '@/lib/herdr/models';
import type { ThreadWindow } from '@/lib/threadWindow';
import type { ChatMessage } from '@/lib/transcript/message';
import { rebind, seedIfSession, seedMessages } from '@/state/threadCache';

/**
 * How long an agent may go without reporting a session id before the thread
 * stops waiting and says the integration is probably missing.
 *
 * A freshly started Claude takes the better part of a minute to report, 48
 * seconds, measured, so accusing the host too early is a false alarm shown to
 * someone whose id is about to arrive. This is comfortably past that, and until
 * it elapses the thread says it is waiting rather than showing nothing.
 */
const NO_SESSION_GRACE_MS = 80_000;

export type SessionState = 'ok' | 'waiting' | 'missing' | 'unsupported' | 'replaced';

interface Options {
  client: HerdrClient | null;
  db: SQLite.SQLiteDatabase;
  connectionId: string;
  cacheKey: string;
  /** The session the chat list last saw for this chat, when it opened from there. */
  listedSig: string | undefined;
  aliveRef: RefObject<boolean>;
  boundSigRef: RefObject<string | null>;
  shown: ThreadWindow;
  seed: (cached: ChatMessage[]) => void;
  stopTails: () => void;
  resetHistory: () => void;
  setLoading: (loading: boolean) => void;
}

/**
 * Which session a thread shows. A chat's identity is its agent's session, not
 * its workspace slot: herdr reuses workspace ids, so a new session in the
 * same slot drops the old history (`rebind`) rather than continuing it.
 */
export function useSessionBinding({
  client, db, connectionId, cacheKey, listedSig, aliveRef, boundSigRef, shown, seed, stopTails, resetHistory, setLoading,
}: Options) {
  const [sessionState, setSessionState] = useState<SessionState>('ok');
  /** The panes the bound session was seen in, sorted and joined. */
  const boundPanes = useRef('');
  /**
   * The session this thread had open ended and a different agent now holds
   * the slot, not yet reporting its own session. Cleared when one binds.
   */
  const replaced = useRef(false);
  /** When the thread first saw an agent without a session id, or null while all have one. */
  const noSessionSince = useRef<number | null>(null);
  /**
   * The agent kinds whose integration the host says is not installed, asked
   * once the thread first waits for a session. Null until it answers. With it
   * the thread says "install the integration" at once instead of after the
   * grace period, which a question on screen keeps restarting.
   */
  const missingIntegrations = useRef<ReadonlySet<string> | null>(null);
  const askedIntegrations = useRef(false);

  /*
    Open from the cache at once. The list saw this chat's session a moment
    ago; when the cached messages are that session's, they show before the
    first poll, and the thread is bound to it so the poll goes straight to the
    tail rather than through a loading state. A host that names another
    session by then is a rotation, and is handled as one. A cache of another
    session is left alone here (`seedIfSession` only reads).
  */
  const seededFromList = useRef(false);
  useEffect(() => {
    if (listedSig === undefined || listedSig === '' || seededFromList.current) return;
    seededFromList.current = true;
    void seedIfSession(db, connectionId, cacheKey, listedSig).then((cached) => {
      if (!aliveRef.current || boundSigRef.current !== null || !shown.isEmpty || cached.length === 0) return;
      boundSigRef.current = listedSig;
      seed(cached);
      setLoading(false);
    });
  }, [db, connectionId, cacheKey, listedSig, seed, shown, setLoading, aliveRef, boundSigRef]);

  /**
   * Bind the thread to what a poll saw. Returns the agents with a
   * conversation, or null when `stopped` turned true on the way.
   */
  const bind = useCallback(async (live: readonly AgentInfo[], stopped: () => boolean) => {
    const conversational = live.filter(isConversationalAgent);
    const unsupported = conversational.length === 0 && live.some(agent => agent.agent !== null);
    const sig = sessionSignature(conversational);
    const panes = conversational.map((agent) => agent.paneId).sort().join(',');

    /*
      The session this thread was showing is gone. Nothing reported a new
      one, but either no agent is left in the workspace (closed on the
      host) or different panes hold it (recreated, common in the iPad split
      view). The old history and the send target would otherwise both
      stay: the screen kept the old conversation and `send` went to the new
      pane (#87). Unbind, clear the history, and hold sending until the new
      agent says which session it is.
    */
    if (
      sig === null &&
      boundSigRef.current !== null &&
      // No panes yet: bound from the cache before the first poll, which
      // records them below.
      (conversational.length === 0 || (boundPanes.current !== '' && panes !== boundPanes.current))
    ) {
      stopTails();
      boundSigRef.current = null;
      boundPanes.current = '';
      resetHistory();
      replaced.current = conversational.length > 0;
    }
    if (conversational.length === 0) replaced.current = false;
    if (sig !== null) {
      replaced.current = false;
      boundPanes.current = panes;
    }

    // An agent that never reports a session id is almost always a host
    // without `herdr integration install claude`. The thread cannot target
    // a transcript without it and refuses to guess, so without this it just
    // stays empty and blames nothing. Setting the same value twice is a
    // no-op in React, so this does not re-render on every poll.
    if (unsupported) {
      noSessionSince.current = null;
      setSessionState('unsupported');
    } else if (replaced.current) {
      noSessionSince.current = null;
      setSessionState('replaced');
    } else if (conversational.length > 0 && sig === null) {
      // A question asked before the session starts, Claude's folder trust,
      // is not a missing integration: the id arrives once it is answered,
      // so the grace period only runs while nothing is being asked.
      if (conversational.some((agent) => agent.inputPending || agent.agentStatus === 'blocked')) {
        noSessionSince.current = null;
      }
      const since = (noSessionSince.current ??= Date.now());
      if (!askedIntegrations.current && client !== null) {
        askedIntegrations.current = true;
        void client.integrationIssues().then((issues) => {
          missingIntegrations.current = new Set((issues ?? []).filter((issue) => issue.state === 'missing').map((issue) => issue.name));
        });
      }
      const notInstalled = conversational.some((agent) => missingIntegrations.current?.has(agent.agent ?? '') === true);
      setSessionState(notInstalled || Date.now() - since >= NO_SESSION_GRACE_MS ? 'missing' : 'waiting');
    } else {
      noSessionSince.current = null;
      setSessionState('ok');
    }
    if (sig === null) setLoading(false);
    if (sig !== null && sig !== boundSigRef.current) {
      // Rotation, or a new chat reusing this workspace. Drop the old
      // history rather than appending a different conversation to it.
      stopTails();
      const rotated = boundSigRef.current !== null;
      const dropped = await rebind(db, connectionId, cacheKey, sig);
      if (dropped || rotated) resetHistory();
      if (stopped()) return null;
      boundSigRef.current = sig;
      setLoading(true);
      const cached = await seedMessages(db, connectionId, cacheKey);
      if (stopped()) return null;
      seed(cached);
    }
    return { conversational };
  }, [client, db, connectionId, cacheKey, stopTails, resetHistory, seed, setLoading, boundSigRef]);

  return { sessionState, bind };
}
