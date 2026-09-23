import { exitCodeError } from '../herdr/client';
import { HerdrError } from '../herdr/protocol';
import { shellQuote, withPath } from '../herdr/shell';
import { POLL_TIMEOUT_MS, STREAM_START_TIMEOUT_MS, TRANSCRIPT_TIMEOUT_MS } from '../herdr/timeouts';
import type { HerdrTransport } from '../herdr/transport';
import type { ChatMessage } from './message';
import { displayText, isToolOnly } from './message';
import {
  assistantMeta,
  parseTranscript,
  parseTranscriptEntry,
  projectDirName,
} from './parser';
import type { SessionMeta } from './sessionMeta';

/**
 * Reads Claude Code transcripts on the herdr host so chat threads show clean
 * message bubbles instead of the raw TUI buffer.
 *
 * Given a pane's cwd it finds the session `.jsonl` under
 * `~/.claude/projects/<escaped-cwd>/` and either loads a bounded recent window
 * or follows it live.
 *
 * Behaviour ported from the original SwiftUI implementation (see git
 * history before the Expo rewrite).
 */
/**
 * `$HOME` per transport, rather than per `TranscriptStore`.
 *
 * The cache used to be an instance field, and no instance ever lived long
 * enough to use it: `startTail` builds a fresh store on every invocation and
 * `useWorkspaces.refresh` builds one on a three-second poll, so each started
 * with an empty cache and paid the same `printf %s "$HOME"` round-trip the
 * comment claimed it had avoided.
 *
 * The transport is the right key because it IS the connection — same SSH user,
 * same machine, and a home directory does not move underneath one. A WeakMap
 * because invalidating a client discards its transport, and the stale entry
 * should go with it rather than be remembered for a connection that no longer
 * exists.
 */
const homeByTransport = new WeakMap<HerdrTransport, Promise<string>>();
const codexPathsByTransport = new WeakMap<HerdrTransport, Map<string, Promise<string | null>>>();

export class TranscriptStore {
  private readonly transport: HerdrTransport;

  constructor(transport: HerdrTransport) {
    this.transport = transport;
  }

  /**
   * The host user's home directory. Stored transcript paths must be absolute so
   * shell quoting stays safe.
   *
   * Cached against the transport — see `homeByTransport`.
   */
  async homeDirectory(): Promise<string> {
    const cached = homeByTransport.get(this.transport);
    if (cached !== undefined) return cached;

    // The PROMISE is cached, not the string it resolves to. `startTail` runs
    // once per conversational agent and they start together, so caching only the
    // result still let every one of them issue its own round-trip before the
    // first came back — the misses all happen before the first hit.
    const pending = this.readHomeDirectory();
    homeByTransport.set(this.transport, pending);
    // A failure must not become the answer for the life of the connection. The
    // host may simply have been busy; drop it so the next caller tries again.
    void pending.catch(() => homeByTransport.delete(this.transport));
    return pending;
  }

  private async readHomeDirectory(): Promise<string> {
    const home = (await this.shell('printf %s "$HOME"', POLL_TIMEOUT_MS)).trim();
    // No usable answer is a failure, not a value. "~" was returned here once,
    // and every path built from it went through `shellQuote` downstream, so the
    // host looked for a directory literally named "~" and every read failed
    // somewhere far from the cause.
    if (home.length === 0) {
      throw new HerdrError('home_unknown', "The host didn't say where the home directory is.");
    }
    return home;
  }

  /**
   * Exact transcript path for a known agent session id — the authoritative
   * target, since herdr's `agent_session.value` IS the transcript filename for
   * Claude Code.
   *
   * Returns null for an id that isn't obviously inert, so it can never widen
   * into a path traversal or a shell injection.
   */
  sessionTranscriptPath(home: string, cwd: string, sessionId: string): string | null {
    if (sessionId.length === 0 || !/^[A-Za-z0-9-]+$/.test(sessionId)) return null;
    return `${home}/.claude/projects/${projectDirName(cwd)}/${sessionId}.jsonl`;
  }

