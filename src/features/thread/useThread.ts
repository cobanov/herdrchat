import { useCallback, useEffect, useRef, useState } from 'react';

import { backoffDelay } from '@/lib/poll';
import { useHostEvents } from '../useHostEvents';
import { usePollGate } from '../usePollGate';
import { useReportPresence } from './useReportPresence';
import { useSettings } from '@/state/settings';
import type * as SQLite from 'expo-sqlite';

import type { HerdrClient } from '@/lib/herdr/client';
import { HerdrError } from '@/lib/herdr/protocol';
import {
  hasSessionId,
  sessionSignature,
  type AgentInfo,
  type AgentStatus,
} from '@/lib/herdr/models';
import { TranscriptStore } from '@/lib/transcript/store';
import type { ChatMessage } from '@/lib/transcript/message';
import { displayText } from '@/lib/transcript/message';
import {
  blockedPromptSignature,
  blockedPendingTimeout,
  parseBlockedPrompt,
  resolveBlockedPending,
  type BlockedPending,
  type BlockedPrompt,
} from '@/lib/transcript/blockedPrompt';
import { extractLivePreview } from '@/lib/transcript/livePreview';
import { modelDisplayName, type SessionMeta } from '@/lib/transcript/sessionMeta';
import {
  appendMessages,
  rebind,
  replaceMessages,
  seedMessages,
  setTailCursor,
  tailCursor,
} from '@/state/threadCache';

/**
 * Bytes of a fresh transcript to pull up front.
 *
 * A chat surface is about recency, so this is deliberately small: a large window
 * means every thread open pays a multi-megabyte SSH read and then lays out
 * thousands of bubbles, which is what makes long sessions open mid-history and
 * stutter. Older history stays on the host. A changed transcript opens with a
 * fresh window, never by replaying everything since the last visit.
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
 * The status poll's rate while the host's event stream is live and no agent
 * is working. Status flips and turn ends arrive as events and trigger a poll
 * at once; this only catches what a dropped stream would lose. While an agent
 * IS working the fast rate stays, because the streaming preview and the tail
 * watchdog are screen reads that no event announces.
 */
const LIVE_POLL_MS = 30_000;
/** Coalesce a burst of events (working → done → idle) into one poll. */
const EVENT_DEBOUNCE_MS = 250;
/**
 * How long a tail may produce nothing while its agent is WORKING before it is
 * assumed dead and restarted.
 *
 * Generous on purpose. A working agent can genuinely go quiet for a while, a
 * long build, a slow test run, one tool call that takes a minute, and the cost
 * of waiting is a late restart, while the cost of firing early is a stream
 * needlessly torn down and re-established over SSH.
 */
const TAIL_SILENCE_MS = 90_000;
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
const CODEX_RECEIPT_WAIT_MS = 5_000;
/** How long a send cut off by the connection waits for its transcript receipt. */
const TRANSPORT_RECEIPT_WAIT_MS = 8_000;
const RECEIPT_CHECK_MS = 100;
const CODEX_DELIVERY_NOTICE = 'The input was sent to Codex, but its transcript has not confirmed delivery. Check the host before retrying.';
const BLOCKED_PENDING_ERROR = 'The reply may not have landed, check the agent.';
const STALLED_WARNING = 'The agent never picked that up, it may be stuck at a prompt. Try again.';
const UNCONFIRMED_WARNING = "Couldn't confirm delivery, the message may be stuck in the terminal. Try again.";
const DELIVERY_UNKNOWN_WARNING =
  "The connection dropped while sending, so the message may have arrived. Check the chat before sending it again.";
/** Warnings about whether a message landed. Its transcript receipt answers them. */
const DELIVERY_WARNINGS: ReadonlySet<string> = new Set([
  CODEX_DELIVERY_NOTICE,
  STALLED_WARNING,
  UNCONFIRMED_WARNING,
  DELIVERY_UNKNOWN_WARNING,
]);

/** States that prove the agent read a prompt: it started, or it stopped to ask. */
const REACTED = ['working', 'blocked'] as const;

