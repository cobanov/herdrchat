import type * as SQLite from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { HerdrClient } from '@/lib/herdr/client';
import { SUBAGENT_RESOLVE_RETRY_MS } from '@/lib/herdr/timeouts';
import { agentIdFromPath } from '@/lib/subagents/paths';
import type { ChatMessage } from '@/lib/transcript/message';
import { TranscriptStore } from '@/lib/transcript/store';
import { continueWindow } from '@/lib/transcript/window';
import { appendMessages, rebind, replaceMessages, seedMessages } from '@/state/threadCache';

/** Lines a subagent's thread opens with, as the main thread's (see `useThread`). */
const RECENT_LINES = 300;
/** One page of scroll-up history, in lines. */
const OLDER_LINES = 200;

export interface TranscriptState {
  messages: ChatMessage[];
  /** Nothing on screen yet, and the first read has not landed. */
  loading: boolean;
  /** Bumped when the list must start again from its end, as the main thread's. */
  historyVersion: number;
  /** The file is not there yet. */
  absent: boolean;
  error: string | null;
  loadOlder: () => Promise<void>;
  loadingOlder: boolean;
  reachedStart: boolean;
}

/**
 * Where a subagent's messages are cached: under its workspace, by its agent
 * id, so closing the workspace forgets them (`forgetWorkspace` clears by that
 * prefix) and two agents never share a cache. The agent id is the session
 * here, and the cache's signature: a different agent at the same key drops
 * the old one's rows.
 */
export function transcriptCacheKey(workspaceId: string, agentId: string): string {
  return `${workspaceId}/agent:${agentId}`;
}

/**
 * A transcript read by its path, with no herdr pane behind it: a subagent's.
 * Opens on the cached copy, reads the recent window, and follows the file
 * live while `follow` (the agent is still running). When following stops, one
 * last read catches what the stream had not yet delivered.
 *
 * None of the main thread's sending, blocked prompts or panels: a subagent
 * takes no input from here.
 */