  /** Codex's filename contains a timestamp as well as its native session id.
   * Search ONLY for that id, then verify session_meta before reading history.
   * Never use cwd, recency, or a matching chat title to infer the owning session.
   */
  async codexTranscriptPath(sessionId: string): Promise<string | null> {
    if (!/^[A-Za-z0-9-]+$/.test(sessionId)) return null;
    let paths = codexPathsByTransport.get(this.transport);
    if (paths === undefined) {
      paths = new Map();
      codexPathsByTransport.set(this.transport, paths);
    }
    const cached = paths.get(sessionId);
    if (cached !== undefined) return cached;
    const pending = this.findCodexTranscript(sessionId);
    paths.set(sessionId, pending);
    const forget = () => { if (paths.get(sessionId) === pending) paths.delete(sessionId); };
    // Missing files and failed reads must be retried when the next event arrives.
    void pending.then(path => { if (path === null) forget(); }, forget);
    return pending;
  }

  forgetCodexTranscript(sessionId: string): void {
    codexPathsByTransport.get(this.transport)?.delete(sessionId);
  }

  private async findCodexTranscript(sessionId: string): Promise<string | null> {
    const output = await this.shell(
      'codex_root="${CODEX_HOME:-$HOME/.codex}"; ' +
      'for codex_dir in "$codex_root/sessions" "$codex_root/archived_sessions"; do ' +
      'if [ -d "$codex_dir" ]; then ' +
      `find "$codex_dir" -type f -name ${shellQuote(`rollout-*-${sessionId}.jsonl`)} || exit $?; ` +
      'fi; done'
    );
    const paths = output.split('\n').filter(path => path.length > 0);
    if (paths.length === 0) return null;
    if (paths.length !== 1) {
      throw new HerdrError('codex_session_ambiguous',
        'More than one Codex transcript has this session id. Nothing was opened. Check the duplicate session files on the host.');
    }
    const path = paths[0];
    if (path === undefined || !path.startsWith('/') || !path.endsWith(`-${sessionId}.jsonl`) || path.includes('\0')) {
      throw new HerdrError('codex_session_invalid', 'The host returned an invalid Codex transcript path.');
    }
    const header = await this.shell(`head -n 1 ${shellQuote(path)}`);
    let valid = false;
    try {
      const raw: unknown = JSON.parse(header);
      if (typeof raw === 'object' && raw !== null && 'type' in raw && raw.type === 'session_meta' &&
          'payload' in raw && typeof raw.payload === 'object' && raw.payload !== null &&
          'id' in raw.payload && raw.payload.id === sessionId) valid = true;
    } catch { /* A partially written header can be retried on the next refresh. */ }
    if (!valid) {
      throw new HerdrError('codex_session_mismatch',
        'This Codex file does not confirm the expected session id. Nothing was opened. Retry after the agent has finished starting.');
    }
    return path;
  }

  // There is deliberately no `newestTranscriptPath` here. Picking the newest
  // .jsonl in a project dir is the one shortcut this file must never offer:
  // every chat sharing a working directory shares that dir, so the newest file
  // belongs to whichever conversation was touched last, not to the one being
  // opened. Callers wait for the session id instead — see `sessionTranscriptPath`.

