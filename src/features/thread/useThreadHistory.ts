import { useCallback, useRef, useState, type RefObject } from 'react';
import type * as SQLite from 'expo-sqlite';

import type { HerdrClient } from '@/lib/herdr/client';
import { ThreadWindow } from '@/lib/threadWindow';
import type { ChatMessage } from '@/lib/transcript/message';
import { TranscriptStore } from '@/lib/transcript/store';
import { appendMessages } from '@/state/threadCache';

/**
 * One page of scroll-up history, in transcript lines: a screen or two of
 * conversation once tool calls fold into their summary rows.
 */
const OLDER_LINES = 200;
/**
 * How many pages a single pull may read while every one of them turns out to
 * be entirely deduped. A thread resumed from its cache anchors at the tail
 * cursor, so the first pages back are the cached window itself and yield
 * nothing new; stopping at the first of those left the reader at the top with
 * nothing happening.
 */
const OLDER_EMPTY_PAGES = 6;
/**
 * How long a failed page waits before the next scroll may ask again. The reader
 * asks on every scroll event near the top, and without this a host that keeps
 * failing would be asked a dozen times a second.
 */
const OLDER_RETRY_MS = 2_000;

/**
 * Where scroll-up reads from, and how far back it has already gone. Recorded
 * from the first tail only: a workspace with two agents has two transcripts,
 * and paging the focused one is what "load older" means to a reader.
 */
export interface OlderSource {
  path: string;
  label: string | null;
  anchor: number;
  /** Codex only: a rewound or forked rollout goes on in the file it was cut from. */
  codexBase: boolean;
}

interface Options {
  client: HerdrClient | null;
  db: SQLite.SQLiteDatabase;
  connectionId: string;
  cacheKey: string;
  aliveRef: RefObject<boolean>;
  boundSigRef: RefObject<string | null>;
  /** A transcript line confirmed a sent message: a warning about its delivery is moot. */
  onConfirmed: () => void;
}

/** The messages a thread shows, the cache they are written to, and paging up through history. */
export function useThreadHistory({ client, db, connectionId, cacheKey, aliveRef, boundSigRef, onConfirmed }: Options) {
  const [shown] = useState(() => new ThreadWindow());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /** Changes only when a bounded host snapshot replaces the visible window. */
  const [historyVersion, setHistoryVersion] = useState(0);
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedStart, setReachedStart] = useState(false);
  const olderSource = useRef<OlderSource | null>(null);
  const paging = useRef(false);
  /** When a page last failed, for `OLDER_RETRY_MS`. */
  const olderFailedAt = useRef(0);

  const rebuild = useCallback(() => {
    const view = shown.view();
    if (view.confirmed > 0) onConfirmed();
    setMessages(view.messages);
  }, [shown, onConfirmed]);

  /** Show the cached messages, as they are. */
  const seed = useCallback((cached: ChatMessage[]) => {
    shown.seed(cached);
    rebuild();
  }, [shown, rebuild]);

  const ingest = useCallback(
    async (incoming: readonly ChatMessage[], sig: string) => {
      if (!aliveRef.current || sig !== boundSigRef.current) return;
      const fresh = shown.append(incoming);
      if (fresh.length === 0) return;
      await appendMessages(db, connectionId, cacheKey, sig, fresh);
      if (aliveRef.current) rebuild();
    },
    [db, connectionId, cacheKey, rebuild, shown, aliveRef, boundSigRef]
  );

  /**
   * Show a fresh read of the transcript's end. When that continues what is on
   * screen, keep the older history the reader paged back to and the list as it
   * is, so a reader mid-scroll stays put. Only a window that cannot continue
   * (a gap, or the first read) is a new list.
   */
  const showEnd = useCallback((latest: ChatMessage[]) => {
    const { continued, keptOlder } = shown.replaceEnd(latest);
    if (!keptOlder) olderSource.current = null;
    rebuild();
    if (!continued) setHistoryVersion((version) => version + 1);
  }, [shown, rebuild]);

  /** Where scroll-up starts: set by the first transcript opened, kept after. */
  const anchorOlder = useCallback((source: OlderSource) => {
    if (olderSource.current !== null) return;
    olderSource.current = source;
    setReachedStart(source.anchor <= 0 && !source.codexBase);
  }, []);

  /**
   * Prepend a page of older history.
   *
   * Deliberately NOT written to the thread cache: `appendMessages` numbers rows
   * with max(seq)+1, so persisting a page of old turns would file them after the
   * newest ones and the thread would come back inverted on the next open. Pages
   * live for this visit; reopening starts from the recent window again.
   */
  const loadOlder = useCallback(async () => {
    if (client === null || paging.current) return;
    if (Date.now() - olderFailedAt.current < OLDER_RETRY_MS) return;
    const source = olderSource.current;
    if (source === null || (source.anchor <= 0 && !source.codexBase)) return;
    const sig = boundSigRef.current;

    paging.current = true;
    setLoadingOlder(true);
    try {
      const store = new TranscriptStore(client.transport);
      for (let page = 0; page < OLDER_EMPTY_PAGES; page += 1) {
        const current = olderSource.current;
        if (current === null) break;
        if (current.anchor <= 0) {
          // The start of this file. A rewound or forked Codex rollout holds
          // only its own turns, and its first line names the file the earlier
          // ones are in: page on there, from where the inherited part ends.
          const base = current.codexBase ? await store.codexHistoryBase(current.path) : null;
          if (!aliveRef.current || sig !== boundSigRef.current || olderSource.current !== current) return;
          olderSource.current = base === null
            ? { ...current, codexBase: false }
            : { ...current, path: base.path, anchor: base.endByte };
          if (base === null) {
            setReachedStart(true);
            break;
          }
          continue;
        }

        const older = await store.older(current.path, current.label, current.anchor, OLDER_LINES);
        if (!aliveRef.current || sig !== boundSigRef.current || olderSource.current !== current) return;
        olderSource.current = { ...current, anchor: older.startByte };

        const fresh = shown.prepend(older.messages);
        if (fresh.length > 0) rebuild();

        if (older.reachedStart && !current.codexBase) {
          setReachedStart(true);
          break;
        }
        // Only keep paging while the reader has been given nothing.
        if (fresh.length > 0) break;
      }
    } catch {
      // A failed reach for more history leaves the thread exactly as it was.
      // The reader's next scroll asks again; surfacing a banner for it would
      // push the conversation down to report that nothing happened.
      olderFailedAt.current = Date.now();
    } finally {
      paging.current = false;
      if (aliveRef.current) setLoadingOlder(false);
    }
  }, [client, rebuild, shown, aliveRef, boundSigRef]);

  /** Forget the window: a new session, or a reload. */
  const reset = useCallback(() => {
    shown.reset();
    olderSource.current = null;
    setReachedStart(false);
    setMessages([]);
    setFailedIds(new Set());
  }, [shown]);

  const markFailed = useCallback((id: string) => {
    setFailedIds((previous) => new Set(previous).add(id));
  }, []);

  const unmarkFailed = useCallback((id: string) => {
    setFailedIds((previous) => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
  }, []);

  return {
    shown,
    messages,
    historyVersion,
    failedIds,
    loadingOlder,
    reachedStart,
    rebuild,
    seed,
    ingest,
    showEnd,
    anchorOlder,
    loadOlder,
    reset,
    markFailed,
    unmarkFailed,
  };
}
