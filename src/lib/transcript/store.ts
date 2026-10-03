import { exitCodeError } from '../herdr/client';
import { HerdrError, transportError } from '../herdr/protocol';
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
const claudeDirByTransport = new WeakMap<HerdrTransport, Promise<string>>();

/**
 * Where Claude Code keeps its data on the host. It honours `CLAUDE_CONFIG_DIR`,
 * so a hardcoded `~/.claude` missed every transcript of someone who set it
 * (#89). Only as good as the SSH session's environment: a variable exported
 * from an interactive shell rc is not seen here.
 */
const CLAUDE_DIR_COMMAND = 'printf %s "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"';
const CLAUDE_DIR_SHELL = '${CLAUDE_CONFIG_DIR:-$HOME/.claude}';
const codexPathsByTransport = new WeakMap<HerdrTransport, Map<string, Promise<string | null>>>();
const ompPathsByTransport = new WeakMap<HerdrTransport, Map<string, Promise<string | null>>>();

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

  /** Claude Code's data folder on the host, cached like `homeDirectory`. */
  async claudeDirectory(): Promise<string> {
    const cached = claudeDirByTransport.get(this.transport);
    if (cached !== undefined) return cached;
    const pending = this.shell(CLAUDE_DIR_COMMAND, POLL_TIMEOUT_MS).then((raw) => {
      const dir = raw.trim();
      if (!dir.startsWith('/')) {
        throw new HerdrError('home_unknown', "The host didn't say where Claude keeps its data.");
      }
      return dir;
    });
    claudeDirByTransport.set(this.transport, pending);
    void pending.catch(() => claudeDirByTransport.delete(this.transport));
    return pending;
  }

  /**
   * The transcript path for a Claude session: `<claude dir>/projects/<folder
   * for cwd>/<session id>.jsonl`. Null for an id that isn't obviously inert.
   */
  async claudeTranscriptPath(cwd: string, sessionId: string): Promise<string | null> {
    if (sessionId.length === 0 || !/^[A-Za-z0-9-]+$/.test(sessionId)) return null;
    return `${await this.claudeDirectory()}/projects/${projectDirName(cwd)}/${sessionId}.jsonl`;
  }

  /**
   * Find a Claude session's transcript by its exact file name in any project
   * folder, for when it is not where the pane's cwd says. A session started at
   * a repo root and moved into `.claude/worktrees/<name>` is filed under the
   * worktree's folder, while herdr may still report the root (#89).
   *
   * Not a guess: the name is the session id herdr reported, and only that exact
   * file can match. What CLAUDE.md forbids is "the newest file in the folder".
   */
  async findClaudeTranscript(sessionId: string): Promise<string | null> {
    if (sessionId.length === 0 || !/^[A-Za-z0-9-]+$/.test(sessionId)) return null;
    const result = await this.transport.exec(
      withPath(
        // Falls off the end rather than `exit 0`: the transport marks a finished
        // command by what runs after it (#103). Not found is a non-zero status.
        `found=; for f in "${CLAUDE_DIR_SHELL}"/projects/*/${sessionId}.jsonl; do ` +
          `if [ -f "$f" ]; then printf '%s' "$f"; found=1; break; fi; done; [ -n "$found" ]`
      ),
      POLL_TIMEOUT_MS
    );
    if (!result.ok || result.exitCode !== 0) return null;
    const path = result.stdout.trim();
    return path.startsWith('/') && path.endsWith(`/${sessionId}.jsonl`) ? path : null;
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

  /**
   * Herdr's OMP extension normally reports the exact file, including custom
   * session directories and profiles. An id-only report searches for that
   * exact id, never for a cwd's newest journal.
   */
  async ompTranscriptPath(value: string, kind: string | null): Promise<string | null> {
    if (kind === 'path') {
      return value.startsWith('/') && value.endsWith('.jsonl') && !/[\0\r\n]/.test(value) &&
        !value.split('/').includes('..') ? value : null;
    }
    if (kind !== 'id' || !/^[A-Za-z0-9-]+$/.test(value)) return null;
    let paths = ompPathsByTransport.get(this.transport);
    if (paths === undefined) {
      paths = new Map();
      ompPathsByTransport.set(this.transport, paths);
    }
    const cached = paths.get(value);
    if (cached !== undefined) return cached;
    const pending = this.findOmpTranscript(value);
    paths.set(value, pending);
    const forget = () => { if (paths.get(value) === pending) paths.delete(value); };
    void pending.then(path => { if (path === null) forget(); }, forget);
    return pending;
  }

  forgetOmpTranscript(sessionId: string): void {
    ompPathsByTransport.get(this.transport)?.delete(sessionId);
  }

  private async findOmpTranscript(value: string): Promise<string | null> {
    const output = await this.shell(
      'omp_config="$HOME/${PI_CONFIG_DIR:-.omp}"; ' +
      'for omp_dir in "${PI_CODING_AGENT_DIR:-$omp_config/agent}/sessions" ' +
      '"$omp_config/agent/sessions" "$omp_config/profiles" ' +
      '${XDG_DATA_HOME:+"$XDG_DATA_HOME/omp"}; do ' +
      'if [ -d "$omp_dir" ]; then ' +
      `find "$omp_dir" -type f \\( -name ${shellQuote(`*_${value}.jsonl`)} -o -name ${shellQuote(`${value}.jsonl`)} \\) || exit $?; ` +
      'fi; done'
    );
    const paths = [...new Set(output.split('\n').filter(path => path.length > 0))];
    if (paths.length === 0) return null;
    if (paths.length !== 1) {
      throw new HerdrError('omp_session_ambiguous',
        'More than one OMP transcript has this session id. Nothing was opened. Resume the session with the OMP integration so it reports the exact path.');
    }
    const path = paths[0]!;
    if (!path.startsWith('/') || !path.endsWith('.jsonl') || /[\0\r\n]/.test(path) || path.split('/').includes('..')) {
      throw new HerdrError('omp_session_invalid', 'The host returned an invalid OMP transcript path.');
    }
    return path;
  }

  /** Do not display another format (or a mismatched id) as OMP history. */
  async verifyOmpTranscript(path: string, sessionId: string | null): Promise<void> {
    const header = await this.shell(`head -n 2 ${shellQuote(path)}`);
    if (!this.isOmpHeader(header, sessionId)) {
      if (sessionId !== null) this.forgetOmpTranscript(sessionId);
      throw new HerdrError('omp_session_mismatch',
        'This file does not confirm the expected OMP session. Nothing was opened. Resume the session on the host, then reload.');
    }
  }

  private isOmpHeader(header: string, sessionId: string | null): boolean {
    try {
      const [first, second] = header.split('\n', 2);
      let raw: unknown = JSON.parse(first ?? '');
      // Current OMP journals prepend a fixed-width title slot. Legacy files
      // start directly with the session header; neither format needs a scan.
      if (typeof raw === 'object' && raw !== null && 'type' in raw && raw.type === 'title') {
        raw = JSON.parse(second ?? '');
      }
      return typeof raw === 'object' && raw !== null &&
        'type' in raw && raw.type === 'session' &&
        'id' in raw && typeof raw.id === 'string' && raw.id.length > 0 &&
        (sessionId === null || raw.id === sessionId);
    } catch {
      return false; // A partially written header can be retried next refresh.
    }
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
   * The conversation's last `lines` lines, read in one command, and the bytes
   * they span, so the live tail can follow from exactly the end.
   *
   * Counted in lines, not bytes, because bytes are a poor measure of
   * conversation. Claude embeds every picture it reads as base64, twice, so a
   * session that checks screenshots has lines of half a megabyte to a megabyte.
   * A byte window of a few hundred kilobytes opened such a thread on a dozen
   * rows, and paging back a byte window at a time fetched one picture per pull
   * and showed nothing for it: the reader could not get back into history.
   *
   * `size` is the probe's answer. Reading only up to it keeps an agent writing
   * right now from turning this into an unbounded catch-up read.
   */
  async recent(
    path: string,
    agentLabel: string | null,
    lines: number,
    size?: number
  ): Promise<{ messages: ChatMessage[]; consumedBytes: number; startByte: number }> {
    const end = size ?? (await this.sizeOrThrow(path));
    const window = await this.linesBefore(path, agentLabel, end, lines);
    return { messages: window.messages, consumedBytes: window.endByte, startByte: window.startByte };
  }

  /**
   * The `lines` lines immediately BEFORE `beforeByte`, what a reader gets by
   * scrolling to the top of a thread. `beforeByte` is always a line start: the
   * `startByte` of the window or page before, or a tail cursor.
   */
  async older(
    path: string,
    agentLabel: string | null,
    beforeByte: number,
    lines: number
  ): Promise<{ messages: ChatMessage[]; startByte: number; reachedStart: boolean }> {
    if (beforeByte <= 0) return { messages: [], startByte: 0, reachedStart: true };
    const window = await this.linesBefore(path, agentLabel, beforeByte, lines);
    return { messages: window.messages, startByte: window.startByte, reachedStart: window.startByte <= 0 };
  }

  /**
   * Up to `lines` whole lines ending at or before byte `end`, as `[startByte,
   * endByte)`. A line still being written at `end` is left out, and `endByte`
   * stops before it, so the tail reads it whole.
   *
   * The host finds the boundaries (only the numbers come back) and strips
   * picture data before anything crosses the network: a quoted string of 128
   * or more base64 characters, or a base64 data URL, becomes "". Neither is text a person reads, and the
   * parser only counts image blocks, it never decodes them. A line stays one
   * line, so `[startByte, endByte)` still describes exactly what was parsed.
   * Measured on a real 30 MB transcript, 200 lines went from 6.2 MB to 196 KB.
   *
   * The pattern keeps to what BSD, GNU and busybox `sed -E` all accept: a
   * repetition count of at most 255 (BSD's RE_DUP_MAX), no `\w`, and `|` as
   * the delimiter since `/` is in the base64 alphabet.
   */
  private async linesBefore(
    path: string,
    agentLabel: string | null,
    end: number,
    lines: number
  ): Promise<{ messages: ChatMessage[]; startByte: number; endByte: number }> {
    if (end <= 0) return { messages: [], startByte: 0, endByte: 0 };
    const output = await this.shell(windowScript(path, end, lines));
    const newline = output.indexOf('\n');
    const header = /^(\d+) (\d+)$/.exec(newline < 0 ? output : output.slice(0, newline));
    const startByte = Number(header?.[1]);
    const endByte = Number(header?.[2]);
    if (header === null || startByte > endByte || endByte > end) {
      throw new HerdrError('transcript_changed', 'The transcript read came back incomplete. Retrying.');
    }
    const text = newline < 0 ? '' : output.slice(newline + 1);
    return { messages: parseTranscript(text, agentLabel), startByte, endByte };
  }

  /**
   * Where the line that ends at (or contains) `byte - 1` starts: the host runs
   * `grep -b` over the prefix and returns only that offset, never the content.
   * Used where a read must begin exactly on a line boundary.
   */
  async lineStartBefore(path: string, byte: number): Promise<number> {
    if (byte <= 0) return 0;
    const output = await this.shell(
      `head -c ${byte} ${shellQuote(path)} | LC_ALL=C grep -a -b '' | cut -d: -f1 | tail -n 1`
    );
    const lineStart = Number.parseInt(output.trim(), 10);
    if (!Number.isInteger(lineStart) || lineStart < 0 || lineStart >= byte) {
      throw new HerdrError('transcript_changed', 'Could not find where that line starts. Retrying.');
    }
    return lineStart;
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
    let ompEffortFound = false;

    const lines = text.split('\n');
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const meta = assistantMeta(lines[index] ?? '');
      if (meta === null) continue;
      if (model === null && meta.model !== null) {
        model = meta.model;
        if (agent !== 'omp') effort = meta.effort ?? null;
      }
      if (agent === 'omp' && !ompEffortFound && meta.effort !== undefined) {
        effort = meta.effort;
        ompEffortFound = true;
      }
      if (contextTokens === null) contextTokens = meta.contextTokens;
      if (model !== null && contextTokens !== null && (agent !== 'omp' || ompEffortFound)) break;
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
    if (agent === 'omp' && (!ompEffortFound || model === null)) {
      // These settings are separate journal records and may predate the window.
      const settings = await this.shell(
        `awk '/"type"[[:space:]]*:[[:space:]]*"model_change"/ { model = $0 } ` +
        `/"type"[[:space:]]*:[[:space:]]*"thinking_level_change"/ { effort = $0 } ` +
        `END { print model; print effort }' ${shellQuote(path)}`
      );
      for (const line of settings.split('\n')) {
        const meta = assistantMeta(line);
        if (meta === null) continue;
        if (model === null) model = meta.model;
        if (!ompEffortFound && meta.effort !== undefined) {
          effort = meta.effort;
          ompEffortFound = true;
        }
      }
    }
    if (model === null && contextTokens === null && !ompEffortFound) return null;
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
    const ompSessions = new Map<string, string | null>();
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
      if (request.sessionId === null) continue;
      if (request.agent === 'omp') {
        const path = await this.ompTranscriptPath(request.sessionId, request.sessionKind ?? 'id').catch(() => null);
        if (path === null) continue;
        script += `f=${shellQuote(path)}; `;
        ompSessions.set(request.workspaceId, request.sessionKind === 'path' ? null : request.sessionId);
      } else if (!/^[A-Za-z0-9-]+$/.test(request.sessionId)) continue;
      else if (request.agent === 'codex') {
        // One broken Codex session must not suppress every other row's preview.
        const path = await this.codexTranscriptPath(request.sessionId).catch(() => null);
        if (path === null) continue;
        script += `f=${shellQuote(path)}; `;
      } else if (request.agent === undefined || request.agent === 'claude') {
        const dir = projectDirName(request.cwd);
        const id = request.sessionId;
        script += `f="${CLAUDE_DIR_SHELL}/projects/${dir}/${id}.jsonl"; `;
        // Not under the cwd's folder (a worktree session, #89): the exact id
        // in any project folder. Never a different file.
        script += `[ -f "$f" ] || for g in "${CLAUDE_DIR_SHELL}"/projects/*/${id}.jsonl; do [ -f "$g" ] && f=$g && break; done; `;
      } else continue;
      script += `printf '\\n${marker} %s\\n' '${request.workspaceId}'; `;
      // Validate headers in the preview batch, not one SSH call per OMP row.
      if (request.agent === 'omp') script += `head -n 2 "$f" 2>/dev/null; printf '\\n'; `;
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
      let body = block.slice(headerEnd + 1);
      const ompId = ompSessions.get(workspaceId);
      if (ompId !== undefined) {
        const secondNewline = body.indexOf('\n', body.indexOf('\n') + 1);
        if (secondNewline < 0 || !this.isOmpHeader(body.slice(0, secondNewline), ompId)) {
          if (ompId !== null) this.forgetOmpTranscript(ompId);
          continue;
        }
        body = body.slice(secondNewline + 1);
      }
      const messages = parseTranscript(body);
      const last = findLast(
        messages,
        // A command's note ("Cancelled") is neither news nor the conversation.
        (message) => !message.isSidechain && !isToolOnly(message) && message.role !== 'system'
      );
      if (last !== undefined) result.set(workspaceId, last);
    }
    return result;
  }

  private async shell(command: string, timeoutMs = TRANSCRIPT_TIMEOUT_MS): Promise<string> {
    const result = await this.transport.exec(withPath(command), timeoutMs);
    if (!result.ok) throw transportError(result);
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
  /** OMP reports a path; legacy providers and callers report ids. */
  sessionKind?: string | null;
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
 * The host side of `linesBefore`: prints "<startByte> <endByte>", then those
 * lines with picture data stripped.
 *
 * It reads a chunk `[b, e)` before the end rather than the whole prefix, and
 * gets there by seeking: `dd count=0` moves the shared file offset and `head
 * -c` reads on from it. Everything else counts with `wc` and `head`, never
 * `tail` on a pipe: BSD's crawls at about 60 MB/s and `tail -c +N` streams no
 * faster, which made a 30 MB transcript take two seconds per page on a Mac
 * host. The chunk grows fourfold until it holds more than `n` lines or reaches
 * the start of the file, so a first line cut by the chunk is never one of the
 * `n`.
 *
 * `k` newlines in the chunk: the window ends `z` after the last one, leaving a
 * line still being written to the tail, and starts `s` after the first `k - n`
 * lines. `head -n 0` is an error on BSD, hence the guards. Only `dd`, `head`,
 * `wc` and `sed`: busybox's `grep` has no `-b`.
 *
 * Run by `sh` rather than the login shell, which may be zsh or fish.
 */
export function windowScript(path: string, end: number, lines: number): string {
  return `sh -c ${shellQuote([
    `f=${shellQuote(path)}; e=${end}; n=${lines}; w=${WINDOW_CHUNK_BYTES}`,
    '[ -r "$f" ] || exit 1',
    'r() { { dd bs=1 skip="$1" count=0 2>/dev/null; head -c $(($2 - $1)); } < "$f"; }',
    'while :; do',
    '  if [ "$e" -gt "$w" ]; then b=$((e - w)); else b=0; fi',
    '  k=$(($(r "$b" "$e" | wc -l)))',
    '  if [ "$b" -eq 0 ] || [ "$k" -gt "$n" ]; then break; fi',
    '  w=$((w * 4))',
    'done',
    'z=$b; [ "$k" -gt 0 ] && z=$((b + $(r "$b" "$e" | head -n "$k" | wc -c)))',
    's=$b; [ "$k" -gt "$n" ] && s=$((b + $(r "$b" "$e" | head -n $((k - n)) | wc -c)))',
    'echo "$s $z"',
    `r "$s" "$z" | sed -E ${shellQuote(STRIP_PICTURES)}`,
  ].join('\n'))}`;
}

/** The first chunk `windowScript` looks at: a few pictures' worth. */
const WINDOW_CHUNK_BYTES = 4 * 1024 * 1024;

/** See `linesBefore`. */
const STRIP_PICTURES =
  's|"[A-Za-z0-9+/=]{128}[A-Za-z0-9+/=]*"|""|g; s|"data:[A-Za-z0-9.+/-]*;base64,[A-Za-z0-9+/=]*"|""|g';

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