  /**
   * How big a transcript is, or why we don't know.
   *
   * Three answers, not two. This used to return `-1` for both "no such file"
   * and "the read failed", with `2>/dev/null` throwing away the only thing that
   * could tell them apart — so a transport hiccup was indistinguishable from a
   * session whose file hasn't appeared yet, and the caller waited quietly for a
   * file that was already there.
   *
   * `absent` is normal and expected: herdr reports a session id a moment before
   * Claude creates the file. `unknown` is not, and the caller is expected to say
   * so rather than retry in silence.
   */
  async fileProbe(path: string): Promise<FileProbe> {
    const quoted = shellQuote(path);
    const slash = path.lastIndexOf('/');
    const folder = shellQuote(slash > 0 ? path.slice(0, slash) : '.');
    /*
      The shell ANSWERS these questions; we do not read its mind. Matching
      /no such file|not found/ against stderr was the first version, and stderr
      is in whatever language the host is configured in — on a non-English host
      every freshly created session read `unknown` and the caller reported a
      broken transcript instead of waiting a beat.

      `[ -f ]` alone was the second, and it conflated from the other side: it is
      also false when the path cannot be stat'ed at all, so a directory this SSH
      user cannot search — a transcript owned by another user, a tightened
      ~/.claude — reported `absent`. `absent` is the silent branch, so the thread
      waited for a file it was never going to be allowed to see, and said
      nothing, forever.

      Four questions instead, in the order the kernel asks them. Note `-x` and
      not `-r` on the folder: stat'ing a file needs SEARCH permission on every
      directory above it, and a directory can be perfectly listable while its
      contents cannot be reached.
    */
    const result = await this.transport.exec(
      withPath(
        `[ -d ${folder} ] || exit ${ABSENT_EXIT};` +
          ` [ -x ${folder} ] || exit ${UNSEARCHABLE_EXIT};` +
          ` [ -e ${quoted} ] || exit ${ABSENT_EXIT};` +
          ` [ -r ${quoted} ] || exit ${UNREADABLE_EXIT};` +
          ` wc -c < ${quoted}`
      ),
      POLL_TIMEOUT_MS
    );
    if (!result.ok) return { kind: 'unknown', reason: result.message };

    // A missing project directory is `absent` too, and for the same reason the
    // missing file is: Claude creates it when the session starts writing.
    if (result.exitCode === ABSENT_EXIT) return { kind: 'absent' };
    if (result.exitCode === UNSEARCHABLE_EXIT) {
      return {
        kind: 'unknown',
        reason: "this SSH user can't open the folder the transcript is in",
      };
    }
    if (result.exitCode === UNREADABLE_EXIT) {
      return { kind: 'unknown', reason: "the transcript is there but this SSH user can't read it" };
    }
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim().split('\n')[0] ?? '';
      return { kind: 'unknown', reason: detail.length > 0 ? detail : `wc exited ${result.exitCode}` };
    }

