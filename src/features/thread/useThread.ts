import { useCallback, useEffect, useRef, useState } from 'react';

import { backoffDelay } from '@/lib/poll';
import { usePollGate } from '../usePollGate';
import { useReportPresence } from './useReportPresence';
import { useSettings } from '@/state/settings';
import type * as SQLite from 'expo-sqlite';

import type { HerdrClient } from '@/lib/herdr/client';
import { HerdrError } from '@/lib/herdr/protocol';
import { hasSessionId, sessionSignature, type AgentInfo, type AgentStatus } from '@/lib/herdr/models';
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
 * How long a tail may produce nothing while its agent is WORKING before it is
 * assumed dead and restarted.
 *
 * Generous on purpose. A working agent can genuinely go quiet for a while — a
 * long build, a slow test run, one tool call that takes a minute — and the cost
 * of waiting is a late restart, while the cost of firing early is a stream
 * needlessly torn down and re-established over SSH.
 */
const TAIL_SILENCE_MS = 90_000;
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
const BLOCKED_PENDING_ERROR = 'The reply may not have landed — check the agent.';

export interface ThreadState {
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
  /** Stop the working agent. `hard` sends Ctrl-C and may end the session. */
  interrupt: (hard?: boolean) => Promise<void>;
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
  const [blockedPending, setBlockedPending] = useState<BlockedPending | null>(null);
  // Mirrors the state for the poll closure and for the synchronous double-tap
  // guard in sendKeys — a second tap can land before React re-renders.
  const blockedPendingRef = useRef<BlockedPending | null>(null);
  const blockedPendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sessionMeta, setSessionMeta] = useState<SessionMeta | null>(null);
  const [livePreview, setLivePreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedStart, setReachedStart] = useState(false);
  const [sessionState, setSessionState] = useState<'ok' | 'waiting' | 'missing'>('ok');
  const noSessionPolls = useRef(0);
  const polling = usePollGate();
  // The user's own battery/data tradeoff, applied on top of each screen's rate.
  const pollScale = useSettings((state) => state.pollScale);
  /** Consecutive failed polls, for the backoff. Reset by any success. */
  const failures = useRef(0);
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
  /**
   * When each tail last produced anything, so the poll can tell a wedged stream
   * from a quiet agent. See `TAIL_SILENCE_MS`.
   */
  const tailBeats = useRef(new Map<string, number>());
  /** The header is seeded from disk once per bound session; the tail does the rest. */
  const metaSeeded = useRef(false);
  const alive = useRef(true);

  /**
   * Fold one assistant line's metadata into the header.
   *
   * Merged rather than replaced: a turn can report a model with no usage yet, or
   * usage on a line whose model field is absent, and blanking the other half
   * each time would make the header flicker between complete and half-empty.
   */
  const applyMeta = useCallback((next: SessionMeta) => {
    setSessionMeta((prev) => ({
      model: next.model ?? prev?.model ?? null,
      contextTokens: next.contextTokens ?? prev?.contextTokens ?? null,
    }));
  }, []);

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
    olderSource.current = null;
    setReachedStart(false);
    seen.current = new Set();
    setMessages([]);
    setFailedIds(new Set());
    // A different session means a different model and a different context; the
    // old header would otherwise persist over the new conversation.
    metaSeeded.current = false;
    setSessionMeta(null);
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
      const path = store.sessionTranscriptPath(home, agent.cwd, sessionId);
      if (path === null || !alive.current) return;

      // One probe, and it answers two different questions.
      //
      // `absent` is expected: herdr reports a session id a moment before Claude
      // creates the file, so returning and letting the next poll retry is
      // correct and should be silent.
      //
      // `unknown` is not expected — a permission problem, or the transport
      // failing. It used to arrive as the same `-1` as `absent` and put the
      // thread into a quiet wait for a file that was already there. It gets
      // said out loud now.
      //
      // Previously this measured the file twice: once to test existence and
      // again for the resume arithmetic below. Same answer, two round-trips.
      const probe = await store.fileProbe(path);
      if (!alive.current) return;
      if (probe.kind === 'absent') return;
      if (probe.kind === 'unknown') {
        setError(`Couldn't read this chat's transcript on the host: ${probe.reason}`);
        return;
      }
      const size = probe.bytes;

      const controller = new AbortController();
      tails.current.set(sessionId, controller);
      // Starting counts as a beat, so a tail that never yields a single line is
      // still measured from when it began rather than from never.
      tailBeats.current.set(sessionId, Date.now());

      const sig = boundSig.current ?? sessionSignature([agent]) ?? 'unknown';
      const cached = await tailCursor(db, connectionId, workspaceId, path);
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

      // Seed the header once. The tail keeps it current from here, but a thread
      // resuming from its cached cursor can sit for minutes before the agent
      // next speaks, and a blank model line for that long reads as broken.
      // `prev ?? seeded` because this read raced the tail the moment it started:
      // if a live line already answered the question, it is the newer answer.
      if (!metaSeeded.current) {
        metaSeeded.current = true;
        void store
          .sessionMeta(path)
          .then((seeded) => {
            if (seeded !== null && alive.current) setSessionMeta((prev) => prev ?? seeded);
          })
          .catch(() => {
            /* the header simply stays blank until the agent's next turn */
          });
      }

      void (async () => {
        try {
          for await (const chunk of store.tail(path, label, followFrom)) {
            if (controller.signal.aborted || !alive.current) break;
            tailBeats.current.set(sessionId, Date.now());
            if (chunk.meta !== null) applyMeta(chunk.meta);
            if (chunk.message !== null) await ingest([chunk.message], sig);
            await setTailCursor(db, connectionId, workspaceId, path, chunk.consumedBytes);
          }
        } catch {
          // The tail died (host slept, network moved). The status poll notices
          // the missing tail and restarts it.
        } finally {
          tails.current.delete(sessionId);
          tailBeats.current.delete(sessionId);
        }
      })();
    },
    [client, db, connectionId, workspaceId, ingest, applyMeta]
  );

  // Status poll, which doubles as the tail watchdog.
  useEffect(() => {
    // Backgrounded: iOS suspends these timers anyway, but the socket usually
    // dies with them, so the honest thing is to stop and re-poll immediately on
    // resume — which is what remounting this effect does.
    if (client === null || !polling) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

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
          tailBeats.current.clear();
          if (await rebind(db, connectionId, workspaceId, sig)) resetHistory();
          boundSig.current = sig;
        }

        for (const agent of conversational) {
          // A tail that dies takes the whole live view with it silently. Route
          // it into the same banner as everything else instead of an unhandled
          // rejection nobody sees on a phone.
          void startTail(agent, conversational.length > 1).catch((thrown: unknown) => {
            setError(thrown instanceof HerdrError ? thrown.message : String(thrown));
          });
        }

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
        // to the timer in sendKeys, because this same poll iteration ends in
        // `setError(null)` and would wipe a banner raised from inside it.
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

        const primary = live.find((a) => a.focused) ?? live.find((a) => a.agent !== null) ?? live[0];
        const working = live.some((agent) => agent.agentStatus === 'working');
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
          that dies WITHOUT throwing — a half-open TCP after the host sleeps or
          the phone changes network — therefore leaves the entry in place
          forever, and the restart the catch block promises can never happen.
          The thread just stops receiving messages and looks idle.

          Silence on its own proves nothing: a quiet agent writes no transcript
          lines for hours, legitimately. Silence *while working* does, because a
          working agent is by definition appending turns. A false positive costs
          one restarted tail, which resumes from the persisted cursor and dedupes
          whatever it re-reads — so the check is allowed to be wrong.
        */
        if (working) {
          const now = Date.now();
          for (const agent of conversational) {
            const id = hasSessionId(agent) ? (agent.agentSession?.value ?? null) : null;
            if (id === null || !tails.current.has(id)) continue;
            const beat = tailBeats.current.get(id) ?? now;
            if (now - beat < TAIL_SILENCE_MS) continue;
            tails.current.get(id)?.abort();
            tails.current.delete(id);
            tailBeats.current.delete(id);
          }
        }
        setError(null);
        failures.current = 0;
      } catch (thrown) {
        if (!alive.current) return;
        failures.current += 1;
        setError(thrown instanceof HerdrError ? thrown.message : String(thrown));
      } finally {
        // The banner stays up throughout: backing off must never read as
        // recovery. Only the interval changes.
        if (alive.current) {
          timer = setTimeout(() => void poll(), backoffDelay(STATUS_POLL_MS * pollScale, failures.current));
        }
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
  }, [client, db, connectionId, workspaceId, startTail, resetHistory, clearBlockedPending, polling, pollScale]);

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
   * be two seconds old. A pane id that has changed in that window — an agent
   * restarted, a layout redrawn — sends the message somewhere it will not be
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
   * case the blind Enter was written to guess at — observed by the process that
   * owns the terminal, rather than inferred here from a fixed sleep.
   *
   * So on a modern host there are two outcomes and neither needs us to guess:
   * `delivered` returns immediately, `stalled` fails the bubble honestly.
   *
   * `unverified` is the legacy path, for hosts with no `agent prompt`. There
   * `pane run` only means keystrokes were sent, so the old dance survives —
   * including the blind second Enter, which is unsafe in principle (if the first
   * send DID land it submits an empty line into a live agent) but is also the
   * only thing that recovers a stuck composer on a host with no alternative.
   *
   * `wasWorking` still guards all of it, and herdr's own caveat is why: --wait
   * "does not track turns: if the agent is already working, that active turn's
   * completion may match." Sending into a busy agent just queues, so there is
   * nothing to wait for and waiting would match the wrong turn.
   */
  const deliver = useCallback(
    async (text: string, echoId: string, polled: AgentInfo) => {
      if (client === null) return;
      setIsSending(true);
      try {
        const pane = await currentPane(polled);
        const wasWorking = pane.agentStatus === 'working';
        const outcome = await client.sendPrompt(pane.paneId, text);

        if (outcome === 'stalled') {
          // The host watched and nothing moved. No guessing, no second Enter.
          setFailedIds((previous) => new Set(previous).add(echoId));
          setError('The agent never picked that up — it may be stuck at a prompt. Try again.');
          return;
        }

        if (outcome === 'unverified' && !wasWorking) {
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
    [client, currentPane]
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

  /**
   * Answer a blocked prompt (or poke the primary pane).
   *
   * When the target is a blocked agent, the reply is marked pending BEFORE it
   * is sent, and stays pending until a poll observes the agent act on it. The
   * poll is what removes the bar, and at the slowest setting it runs every ten
   * seconds — without the pending state that whole window accepts a second tap,
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
        blockedPendingTimer.current = setTimeout(() => {
          if (!alive.current || blockedPendingRef.current !== pending) return;
          clearBlockedPending();
          setError(BLOCKED_PENDING_ERROR);
        }, blockedPendingTimeout(STATUS_POLL_MS * pollScale));
      }

      try {
        await client.sendKeys(pane.paneId, keys);
      } catch (thrown) {
        // The keys never left the phone; nothing is pending on the host.
        clearBlockedPending();
        setError(thrown instanceof HerdrError ? thrown.message : String(thrown));
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
        setError(thrown instanceof HerdrError ? thrown.message : String(thrown));
      }
    },
    [client, agents, primaryPane]
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
    blockedPending,
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
    interrupt,
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