export function useTranscript(
  db: SQLite.SQLiteDatabase,
  client: HerdrClient | null,
  connectionId: string,
  workspaceId: string,
  path: string | null,
  follow: boolean
): TranscriptState {
  const agentId = path === null ? null : agentIdFromPath(path);
  const cacheKey = agentId === null ? null : transcriptCacheKey(workspaceId, agentId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [absent, setAbsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedStart, setReachedStart] = useState(false);
  /** Bumped to read the file again: it was absent, or the stream dropped. */
  const [attempt, setAttempt] = useState(0);
  /** Where the open read stopped, once it has: the tail starts here. */
  const [cursor, setCursor] = useState<number | null>(null);
  /** Bumped to open the live stream again after it dropped. */
  const [stream, setStream] = useState(0);

  const shown = useRef<ChatMessage[]>([]);
  const seen = useRef(new Set<string>());
  const consumed = useRef(0);
  const anchor = useRef(0);
  const paging = useRef(false);
  /** Whether the agent still runs, for the retry of a file not there: once it ended, one absent read is final. */
  const following = useRef(follow);
  useEffect(() => {
    following.current = follow;
  }, [follow]);

  const show = useCallback((next: ChatMessage[]) => {
    shown.current = next;
    seen.current = new Set(next.map((message) => message.id));
    setMessages(next);
  }, []);

  /** Messages the stream or a catch-up read found, past what is on screen. */
  const add = useCallback((found: readonly ChatMessage[]) => {
    const fresh = found.filter((message) => !seen.current.has(message.id));
    if (fresh.length === 0) return [];
    show([...shown.current, ...fresh]);
    return fresh;
  }, [show]);

  // Open: the cached copy, then the recent window.
  useEffect(() => {
    if (client === null || path === null || agentId === null || cacheKey === null) return;
    let alive = true;
    const store = new TranscriptStore(client.transport);
    void (async () => {
      try {
        if (attempt === 0) {
          await rebind(db, connectionId, cacheKey, agentId);
          const cached = await seedMessages(db, connectionId, cacheKey);
          if (!alive) return;
          if (cached.length > 0) {
            show(cached);
            setLoading(false);
          }
        }
        const probe = await store.fileProbe(path);
        if (!alive) return;
        if (probe.kind === 'absent') {
          setAbsent(true);
          setLoading(false);
          if (!following.current) return;
          setTimeout(() => {
            if (alive && following.current) setAttempt((value) => value + 1);
          }, SUBAGENT_RESOLVE_RETRY_MS);
          return;
        }
        if (probe.kind === 'unknown') throw new Error(`Couldn't read this agent's transcript: ${probe.reason}`);
        const recent = await store.recent(path, null, RECENT_LINES, probe.bytes);
        if (!alive) return;
        await replaceMessages(db, connectionId, cacheKey, agentId, recent.messages);
        if (!alive) return;
        const continued = continueWindow(shown.current, recent.messages);
        show(continued ?? recent.messages);
        if (continued === null) setHistoryVersion((version) => version + 1);
        anchor.current = recent.startByte;
        consumed.current = recent.consumedBytes;
        setReachedStart(recent.startByte <= 0);
        setAbsent(false);
        setError(null);
        setLoading(false);
        setCursor(recent.consumedBytes);
      } catch (thrown) {
        if (!alive) return;
        setLoading(false);
        setError(thrown instanceof Error ? thrown.message : String(thrown));
      }
    })();
    return () => {
      alive = false;
    };
  }, [db, client, connectionId, path, agentId, cacheKey, attempt, show]);

  // Follow, from where the open read stopped, while the agent runs.
  const followed = useRef(false);
  useEffect(() => {
    if (client === null || path === null || cacheKey === null || agentId === null || cursor === null) return;
    const store = new TranscriptStore(client.transport);
    if (!follow) {
      if (!followed.current) return;
      // It ended while followed: read what the stream had not delivered yet.
      followed.current = false;
      let alive = true;
      void (async () => {
        try {
          const probe = await store.fileProbe(path);
          if (!alive || probe.kind !== 'size' || probe.bytes <= consumed.current) return;
          const rest = await store.recent(path, null, RECENT_LINES, probe.bytes);
          if (!alive) return;
          consumed.current = rest.consumedBytes;
          const fresh = add(rest.messages);
          await appendMessages(db, connectionId, cacheKey, agentId, fresh);
        } catch {
          // What is on screen stays; reopening reads it whole.
        }
      })();
      return () => {
        alive = false;
      };
    }

    followed.current = true;
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const chunk of store.tail(path, null, consumed.current, controller.signal)) {
          if (controller.signal.aborted) break;
          consumed.current = chunk.consumedBytes;
          if (chunk.message === null) continue;
          const fresh = add([chunk.message]);
          await appendMessages(db, connectionId, cacheKey, agentId, fresh);
        }
      } catch (thrown) {
        if (controller.signal.aborted) return;
        // Usually the phone slept and took the stream with it: say so, and
        // follow again from where it stopped.
        setError(`Updates paused. Reconnecting. ${thrown instanceof Error ? thrown.message : String(thrown)}`);
        setTimeout(() => {
          if (controller.signal.aborted) return;
          setError(null);
          setStream((value) => value + 1);
        }, SUBAGENT_RESOLVE_RETRY_MS);
      }
    })();
    return () => controller.abort();
  }, [db, client, connectionId, path, agentId, cacheKey, cursor, follow, stream, add]);

  const loadOlder = useCallback(async () => {
    if (client === null || path === null || paging.current || reachedStart || anchor.current <= 0) return;
    paging.current = true;
    setLoadingOlder(true);
    try {
      const page = await new TranscriptStore(client.transport).older(path, null, anchor.current, OLDER_LINES);
      anchor.current = page.startByte;
      setReachedStart(page.reachedStart);
      const older = page.messages.filter((message) => !seen.current.has(message.id));
      if (older.length > 0) show([...older, ...shown.current]);
    } catch {
      // The next scroll near the top asks again.
    } finally {
      paging.current = false;
      setLoadingOlder(false);
    }
  }, [client, path, reachedStart, show]);

  return { messages, loading, historyVersion, absent, error, loadOlder, loadingOlder, reachedStart };
}