    const bytes = Number.parseInt(result.stdout.trim(), 10);
    return Number.isNaN(bytes)
      ? { kind: 'unknown', reason: `couldn't read a size from "${result.stdout.trim().slice(0, 60)}"` }
      : { kind: 'size', bytes };
  }

  /** The size, or a throw. For callers that cannot proceed without one. */
  private async sizeOrThrow(path: string): Promise<number> {
    const probe = await this.fileProbe(path);
    if (probe.kind === 'size') return probe.bytes;
    throw new HerdrError(
      probe.kind === 'absent' ? 'transcript_absent' : 'transcript_unreadable',
      probe.kind === 'absent'
        ? "The transcript file isn't there yet."
        : `Couldn't measure the transcript: ${probe.reason}`
    );
  }

  /**
   * Bulk-load only the most recent slice of a transcript in one read, instead of
   * streaming a possibly multi-megabyte file line by line. Returns the parsed
   * bubbles plus the byte offset consumed, so the live tail can follow from
   * exactly there.
   *
   * Two independent limits, because bytes are a poor proxy for conversation
   * length in either direction: one turn can be megabytes (image tool-results
   * embed base64), and a megabyte can hold thousands of terse turns. `maxBytes`
   * bounds the transfer; `maxMessages` bounds what the chat surface has to lay
   * out. Older history stays on disk, untouched.
   */
  async recent(
    path: string,
    agentLabel: string | null,
    maxBytes: number,
    maxMessages?: number
  ): Promise<{ messages: ChatMessage[]; consumedBytes: number; startByte: number }> {
    const size = await this.sizeOrThrow(path);
    const start = size > maxBytes ? size - maxBytes : 0;
    // Freeze the end at the probe: an active agent must not turn this bounded
    // snapshot into an unbounded catch-up read while the command runs.
    const body = await this.shell(`tail -c +${start + 1} ${shellQuote(path)} | head -c ${size - start}`);
    if (byteLength(body) < size - start || body.endsWith('\uFFFD')) {
      // A truncated file or a final half UTF-8 character cannot provide a
      // trustworthy byte boundary. Retry the snapshot, never advance past it.
      throw new HerdrError('transcript_changed', 'The transcript changed during the read. Retrying.');
    }

    const lastNewline = body.lastIndexOf('\n');
    // Leave a partially written final line for the live reader to finish.
    const consumedBytes = lastNewline < 0 ? start : size - byteLength(body.slice(lastNewline + 1));
    let text = body.slice(0, lastNewline + 1);
    // A window that starts mid-file almost always starts mid-line. Drop that
    // fragment explicitly rather than relying on it failing to parse — a
    // truncated line can still decode into a half-formed bubble.
    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      if (firstNewline >= 0) {
        text = text.slice(firstNewline + 1);
      }
    }

    // Count backwards from the known byte boundary. A lossy UTF-8 fragment at
    // the beginning cannot move either cursor past the actual host bytes.
    let startByte = consumedBytes - byteLength(text);
    const messages: ChatMessage[] = [];
    const lines = text.length === 0 ? [] : text.slice(0, -1).split('\n');
    let offset = consumedBytes;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]!;
      offset -= byteLength(line) + 1;
      const message = parseTranscriptEntry(line, agentLabel).message;
      if (message !== null) messages.push(message);
      if (maxMessages !== undefined && messages.length >= maxMessages) {
        // Older paging must include the messages omitted by the display cap.
        startByte = offset;
        break;
      }
    }
    messages.reverse();
    return { messages, consumedBytes, startByte };
  }

  /**
   * The window of history immediately BEFORE `startByte` — what a reader gets
   * by pulling down at the top of a thread.
   *
   * Bounded by bytes only, deliberately. `recent()` also caps messages because
   * it decides how much a freshly-opened thread must lay out; here the reader
   * has explicitly asked for more, and a message cap would force this to report
   * an anchor somewhere inside the window it read. Getting that offset wrong by
   * one line either repeats a message or silently drops one, and bytes are the
   * only thing the host and this file agree on exactly.
   */
  async older(
    path: string,
    agentLabel: string | null,
    beforeByte: number,
    maxBytes: number
  ): Promise<{ messages: ChatMessage[]; startByte: number; reachedStart: boolean }> {
    if (beforeByte <= 0) return { messages: [], startByte: 0, reachedStart: true };

    const start = beforeByte > maxBytes ? beforeByte - maxBytes : 0;
    const length = beforeByte - start;

    // A byte RANGE, not a suffix, so it takes two commands. The pipeline's exit
    // status is `head`'s, which makes `tail` dying of SIGPIPE once head has had
    // its fill invisible — true only while nothing sets `pipefail` in
    // `withPath()`. If that ever changes, this starts returning 141 and every
    // older-history read fails; the same inversion once rejected two good
    // release builds before anyone spotted it.
    const body = await this.readRange(path, start, length);

    let text = body;
    let startByte = start;
    // A window opened mid-file almost always opens mid-line. Drop that fragment
    // and move the anchor past it, so the next page ends exactly where this one
    // begins: leaving the anchor at `start` would serve the partial line again,
    // and advancing it further would lose whatever sits between the two pages.
    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      // The window ends at a line boundary, so its only newline being the last
      // byte means the whole window sits inside one line. Dropping "the
      // fragment" would then drop everything and hand back the same anchor, and
      // paging stopped for good at the first line longer than a page (#81):
      // image results and tool dumps run to megabytes.
      if (firstNewline < 0 || firstNewline === text.length - 1) {
        return this.olderLongLine(path, agentLabel, beforeByte);
      }
      text = text.slice(firstNewline + 1);
      // Counted back from the known end, like `recent()`: a window that opened
      // inside a multi-byte character decodes that fragment lossily, so
      // counting forward from `start` would land a few bytes off.
      startByte = beforeByte - byteLength(text);
    }

    return {
      messages: parseTranscript(text, agentLabel),
      startByte,
      reachedStart: startByte <= 0,
    };
  }

  /**
   * The one line that ends at `beforeByte`, when it is longer than a page.
   *
   * The host finds where it starts (`grep -b` over the prefix prints each line's
   * byte offset; only the last number comes back, never the content). A line
   * up to `OLDER_LINE_MAX_BYTES` is then read whole. A longer one is stepped
   * over: at that size it is base64 or a tool dump, rarely anything a person
   * would read on a phone, and fetching it would cost more than the reader
   * asked for. Either way the anchor moves, so paging continues.
   */
  private async olderLongLine(
    path: string,
    agentLabel: string | null,
    beforeByte: number
  ): Promise<{ messages: ChatMessage[]; startByte: number; reachedStart: boolean }> {
    const output = await this.shell(
      `head -c ${beforeByte} ${shellQuote(path)} | LC_ALL=C grep -a -b '' | cut -d: -f1 | tail -n 1`
    );
    const lineStart = Number.parseInt(output.trim(), 10);
    if (!Number.isInteger(lineStart) || lineStart < 0 || lineStart >= beforeByte) {
      throw new HerdrError('transcript_changed', 'Could not find where that line starts. Retrying.');
    }
    const lineBytes = beforeByte - lineStart;
    const messages =
      lineBytes > OLDER_LINE_MAX_BYTES
        ? []
        : parseTranscript(await this.readRange(path, lineStart, lineBytes), agentLabel);
    return { messages, startByte: lineStart, reachedStart: lineStart <= 0 };
  }

  /**
   * Bytes `[start, start + length)` of a file. A shorter answer means the read
   * was cut off (a dropped channel, a killed command), and a short page would
   * anchor the next one in the wrong place, so it is refused.
   */
  private async readRange(path: string, start: number, length: number): Promise<string> {
    const body = await this.shell(`tail -c +${start + 1} ${shellQuote(path)} | head -c ${length}`);
    if (byteLength(body) < length) {
      throw new HerdrError('transcript_changed', 'The transcript read was cut short. Retrying.');
    }
    return body;
  }

  /**
   * Stream transcript lines from `startByte` to end, then follow appends. Each
   * chunk carries the running byte offset so the caller can persist it and
   * resume later without re-reading.
   *
   * `meta` rides along because this is the only reader that sees every line the
   * moment it lands. The header's model and context size used to come from a
   * separate `tail -c 262144` on a timer — a quarter of a megabyte over SSH
   * every ten seconds, re-reading lines that had already streamed through here
   * and been thrown away. One parse per line now feeds both.
   */
  async *tail(
    path: string,
    agentLabel: string | null,
    startByte: number,
    signal?: AbortSignal
  ): AsyncGenerator<
    { message: ChatMessage | null; meta: SessionMeta | null; consumedBytes: number },
    void,
    void
  > {
    let consumed = startByte;
    const command = withPath(`tail -c +${startByte + 1} -f ${shellQuote(path)}`);
    for await (const line of this.transport.streamLines(command, STREAM_START_TIMEOUT_MS, signal)) {
      consumed += byteLength(line) + 1; // + the newline the framing stripped
      const entry = parseTranscriptEntry(line, agentLabel);
      yield { message: entry.message, meta: entry.meta, consumedBytes: consumed };
    }
  }

  /**
   * Model and context size for the chat header, seeded ONCE when a thread binds
   * its transcript.
   *
   * After that the live tail keeps it current for free, so this must not go on a
   * timer. It exists only because a thread resuming from its cached cursor may
   * not see an assistant line for minutes, and a header that stayed blank until
   * the agent next spoke would look broken.
   *
   * Null when the tail holds no assistant turn with usage yet.
   */
  async sessionMeta(path: string, agent: string | null = null, tailBytes = 262_144): Promise<SessionMeta | null> {
    const text = await this.shell(`tail -c ${tailBytes} ${shellQuote(path)} 2>/dev/null`);
    let model: string | null = null;
    let effort: string | null = null;
    let contextTokens: number | null = null;

    const lines = text.split('\n');
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const meta = assistantMeta(lines[index] ?? '');
      if (meta === null) continue;
      if (model === null && meta.model !== null) {
        model = meta.model;
        effort = meta.effort ?? null;
      }
      if (contextTokens === null) contextTokens = meta.contextTokens;
      if (model !== null && contextTokens !== null) break;
    }

    if (model === null && agent === 'codex') {
      // ponytail: one host-side scan only when a long turn outgrows the tail.
      // Return one context record, not the history. A host metadata index can
      // replace this if very large sessions make the one-off scan expensive.
      const context = await this.shell(
        `awk '/"type"[[:space:]]*:[[:space:]]*"turn_context"/ { latest = $0 } END { print latest }' ${shellQuote(path)}`
      );
      const meta = assistantMeta(context.trim());
      model = meta?.model ?? null;
      effort = meta?.effort ?? null;
    }
    if (model === null && contextTokens === null) return null;
    return { model, effort, contextTokens };
  }

  /**
   * Fetch the tail of every workspace's transcript in ONE round-trip and return
   * the newest displayable message per workspace — the data behind the
   * Messages-style "last message" line in the chat list.
   *
   * Workspaces with no transcript are simply absent from the result.
   */
  async latestMessages(
    requests: readonly PreviewRequest[],
    tailBytes = 48_000
  ): Promise<Map<string, ChatMessage>> {
    // A fresh marker per call. A transcript that happens to contain the literal
    // separator — a chat ABOUT this app writes it verbatim — used to split a
    // block in two and file the tail of one workspace's history under a
    // workspace id read out of the transcript's own text.
    const marker = randomMarker();
    let script = '';
    for (const request of requests) {
      // Ids are interpolated into the script and the marker line, so refuse
      // anything that isn't obviously inert rather than trying to quote it.
      if (!/^[A-Za-z0-9:_-]+$/.test(request.workspaceId)) continue;

      // Exact session file ONLY. Falling back to the newest transcript in the
      // project dir previews a foreign session's last message under a reused or
      // same-named workspace — and two chats opened on one folder share that
      // dir, so the guess is wrong exactly when it looks most plausible. A
      // request without a usable session id is dropped rather than guessed; the
      // row keeps its live status line until the id arrives.
      if (request.sessionId === null || !/^[A-Za-z0-9-]+$/.test(request.sessionId)) continue;
      if (request.agent === 'codex') {
        // One broken Codex session must not suppress every other row's preview.
        const path = await this.codexTranscriptPath(request.sessionId).catch(() => null);
        if (path === null) continue;
        script += `f=${shellQuote(path)}; `;
      } else if (request.agent === undefined || request.agent === 'claude') {
        const dir = projectDirName(request.cwd);
        script += `f="$HOME/.claude/projects/${dir}/${request.sessionId}.jsonl"; `;
      } else continue;
      script += `printf '\\n${marker} %s\\n' '${request.workspaceId}'; `;
      script += `[ -n "$f" ] && tail -c ${tailBytes} "$f" 2>/dev/null; `;
    }
    if (script.length === 0) return new Map();
    script += 'true'; // a workspace without a transcript must not fail the batch

    const text = await this.shell(script);
    const result = new Map<string, ChatMessage>();

    for (const block of text.split(`\n${marker} `).slice(1)) {
      const headerEnd = block.indexOf('\n');
      if (headerEnd < 0) continue;
      const workspaceId = block.slice(0, headerEnd).trim();
      const messages = parseTranscript(block.slice(headerEnd + 1));
      const last = findLast(
        messages,
        (message) => !message.isSidechain && !isToolOnly(message)
      );
      if (last !== undefined) result.set(workspaceId, last);
    }
    return result;
  }

  private async shell(command: string, timeoutMs = TRANSCRIPT_TIMEOUT_MS): Promise<string> {
    const result = await this.transport.exec(withPath(command), timeoutMs);
    if (!result.ok) throw new HerdrError(result.code, result.message, { transport: true });
    // Nothing in this file runs herdr — it runs `sh`, `tail`, `wc` and `head`.
    // The shared exit-code reader blames herdr for a 127, which sends the
    // reader off to install a tool that is already there.
    if (result.exitCode === 127) {
      throw new HerdrError(
        'transcript_tools_missing',
        "The host couldn't run the commands that read a transcript (exit 127). tail, wc and head must be on the PATH a non-interactive SSH session gets."
      );
    }
    if (result.exitCode !== 0) throw exitCodeError(result.exitCode, result.stderr);
    return result.stdout;
  }
}

