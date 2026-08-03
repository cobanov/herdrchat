import { useCallback, useEffect, useRef, useState } from 'react';
import type * as SQLite from 'expo-sqlite';

import type { HerdrClient } from '@/lib/herdr/client';
import { HerdrError } from '@/lib/herdr/protocol';
import { hasSessionId, sessionSignature, type AgentInfo, type AgentStatus } from '@/lib/herdr/models';
import { TranscriptStore } from '@/lib/transcript/store';
import type { ChatMessage } from '@/lib/transcript/message';
import { displayText } from '@/lib/transcript/message';
import { parseBlockedPrompt, type BlockedPrompt } from '@/lib/transcript/blockedPrompt';
import { extractLivePreview } from '@/lib/transcript/livePreview';
import type { SessionMeta } from '@/lib/transcript/sessionMeta';
import {
  appendMessages,
  rebind,
  resetTailCursor,
  seedMessages,
  seenIds,
  setTailCursor,
  tailCursor,
} from '@/state/threadCache';

/**
 * Bytes of a fresh transcript to pull up front.
 *
 * A chat surface is about recency, so this is deliberately small: a large window
 * means every thread open pays a multi-megabyte SSH read and then lays out
 * thousands of bubbles, which is what makes long sessions open mid-history and
 * stutter. Older history stays on disk; reopens resume from the cached cursor
 * and pay nothing.
 */
const RECENT_BYTES = 384_000;
/**
 * Widened window for the pathological case: a transcript whose tail is one
 * enormous line (image tool-results embed base64) yields almost no bubbles from
 * the small window. Tried once, only when the first read came back too thin.
 */
const RECENT_BYTES_WIDE = 3_000_000;
const RECENT_MESSAGES = 150;
const THIN_HISTORY = 10;
/**
 * On resume, rewind this far before the stored cursor: a disconnect can leave it
 * mid-line, and re-reading the boundary line in full costs nothing (dedupe drops
 * what we've seen) while losing it costs a message.
 */
const RESUME_REWIND = 4096;
/**
 * One page of scroll-up history. Smaller than the opening window: this is a
 * deliberate reach for more, so it should land quickly rather than pull the
 * largest slice it can justify.
 */
const OLDER_BYTES = 128_000;
/**
 * How many pages a single pull may consume while every one of them turns out to
 * be entirely deduped. Resuming from cache anchors at the tail cursor, so the
 * first page back is the cached window itself and yields nothing new; without
 * this, that pull would appear to do nothing at all.
 */
const OLDER_EMPTY_PAGES = 3;

const STATUS_POLL_MS = 2000;
/**
 * How long an agent may go without reporting a session id before the thread
 * stops waiting and says the integration is probably missing.
 *
 * A freshly started Claude takes the better part of a minute to report — 48
 * seconds, measured — so accusing the host too early is a false alarm shown to
 * someone whose id is about to arrive. This is comfortably past that, and until
 * it elapses the thread says it is waiting rather than showing nothing.
 */
const NO_SESSION_POLLS = 40; // × 2s ≈ 80 seconds

export interface ThreadState {
  messages: ChatMessage[];
  status: AgentStatus;
  agents: AgentInfo[];
  blockedPrompt: BlockedPrompt | null;
  isBlocked: boolean;
  sessionMeta: SessionMeta | null;
  livePreview: string | null;
  workingDirName: string | null;
  error: string | null;
  isSending: boolean;
  /** Fetch one page of history above the oldest message on screen. */
  loadOlder: () => Promise<void>;
  loadingOlder: boolean;
  /** True once the top of the transcript is on screen — nothing left to fetch. */
  reachedStart: boolean;
  /**
   * Whether this thread can be read at all.
   *
   * `ok` — an agent has reported its session, so the transcript is targetable.
   * `waiting` — an agent is here but has not reported yet; normal for a minute.
   * `missing` — long enough that the host is probably missing herdr's Claude
   *   integration, which is the only thing that reports the id.
   */
  sessionState: 'ok' | 'waiting' | 'missing';
  failedIds: Set<string>;
  send: (text: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
  sendKeys: (keys: readonly string[]) => Promise<void>;
  clearError: () => void;
  reload: () => Promise<void>;
}

/**
 * Drives one workspace thread: tails the transcript into bubbles, tracks live
 * blocked/working state, and sends replies back through herdr.
 *
 * Transcripts are targeted by the agent's native session reference — herdr's
 * `agent_session.value` IS the Claude transcript filename — rather than by
 * guessing the newest file in the project directory, because that guess opens a
 * previous session's history under a reused workspace.
 */
export function useThread(
  db: SQLite.SQLiteDatabase,
  client: HerdrClient | null,
  connectionId: string,
  workspaceId: string,
  initialAgents: readonly AgentInfo[]
): ThreadState {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([...initialAgents]);
  const [blockedPrompt, setBlockedPrompt] = useState<BlockedPrompt | null>(null);
  const [sessionMeta, setSessionMeta] = useState<SessionMeta | null>(null);
  const [livePreview, setLivePreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedStart, setReachedStart] = useState(false);
  const [sessionState, setSessionState] = useState<'ok' | 'waiting' | 'missing'>('ok');
  const noSessionPolls = useRef(0);
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());

