import {
  decodeAgentInfo,
  decodePane,
  decodeSnapshot,
  decodeWorkspace,
  decodeWorkspaceCreation,
  type AgentInfo,
  type AgentStatus,
  type Pane,
  type Snapshot,
  type Workspace,
  type WorkspaceCreation,
} from './models';
import { HerdrError, checkEnvelope, decodeEnvelope } from './protocol';
import { shellCommand, shellQuote, withPath } from './shell';
import {
  INSTALL_TIMEOUT_MS,
  LAUNCH_TIMEOUT_MS,
  POLL_TIMEOUT_MS,
  SCREEN_TIMEOUT_MS,
  SEND_TIMEOUT_MS,
} from './timeouts';
import type { HerdrTransport } from './transport';

/**
 * High-level herdr operations over any transport. Command shapes mirror the
 * `herdr` CLI helpers, which wrap the socket API and print `{id, result}` JSON.
 *
 * Behaviour ported from the original SwiftUI implementation (see git
 * history before the Expo rewrite).
 */
export class HerdrClient {
  /**
   * Public so a `TranscriptStore` can share the same connection. Reading
   * transcripts and driving herdr are the same conversation with the same host;
   * giving the store its own transport would open a second SSH connection to
   * say the same things.
   */
  readonly transport: HerdrTransport;
  /** The `herdr` executable name/path on the host (overridable if not on PATH). */
  private readonly herdr: string;

  constructor(transport: HerdrTransport, herdrPath = 'herdr') {
    this.transport = transport;
    this.herdr = herdrPath;
  }

  // MARK: - Reads

  async snapshot(): Promise<Snapshot> {
    const result = await this.run([this.herdr, 'api', 'snapshot'], POLL_TIMEOUT_MS);
    return decodeSnapshot(field(result, 'snapshot'));
  }

  async workspaces(): Promise<Workspace[]> {
    const result = await this.run([this.herdr, 'workspace', 'list'], POLL_TIMEOUT_MS);
    return asArray(field(result, 'workspaces')).map(decodeWorkspace);
  }

  async agents(): Promise<AgentInfo[]> {
    const result = await this.run([this.herdr, 'agent', 'list'], POLL_TIMEOUT_MS);
    return asArray(field(result, 'agents')).map(decodeAgentInfo);
  }

  async panes(): Promise<Pane[]> {
    const result = await this.run([this.herdr, 'pane', 'list'], POLL_TIMEOUT_MS);
    return asArray(field(result, 'panes')).map(decodePane);
  }

  /** Confirm the host is reachable and herdr is answering. */
  async ping(): Promise<void> {
    await this.shell(shellCommand([this.herdr, 'status', 'server']), POLL_TIMEOUT_MS);
  }

  /**
   * Install herdr on the host via the official one-liner (into ~/.local/bin,
   * which the PATH prefix already covers). The recovery action when a connect
   * fails because herdr isn't installed on that account.
   */
  async installHerdr(): Promise<void> {
    await this.shell('curl -fsSL https://herdr.dev/install.sh | sh', INSTALL_TIMEOUT_MS);
  }

  /**
   * The host user's home directory — the starting point for browsing to a
   * working directory in the new-chat folder picker.
   */
  async homeDirectory(): Promise<string> {
    const output = await this.shell('printf %s "$HOME"', POLL_TIMEOUT_MS);
    const home = output.trim();
    return home.length > 0 ? home : '/';
  }

  /**
   * Immediate subdirectories of `path` on the host (names only, sorted, hidden
   * dirs excluded), so a working directory can be chosen by browsing the device
   * instead of typed from memory.
   */
  async listDirectories(path: string): Promise<string[]> {
    // `-p` appends "/" to directories and `-L` follows symlinked dirs, so we can
    // keep only entries ending in "/" and strip it. An unreadable path yields
    // nothing rather than erroring the picker.
    const command = `cd ${shellQuote(path)} 2>/dev/null && ls -1Lp 2>/dev/null; true`;
    const output = await this.shell(command, POLL_TIMEOUT_MS);
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.endsWith('/'))
      .map((line) => line.slice(0, -1))
      .filter((name) => name.length > 0 && name !== '.' && name !== '..')
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  /**
   * The pane's currently VISIBLE screen — needed to read Claude's on-screen
   * choice menus (permission prompts, AskUserQuestion). Claude runs on the
   * terminal's alternate screen, so `recent`/`recent-unwrapped` (scrollback)
   * come back empty; only `visible` captures the live menu.
   */
  paneVisible(paneId: string, lines: number): Promise<string> {
    return this.shell(
      shellCommand([
        this.herdr,
        'pane',
        'read',
        paneId,
        '--source',
        'visible',
        '--lines',
        String(lines),
      ]),
      SCREEN_TIMEOUT_MS
    );
  }

