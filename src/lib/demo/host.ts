/**
 * A herdr host that isn't one.
 *
 * The transport is an interface precisely so the core can run against a canned
 * host, which is how every test here works. The demo takes that seam into
 * production: everything above it — the chat list, the thread, the blocked bar,
 * the transcript reader — runs its real code, and only the machine underneath
 * is fictional. Nobody gets a special "demo screen" that could drift from the
 * app people actually use.
 *
 * It answers the commands the real client builds, in the form the real client
 * builds them: a `withPath` prefix, then either POSIX-quoted `herdr` argv or a
 * small `sh` snippet for reading transcripts.
 */
import type { ExecResult } from '../../../modules/herdr-ssh/src';
import type { HerdrTransport } from '../herdr/transport';
import { projectDirName } from '../transcript/parser';
import {
  answeredReply,
  DEMO_BLOCKED_SCREEN,
  DEMO_HOME,
  DEMO_SESSION_IDS,
  DEMO_WORKSPACES,
  replyFor,
  replyLine,
  transcriptFor,
  userLine,
} from './fixtures';

/** The version the demo claims, so the client picks the agent-aware verbs. */
const DEMO_HERDR_VERSION = '0.8.0';

/**
 * How long the demo agent "thinks" before its answer lands.
 *
 * Pulled rather than scheduled: a due reply is materialised by the next read,
 * of which there are plenty — the status poll, the list preview, the live tail.
 * That keeps the host free of timers it would have to clean up, and lets a test
 * move time instead of waiting for it.
 */
const REPLY_DELAY_MS = 1_500;

/** How often the fake tail looks for newly appended lines. */
const TAIL_POLL_MS = 200;

function ok(result: unknown): ExecResult {
  return { ok: true, stdout: JSON.stringify({ id: 'demo', result }), stderr: '', exitCode: 0 };
}

/** Raw stdout, for the commands that are `sh` rather than herdr. */
function out(stdout: string): ExecResult {
  return { ok: true, stdout, stderr: '', exitCode: 0 };
}

function exit(code: number): ExecResult {
  return { ok: true, stdout: '', stderr: '', exitCode: code };
}

/** Success for verbs that print nothing at all (`pane run`, `send-keys`). */
function silent(): ExecResult {
  return out('');
}

/**
 * UTF-8 byte length, by the same rules the transcript reader uses. Offsets on a
 * real host are bytes; `String.length` is UTF-16 units.
 */
function byteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * The substring beginning at `startByte`, snapped forward to a code-point
 * boundary. A real `tail -c` can cut mid-code-point; the reader already handles
 * that by discarding a partial first line, so starting at the next whole
 * character is the honest simplification.
 */
function sliceFromByte(text: string, startByte: number): string {
  if (startByte <= 0) return text;
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes >= startByte) return text.slice(index);
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return '';
}

/** The last `count` bytes, snapped forward to a boundary. */
function sliceLastBytes(text: string, count: number): string {
  const total = byteLength(text);
  return total <= count ? text : sliceFromByte(text, total - count);
}

/**
 * Undo `withPath` and `shellCommand`.
 *
 * Reading the real command back is what lets the demo answer the same verbs a
 * host would, rather than the demo and the client agreeing on some third format
 * neither would use in production.
 */
