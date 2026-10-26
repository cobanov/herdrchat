import { useCallback, useRef, useState, type RefObject } from 'react';
import type * as SQLite from 'expo-sqlite';

import { batcher } from '@/lib/batcher';
import { agentSpec } from '@/lib/herdr/agents';
import type { HerdrClient } from '@/lib/herdr/client';
import { hasSessionReference, isPiFamily, sessionSignature, type AgentInfo } from '@/lib/herdr/models';
import { errorText, HerdrError } from '@/lib/herdr/protocol';
import type { ThreadWindow } from '@/lib/threadWindow';
import type { ChatMessage } from '@/lib/transcript/message';
import type { SessionMeta } from '@/lib/transcript/sessionMeta';
import { TranscriptStore } from '@/lib/transcript/store';
import { replaceMessages, setTailCursor, tailCursor } from '@/state/threadCache';

import type { OlderSource } from './useThreadHistory';

/**
 * Transcript lines a thread opens with, about a hundred messages.
 *
 * Lines rather than bytes: a picture Claude reads is a line of up to a
 * megabyte, so a byte window opened a screenshot-heavy session on a dozen rows.
 * The host strips the picture data, so this is a few hundred kilobytes on the
 * wire. Older history is a scroll away.
 */
const RECENT_LINES = 300;
/**
 * On resume, the tail re-reads the line at the stored cursor: a disconnect can
 * leave the cursor mid-line, and re-reading the boundary line in full costs
 * nothing (dedupe drops what we've seen) while losing it costs a message. The
 * host says where that line starts (#109). A blind rewind by a byte count could
 * land inside a multi-byte character, and the lossy decode of that fragment
 * pushed the cursor a few bytes past where it really was. This fixed rewind is
 * only the fallback when the host cannot be asked.
 */
const RESUME_REWIND = 4096;
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
/** How far past its cursor a reopened chat catches up through the tail rather than a fresh window. */
const CATCH_UP_BYTES = 64 * 1024;
/** How long a burst of tail lines gathers before it is written and shown. */
const TAIL_BATCH_MS = 100;
/** First and longest wait before looking again for a sibling's absent transcript. */
const ABSENT_RETRY_MS = 5_000;
const ABSENT_RETRY_MAX_MS = 60_000;

interface Options {
  client: HerdrClient | null;
  db: SQLite.SQLiteDatabase;
  connectionId: string;
  cacheKey: string;
  aliveRef: RefObject<boolean>;
  boundSigRef: RefObject<string | null>;
  kickRef: RefObject<() => void>;
  shown: ThreadWindow;
  ingest: (incoming: readonly ChatMessage[], sig: string) => Promise<void>;
  showEnd: (latest: ChatMessage[]) => void;
  anchorOlder: (source: OlderSource) => void;
  setLoading: (loading: boolean) => void;
}

/**
 * The live transcript streams of a thread's agents: one tail per session,
 * opened on a bounded window, resumed from the cursor saved on disk, and
 * restarted when one fails or goes quiet while its agent works. Also the
 * header's model, effort and context, which the same lines carry.
 */