  // MARK: - Writes

  /**
   * Type a chat message into an agent pane and submit it. `pane run` sends the
   * text and a real Enter in one request — a separate `send-keys enter` types
   * the text but doesn't submit inside an agent TUI (only in a plain shell).
   */
  async sendMessage(paneId: string, text: string): Promise<void> {
    const output = await this.shell(
      shellCommand([this.herdr, 'pane', 'run', paneId, text]),
      SEND_TIMEOUT_MS
    );
    checkEnvelope(output);
  }

  /** Send raw keys to a pane, e.g. a quick reply to a blocked prompt. */
  async sendKeys(paneId: string, keys: readonly string[]): Promise<void> {
    const output = await this.shell(
      shellCommand([this.herdr, 'pane', 'send-keys', paneId, ...keys]),
      SEND_TIMEOUT_MS
    );
    checkEnvelope(output);
  }

  /**
   * Create a new workspace rooted at `cwd` without stealing focus on the
   * desktop. Follow with `startAgent` on the returned root pane.
   */
  async createWorkspace(cwd: string, label: string | null): Promise<WorkspaceCreation> {
    const argv = [this.herdr, 'workspace', 'create', '--cwd', cwd, '--no-focus'];
    if (label !== null && label.length > 0) argv.push('--label', label);
    const result = await this.run(argv, LAUNCH_TIMEOUT_MS);
    return decodeWorkspaceCreation(result);
  }

  /**
   * Launch an agent in a freshly created pane's shell. Uses `pane run`, which
   * types the command and presses Enter in one request.
   */
  async startAgent(paneId: string, command = 'claude'): Promise<void> {
    const output = await this.shell(
      shellCommand([this.herdr, 'pane', 'run', paneId, command]),
      LAUNCH_TIMEOUT_MS
    );
    checkEnvelope(output);
  }

  /**
   * Block until the agent in a pane reaches `status`, or the timeout elapses.
   * Backs delivery verification: after submitting a prompt the agent should flip
   * to `working`. Returns false on timeout rather than throwing — not reaching
   * the state is the answer the caller wants.
   */
  async waitAgentStatus(paneId: string, status: AgentStatus, timeoutMs: number): Promise<boolean> {
    try {
      const result = await this.transport.exec(
        withPath(
          shellCommand([
            this.herdr,
            'agent',
            'wait',
            paneId,
            '--status',
            status,
            '--timeout',
            String(timeoutMs),
          ])
        ),
        // herdr's own wait, plus headroom. Our deadline must never fire before
        // the one we asked the host to honour, or a normal "didn't reach the
        // state" answer would come back as a transport timeout.
        timeoutMs + SEND_TIMEOUT_MS
      );
      return result.ok && result.exitCode === 0;
    } catch {
      return false;
    }
  }

  // MARK: - Plumbing

  /** Run an argv (quoted, so arbitrary user text is safe) and unwrap the envelope. */
  private async run(argv: readonly string[], timeoutMs: number): Promise<unknown> {
    const output = await this.shell(shellCommand(argv), timeoutMs);
    return decodeEnvelope(output);
  }

  /**
   * Run a shell command on the host, mapping transport failures and the exit
   * statuses that mean something specific into `HerdrError`.
   */
  private async shell(command: string, timeoutMs: number): Promise<string> {
    const result = await this.transport.exec(withPath(command), timeoutMs);
    if (!result.ok) {
      throw new HerdrError(result.code, result.message);
    }
    if (result.exitCode !== 0) {
      throw exitCodeError(result.exitCode, result.stderr);
    }
    return result.stdout;
  }
}

/**
 * Turn a non-zero exit into a helpful message. Exit 127 = "command not found",
 * which for us almost always means `herdr` isn't installed on this account (or
 * isn't on PATH) — spell that out instead of a bare code, because it has a
 * one-tap recovery.
 */
export function exitCodeError(exitCode: number, stderr = ''): HerdrError {
  if (exitCode === 127) {
    return new HerdrError(
      'herdr_not_found',
      "herdr wasn't found on this account (exit 127). It's likely not installed for this user, or not on PATH. Install herdr on the host, or set its full path in the connection's Advanced settings."
    );
  }
  const detail = stderr.trim().split('\n')[0] ?? '';
  return new HerdrError(
    'ssh_command_failed',
    detail.length > 0
      ? `The command failed on the host (exit ${exitCode}): ${detail}`
      : `The command failed on the host (exit ${exitCode}).`
  );
}

function field(result: unknown, key: string): unknown {
  return typeof result === 'object' && result !== null
    ? (result as Record<string, unknown>)[key]
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
