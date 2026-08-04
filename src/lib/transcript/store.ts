import { exitCodeError } from '../herdr/client';
import { HerdrError } from '../herdr/protocol';
import { shellQuote, withPath } from '../herdr/shell';
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
export class TranscriptStore {
  private readonly transport: HerdrTransport;

  constructor(transport: HerdrTransport) {
    this.transport = transport;
  }

  /**
   * The host user's home directory. Stored transcript paths must be absolute so
   * shell quoting stays safe.
   */
  async homeDirectory(): Promise<string> {
    const home = (await this.shell('printf %s "$HOME"')).trim();
    return home.length > 0 ? home : '~';
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

  // There is deliberately no `newestTranscriptPath` here. Picking the newest
  // .jsonl in a project dir is the one shortcut this file must never offer:
  // every chat sharing a working directory shares that dir, so the newest file
  // belongs to whichever conversation was touched last, not to the one being
  // opened. Callers wait for the session id instead — see `sessionTranscriptPath`.

  /** Current file size in bytes, or -1 if unknown (missing file, no permission). */
  async fileSize(path: string): Promise<number> {
    const output = (await this.shell(`wc -c < ${shellQuote(path)} 2>/dev/null`)).trim();
    const size = Number.parseInt(output, 10);
    return Number.isNaN(size) ? -1 : size;
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
    const size = await this.fileSize(path);
    const start = size > maxBytes ? size - maxBytes : 0;
    const body = await this.shell(`tail -c +${start + 1} ${shellQuote(path)}`);

    let text = body;
    let startByte = start;
    // A window that starts mid-file almost always starts mid-line. Drop that
    // fragment explicitly rather than relying on it failing to parse — a
    // truncated line can still decode into a half-formed bubble.
    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      if (firstNewline >= 0) {
        startByte = start + byteLength(text.slice(0, firstNewline + 1));
        text = text.slice(firstNewline + 1);
      }
    }

    let messages = parseTranscript(text, agentLabel);
    if (maxMessages !== undefined && messages.length > maxMessages) {
      messages = messages.slice(messages.length - maxMessages);
    }

    // Consumed is the whole WINDOW regardless of what we kept or dropped: the
    // tail must resume at the real end of file, not at the first bubble shown,
    // or every trimmed message is re-read and re-appended as if it were new.
    //
    // `startByte` runs the other way — it is where this window BEGAN, which is
    // the anchor `older()` reads backwards from. Note it is the window start,
    // not the first kept message: anything `maxMessages` trimmed was never
    // shown, so letting the first older page serve it again is correct.
    return { messages, consumedBytes: start + byteLength(body), startByte };
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
    const body = await this.shell(
      `tail -c +${start + 1} ${shellQuote(path)} | head -c ${length}`
    );

    let text = body;
    let startByte = start;
    // A window opened mid-file almost always opens mid-line. Drop that fragment
    // and move the anchor past it, so the next page ends exactly where this one
    // begins: leaving the anchor at `start` would serve the partial line again,
    // and advancing it further would lose whatever sits between the two pages.
    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      if (firstNewline >= 0) {
        startByte = start + byteLength(text.slice(0, firstNewline + 1));
        text = text.slice(firstNewline + 1);
      }
    }

    return {
      messages: parseTranscript(text, agentLabel),
      startByte,
      reachedStart: startByte <= 0,
    };
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
    startByte: number
  ): AsyncGenerator<
    { message: ChatMessage | null; meta: SessionMeta | null; consumedBytes: number },
    void,
    void
  > {
    let consumed = startByte;
    const command = withPath(`tail -c +${startByte + 1} -f ${shellQuote(path)}`);
    for await (const line of this.transport.streamLines(command)) {
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
  async sessionMeta(path: string, tailBytes = 262_144): Promise<SessionMeta | null> {
    const text = await this.shell(`tail -c ${tailBytes} ${shellQuote(path)} 2>/dev/null`);
    let model: string | null = null;
    let contextTokens: number | null = null;

    const lines = text.split('\n');
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const meta = assistantMeta(lines[index] ?? '');
      if (meta === null) continue;
      if (model === null) model = meta.model;
      if (contextTokens === null) contextTokens = meta.contextTokens;
      if (model !== null && contextTokens !== null) break;
    }

    if (model === null && contextTokens === null) return null;
    return { model, contextTokens };
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
    let script = '';
    for (const request of requests) {
      // Ids are interpolated into the script and the marker line, so refuse
      // anything that isn't obviously inert rather than trying to quote it.
      if (!/^[A-Za-z0-9:_-]+$/.test(request.workspaceId)) continue;
      const dir = projectDirName(request.cwd);

      // Exact session file ONLY. Falling back to the newest transcript in the
      // project dir previews a foreign session's last message under a reused or
      // same-named workspace — and two chats opened on one folder share that
      // dir, so the guess is wrong exactly when it looks most plausible. A
      // request without a usable session id is dropped rather than guessed; the
      // row keeps its live status line until the id arrives.
      if (request.sessionId === null || !/^[A-Za-z0-9-]+$/.test(request.sessionId)) continue;
      script += `f="$HOME/.claude/projects/${dir}/${request.sessionId}.jsonl"; `;
      script += `printf '\\n${MARKER} %s\\n' '${request.workspaceId}'; `;
      script += `[ -n "$f" ] && tail -c ${tailBytes} "$f" 2>/dev/null; `;
    }
    if (script.length === 0) return new Map();
    script += 'true'; // a workspace without a transcript must not fail the batch

    const text = await this.shell(script);
    const result = new Map<string, ChatMessage>();

    for (const block of text.split(`\n${MARKER} `).slice(1)) {
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

  private async shell(command: string): Promise<string> {
    const result = await this.transport.exec(withPath(command));
    if (!result.ok) throw new HerdrError(result.code, result.message);
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
}

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

const MARKER = '@@HERDRCHAT';

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