  // Transcript arrivals and optimistic echoes are kept apart so an unconfirmed
  // echo can sit at its send position rather than pinning to the bottom below
  // newer messages.
  const arrivals = useRef<ChatMessage[]>([]);
  const echoes = useRef<ChatMessage[]>([]);
  const seen = useRef<Set<string>>(new Set());
  /**
   * Where scroll-up reads from, and how far back it has already gone. Recorded
   * from the first tail only: a workspace with two agents has two transcripts,
   * and paging the focused one is what "load older" means to a reader.
   */
  const olderSource = useRef<{ path: string; label: string | null; anchor: number } | null>(null);
  const boundSig = useRef<string | null>(null);
  const tails = useRef(new Map<string, AbortController>());
  const alive = useRef(true);

  const rebuild = useCallback(() => {
    // Drop echoes the transcript has now confirmed.
    const confirmed = new Set(
      arrivals.current.filter((m) => m.role === 'user').map((m) => displayText(m).trim())
    );
    echoes.current = echoes.current.filter((echo) => !confirmed.has(displayText(echo).trim()));

    if (echoes.current.length === 0) {
      setMessages([...arrivals.current]);
      return;
    }
    // Merge the two time-ordered lists, carrying the last known timestamp
    // forward for arrivals that have none.
    const merged: ChatMessage[] = [];
    const pending = [...echoes.current].sort(
      (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
    );
    let index = 0;
    let last = 0;
    for (const message of arrivals.current) {
      const effective = message.timestamp ?? last;
      last = effective;
      while (index < pending.length && (pending[index]?.timestamp ?? Infinity) <= effective) {
        merged.push(pending[index]!);
        index += 1;
      }
      merged.push(message);
    }
    merged.push(...pending.slice(index));
    setMessages(merged);
  }, []);

  const ingest = useCallback(
    async (incoming: readonly ChatMessage[], sig: string) => {
      const fresh = incoming.filter((message) => !seen.current.has(message.id));
      if (fresh.length === 0) return;
      for (const message of fresh) seen.current.add(message.id);
      arrivals.current.push(...fresh);
      await appendMessages(db, connectionId, workspaceId, sig, fresh);
      if (alive.current) rebuild();
    },
    [db, connectionId, workspaceId, rebuild]
  );

  /**
   * Prepend a page of older history.
   *
   * Deliberately NOT written to the thread cache: `appendMessages` numbers rows
   * with max(seq)+1, so persisting a page of old turns would file them after the
   * newest ones and the thread would come back inverted on the next open. Pages
   * live for this visit; reopening starts from the recent window again.
   */
  const loadOlder = useCallback(async () => {
    if (client === null) return;
    const source = olderSource.current;
    if (source === null || source.anchor <= 0) return;

    setLoadingOlder(true);
    try {
      const store = new TranscriptStore(client.transport);
      for (let page = 0; page < OLDER_EMPTY_PAGES; page += 1) {
        const current = olderSource.current;
        if (current === null || current.anchor <= 0) break;

        const older = await store.older(current.path, current.label, current.anchor, OLDER_BYTES);
        if (!alive.current) return;
        olderSource.current = { ...current, anchor: older.startByte };

        const fresh = older.messages.filter((message) => !seen.current.has(message.id));
        for (const message of fresh) seen.current.add(message.id);
        if (fresh.length > 0) {
          arrivals.current.unshift(...fresh);
          rebuild();
        }

        if (older.reachedStart) {
          setReachedStart(true);
          break;
        }
        // Only keep paging while the reader has been given nothing.
        if (fresh.length > 0) break;
      }
    } catch {
      // A failed reach for more history leaves the thread exactly as it was.
      // The reader can pull again; surfacing a banner for it would push the
      // conversation down to report that nothing happened.
    } finally {
      if (alive.current) setLoadingOlder(false);
    }
  }, [client, rebuild]);

  const resetHistory = useCallback(() => {
    arrivals.current = [];
    echoes.current = [];
    olderSource.current = null;
    setReachedStart(false);
    seen.current = new Set();
    setMessages([]);
    setFailedIds(new Set());
  }, []);

  // Seed from the disk cache so reopening is instant, then let the tails correct
  // it. Only seeds when the cached session matches the live one.
  useEffect(() => {
    alive.current = true;
    void (async () => {
      const sig = sessionSignature(initialAgents);
      if (sig !== null) {
        const dropped = await rebind(db, connectionId, workspaceId, sig);
        if (dropped) resetHistory();
        boundSig.current = sig;
      }
      const [cached, ids] = await Promise.all([
        seedMessages(db, connectionId, workspaceId),
        seenIds(db, connectionId, workspaceId),
      ]);
      if (!alive.current || cached.length === 0) return;
      arrivals.current = cached;
      // The FULL seen set, not just the seeded slice, so the tail can't re-add
      // the history we deliberately trimmed away.
      seen.current = ids;
      rebuild();
    })();
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, connectionId, workspaceId]);

  const startTail = useCallback(
    async (agent: AgentInfo, multiAgent: boolean) => {
      if (client === null) return;

      // Keyed by the Claude session id, because that is the only unique thing
      // here — and both halves of this matter:
      //
      // No session id means there is nothing safe to open. "Newest .jsonl in
      // the project dir" is a guess, and two chats sharing a folder — the same
      // folder you would naturally give the same name — makes it a guess that
      // shows the other conversation's history. Returning costs one poll; the
      // status poll calls this again every couple of seconds.
      //
      // And the map was previously keyed by cwd, which collapsed two agents in
      // one directory onto a single tail slot, so the second never streamed.
      const sessionId = hasSessionId(agent) ? (agent.agentSession?.value ?? null) : null;
      if (sessionId === null || tails.current.has(sessionId)) return;

      const store = new TranscriptStore(client.transport);
      const label = multiAgent ? agent.agent : null;

      const home = await store.homeDirectory();
      let path = store.sessionTranscriptPath(home, agent.cwd, sessionId);
      // The session may be known a moment before its file exists; return
      // rather than tailing a stale one, and let the next poll retry.
      if (path !== null && (await store.fileSize(path)) < 0) path = null;
      if (path === null || !alive.current) return;

      const controller = new AbortController();
      tails.current.set(sessionId, controller);

      const sig = boundSig.current ?? sessionSignature([agent]) ?? 'unknown';
      const cached = await tailCursor(db, connectionId, workspaceId, path);
      const size = await store.fileSize(path);
      const canResume = cached !== null && size >= cached;

      let followFrom: number;
      let anchor: number | null = null;
      if (canResume) {
        followFrom = Math.max(0, cached - RESUME_REWIND);
        // The cache does not record where its oldest message sat in the file,
        // so scroll-up anchors at the cursor instead. That first page back is
        // the cached window itself and dedupes to nothing, which is why
        // loadOlder keeps going until a page yields something — an
        // over-estimate wastes a read, an under-estimate would open a hole in
        // the history that nothing later fills.
        anchor = cached;
      } else {
        await resetTailCursor(db, connectionId, workspaceId, path);
        const recent = await loadRecent(store, path, label, size);
        if (recent !== null) {
          await ingest(recent.messages, sig);
          await setTailCursor(db, connectionId, workspaceId, path, recent.consumedBytes);
          followFrom = recent.consumedBytes;
          anchor = recent.startByte;
        } else {
          followFrom = 0;
        }
      }

      if (olderSource.current === null && anchor !== null) {
        olderSource.current = { path, label, anchor };
        if (anchor <= 0) setReachedStart(true);
      }

      void (async () => {
        try {
          for await (const chunk of store.tail(path, label, followFrom)) {
            if (controller.signal.aborted || !alive.current) break;
            if (chunk.message !== null) await ingest([chunk.message], sig);
            await setTailCursor(db, connectionId, workspaceId, path, chunk.consumedBytes);
          }
        } catch {
          // The tail died (host slept, network moved). The status poll notices
          // the missing tail and restarts it.
        } finally {
          tails.current.delete(sessionId);
        }
      })();
    },
    [client, db, connectionId, workspaceId, ingest]
  );

  // Status poll, which doubles as the tail watchdog.
  useEffect(() => {
    if (client === null) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let metaTick = 0;

    const poll = async () => {
      try {
        const snapshot = await client.snapshot();
        if (!alive.current) return;
        const live = snapshot.agents.filter((agent) => agent.workspaceId === workspaceId);
        setAgents(live);

        const conversational = live.filter((agent) => agent.agent !== null);
        const sig = sessionSignature(conversational);

        // An agent that never reports a session id is almost always a host
        // without `herdr integration install claude`. The thread cannot target
        // a transcript without it and refuses to guess, so without this it just
        // stays empty and blames nothing. Setting the same value twice is a
        // no-op in React, so this does not re-render on every poll.
        if (conversational.length > 0 && sig === null) {
          noSessionPolls.current += 1;
          setSessionState(noSessionPolls.current >= NO_SESSION_POLLS ? 'missing' : 'waiting');
        } else {
          noSessionPolls.current = 0;
          setSessionState('ok');
        }
        if (sig !== null && sig !== boundSig.current) {
          // Rotation, or a new chat reusing this workspace. Drop the old
          // history rather than appending a different conversation to it.
          for (const controller of tails.current.values()) controller.abort();
          tails.current.clear();
          if (await rebind(db, connectionId, workspaceId, sig)) resetHistory();
          boundSig.current = sig;
        }

        for (const agent of conversational) {
          void startTail(agent, conversational.length > 1);
        }

        const blocked = live.find((agent) => agent.agentStatus === 'blocked');
        if (blocked === undefined) {
          setBlockedPrompt(null);
        } else {
          const raw = await client.paneVisible(blocked.paneId, 40);
          const parsed = parseBlockedPrompt(raw);
          setBlockedPrompt(parsed.options.length === 0 ? null : parsed);
        }

        const primary = live.find((a) => a.focused) ?? live.find((a) => a.agent !== null) ?? live[0];
        const working = live.some((agent) => agent.agentStatus === 'working');
        if (working && primary !== undefined) {
          const raw = await client.paneVisible(primary.paneId, 30);
          setLivePreview(extractLivePreview(raw));
        } else {
          setLivePreview(null);
        }

        metaTick += 1;
        if (metaTick % 5 === 1 && primary !== undefined) {
          const store = new TranscriptStore(client.transport);
          const sessionId = hasSessionId(primary) ? (primary.agentSession?.value ?? null) : null;
          if (sessionId !== null) {
            const home = await store.homeDirectory();
            const path = store.sessionTranscriptPath(home, primary.cwd, sessionId);
            if (path !== null) setSessionMeta(await store.sessionMeta(path));
          }
        }
        setError(null);
      } catch (thrown) {
        if (!alive.current) return;
        setError(thrown instanceof HerdrError ? thrown.message : String(thrown));
      } finally {
        if (alive.current) timer = setTimeout(() => void poll(), STATUS_POLL_MS);
      }
    };
    void poll();

    // Captured now: by cleanup time `tails.current` may be a different map, and
    // aborting the wrong one leaves real tails running against a dead screen.
    const live = tails.current;
    return () => {
      if (timer !== null) clearTimeout(timer);
      for (const controller of live.values()) controller.abort();
      live.clear();
    };
  }, [client, db, connectionId, workspaceId, startTail, resetHistory]);

  const status: AgentStatus = agents.some((a) => a.agentStatus === 'blocked')
    ? 'blocked'
    : agents.some((a) => a.agentStatus === 'working')
      ? 'working'
      : agents.some((a) => a.agentStatus === 'done')
        ? 'done'
        : agents.length === 0
          ? 'unknown'
          : 'idle';

  const primaryPane =
    agents.find((a) => a.focused) ?? agents.find((a) => a.agent !== null) ?? agents[0] ?? null;
  const blockedPane = agents.find((a) => a.agentStatus === 'blocked') ?? null;

  /**
   * Submit and verify. `pane run` types the text and presses Enter, but a busy
   * TUI can leave the prompt sitting in the composer — so unless the agent was
   * already working (where a send just queues), require the status to flip to
   * `working`; if it doesn't, press Enter once more and re-check.
   */
  const deliver = useCallback(
    async (text: string, echoId: string, pane: AgentInfo) => {
      if (client === null) return;
      setIsSending(true);
      const wasWorking = pane.agentStatus === 'working';
      try {
        await client.sendMessage(pane.paneId, text);
        if (!wasWorking) {
          let accepted = await client.waitAgentStatus(pane.paneId, 'working', 3500);
          if (!accepted) {
            await client.sendKeys(pane.paneId, ['Enter']);
            accepted = await client.waitAgentStatus(pane.paneId, 'working', 2500);
          }
          if (!accepted) {
            setFailedIds((previous) => new Set(previous).add(echoId));
            setError(
              "Couldn't confirm delivery — the message may be stuck in the terminal. Try again."
            );
          }
        }
      } catch (thrown) {
        setFailedIds((previous) => new Set(previous).add(echoId));
        setError(thrown instanceof HerdrError ? thrown.message : String(thrown));
      } finally {
        setIsSending(false);
      }
    },
    [client]
  );

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (text.length === 0 || primaryPane === null) return;
      const echo: ChatMessage = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        role: 'user',
        segments: [{ kind: 'text', text }],
        timestamp: Date.now(),
        agentLabel: null,
        isSidechain: false,
      };
      echoes.current.push(echo);
      rebuild();
      await deliver(text, echo.id, primaryPane);
    },
    [primaryPane, rebuild, deliver]
  );

  const retry = useCallback(
    async (id: string) => {
      const echo = echoes.current.find((message) => message.id === id);
      if (echo === undefined || primaryPane === null) return;
      setFailedIds((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
      await deliver(displayText(echo), id, primaryPane);
    },
    [primaryPane, deliver]
  );

  const sendKeys = useCallback(
    async (keys: readonly string[]) => {
      const pane = blockedPane ?? primaryPane;
      if (client === null || pane === null) return;
      try {
        await client.sendKeys(pane.paneId, keys);
      } catch (thrown) {
        setError(thrown instanceof HerdrError ? thrown.message : String(thrown));
      }
    },
    [client, blockedPane, primaryPane]
  );

  const reload = useCallback(async () => {
    for (const controller of tails.current.values()) controller.abort();
    tails.current.clear();
    resetHistory();
  }, [resetHistory]);

  return {
    messages,
    status,
    agents,
    blockedPrompt,
    isBlocked: blockedPane !== null,
    sessionMeta,
    livePreview,
    workingDirName: primaryPane?.cwd.split('/').filter(Boolean).pop() ?? null,
    error,
    isSending,
    loadOlder,
    loadingOlder,
    reachedStart,
    sessionState,
    failedIds,
    send,
    retry,
    sendKeys,
    clearError: () => setError(null),
    reload,
  };
}

/**
 * The up-front history read: a small recent window, widened once if it came back
 * too thin to be a real conversation.
 */
async function loadRecent(
  store: TranscriptStore,
  path: string,
  label: string | null,
  size: number
): Promise<{ messages: ChatMessage[]; consumedBytes: number; startByte: number } | null> {
  try {
    const first = await store.recent(path, label, RECENT_BYTES, RECENT_MESSAGES);
    if (first.messages.length >= THIN_HISTORY || size <= RECENT_BYTES) return first;
    try {
      return await store.recent(path, label, RECENT_BYTES_WIDE, RECENT_MESSAGES);
    } catch {
      return first;
    }
  } catch {
    return null;
  }
}
