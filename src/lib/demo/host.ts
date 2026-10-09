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
import { HEREDOC_END } from '../theme/bootstrap';
import { THEME_BEGIN, THEME_MISSING } from '../theme/hostTheme';
import { THEME_FILE } from '../theme/schema';
import {
  DEMO_PHRASES,
  DEMO_THEME_REPLY,
  DEMO_THEME_TEXT,
  DEMO_QUESTIONS,
  DEMO_TABLE_REPLY,
  TRUST_OPTIONS,
  trustScreen,
  effortPanelScreen,
  modelPanelScreen,
  panelFor,
  panelKey,
  questionAnswer,
  questionScreen,
  type DemoPanel,
} from './scenarios';
import {
  answeredReply,
  commandLines,
  DEMO_BLOCKED_SCREEN,
  ompLine,
  DEMO_HOME,
  DEMO_HOST,
  demoPanes,
  replyFor,
  replyLine,
  toolResultLine,
  toolUseLine,
  userLine,
  type DemoFixtures,
} from './fixtures';
import { unwrapJump, unwrapJumpStream } from '../herdr/machine';

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
/** What `windowScript` prints for `text`: up to `count` whole lines ending at or before byte `end`. */
function linesBefore(text: string, end: number, count: number): string {
  const prefix = text.slice(0, text.length - sliceFromByte(text, end).length);
  const whole = prefix.slice(0, prefix.lastIndexOf('\n') + 1);
  const taken = whole.length === 0 ? [] : whole.slice(0, -1).split('\n').slice(-count);
  const body = taken.length === 0 ? '' : `${taken.join('\n')}\n`;
  const endByte = byteLength(whole);
  return `${endByte - byteLength(body)} ${endByte}\n${body}`;
}

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

/**
 * A workspace's status over its panes, the most urgent first, as herdr reports
 * it. One pane's workspace simply has that pane's status.
 */
function workspaceStatus(statuses: readonly string[]): string {
  return ['blocked', 'working', 'done', 'idle'].find((status) => statuses.includes(status)) ?? statuses[0] ?? 'idle';
}

/** A reply the demo owes, once its moment arrives. */
interface Pending {
  paneId: string;
  /** What the person typed, when they typed something. */
  prompt: string;
  /** Which menu key they tapped, when they answered a prompt instead. */
  answer?: string;
  /** A scenario's own turns, written instead of the usual reply. */
  lines?: (next: () => string, timestamp: string) => string[];
  /** What the scenario does to the host as its turns land, such as writing a file. */
  effect?: () => void;
  dueAt: number;
}

/** A file in the demo's ~/.herdrchat, with the mtime `stat` would print. */
interface HostFile {
  text: string;
  mtime: number;
}

/** A question asked in parts: which part is on screen, and what was picked so far. */
interface Questions {
  step: number;
  answers: string[];
  toolId: string;
}