export interface ThreadState {
  loading: boolean;
  /** Changes only when a bounded host snapshot replaces the visible window. */
  historyVersion: number;
  canSend: boolean;
  messages: ChatMessage[];
  status: AgentStatus;
  agents: AgentInfo[];
  blockedPrompt: BlockedPrompt | null;
  /** The blocked-prompt reply in flight, if any. Non-null disables the bar. */
  blockedPending: BlockedPending | null;
  isBlocked: boolean;
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
   */
  sessionState: 'ok' | 'waiting' | 'missing' | 'unsupported';
  failedIds: Set<string>;
  send: (text: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
  sendKeys: (keys: readonly string[]) => Promise<void>;
  /** Stop the working agent. `hard` sends Ctrl-C and may end the session. */
  interrupt: (hard?: boolean) => Promise<void>;
  clearError: () => void;
  reload: () => Promise<void>;
}

/**
 * Drives one workspace thread: tails the transcript into bubbles, tracks live
 * blocked/working state, and sends replies back through herdr.
 *
 * Transcripts are targeted by the agent's native session reference, herdr's
 * `agent_session.value` IS the Claude transcript filename, rather than by
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
  const [loading, setLoading] = useState(client !== null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [agents, setAgents] = useState<AgentInfo[]>([...initialAgents]);
  const [blockedPrompt, setBlockedPrompt] = useState<BlockedPrompt | null>(null);
  const [blockedPending, setBlockedPending] = useState<BlockedPending | null>(null);
  // Mirrors the state for the poll closure and for the synchronous double-tap
  // guard in sendKeys, a second tap can land before React re-renders.
  const blockedPendingRef = useRef<BlockedPending | null>(null);
  const blockedPendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sessionMetadata, setSessionMetadata] = useState<Record<string, SessionMeta>>({});
  const [livePreview, setLivePreview] = useState<string | null>(null);
  /*
    Errors live in three slots, because each has its own owner and its own
    reason to go away. The poll clears only what the poll raised: a warning
    from a send ("the agent never picked that up") is there to stop the user
    sending the same prompt twice into a live agent, and a successful poll two
    seconds later is no reason to take it down (#82).

    - `pollError`: the status loop's own failure. Cleared by its next success.
    - `actionError`: a send, a blocked-prompt reply, an interrupt. Cleared on
      dismiss, on the transcript receipt that answers it, or by the next send.
    - `tailError`: the live transcript reader, below.
  */
  const [pollError, setPollError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /*
    Tail failures need their own slot, because the poll's success path ends in
    `setPollError(null)` and a tail that rejected earlier in the SAME iteration was
    wiped by it a few hundred milliseconds after appearing.

    `startTail` is fired without await and its first await, `homeDirectory()` :
    is serialized ahead of the poll's own `paneVisible` calls on one connection,
    so its rejection lands first almost every time. And when no agent is blocked
    and none is working, the poll has no awaits left at all between the two, so
    the clear follows immediately.

    Whether it was visible therefore depended on what the agents happened to be
    doing, which is why this read as "the banner flickers" rather than as a bug.
    The poll clears only what the poll raised.
  */
  const [tailError, setTailError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedStart, setReachedStart] = useState(false);
  const [sessionState, setSessionState] = useState<'ok' | 'waiting' | 'missing' | 'unsupported'>('ok');
  /** When the thread first saw an agent without a session id, or null while all have one. */
  const noSessionSince = useRef<number | null>(null);
  const polling = usePollGate();
  // The user's own battery/data tradeoff, applied on top of each screen's rate.
  const pollScale = useSettings((state) => state.pollScale);
  /** Consecutive failed polls, for the backoff. Reset by any success. */
  const failures = useRef(0);
  /** Asks the running status loop to poll soon. Set by the effect that owns it. */
  const kick = useRef<() => void>(() => undefined);
  const streamLive = useHostEvents(
    client,
    agents.map((agent) => agent.paneId),
    polling,
    () => kick.current()
  );
  const streamLiveRef = useRef(streamLive);
  useEffect(() => {
    streamLiveRef.current = streamLive;
  }, [streamLive]);
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());

  // Transcript arrivals and optimistic echoes are kept apart so an unconfirmed
  // echo can sit at its send position rather than pinning to the bottom below
  // newer messages.
  const arrivals = useRef<ChatMessage[]>([]);
  const echoes = useRef<ChatMessage[]>([]);
  const echoBaselines = useRef(new Map<string, Set<string>>());
  const claimedReceipts = useRef(new Set<string>());
  const confirmedEchoIds = useRef(new Set<string>());
  const seen = useRef<Set<string>>(new Set());
  /**
   * Where scroll-up reads from, and how far back it has already gone. Recorded
   * from the first tail only: a workspace with two agents has two transcripts,
   * and paging the focused one is what "load older" means to a reader.
   */
  const olderSource = useRef<{
    path: string;
    label: string | null;
    anchor: number;
  } | null>(null);
  const boundSig = useRef<string | null>(null);
  const tails = useRef(new Map<string, AbortController>());
  /**
   * When each tail last produced anything, so the poll can tell a wedged stream
   * from a quiet agent. See `TAIL_SILENCE_MS`.
   */
  const tailBeats = useRef(new Map<string, number>());
  /** The header is seeded from disk once per bound session; the tail does the rest. */
  const metaSeeded = useRef(new Set<string>());
  const alive = useRef(true);
  const paging = useRef(false);
  const sending = useRef(false);