/**
 * One workspace's "last message" lookup: which transcript to peek at for the
 * chat-list preview.
 */
export interface PreviewRequest {
  workspaceId: string;
  cwd: string;
  /** null when the agent hasn't reported a session id yet. */
  sessionId: string | null;
  /** Legacy callers omit this for Claude. Other providers must opt in. */
  agent?: string;
}

/**
 * The answer to "how big is this transcript".
 *
 * `absent` means the host said the file is not there — normal for a few seconds
 * after a session id arrives, and the branch callers retry in silence. `unknown`
 * means we could not find out, which is a different thing and must be said out
 * loud.
 *
 * Permission failures are `unknown`, not `absent`. Getting that backwards costs
 * the user a thread that waits forever without ever explaining why.
 */
export type FileProbe =
  | { kind: 'size'; bytes: number }
  | { kind: 'absent' }
  | { kind: 'unknown'; reason: string };

/** Collapse a transcript turn into a single-paragraph snippet for the list. */
export function previewText(message: ChatMessage): string | null {
  const collapsed = displayText(message)
    .replaceAll('**', '')
    .replaceAll('__', '')
    .replaceAll('`', '')
    .split(/\s+/)
    .map((word) => (word.startsWith('#') ? word.replace(/^#+/, '') : word))
    .filter((word) => word.length > 0)
    .join(' ');
  return collapsed.length === 0 ? null : collapsed.slice(0, 200);
}

/**
 * The longest single line older history will fetch (4 MiB). The largest seen
 * in practice were a 2.3 MB Claude image result and a 3.9 MB Codex compaction.
 */
const OLDER_LINE_MAX_BYTES = 4 * 1024 * 1024;

const MARKER_PREFIX = '@@HERDRCHAT';

/*
  Exit statuses the size probe uses to answer in a language the host cannot
  localise. Chosen above the 1-125 range a real command would return, and below
  126 where the shell's own "not executable" / "not found" codes live.
*/

/** The file, or the folder that would hold it, is not there yet. Expected. */
const ABSENT_EXIT = 44;
/** The folder exists but this user cannot search it, so nothing can be stat'ed. */
const UNSEARCHABLE_EXIT = 45;
/** The file exists and this user cannot read it. */
const UNREADABLE_EXIT = 46;

/**
 * A separator no transcript can contain by accident. Random per call, so even a
 * conversation that quotes an earlier batch's marker cannot split a block.
 */
function randomMarker(): string {
  const hex = Math.floor(Math.random() * 0xffff_ffff)
    .toString(16)
    .padStart(8, '0');
  return `${MARKER_PREFIX}-${hex}`;
}

/**
 * UTF-8 byte length. Offsets are byte offsets on the host, and `String.length`
 * counts UTF-16 units — using it would drift the tail cursor on any transcript
 * containing an emoji or a non-Latin script.
 */
function byteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4; // surrogate pair: one 4-byte code point
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function findLast<T>(items: readonly T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && predicate(item)) return item;
  }
  return undefined;
}