export class DemoHost implements HerdrTransport {
  /** Transcripts by pane, mutable because the demo agent writes to them. */
  private readonly transcripts = new Map<string, string>();
  /** Absolute transcript path → pane, so a file read resolves to a conversation. */
  private readonly paths = new Map<string, string>();
  /** Agent status by pane, mutable because answering a prompt unblocks it. */
  private readonly statuses = new Map<string, string>();
  private pending: Pending[] = [];
  /** A slash command's panel open over a pane's composer. */
  private readonly panels = new Map<string, DemoPanel>();
  private readonly questions = new Map<string, Questions>();
  /** Panes at the folder-trust question, with the row under its cursor. */
  private readonly trusting = new Map<string, number>();
  private counter = 0;
  /**
   * ~/.herdrchat, by file name. Empty at first, so the theme is the app's own
   * and every other flow looks as it always has; the app's bootstrap writes and
   * the theme scenario fill it, in memory only.
   */
  private readonly herdrchatDir = new Map<string, HostFile>();
  private lastMtime = 0;
  /**
   * The machines saved on this host, by SSH target, each a demo host of its
   * own. A command jumped to one (`withMachine`) is unwrapped by the same
   * builder that wrapped it and answered there.
   */
  private readonly machines = new Map<string, DemoHost>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly fixtures: DemoFixtures = DEMO_HOST
  ) {
    for (const machine of fixtures.machines) {
      this.machines.set(machine.target, new DemoHost(now, machine.fixtures));
    }
    for (const pane of fixtures.workspaces.flatMap(demoPanes)) {
      this.statuses.set(pane.paneId, pane.agentStatus);
      this.transcripts.set(pane.paneId, fixtures.transcript(pane.paneId));
      const ompPath = fixtures.ompPaths[pane.paneId];
      if (ompPath !== undefined) this.paths.set(ompPath, pane.paneId);
      const session = fixtures.sessionIds[pane.paneId];
      if (session !== undefined) {
        const dir = projectDirName(pane.cwd);
        this.paths.set(`${DEMO_HOME}/.claude/projects/${dir}/${session}.jsonl`, pane.paneId);
      }
    }
  }

  async exec(command: string, timeoutMs: number): Promise<ExecResult> {
    for (const [target, machine] of this.machines) {
      const inner = unwrapJump(target, command);
      if (inner !== null) return machine.exec(inner, timeoutMs);
    }
    this.materialise();
    const body = withoutPath(command);
    return this.filesystem(body) ?? this.herdr(parseArgv(body));
  }

  /** Write any reply whose moment has arrived. Called before every read. */
  private materialise(): void {
    const now = this.now();
    const ready = this.pending.filter(reply => reply.dueAt <= now);
    this.pending = this.pending.filter(reply => reply.dueAt > now);
    for (const due of ready) {
      due.effect?.();
      if (due.lines !== undefined) {
        for (const written of due.lines(() => this.uuid(), this.stamp())) this.append(due.paneId, written);
      } else {
        const text = due.answer === undefined ? replyFor(due.prompt) : answeredReply(due.answer);
        this.append(due.paneId, this.isOmp(due.paneId)
          ? ompLine('assistant', text, this.uuid(), this.stamp())
          : replyLine(text, this.uuid(), this.stamp()));
      }
      this.statuses.set(due.paneId,
        this.pending.some(reply => reply.paneId === due.paneId) ? 'working' : 'idle');
    }
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
  async *streamLines(command: string, startTimeoutMs: number, signal?: AbortSignal): AsyncIterable<string> {
    for (const [target, machine] of this.machines) {
      const inner = unwrapJumpStream(target, command);
      if (inner !== null) {
        yield* machine.streamLines(inner, startTimeoutMs, signal);
        return;
      }
    }
    const follow = /^tail -c \+(\d+) -f '(.+?)'$/.exec(withoutPath(command));
    if (follow === null) return;

    const path = follow[2]!;
    let cursor = Number(follow[1]) - 1;

    while (!signal?.aborted) {
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
    if (body === 'printf %s "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"') return out(`${DEMO_HOME}/.claude`);

    // A picture on its way up. The demo keeps nothing; it answers the last
    // command the way a host does, with where the file would be, so sending a
    // picture runs the same code here as against a real machine.
    const upload = /"\$HOME\/\.cache\/herdrchat\/uploads\/([A-Za-z0-9-]+\.(?:jpg|png))(\.part)?"/.exec(body);
    if (upload !== null) {
      return out(body.includes('base64 -d') ? `${DEMO_HOME}/.cache/herdrchat/uploads/${upload[1]}\n` : '');
    }

    // The size probe, which asks four questions before it measures anything —
    // is the folder there, can it be searched, is the file there, can it be
    // read. A fictional host has no permissions to get wrong, so the only two
    // answers it can give are "here is the size" and the absent status. Matching
    // the real shape rather than a simplification is the point: this transport
    // exists to run the app's real code, and a probe it answered loosely would
    // be the one place the demo stopped being the app.
    const probe =
      /^\[ -d '(.+?)' \] \|\| exit (\d+); \[ -x '.+?' \] \|\| exit \d+; \[ -e '(.+?)' \] \|\| exit \d+; \[ -r '.+?' \] \|\| exit \d+; wc -c < '.+?'$/.exec(
        body
      );
    if (probe !== null) {
      const contents = this.read(probe[3]!);
      return contents === null ? exit(Number(probe[2])) : out(`${byteLength(contents)}\n`);
    }

    const from = /^tail -c \+(\d+) '(.+?)'(?: \| head -c (\d+))?$/.exec(body);
    if (from !== null) {
      const contents = this.read(from[2]!);
      if (contents === null) return exit(1);
      const rest = sliceFromByte(contents, Number(from[1]) - 1);
      return out(from[3] === undefined ? rest
        : rest.slice(0, rest.length - sliceFromByte(rest, Number(from[3])).length));
    }

    // `windowScript`: the whole lines before a byte, as "<start> <end>" and then
    // the lines. The demo has no pictures to strip.
    const script = /^sh -c '([\s\S]*)'$/.exec(body);
    const window = script === null ? null : /^f='(.+?)'; e=(\d+); n=(\d+);/.exec(script[1]!.replaceAll(`'\\''`, `'`));
    if (window !== null) {
      const contents = this.read(window[1]!);
      return contents === null ? exit(1) : out(linesBefore(contents, Number(window[2]), Number(window[3])));
    }
    if (script !== null) {
      const theme = this.themeFiles(script[1]!.replaceAll(`'\\''`, `'`));
      if (theme !== null) return theme;
    }

    // The OMP header check reads the first two records.
    const head = /^head -n (\d+) '(.+?)'$/.exec(body);
    if (head !== null) {
      const contents = this.read(head[2]!);
      return contents === null ? exit(1) : out(`${contents.split('\n').slice(0, Number(head[1])).join('\n')}\n`);
    }

    const last = /^tail -c (\d+) '(.+?)' 2>\/dev\/null$/.exec(body);
    if (last !== null) {
      const contents = this.read(last[2]!);
      return out(contents === null ? '' : sliceLastBytes(contents, Number(last[1])));
    }

    return null;
  }

  // MARK: - ~/.herdrchat (src/lib/theme)

  /** The host theme's three commands: fetch, bootstrap, reset. Null for any other script. */
  private themeFiles(script: string): ExecResult | null {
    if (script.includes(`echo ${THEME_BEGIN}`)) {
      const file = this.herdrchatDir.get(THEME_FILE);
      if (file === undefined) return out(`${THEME_MISSING}\n`);
      const last = /if \[ "\$m" = "([^"]*)" \]/.exec(script)?.[1];
      return out(last === String(file.mtime) ? `${file.mtime}\n` : `${file.mtime}\n${THEME_BEGIN}\n${file.text}`);
    }
    if (script.startsWith('mkdir -p "$HOME/.herdrchat"')) {
      const heredoc = new RegExp(`\\[ -e (\\S+) \\] \\|\\| cat > \\S+ <<'${HEREDOC_END}'\\n([\\s\\S]*?)\\n${HEREDOC_END}(?:\\n|$)`, 'g');
      for (const [, name, text] of script.matchAll(heredoc)) {
        if (!this.herdrchatDir.has(name!)) this.writeHostFile(name!, `${text!}\n`);
      }
      return silent();
    }
    if (script.includes('mv "$f" "$b"')) {
      const file = this.herdrchatDir.get(THEME_FILE);
      if (file !== undefined) {
        // The first free backup name, as the real command picks it.
        let backup = `${THEME_FILE}.bak`;
        for (let n = 1; this.herdrchatDir.has(backup); n += 1) backup = `${THEME_FILE}.bak.${n}`;
        this.herdrchatDir.delete(THEME_FILE);
        this.herdrchatDir.set(backup, file);
      }
      return silent();
    }
    return null;
  }

  /** Write a file with an mtime later than any before it, as a real clock in seconds would give, never equal. */
  private writeHostFile(name: string, text: string): void {
    this.lastMtime = Math.max(Math.floor(this.now() / 1000), this.lastMtime + 1);
    this.herdrchatDir.set(name, { text, mtime: this.lastMtime });
  }

  /** A file under ~/.herdrchat, for tests: what the app's writes left there. */
  hostFile(name: string): string | null {
    return this.herdrchatDir.get(name)?.text ?? null;
  }

  private isOmp(paneId: string): boolean {
    return this.fixtures.ompPaths[paneId] !== undefined;
  }

  private focusedWorkspaceId(): string {
    return this.fixtures.workspaces.find((w) => demoPanes(w).some((pane) => pane.paneId === this.fixtures.focusedPaneId))
      ?.workspaceId ?? '';
  }

  private statusOf(paneId: string): string {
    return this.statuses.get(paneId) ?? 'idle';
  }

  private workspaceRows(): unknown[] {
    return this.fixtures.workspaces.map((w) => {
      const panes = demoPanes(w);
      return {
        workspace_id: w.workspaceId,
        label: w.label,
        number: w.number,
        agent_status: workspaceStatus(panes.map((pane) => this.statusOf(pane.paneId))),
        focused: panes.some((pane) => pane.paneId === this.fixtures.focusedPaneId),
        active_tab_id: `${w.workspaceId}:t1`,
        pane_count: panes.length,
        tab_count: 1,
      };
    });
  }

  private agentRows(): unknown[] {
    return this.fixtures.workspaces.flatMap((w) => demoPanes(w).map((pane, index) => ({
      agent: pane.agent ?? 'claude',
      agent_status: this.statusOf(pane.paneId),
      cwd: pane.cwd,
      foreground_cwd: pane.cwd,
      focused: pane.paneId === this.fixtures.focusedPaneId,
      pane_id: pane.paneId,
      tab_id: `${w.workspaceId}:t1`,
      // The first pane keeps the terminal id it always had.
      terminal_id: index === 0 ? `term_${w.workspaceId}` : `term_${pane.paneId.replace(':', '_')}`,
      workspace_id: w.workspaceId,
      // As herdr sends them: `terminal_title` with Claude's status glyph in
      // front, `title` and the stripped one without.
      ...(pane.title === undefined ? {} : {
        title: pane.title, terminal_title: `✳ ${pane.title}`, terminal_title_stripped: pane.title,
      }),
      ...(this.trusting.has(pane.paneId) ? { input_pending: true, input_prompt_kind: 'unknown' } : {}),
      agent_session: pane.agent === 'omp'
        ? { agent: 'omp', kind: 'path', source: 'herdr:omp', value: this.fixtures.ompPaths[pane.paneId] ?? null }
        : { agent: 'claude', kind: 'id', source: 'herdr:claude', value: this.fixtures.sessionIds[pane.paneId] ?? null },
    })));
  }

  /** `herdr <verb>`. */
  private herdr(argv: string[]): ExecResult {
    const verb = argv.slice(1).join(' ');

    if (verb === 'status server') return ok({ running: true });
    if (verb === 'workspace list') return ok({ workspaces: this.workspaceRows() });
    if (verb === 'agent list') return ok({ agents: this.agentRows() });
    // Bare JSON, not an envelope, as herdr prints it.
    if (verb === 'machine list --json') {
      return out(JSON.stringify(this.fixtures.machines.map(({ id, label, target, session, enabled }) => ({
        id, label, target, session, enabled, selected: false,
      }))));
    }

    if (argv[1] === 'workspace' && ['create', 'rename', 'close'].includes(argv[2] ?? '')) {
      return out(JSON.stringify({ error: {
        code: 'demo_action_unavailable',
        message: 'Select your own host to create, rename or close chats. Demo contains sample conversations only.',
      } }));
    }

    if (verb === 'api snapshot') {
      return ok({
        snapshot: {
          agents: this.agentRows(),
          workspaces: this.workspaceRows(),
          focused_pane_id: this.fixtures.focusedPaneId,
          focused_tab_id: `${this.focusedWorkspaceId()}:t1`,
          focused_workspace_id: this.focusedWorkspaceId(),
          version: DEMO_HERDR_VERSION,
          protocol: 19,
        },
      });
    }

    // `pane read <pane> --source visible --lines N`
    if (argv[1] === 'pane' && argv[2] === 'read') {
      const paneId = argv[3] ?? '';
      const panel = this.panels.get(paneId);
      if (panel !== undefined) return out(panel.kind === 'model' ? modelPanelScreen(panel) : effortPanelScreen(panel));
      const questions = this.questions.get(paneId);
      if (questions !== undefined) return out(questionScreen(questions.step, questions.answers));
      const cursor = this.trusting.get(paneId);
      if (cursor !== undefined) return out(trustScreen(cursor));
      return out(this.statusOf(paneId) === 'blocked' ? DEMO_BLOCKED_SCREEN : '');
    }

    // `pane send-keys <pane> <key>…` — how a blocked-prompt answer is delivered.
    if (argv[1] === 'pane' && argv[2] === 'send-keys') {
      const paneId = argv[3] ?? '';
      const choice = argv[4] ?? '';
      if (this.panels.has(paneId)) return this.panelKeys(paneId, argv.slice(4));
      if (this.questions.has(paneId)) return this.questionKey(paneId, choice);
      if (this.trusting.has(paneId)) return this.trustKeys(paneId, argv.slice(4));
      if (['Escape', 'escape', 'Esc', 'ctrl+c', 'C-c'].includes(choice)) {
        this.pending = this.pending.filter(reply => reply.paneId !== paneId);
        this.statuses.set(paneId, 'idle');
        return silent();
      }
      if (this.statusOf(paneId) === 'blocked') {
        this.statuses.set(paneId, 'working');
        this.pending.push({ paneId, prompt: '', answer: choice, dueAt: this.now() + REPLY_DELAY_MS });
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
      if (this.trusting.has(paneId)) {
        return out(JSON.stringify({ error: {
          code: 'agent_input_pending',
          message: `agent ${paneId} has a pending unknown input prompt; chat prompt was not written`,
        } }));
      }
      if (text.trim().startsWith('/') && !this.isOmp(paneId)) return this.command(paneId, text);
      this.append(paneId, this.isOmp(paneId) ? ompLine('user', text, this.uuid(), this.stamp()) : userLine(text, this.uuid(), this.stamp()));
      const asked = text.toLowerCase();
      if (asked.includes(DEMO_PHRASES.questions)) return this.askQuestions(paneId);
      if (asked.includes(DEMO_PHRASES.tools)) return this.runChecks(paneId);
      if (asked.includes(DEMO_PHRASES.trust)) return this.askTrust(paneId);
      if (asked.includes(DEMO_PHRASES.table)) return this.compareOptions(paneId);
      if (asked.includes(DEMO_PHRASES.theme)) return this.writeTheme(paneId);
      this.statuses.set(paneId, 'working');
      this.pending.push({ paneId, prompt: text, dueAt: this.now() + REPLY_DELAY_MS });
      return silent();
    }

    return silent();
  }

  // MARK: - Scenarios (see scenarios.ts)

  /**
   * A slash command. One with a panel opens it and leaves the agent idle, as
   * Claude does; the command reaches the transcript only when the panel
   * closes. Anything else prints at once.
   */
  private command(paneId: string, text: string): ExecResult {
    const panel = panelFor(text);
    if (panel !== null) {
      this.panels.set(paneId, panel);
      return silent();
    }
    const name = text.trim().split(/\s+/)[0] ?? text;
    this.writeCommand(paneId, text, `This is the demo host, so ${name} did nothing here.`);
    return silent();
  }

  private panelKeys(paneId: string, keys: readonly string[]): ExecResult {
    for (const key of keys) {
      const panel = this.panels.get(paneId);
      if (panel === undefined) break;
      const next = panelKey(panel, key);
      if ('panel' in next) {
        this.panels.set(paneId, next.panel);
      } else {
        this.panels.delete(paneId);
        this.writeCommand(paneId, panel.kind === 'model' ? '/model' : '/effort', next.printed);
      }
    }
    return silent();
  }

  private writeCommand(paneId: string, command: string, printed: string): void {
    for (const written of commandLines(command, printed, [this.uuid(), this.uuid()], this.stamp())) {
      this.append(paneId, written);
    }
  }

  /** AskUserQuestion with two questions, then the review screen that submits them. */
  private askQuestions(paneId: string): ExecResult {
    const toolId = `toolu_demo_${this.uuid()}`;
    const input = { questions: DEMO_QUESTIONS.map((q) => ({ question: q.question, options: q.options.map((label) => ({ label })) })) };
    this.append(paneId, toolUseLine('AskUserQuestion', input, toolId, this.uuid(), this.stamp()));
    this.questions.set(paneId, { step: 0, answers: [], toolId });
    this.statuses.set(paneId, 'blocked');
    return silent();
  }

  private questionKey(paneId: string, key: string): ExecResult {
    const state = this.questions.get(paneId);
    if (state === undefined) return silent();
    if (['Escape', 'escape', 'Esc'].includes(key)) {
      this.questions.delete(paneId);
      this.statuses.set(paneId, 'idle');
      return silent();
    }
    if (state.step < DEMO_QUESTIONS.length) {
      const answer = questionAnswer(state.step, key);
      if (answer !== null) this.questions.set(paneId, { ...state, step: state.step + 1, answers: [...state.answers, answer] });
      return silent();
    }
    // The review screen: 1 submits, 2 cancels.
    if (key !== '1' && key !== '2') return silent();
    this.questions.delete(paneId);
    const submitted = key === '1';
    const summary = submitted ? `You picked ${state.answers.join(' and ')}.` : 'You cancelled the questions.';
    this.statuses.set(paneId, 'working');
    this.pending.push({
      paneId,
      prompt: '',
      dueAt: this.now() + REPLY_DELAY_MS,
      lines: (next, timestamp) => [
        toolResultLine(state.toolId, submitted ? state.answers.join(', ') : 'Cancelled', !submitted, next(), timestamp),
        replyLine(summary, next(), timestamp),
      ],
    });
    return silent();
  }

  /**
   * As if the agent had just started in a folder Claude does not trust yet:
   * the question waits for keys, the agent stays idle, and a prompt is refused
   * until it is answered, the way a new chat in a new folder starts.
   */
  private askTrust(paneId: string): ExecResult {
    this.trusting.set(paneId, 0);
    this.statuses.set(paneId, 'idle');
    return silent();
  }

  private trustKeys(paneId: string, keys: readonly string[]): ExecResult {
    for (const key of keys) {
      const cursor = this.trusting.get(paneId);
      if (cursor === undefined) break;
      if (key === 'Up') this.trusting.set(paneId, Math.max(0, cursor - 1));
      else if (key === 'Down') this.trusting.set(paneId, Math.min(TRUST_OPTIONS.length - 1, cursor + 1));
      else if (['Enter', 'Escape', 'escape', 'Esc'].includes(key)) {
        this.trusting.delete(paneId);
        const trusted = key === 'Enter' && TRUST_OPTIONS[cursor] === 'Yes, I trust this folder';
        this.append(paneId, replyLine(
          trusted
            ? 'Thanks, I can work in this folder now. What should we do first?'
            : 'You chose not to trust that folder, so Claude would exit here. On the demo host this chat stays open.',
          this.uuid(),
          this.stamp()
        ));
      }
    }
    return silent();
  }

  /** A reply with a table in it. */
  private compareOptions(paneId: string): ExecResult {
    this.statuses.set(paneId, 'working');
    this.pending.push({
      paneId,
      prompt: '',
      dueAt: this.now() + REPLY_DELAY_MS,
      lines: (next, timestamp) => [replyLine(DEMO_TABLE_REPLY, next(), timestamp)],
    });
    return silent();
  }

  /**
   * The agent restyles the app: it writes ~/.herdrchat/theme.json, says so,
   * and from then on the theme fetch serves the file with a new mtime. The file
   * lands with the reply, not with the prompt, as it would on a real host.
   */
  private writeTheme(paneId: string): ExecResult {
    this.statuses.set(paneId, 'working');
    const path = `${DEMO_HOME}/.herdrchat/${THEME_FILE}`;
    this.pending.push({
      paneId,
      prompt: '',
      dueAt: this.now() + REPLY_DELAY_MS,
      effect: () => this.writeHostFile(THEME_FILE, DEMO_THEME_TEXT),
      lines: (next, timestamp) => {
        const id = `toolu_demo_${next()}`;
        return [
          toolUseLine('Write', { file_path: path, content: DEMO_THEME_TEXT }, id, next(), timestamp),
          toolResultLine(id, `File created successfully at: ${path}`, false, next(), timestamp),
          replyLine(DEMO_THEME_REPLY, next(), timestamp),
        ];
      },
    });
    return silent();
  }

  /** A run of tool calls with one failure, then a closing sentence. */
  private runChecks(paneId: string): ExecResult {
    this.statuses.set(paneId, 'working');
    this.pending.push({
      paneId,
      prompt: '',
      dueAt: this.now() + REPLY_DELAY_MS,
      lines: (next, timestamp) => {
        const call = (name: string, input: Record<string, unknown>, result: string, failed = false) => {
          const id = `toolu_demo_${next()}`;
          return [toolUseLine(name, input, id, next(), timestamp), toolResultLine(id, result, failed, next(), timestamp)];
        };
        return [
          ...call('Bash', { command: 'npm test', description: 'Run the tests' }, 'FAIL src/lib/directories.test.ts\n  1 failed, 41 passed', true),
          ...call('Read', { file_path: 'src/lib/directories.ts' }, 'export async function listDirectories(…)'),
          ...call('Edit', { file_path: 'src/lib/directories.ts', old_string: '; true', new_string: '' }, 'The file has been updated.'),
          ...call('Bash', { command: 'npm test', description: 'Run the tests again' }, '42 passed'),
          replyLine('One test failed on the first run: an unreadable folder still read as empty. Fixed it in directories.ts, and all 42 tests pass now.', next(), timestamp),
        ];
      },
    });
    return silent();
  }
}