export function useTranscriptTails({
  client, db, connectionId, cacheKey, aliveRef, boundSigRef, kickRef, shown, ingest, showEnd, anchorOlder, setLoading,
}: Options) {
  const [sessionMetadata, setSessionMetadata] = useState<Record<string, SessionMeta>>({});
  const [transcriptPaths, setTranscriptPaths] = useState<string[]>([]);
  /*
    Tail failures need their own error slot, because the poll's success path
    ends in `setPollError(null)` and a tail that rejected earlier in the SAME
    iteration was wiped by it a few hundred milliseconds after appearing.

    `startTails` is fired without await, and its first host call starts ahead
    of the poll's own `paneVisible` calls (each runs on a channel of its own,
    side by side), so its rejection lands first almost every time. And when no
    agent is blocked and none is working, the poll has no awaits left at all
    between the two, so the clear follows immediately.

    Whether it was visible therefore depended on what the agents happened to be
    doing, which is why this read as "the banner flickers" rather than as a bug.
    The poll clears only what the poll raised.
  */
  const [tailError, setTailError] = useState<string | null>(null);
  const tails = useRef(new Map<string, AbortController>());
  /**
   * When each tail last produced anything, so the poll can tell a wedged stream
   * from a quiet agent. See `TAIL_SILENCE_MS`.
   */
  const tailBeats = useRef(new Map<string, number>());
  /**
   * Tail failures in a row per session, cleared by anything the tail reads.
   * The first is nearly always the phone sleeping and taking the stream with
   * it, so it restarts quietly; only a restart that fails too is shown.
   */
  const tailFailures = useRef(new Map<string, number>());
  /** Agents whose transcript file was absent, and when to look again (#99). */
  const absentRetry = useRef(new Map<string, { at: number; delay: number }>());
  /** The header is seeded from disk once per bound session; the tail does the rest. */
  const metaSeeded = useRef(new Set<string>());

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
        effort: key.startsWith('pi:') || key.startsWith('omp:')
          ? next.effort !== undefined ? next.effort : prev[key]?.effort
          : next.model !== null ? next.effort ?? null : prev[key]?.effort ?? null,
        contextTokens: next.contextTokens ?? prev[key]?.contextTokens ?? null,
      },
    }));
  }, []);

  /** Stop every tail, without forgetting how each was doing: the screen is going away. */
  const abortTails = useCallback(() => {
    for (const controller of tails.current.values()) controller.abort();
    tails.current.clear();
  }, []);

  /** Stop every tail and start the next from nothing: another session, or a reload. */
  const stopTails = useCallback(() => {
    abortTails();
    tailBeats.current.clear();
    tailFailures.current.clear();
  }, [abortTails]);

  /** A different session means a different model and context; the old header would persist over it. */
  const resetMeta = useCallback(() => {
    metaSeeded.current.clear();
    setSessionMetadata({});
  }, []);

  const startTails = useCallback(async (live: readonly AgentInfo[]) => {
    if (client === null || boundSigRef.current === null) return;
    const identified = live.filter(hasSessionReference);
    if (identified.length === 0) return;
    /*
      An agent whose transcript file does not exist yet has no tail, and a
      missing tail restarts every sibling (below). While a healthy sibling was
      streaming, that aborted and re-opened its SSH tail on every poll, for as
      long as the other file stayed absent (#99). So with something live, an
      absent file is retried on a backoff instead; with nothing live there is
      nothing to disturb, and it is retried every poll so a new chat's first
      messages are not delayed.
    */
    const now = Date.now();
    const someLive = identified.some(agent => tails.current.has(sessionSignature([agent])!));
    const settled = identified.every(agent => {
      const key = sessionSignature([agent])!;
      if (tails.current.has(key)) return true;
      const retry = absentRetry.current.get(key);
      return someLive && retry !== undefined && now < retry.at;
    });
    if (settled) return;

    // One opening snapshot for the whole workspace. Reserving every native
    // session before awaiting also prevents an event from starting it twice.
    // Restart siblings together when one stream dies, so two agents never
    // replace each other's half of the cached window.
    abortTails();
    const controller = new AbortController();
    const sig = boundSigRef.current;
    const current = () => aliveRef.current && !controller.signal.aborted && sig === boundSigRef.current;
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
          let path = await store.transcriptPath(agent);
          if (path === null) throw new HerdrError('session_invalid', agentSpec(agent.agent)?.missing ?? 'The agent reported an invalid session id. Resume the session on the host, then reload.');
          let probe = await store.fileProbe(path);
          if (probe.kind === 'absent' && agent.agent === 'claude') {
            // Not under the folder the pane's cwd names. The same session id may
            // be filed under a worktree's folder instead (#89).
            const found = await store.findClaudeTranscript(id);
            if (found !== null && found !== path) {
              path = found;
              probe = await store.fileProbe(path);
            }
          }
          if (probe.kind === 'absent') {
            store.forgetTranscript(agent);
            const previous = absentRetry.current.get(key);
            const delay = Math.min((previous?.delay ?? ABSENT_RETRY_MS / 2) * 2, ABSENT_RETRY_MAX_MS);
            absentRetry.current.set(key, { at: Date.now() + delay, delay });
            release(key);
            return null; // A new agent can receive its first prompt before writing a file.
          }
          if (probe.kind === 'unknown') throw new HerdrError('transcript_unreadable', `Couldn't read this chat's transcript on the host: ${probe.reason}`);
          if (isPiFamily(agent.agent)) await store.verifyOmpTranscript(path, agent.agentSession!.kind === 'id' ? id : null);
          absentRetry.current.delete(key);
          const cached = await tailCursor(db, connectionId, cacheKey, path);
          return { key, path, label, agent: agent.agent, size: probe.bytes, cached };
        } catch (thrown) {
          release(sessionSignature([agent])!);
          openingError = errorText(thrown);
          return null;
        }
      }))).filter(source => source !== null);
      if (!current()) return;
      const claudePaths = sources.filter(source => source.agent === 'claude').map(source => source.path);
      setTranscriptPaths(previous => previous.join('\n') === claudePaths.join('\n') ? previous : claudePaths);

      // A cursor is a live-stream checkpoint, not a history-loading strategy: a
      // backlog is read as one bounded window (#66, an 11 MB gap took minutes
      // to replay line by line). A few lines past the cursor, a reply or two
      // since the chat was last open, are the exception: the tail streams them
      // from the cursor, where the window re-read 300 lines and replaced the
      // cache. An unchanged file uses the cache as it is.
      const smallGap = (source: { cached: number | null; size: number }) =>
        source.cached !== null && source.cached < source.size && source.size - source.cached <= CATCH_UP_BYTES;
      // Each tail files its backlog in arrival order and only the window sorts
      // by time, so the catch-up is for one source with news, never two.
      const behind = sources.filter(source => source.cached !== source.size);
      const changed = shown.isEmpty || behind.length > 1 || behind.some(source => !smallGap(source));
      const windows = await Promise.all(sources.map(async source => ({
        ...source,
        recent: changed ? await loadRecent(store, source.path, source.label, source.size) : null,
      })));
      if (!current()) return;
      if (changed && windows.length > 0) {
        const latest = windows.flatMap(window => window.recent?.messages ?? []);
        // A single transcript keeps host order even without timestamps.
        if (windows.length > 1) latest.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
        await replaceMessages(db, connectionId, cacheKey, sig, latest);
        if (!current()) return;
        showEnd(latest);
      }

      setTailError(openingError);
      for (const source of windows) {
        const followFrom = source.recent?.consumedBytes ?? await resumePoint(store, source.path, source.cached!);
        if (source.recent !== null) {
          await setTailCursor(db, connectionId, cacheKey, source.path, followFrom);
        }
        if (!current()) return;
        anchorOlder({
          path: source.path,
          label: source.label,
          anchor: source.recent?.startByte ?? source.cached!,
          codexBase: source.agent === 'codex',
        });
        if (!metaSeeded.current.has(source.key)) {
          metaSeeded.current.add(source.key);
          void store.sessionMeta(source.path, source.agent).then(seeded => {
            if (seeded !== null && current()) setSessionMetadata(prev => ({
              ...prev,
              [source.key]: {
                model: prev[source.key]?.model ?? seeded.model,
                effort: isPiFamily(source.agent)
                  ? prev[source.key]?.effort !== undefined ? prev[source.key]?.effort : seeded.effort
                  : prev[source.key]?.model != null ? prev[source.key]?.effort : seeded.effort,
                contextTokens: prev[source.key]?.contextTokens ?? seeded.contextTokens,
              },
            }));
          }).catch(() => { /* The next live turn can fill the header. */ });
        }
        tailBeats.current.set(source.key, Date.now());
        void (async () => {
          let restartNow = false;
          // Lines arrive in bursts (a call, its result, the reply), and each
          // one was a transaction, a cursor write and a rebuild of the whole
          // list. A burst is one of each now, messages before the cursor.
          const written = batcher<{ message: ChatMessage | null; consumed: number }>(async (chunks) => {
            // An aborted tail's drain can run while the poll awaits `rebind`, when
            // `ingest` still sees the old session bound. The cursor stays, so a
            // restarted tail reads these lines again.
            if (!current()) return;
            const messages = chunks.flatMap((chunk) => (chunk.message === null ? [] : [chunk.message]));
            if (messages.length > 0) await ingest(messages, sig);
            const last = chunks[chunks.length - 1];
            if (current() && last !== undefined) await setTailCursor(db, connectionId, cacheKey, source.path, last.consumed);
          }, TAIL_BATCH_MS);
          try {
            for await (const chunk of store.tail(source.path, source.label, followFrom, controller.signal)) {
              if (!current()) break;
              if (written.failure !== undefined) throw written.failure;
              tailBeats.current.set(source.key, Date.now());
              tailFailures.current.delete(source.key);
              if (chunk.meta !== null) applyMeta(source.key, chunk.meta);
              written.push({ message: chunk.message, consumed: chunk.consumedBytes });
            }
            await written.drain();
            if (written.failure !== undefined) throw written.failure;
          } catch (thrown) {
            if (current()) {
              const failures = (tailFailures.current.get(source.key) ?? 0) + 1;
              tailFailures.current.set(source.key, failures);
              // With live events the poll that restarts a tail runs every 30 s,
              // so the thread sat behind this banner for that long after every
              // return from the background. Restart at once instead, and only
              // say something when that restart fails as well.
              if (failures === 1) restartNow = true;
              else setTailError(`Conversation updates paused. Reconnecting. ${errorText(thrown)}`);
            }
          } finally {
            release(source.key);
            // After the release, or the poll would still find this tail running.
            if (restartNow) kickRef.current();
          }
        })();
      }
      if (current()) {
        setLoading(false);
      }
    } catch (thrown) {
      if (current()) {
        setLoading(false);
        setTailError(errorText(thrown));
        // Keep the last readable cache, and retry the bounded snapshot. Never
        // fall back to tailing from byte zero on a failed bulk read.
        controller.abort();
        for (const agent of identified) release(sessionSignature([agent])!);
      }
    }
  }, [client, db, connectionId, cacheKey, ingest, applyMeta, abortTails, showEnd, anchorOlder, shown, setLoading, aliveRef, boundSigRef, kickRef]);

  /*
    Tail watchdog, run by the poll while an agent works.

    `startTails` returns early for a session already in `tails`, and that
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
  const dropSilentTails = useCallback((conversational: readonly AgentInfo[]) => {
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
  }, []);

  return {
    sessionMetadata,
    transcriptPaths,
    tailError,
    setTailError,
    startTails,
    abortTails,
    stopTails,
    resetMeta,
    dropSilentTails,
  };
}

/** Where a tail resuming from `cursor` starts: the start of the line there. */
async function resumePoint(store: TranscriptStore, path: string, cursor: number): Promise<number> {
  try {
    return await store.lineStartBefore(path, cursor);
  } catch {
    return Math.max(0, cursor - RESUME_REWIND);
  }
}

/** The up-front history read, frozen at the size the probe measured. */
function loadRecent(
  store: TranscriptStore,
  path: string,
  label: string | null,
  size: number
): Promise<{
  messages: ChatMessage[];
  consumedBytes: number;
  startByte: number;
}> {
  return store.recent(path, label, RECENT_LINES, size);
}