export function parseArgv(command: string): string[] {
  const argv: string[] = [];
  let current = '';
  let quoted = false;
  let started = false;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (quoted) {
      if (char === "'") quoted = false;
      else current += char;
      continue;
    }
    if (char === "'") {
      quoted = true;
      started = true;
      continue;
    }
    if (char === '\\' && command[i + 1] === "'") {
      current += "'";
      i += 1;
      started = true;
      continue;
    }
    if (char === ' ') {
      if (started) argv.push(current);
      current = '';
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (started) argv.push(current);
  return argv;
}

/** Strip the `export PATH=…; ` prefix every command carries. */
function withoutPath(command: string): string {
  if (!command.startsWith('export PATH=')) return command;
  const cut = command.indexOf('; ');
  return cut === -1 ? command : command.slice(cut + 2);
}

/** A reply the demo owes, once its moment arrives. */
interface Pending {
  paneId: string;
  /** What the person typed, when they typed something. */
  prompt: string;
  /** Which menu key they tapped, when they answered a prompt instead. */
  answer?: string;
  dueAt: number;
}

export class DemoHost implements HerdrTransport {
  /** Transcripts by pane, mutable because the demo agent writes to them. */
  private readonly transcripts = new Map<string, string>();
  /** Absolute transcript path → pane, so a file read resolves to a conversation. */
  private readonly paths = new Map<string, string>();
  /** Agent status by pane, mutable because answering a prompt unblocks it. */
  private readonly statuses = new Map<string, string>();
  private pending: Pending | null = null;
  private counter = 0;

  constructor(private readonly now: () => number = () => Date.now()) {
    for (const workspace of DEMO_WORKSPACES) {
      this.statuses.set(workspace.paneId, workspace.agentStatus);
      this.transcripts.set(workspace.paneId, transcriptFor(workspace.paneId));
      const session = DEMO_SESSION_IDS[workspace.paneId];
      if (session !== undefined) {
        const dir = projectDirName(workspace.cwd);
        this.paths.set(`${DEMO_HOME}/.claude/projects/${dir}/${session}.jsonl`, workspace.paneId);
      }
    }
  }

  async exec(command: string, _timeoutMs: number): Promise<ExecResult> {
    this.materialise();
    const body = withoutPath(command);
    return this.filesystem(body) ?? this.herdr(parseArgv(body));
  }

  /** Write any reply whose moment has arrived. Called before every read. */
  private materialise(): void {
    const due = this.pending;
    if (due === null || this.now() < due.dueAt) return;
    this.pending = null;
    const text = due.answer === undefined ? replyFor(due.prompt) : answeredReply(due.answer);
    this.append(due.paneId, replyLine(text, this.uuid(), this.stamp()));
    this.statuses.set(due.paneId, 'idle');
  }

  private append(paneId: string, jsonLine: string): void {
    const existing = this.transcripts.get(paneId) ?? '';
    this.transcripts.set(paneId, `${existing}${jsonLine}\n`);
  }

  private uuid(): string {
    this.counter += 1;
    return `demo-${this.counter}`;
  }

  private stamp(): string {
    return new Date(this.now()).toISOString();
  }

  /**
   * `tail -c +N -f` — the live tail the thread depends on for anything that
   * arrives after it opened. Like the real thing this never ends on its own;
   * the consumer abandons the iterator when the thread goes away.
   */
  async *streamLines(command: string, _startTimeoutMs: number): AsyncIterable<string> {
    const follow = /^tail -c \+(\d+) -f '(.+?)'$/.exec(withoutPath(command));
    if (follow === null) return;

    const path = follow[2]!;
    let cursor = Number(follow[1]) - 1;

    for (;;) {
      this.materialise();
      const contents = this.read(path);
      if (contents !== null) {
        const rest = sliceFromByte(contents, cursor);
        const lines = rest.split('\n');
        // The last element is whatever follows the final newline — an
        // incomplete line, or the empty string. Either way it is not ours yet.
        for (const line of lines.slice(0, -1)) {
          cursor += byteLength(line) + 1;
          if (line.length > 0) yield line;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, TAIL_POLL_MS));
    }
  }

  /** The contents of a demo transcript, or null when nothing lives at that path. */
  private read(path: string): string | null {
    const pane = this.paths.get(path);
    if (pane === undefined) return null;
    return this.transcripts.get(pane) ?? null;
  }

  /** `sh` reading transcripts. Returns null when the command is not one of these. */
  private filesystem(body: string): ExecResult | null {
    if (body === 'printf %s "$HOME"') return out(DEMO_HOME);

    const probe = /^\[ -f '(.+?)' \] \|\| exit (\d+); wc -c < '(.+?)'$/.exec(body);
    if (probe !== null) {
      const contents = this.read(probe[1]!);
      return contents === null ? exit(Number(probe[2])) : out(`${byteLength(contents)}\n`);
    }

    const from = /^tail -c \+(\d+) '(.+?)'$/.exec(body);
    if (from !== null) {
      const contents = this.read(from[2]!);
      return contents === null ? exit(1) : out(sliceFromByte(contents, Number(from[1]) - 1));
    }

    const last = /^tail -c (\d+) '(.+?)' 2>\/dev\/null$/.exec(body);
    if (last !== null) {
      const contents = this.read(last[2]!);
      return out(contents === null ? '' : sliceLastBytes(contents, Number(last[1])));
    }

    return null;
  }

  private statusOf(paneId: string): string {
    return this.statuses.get(paneId) ?? 'idle';
  }

  private workspaceRows(): unknown[] {
    return DEMO_WORKSPACES.map((w) => ({
      workspace_id: w.workspaceId,
      label: w.label,
      number: w.number,
      agent_status: this.statusOf(w.paneId),
      focused: w.paneId === 'w1:p1',
      active_tab_id: `${w.workspaceId}:t1`,
      pane_count: 1,
      tab_count: 1,
    }));
  }

  private agentRows(): unknown[] {
    return DEMO_WORKSPACES.map((w) => ({
      agent: 'claude',
      agent_status: this.statusOf(w.paneId),
      cwd: w.cwd,
      foreground_cwd: w.cwd,
      focused: w.paneId === 'w1:p1',
      pane_id: w.paneId,
      tab_id: `${w.workspaceId}:t1`,
      terminal_id: `term_${w.workspaceId}`,
      workspace_id: w.workspaceId,
      agent_session: {
        agent: 'claude',
        kind: 'id',
        source: 'herdr:claude',
        value: DEMO_SESSION_IDS[w.paneId] ?? null,
      },
    }));
  }

  /** `herdr <verb>`. */
  private herdr(argv: string[]): ExecResult {
    const verb = argv.slice(1).join(' ');

    if (verb === 'status server') return ok({ running: true });
    if (verb === 'workspace list') return ok({ workspaces: this.workspaceRows() });
    if (verb === 'agent list') return ok({ agents: this.agentRows() });

    if (verb === 'api snapshot') {
      return ok({
        snapshot: {
          agents: this.agentRows(),
          workspaces: this.workspaceRows(),
          focused_pane_id: 'w1:p1',
          focused_tab_id: 'w1:t1',
          focused_workspace_id: 'w1',
          version: DEMO_HERDR_VERSION,
          protocol: 19,
        },
      });
    }

    // `pane read <pane> --source visible --lines N`
    if (argv[1] === 'pane' && argv[2] === 'read') {
      const paneId = argv[3] ?? '';
      return out(this.statusOf(paneId) === 'blocked' ? DEMO_BLOCKED_SCREEN : '');
    }

    // `pane send-keys <pane> <key>…` — how a blocked-prompt answer is delivered.
    if (argv[1] === 'pane' && argv[2] === 'send-keys') {
      const paneId = argv[3] ?? '';
      const choice = argv[4] ?? '';
      if (this.statusOf(paneId) === 'blocked') {
        this.statuses.set(paneId, 'working');
        this.pending = { paneId, prompt: '', answer: choice, dueAt: this.now() + REPLY_DELAY_MS };
      }
      return silent();
    }

    // `agent prompt <pane> <text>` on a modern host, `pane run <pane> <text>`
    // on an old one. The demo answers to both so neither path is untested.
    const isPrompt =
      (argv[1] === 'agent' && argv[2] === 'prompt') || (argv[1] === 'pane' && argv[2] === 'run');
    if (isPrompt) {
      const paneId = argv[3] ?? '';
      const text = argv[4] ?? '';
      this.append(paneId, userLine(text, this.uuid(), this.stamp()));
      this.statuses.set(paneId, 'working');
      this.pending = { paneId, prompt: text, dueAt: this.now() + REPLY_DELAY_MS };
      return silent();
    }

    return silent();
  }
}