  /**
   * Fold one assistant line's metadata into the header.
   *
   * Merged rather than replaced: a turn can report a model with no usage yet, or
   * usage on a line whose model field is absent, and blanking the other half
   * each time would make the header flicker between complete and half-empty.
   */
  const applyMeta = useCallback((key: string, next: SessionMeta) => {
    setSessionMetadata((prev) => ({
      ...prev,
      [key]: {
        model: next.model ?? prev[key]?.model ?? null,
        // Model and effort belong to one turn, never to a sibling agent.
        effort: next.model !== null ? next.effort ?? null : prev[key]?.effort ?? null,
        contextTokens: next.contextTokens ?? prev[key]?.contextTokens ?? null,
      },
    }));
  }, []);

  const rebuild = useCallback(() => {
    // Only a NEW host record can acknowledge a prompt. Matching all historical
    // text made a second "again" disappear before it had even been sent.
    echoes.current = echoes.current.filter((echo) => {
      const before = echoBaselines.current.get(echo.id);
      const receipt = arrivals.current.find(message => message.role === 'user' &&
        !before?.has(message.id) && !claimedReceipts.current.has(message.id) &&
        displayText(message).trim() === displayText(echo).trim());
      if (receipt === undefined) return true;
      claimedReceipts.current.add(receipt.id);
      confirmedEchoIds.current.add(echo.id);
      echoBaselines.current.delete(echo.id);
      // The message arrived after all: a warning about its delivery is moot.
      setActionError(previous => previous !== null && DELIVERY_WARNINGS.has(previous) ? null : previous);
      return false;
    });

    if (echoes.current.length === 0) {
      setMessages([...arrivals.current]);
      return;
    }
    // Merge the two time-ordered lists, carrying the last known timestamp
    // forward for arrivals that have none.
    const merged: ChatMessage[] = [];
    const pending = [...echoes.current].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
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
      if (!alive.current || sig !== boundSig.current) return;
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
    if (client === null || paging.current) return;
    const source = olderSource.current;
    if (source === null || source.anchor <= 0) return;
    const sig = boundSig.current;

    paging.current = true;
    setLoadingOlder(true);
    try {
      const store = new TranscriptStore(client.transport);
      for (let page = 0; page < OLDER_EMPTY_PAGES; page += 1) {
        const current = olderSource.current;
        if (current === null || current.anchor <= 0) break;

        const older = await store.older(current.path, current.label, current.anchor, OLDER_BYTES);
        if (!alive.current || sig !== boundSig.current || olderSource.current !== current) return;
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
      paging.current = false;
      if (alive.current) setLoadingOlder(false);
    }
  }, [client, rebuild]);

  const clearBlockedPending = useCallback(() => {
    if (blockedPendingTimer.current !== null) {
      clearTimeout(blockedPendingTimer.current);
      blockedPendingTimer.current = null;
    }
    blockedPendingRef.current = null;
    setBlockedPending(null);
  }, []);

  const resetHistory = useCallback(() => {
    arrivals.current = [];
    echoes.current = [];
    echoBaselines.current.clear();
    claimedReceipts.current.clear();
    confirmedEchoIds.current.clear();
    olderSource.current = null;
    setReachedStart(false);
    seen.current = new Set();
    setMessages([]);
    setFailedIds(new Set());
    // A different session means a different model and a different context; the
    // old header would otherwise persist over the new conversation.
    metaSeeded.current.clear();
    setSessionMetadata({});
  }, []);

  // Cache reads happen after the snapshot identifies the live session. A route
  // opens without initial agents, so seeding here could flash a recycled chat.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const startTails = useCallback(async (live: readonly AgentInfo[]) => {
    if (client === null || boundSig.current === null) return;
    const identified = live.filter(hasSessionId);
    if (identified.length === 0 || identified.every(agent => tails.current.has(sessionSignature([agent])!))) return;

    // One opening snapshot for the whole workspace. Reserving every native
    // session before awaiting also prevents an event from starting it twice.
    // Restart siblings together when one stream dies, so two agents never
    // replace each other's half of the cached window.
    for (const controller of tails.current.values()) controller.abort();
    tails.current.clear();
    const controller = new AbortController();
    const sig = boundSig.current;
    const current = () => alive.current && !controller.signal.aborted && sig === boundSig.current;
    const release = (key: string) => {
      if (tails.current.get(key) === controller) {
        tails.current.delete(key);
        tailBeats.current.delete(key);
      }
    };
    for (const agent of identified) tails.current.set(sessionSignature([agent])!, controller);

    try {
      const store = new TranscriptStore(client.transport);
      let openingError: string | null = null;
      const sources = (await Promise.all(identified.map(async agent => {
        try {
          const id = agent.agentSession!.value!;
          const key = sessionSignature([agent])!;
          const label = live.length > 1 ? agent.agent : null;
          const path = agent.agent === 'codex'
            ? await store.codexTranscriptPath(id)
            : store.sessionTranscriptPath(await store.homeDirectory(), agent.cwd, id);
          if (path === null) throw new Error(agent.agent === 'codex'
            ? 'The Codex session is identified, but its transcript is not in CODEX_HOME/sessions or archived_sessions on this host. Start or resume that exact session on the host, then reload.'
            : 'The agent reported an invalid session id. Resume the session on the host, then reload.');
          const probe = await store.fileProbe(path);
          if (probe.kind === 'absent') {
            if (agent.agent === 'codex') store.forgetCodexTranscript(id);
            release(key);
            return null; // A new agent can receive its first prompt before writing a file.
          }
          if (probe.kind === 'unknown') throw new Error(`Couldn't read this chat's transcript on the host: ${probe.reason}`);
          const cached = await tailCursor(db, connectionId, workspaceId, path);
          return { key, path, label, agent: agent.agent, size: probe.bytes, cached };
        } catch (thrown) {
          release(sessionSignature([agent])!);
          openingError = thrown instanceof Error ? thrown.message : String(thrown);
          return null;
        }
      }))).filter(source => source !== null);
      if (!current()) return;

      // A cursor is a live-stream checkpoint, not a history-loading strategy.
      // Even a small backlog is read in bulk; an unchanged file can use cache.
      const changed = arrivals.current.length === 0 || sources.some(source => source.cached !== source.size);
      const windows = await Promise.all(sources.map(async source => ({
        ...source,
        recent: changed ? await loadRecent(store, source.path, source.label, source.size) : null,
      })));
      if (!current()) return;
      if (changed && windows.length > 0) {
        const latest = windows.flatMap(window => window.recent?.messages ?? []);
        // A single transcript keeps host order even without timestamps.
        if (windows.length > 1) latest.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
        await replaceMessages(db, connectionId, workspaceId, sig, latest);
        if (!current()) return;
        arrivals.current = latest;
        seen.current = new Set(latest.map(message => message.id));
        olderSource.current = null;
        rebuild();
        setHistoryVersion(version => version + 1);
      }

      setTailError(openingError);
      for (const source of windows) {
        const followFrom = source.recent?.consumedBytes ?? Math.max(0, source.cached! - RESUME_REWIND);
        if (source.recent !== null) {
          await setTailCursor(db, connectionId, workspaceId, source.path, followFrom);
        }
        if (!current()) return;
        if (olderSource.current === null) {
          const anchor = source.recent?.startByte ?? source.cached!;
          olderSource.current = { path: source.path, label: source.label, anchor };
          setReachedStart(anchor <= 0);
        }
        if (!metaSeeded.current.has(source.key)) {
          metaSeeded.current.add(source.key);
          void store.sessionMeta(source.path, source.agent).then(seeded => {
            if (seeded !== null && current()) setSessionMetadata(prev => ({
              ...prev,
              [source.key]: {
                model: prev[source.key]?.model ?? seeded.model,
                effort: prev[source.key]?.model != null ? prev[source.key]?.effort : seeded.effort,
                contextTokens: prev[source.key]?.contextTokens ?? seeded.contextTokens,
              },
            }));
          }).catch(() => { /* The next live turn can fill the header. */ });
        }
        tailBeats.current.set(source.key, Date.now());
        void (async () => {
          try {
            for await (const chunk of store.tail(source.path, source.label, followFrom, controller.signal)) {
              if (!current()) break;
              tailBeats.current.set(source.key, Date.now());
              if (chunk.meta !== null) applyMeta(source.key, chunk.meta);
              if (chunk.message !== null) await ingest([chunk.message], sig);
              if (!current()) break;
              await setTailCursor(db, connectionId, workspaceId, source.path, chunk.consumedBytes);
            }
          } catch (thrown) {
            if (current()) setTailError(`Conversation updates paused. Reconnecting. ${thrown instanceof Error ? thrown.message : String(thrown)}`);
          } finally {
            release(source.key);
          }
        })();
      }
      if (current()) {
        setLoading(false);
      }
    } catch (thrown) {
      if (current()) {
        setLoading(false);
        setTailError(thrown instanceof Error ? thrown.message : String(thrown));
        // Keep the last readable cache, and retry the bounded snapshot. Never
        // fall back to tailing from byte zero on a failed bulk read.
        controller.abort();
        for (const agent of identified) release(sessionSignature([agent])!);
      }
    }
  }, [client, db, connectionId, workspaceId, ingest, applyMeta, rebuild]);

  // Status poll, which doubles as the tail watchdog.
  useEffect(() => {
    // Backgrounded: iOS suspends these timers anyway, but the socket usually
    // dies with them, so the honest thing is to stop and re-poll immediately on
    // resume, which is what remounting this effect does.
    if (client === null || !polling) return;
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
      let keepFast = true;
      try {
        const snapshot = await client.snapshot();
        if (!alive.current || stopped) return;
        const live = snapshot.agents.filter((agent) => agent.workspaceId === workspaceId);
        setAgents(live);

        const conversational = live.filter((agent) => agent.agent === 'claude' || agent.agent === 'codex');
        const unsupported = conversational.length === 0 && live.some(agent => agent.agent !== null);
        const sig = sessionSignature(conversational);

        // An agent that never reports a session id is almost always a host
        // without `herdr integration install claude`. The thread cannot target
        // a transcript without it and refuses to guess, so without this it just
        // stays empty and blames nothing. Setting the same value twice is a
        // no-op in React, so this does not re-render on every poll.
        if (unsupported) {
          noSessionSince.current = null;
          setSessionState('unsupported');
        } else if (conversational.length > 0 && sig === null) {
          const since = (noSessionSince.current ??= Date.now());
          setSessionState(Date.now() - since >= NO_SESSION_GRACE_MS ? 'missing' : 'waiting');
        } else {
          noSessionSince.current = null;
          setSessionState('ok');
        }
        if (sig === null) setLoading(false);
        if (sig !== null && sig !== boundSig.current) {
          // Rotation, or a new chat reusing this workspace. Drop the old
          // history rather than appending a different conversation to it.
          for (const controller of tails.current.values()) controller.abort();
          tails.current.clear();
          tailBeats.current.clear();
          const rotated = boundSig.current !== null;
          const dropped = await rebind(db, connectionId, workspaceId, sig);
          if (dropped || rotated) resetHistory();
          if (stopped) return;
          boundSig.current = sig;
          setLoading(true);
          const cached = await seedMessages(db, connectionId, workspaceId);
          if (stopped) return;
          arrivals.current = cached;
          // Deduplicate what is ON SCREEN, not every cached row ever seen.
          // Otherwise scroll-up can never recover cached-but-unmounted turns.
          seen.current = new Set(cached.map(message => message.id));
          rebuild();
        }

        void startTails(conversational);

        const blocked = live.find((agent) => agent.agentStatus === 'blocked');
        let parsedPrompt: BlockedPrompt | null = null;
        if (blocked !== undefined) {
          const raw = await client.paneVisible(blocked.paneId, 40);
          const parsed = parseBlockedPrompt(raw);
          parsedPrompt = parsed.options.length === 0 ? null : parsed;
        }
        setBlockedPrompt(parsedPrompt);

        // A reply in flight is confirmed (or orphaned) by what this poll saw.
        // Only the silent outcomes are handled here: the timeout banner belongs
        // to the timer in sendKeys, which raises it as an action error.
        const pending = blockedPendingRef.current;
        if (pending !== null) {
          const resolution = resolveBlockedPending(pending, {
            blocked: blocked !== undefined,
            promptSig: blockedPromptSignature(parsedPrompt),
            now: Date.now(),
            timeoutMs: blockedPendingTimeout(STATUS_POLL_MS * pollScale),
          });
          if (resolution === 'delivered' || resolution === 'superseded') clearBlockedPending();
        }

        const primary =
          live.find((a) => a.focused) ?? live.find((a) => a.agent !== null) ?? live[0];
        const working = live.some((agent) => agent.agentStatus === 'working');
        keepFast = working;
        if (working && primary !== undefined) {
          const raw = await client.paneVisible(primary.paneId, 30);
          setLivePreview(extractLivePreview(raw));
        } else {
          setLivePreview(null);
        }

        /*
          Tail watchdog.

          `startTail` returns early for a session already in `tails`, and that
          entry is removed only when the generator finishes or throws. A stream
          that dies WITHOUT throwing, a half-open TCP after the host sleeps or
          the phone changes network, therefore leaves the entry in place
          forever, and the restart the catch block promises can never happen.
          The thread just stops receiving messages and looks idle.

          Silence on its own proves nothing: a quiet agent writes no transcript
          lines for hours, legitimately. Silence *while working* does, because a
          working agent is by definition appending turns. A false positive costs
          one restarted tail, which resumes from the persisted cursor and dedupes
          whatever it re-reads, so the check is allowed to be wrong.
        */
        if (working) {
          const now = Date.now();
          for (const agent of conversational) {
            const id = sessionSignature([agent]);
            if (id === null || !tails.current.has(id)) continue;
            const beat = tailBeats.current.get(id) ?? now;
            if (now - beat < TAIL_SILENCE_MS) continue;
            tails.current.get(id)?.abort();
            tails.current.delete(id);
            tailBeats.current.delete(id);
          }
        }
        setPollError(null);
        failures.current = 0;
      } catch (thrown) {
        if (!alive.current || stopped) return;
        setLoading(false);
        failures.current += 1;
        setPollError(thrown instanceof HerdrError ? thrown.message : String(thrown));
      } finally {
        inFlight = false;
        // The banner stays up throughout: backing off must never read as
        // recovery. Only the interval changes.
        if (alive.current && !stopped) {
          const base =
            streamLiveRef.current && !keepFast ? LIVE_POLL_MS : STATUS_POLL_MS * pollScale;
          schedule(again ? EVENT_DEBOUNCE_MS : backoffDelay(base, failures.current));
          again = false;
        }
      }
    };
    kick.current = () => schedule(EVENT_DEBOUNCE_MS);
    void poll();

    // Captured now: by cleanup time `tails.current` may be a different map, and
    // aborting the wrong one leaves real tails running against a dead screen.
    const live = tails.current;
    return () => {
      stopped = true;
      kick.current = () => undefined;
      if (timer !== null) clearTimeout(timer);
      for (const controller of live.values()) controller.abort();
      live.clear();
    };
  }, [
    client,
    db,
    connectionId,
    workspaceId,
    startTails,
    resetHistory,
    clearBlockedPending,
    polling,
    pollScale,
    rebuild,
  ]);

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
    agents.find((a) => a.focused && a.agent !== null) ??
    agents.find((a) => a.agent !== null) ??
    null;
  const blockedPane = agents.find((a) => a.agentStatus === 'blocked') ?? null;
  const sessionMeta = primaryPane === null ? null
    : sessionMetadata[sessionSignature([primaryPane]) ?? ''] ?? null;

  // Publish "driven from a phone, on this model" to the host's sidebar. Gated on
  // `polling` so a backgrounded app stops claiming presence it does not have.
  useReportPresence(
    client,
    primaryPane?.paneId ?? null,
    modelDisplayName(sessionMeta?.model ?? null),
    polling
  );

  /**
   * The pane to send to, re-read at the moment of sending.
   *
   * `primaryPane` comes from the poll, so by the time someone taps send it can
   * be two seconds old. A pane id that has changed in that window, an agent
   * restarted, a layout redrawn, sends the message somewhere it will not be
   * read, and `pane run` succeeds against whatever is there, so the failure is
   * silent. This is the same trap the Raycast extension's reviewers caught in
   * its split targeting: don't act on an id you sampled a moment ago.
   *
   * Falls back to the polled pane if the check itself fails. A send that might
   * go to a stale pane still beats a send that does not happen.
   */
  const currentPane = useCallback(
    async (fallback: AgentInfo): Promise<AgentInfo> => {
      if (client === null) return fallback;
      try {
        const snapshot = await client.snapshot();
        const live = snapshot.agents.filter((agent) => agent.workspaceId === workspaceId);
        return (
          live.find((a) => a.focused && a.agent !== null) ??
          live.find((a) => a.agent !== null) ??
          live[0] ??
          fallback
        );
      } catch {
        return fallback;
      }
    },
    [client, workspaceId]
  );

  /**
   * Submit, and let the host verify wherever it can.
   *
   * `agent prompt --wait` makes herdr watch its own agent and answer with what
   * it saw. Its help: "when submission starts from a non-working state, --wait
   * first requires an observed state change within 5000ms; otherwise it returns
   * agent_prompt_stalled." That named error is exactly the stuck-in-the-composer
   * case the blind Enter was written to guess at, observed by the process that
   * owns the terminal, rather than inferred here from a fixed sleep.
   *
   * So on a modern host there are two outcomes and neither needs us to guess:
   * `delivered` returns immediately, `stalled` fails the bubble honestly.
   *
   * `unverified` is the legacy path, for hosts with no `agent prompt` (and the
   * fork's `written_to_pty`). There `pane run` only means keystrokes were sent,
   * so the old dance survives, including the second Enter, which is unsafe in
   * principle (if the first send DID land it submits an empty line into a live
   * agent) but is also the only thing that recovers a stuck composer on a host
   * with no alternative. It is narrowed to the one case it is for: the agent
   * still sitting idle. An agent that went `blocked` read the prompt and opened
   * a menu, and Enter there picks the highlighted option, usually "Yes", which
   * approved a tool call nobody saw (#76). So the wait accepts `blocked` as a
   * reaction, and the status is read again right before any Enter.
   *
   * `wasWorking` still guards all of it, and herdr's own caveat is why: --wait
   * "does not track turns: if the agent is already working, that active turn's
   * completion may match." Sending into a busy agent just queues, so there is
   * nothing to wait for and waiting would match the wrong turn.
   */
  const deliver = useCallback(
    async (text: string, echoId: string, polled: AgentInfo) => {
      if (client === null) return;
      // What the pane is doing right now. `idle` only when the host positively
      // says so; a failed read or a vanished pane is `unknown`, never `idle`.
      const paneState = async (paneId: string): Promise<'idle' | 'reacted' | 'unknown'> => {
        try {
          const snapshot = await client.snapshot();
          const status = snapshot.agents.find((agent) => agent.paneId === paneId)?.agentStatus;
          if (status === 'idle' || status === 'done') return 'idle';
          if (status === 'working' || status === 'blocked') return 'reacted';
          return 'unknown';
        } catch {
          return 'unknown';
        }
      };
      const deliverySig = boundSig.current;
      const current = () => alive.current && deliverySig === boundSig.current;
      const confirmed = () => confirmedEchoIds.current.has(echoId);
      // Wait for the transcript to show the message. When it doesn't, the
      // bubble fails with `notice`, which says the message may have landed:
      // never a blind retry, never a second Enter.
      const awaitReceipt = async (notice: string, waitMs: number) => {
        const deadline = Date.now() + waitMs;
        while (current() && !confirmed() && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, RECEIPT_CHECK_MS));
        }
        if (current() && !confirmed()) {
          setFailedIds(previous => new Set(previous).add(echoId));
          setActionError(notice);
        }
      };
      const awaitCodexReceipt = () => awaitReceipt(CODEX_DELIVERY_NOTICE, CODEX_RECEIPT_WAIT_MS);
      setIsSending(true);
      try {
        const pane = await currentPane(polled);
        const wasWorking = pane.agentStatus === 'working';
        const outcome = await client.sendPrompt(pane.paneId, text);
        if (!current() || confirmed()) return;

        if (pane.agent === 'codex' && outcome !== 'delivered') {
          // Shared-service Codex TUIs may expose no observable composer state.
          // The native transcript is stronger evidence than an idle PTY, and
          // another Enter could submit twice. Wait for that receipt, never resend.
          await awaitCodexReceipt();
          return;
        }

        if (outcome === 'stalled') {
          // The host watched and nothing moved. No guessing, no second Enter.
          setFailedIds((previous) => new Set(previous).add(echoId));
          setActionError(STALLED_WARNING);
          return;
        }

        if (outcome === 'unverified' && !wasWorking) {
          let accepted = await client.waitAgentStatus(pane.paneId, REACTED, 3500);
          if (!accepted) {
            // Enter only into a composer the host says is idle. It may have
            // reacted just after the wait gave up; if its state is unknown, an
            // Enter is not safe to guess and the bubble says so instead.
            const state = await paneState(pane.paneId);
            if (state === 'idle') {
              await client.sendKeys(pane.paneId, ['Enter']);
              accepted = await client.waitAgentStatus(pane.paneId, REACTED, 2500);
            } else {
              accepted = state === 'reacted';
            }
          }
          if (!accepted) {
            setFailedIds((previous) => new Set(previous).add(echoId));
            setActionError(UNCONFIRMED_WARNING);
          }
        }
      } catch (thrown) {
        if (!current() || confirmed()) return;
        if (polled.agent === 'codex' && thrown instanceof HerdrError &&
            thrown.code === 'agent_prompt_unverifiable') {
          await awaitCodexReceipt();
          return;
        }
        if (thrown instanceof HerdrError && thrown.transport) {
          // The connection failed mid-send: the prompt may well have landed.
          // Reporting it as not delivered is how a retry sent it twice (#83).
          await awaitReceipt(DELIVERY_UNKNOWN_WARNING, TRANSPORT_RECEIPT_WAIT_MS);
          return;
        }
        setFailedIds((previous) => new Set(previous).add(echoId));
        setActionError(thrown instanceof HerdrError ? thrown.message : String(thrown));
      } finally {
        setIsSending(false);
      }
    },
    [client, currentPane]
  );

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (text.length === 0 || primaryPane === null || sending.current || loading || sessionState === 'unsupported') return;
      sending.current = true;
      // A new message is a new attempt; the last one's warning has done its job.
      setActionError(null);
      const echo: ChatMessage = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        role: 'user',
        segments: [{ kind: 'text', text }],
        timestamp: Date.now(),
        agentLabel: null,
        isSidechain: false,
      };
      echoBaselines.current.set(echo.id, new Set(arrivals.current.map(message => message.id)));
      echoes.current.push(echo);
      rebuild();
      try {
        await deliver(text, echo.id, primaryPane);
      } finally {
        sending.current = false;
      }
    },
    [primaryPane, rebuild, deliver, loading, sessionState]
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

  /**
   * Answer a blocked prompt (or poke the primary pane).
   *
   * When the target is a blocked agent, the reply is marked pending BEFORE it
   * is sent, and stays pending until a poll observes the agent act on it. The
   * poll is what removes the bar, and at the slowest setting it runs every ten
   * seconds, without the pending state that whole window accepts a second tap,
   * which sends a second digit + Enter into an agent that already moved on.
   *
   * The ref check is synchronous on purpose: the disabled prop the pending
   * state drives arrives only with the next render, and two fast taps fit
   * inside that gap.
   */
  const sendKeys = useCallback(
    async (keys: readonly string[]) => {
      const pane = blockedPane ?? primaryPane;
      if (client === null || pane === null) return;
      if (blockedPendingRef.current !== null) return;

      if (blockedPane !== null) {
        const pending: BlockedPending = {
          keys,
          promptSig: blockedPromptSignature(blockedPrompt),
          sentAt: Date.now(),
        };
        blockedPendingRef.current = pending;
        setBlockedPending(pending);
        // The banner is raised from here rather than from the poll: the poll's
        // success path clears the error state, so a banner it raised itself
        // would not survive its own iteration.
        blockedPendingTimer.current = setTimeout(
          () => {
            if (!alive.current || blockedPendingRef.current !== pending) return;
            clearBlockedPending();
            setActionError(BLOCKED_PENDING_ERROR);
          },
          blockedPendingTimeout(STATUS_POLL_MS * pollScale)
        );
      }

      try {
        await client.sendKeys(pane.paneId, keys);
      } catch (thrown) {
        // The keys never left the phone; nothing is pending on the host.
        clearBlockedPending();
        setActionError(thrown instanceof HerdrError ? thrown.message : String(thrown));
      }
    },
    // `pollScale` belongs here: the pending window is derived from the poll
    // interval, so a callback closing over a stale scale would arm the wrong
    // deadline after the setting changed.
    [client, blockedPane, primaryPane, blockedPrompt, clearBlockedPending, pollScale]
  );

  /**
   * Stop the agent. `hard` sends Ctrl-C, which can end the session.
   *
   * Targets the working pane specifically rather than `blockedPane ??
   * primaryPane` the way `sendKeys` does: a blocked agent is already stopped and
   * waiting for an answer, so interrupting it would answer nothing and might
   * dismiss the prompt the user is about to read.
   */
  const interrupt = useCallback(
    async (hard = false) => {
      const pane = agents.find((a) => a.agentStatus === 'working') ?? primaryPane;
      if (client === null || pane === null) return;
      try {
        await (hard ? client.interruptHard(pane.paneId) : client.interrupt(pane.paneId));
      } catch (thrown) {
        setActionError(thrown instanceof HerdrError ? thrown.message : String(thrown));
      }
    },
    [client, agents, primaryPane]
  );

  const reload = useCallback(async () => {
    for (const controller of tails.current.values()) controller.abort();
    tails.current.clear();
    tailBeats.current.clear();
    // Reload must replace the persisted messages too, otherwise a cold reopen
    // resurrects stale parsed bubbles that the fresh host read has removed.
    await db.withTransactionAsync(async () => {
      for (const table of ['messages', 'tail_cursors']) {
        await db.runAsync(
          `DELETE FROM ${table} WHERE connection_id = ? AND workspace_id = ?`,
          connectionId,
          workspaceId
        );
      }
    });
    if (!alive.current) return;
    resetHistory();
    setLoading(true);
    failures.current = 0;
    kick.current();
  }, [db, connectionId, workspaceId, resetHistory]);

  return {
    loading,
    historyVersion,
    canSend: client !== null && primaryPane !== null && !loading && sessionState !== 'unsupported',
    messages,
    status,
    agents,
    blockedPrompt,
    blockedPending,
    isBlocked: blockedPane !== null,
    sessionMeta,
    livePreview,
    workingDirName: primaryPane?.cwd.split('/').filter(Boolean).pop() ?? null,
    error: actionError ?? pollError ?? tailError,
    isSending,
    loadOlder,
    loadingOlder,
    reachedStart,
    sessionState,
    failedIds,
    send,
    retry,
    sendKeys,
    interrupt,
    clearError: () => {
      setActionError(null);
      setPollError(null);
      setTailError(null);
    },
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
): Promise<{
  messages: ChatMessage[];
  consumedBytes: number;
  startByte: number;
}> {
  const first = await store.recent(path, label, RECENT_BYTES, RECENT_MESSAGES);
  if (first.messages.length >= THIN_HISTORY || size <= RECENT_BYTES) return first;
  try {
    return await store.recent(path, label, RECENT_BYTES_WIDE, RECENT_MESSAGES);
  } catch {
    return first;
  }
}
