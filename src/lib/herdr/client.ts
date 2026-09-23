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
import { HerdrError, checkEnvelope, decodeEnvelope, exitCodeError, herdrErrorFrom, transportError } from './protocol';
import { commandWord, shellCommand, shellQuote, withPath } from './shell';
import { HerdrSocket } from './socket';
import {
  INSTALL_TIMEOUT_MS,
  LAUNCH_TIMEOUT_MS,
  POLL_TIMEOUT_MS,
  SCREEN_TIMEOUT_MS,
  SEND_TIMEOUT_MS,
} from './timeouts';
import type { HerdrTransport } from './transport';
import {
  parseWatcherStatus,
  watcherInstallCommand,
  watcherRemoveCommand,
  watcherStatusCommand,
  type WatcherState,
} from '../notifier/watcher';
import { AGENT_VERBS_VERSION, atLeast } from './version';

// Kept here for `TranscriptStore` and the tests that grew up importing them from the client.
export { exitCodeError, herdrErrorFrom } from './protocol';

/**
 * What the host observed about a submitted prompt. See `sendPrompt`.
 */
export type PromptOutcome = 'delivered' | 'stalled' | 'unverified';

/**
 * How long to let herdr watch for the agent to react.
 *
 * Its stall detection uses a fixed 5000ms window for the first state change,
 * and its help warns that "a shorter --timeout returns timeout instead" — which
 * would turn a diagnosable stall into a generic timeout. So this stays above
 * that floor.
 */
const PROMPT_WAIT_MS = 8000;

/** Upstream `agent_blocked`: the prompt was refused before anything was sent. */
const AGENT_BLOCKED_MESSAGE =
  'The agent is waiting on a question. Answer it first, then send your message.';

/**
 * How long to wait for a freshly spawned server to answer.
 *
 * Measured: about five seconds on a warm machine. Ten attempts a second apart
 * is generous enough for a cold or loaded host without leaving a spinner up so
 * long that it reads as hung.
 */
const SERVER_START_POLLS = 10;
const SERVER_START_INTERVAL_MS = 1000;

/**
 * How long to let a freshly created pane reach its shell prompt.
 *
 * `agent start` refuses a pane that is not "an available shell", and a pane
 * created milliseconds earlier often is not one yet. Measured on a warm host it
 * is ready immediately; this is headroom for a cold or loaded one.
 */
const PANE_READY_RETRIES = 4;
const PANE_READY_INTERVAL_MS = 750;

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
  /**
   * The socket API on the same connection. Public so hooks can hold an
   * `events.subscribe` stream open; everything request-shaped goes through the
   * methods below, which fall back to the CLI on a host the socket cannot be
   * reached on.
   */
  readonly socket: HerdrSocket;

  constructor(transport: HerdrTransport, herdrPath = 'herdr') {
    this.transport = transport;
    this.herdr = herdrPath;
    this.socket = new HerdrSocket(transport, herdrPath);
  }

  // MARK: - Reads

  async snapshot(): Promise<Snapshot> {
    const result = await this.request('session.snapshot', {}, POLL_TIMEOUT_MS, () =>
      this.run([this.herdr, 'api', 'snapshot'], POLL_TIMEOUT_MS)
    );
    const snapshot = decodeSnapshot(field(result, 'snapshot'));
    // Remembered so the capability gates below can answer from it instead of
    // spending a round-trip on `--help`. The field has been in the snapshot all
    // along and nothing read it.
    if (snapshot.version !== null) {
      this.hostVersion = snapshot.version;
      // The reported version outranks any probe. A probe-derived "no" — taken
      // before the first poll landed, possibly against a host that was
      // answering badly — would otherwise downgrade this client to the legacy
      // paths for its whole lifetime. Forget it; the next send answers from
      // the version.
      if (this.agentPrompt?.provenance === 'probe') this.agentPrompt = null;
      if (this.agentStart?.provenance === 'probe') this.agentStart = null;
    }
    return snapshot;
  }

  /**
   * The host's herdr version, as last reported by a snapshot.
   *
   * Null until the first poll lands. Public so the UI can show it — a version
   * you can quote is the first thing a support conversation needs.
   */
  get reportedVersion(): string | null {
    return this.hostVersion;
  }

  private hostVersion: string | null = null;

  async workspaces(): Promise<Workspace[]> {
    const result = await this.request('workspace.list', {}, POLL_TIMEOUT_MS, () =>
      this.run([this.herdr, 'workspace', 'list'], POLL_TIMEOUT_MS)
    );
    return asArray(field(result, 'workspaces')).map(decodeWorkspace);
  }

  async agents(): Promise<AgentInfo[]> {
    const result = await this.request('agent.list', {}, POLL_TIMEOUT_MS, () =>
      this.run([this.herdr, 'agent', 'list'], POLL_TIMEOUT_MS)
    );
    return asArray(field(result, 'agents')).map(decodeAgentInfo);
  }

  async panes(): Promise<Pane[]> {
    const result = await this.request('pane.list', {}, POLL_TIMEOUT_MS, () =>
      this.run([this.herdr, 'pane', 'list'], POLL_TIMEOUT_MS)
    );
    return asArray(field(result, 'panes')).map(decodePane);
  }

  /** Confirm the host is reachable and herdr is answering. */
  async ping(): Promise<void> {
    await this.shell(shellCommand([this.herdr, 'status', 'server']), POLL_TIMEOUT_MS);
  }

  /**
   * Why herdr thinks this pane's agent is in the state it is in.
   *
   * The app shows `agentStatus` and, when it looks wrong, has nothing further to
   * say — which is the worst possible position for the one screen a person opens
   * when something is broken. This is herdr's own account of its detection, and
   * for Claude that account is the whole story: Claude is a "session identity"
   * integration, so it reports which conversation it is but NOT its state, and
   * the state comes from herdr's screen manifest. When the status is wrong, the
   * manifest is where the answer is.
   *
   * Best-effort by design: returns null rather than throwing, because this is
   * diagnostic colour attached to a bug report and must never be the reason one
   * cannot be filed.
   */
  async explainAgent(target: string): Promise<string | null> {
    try {
      const output = await this.shell(
        shellCommand([this.herdr, 'agent', 'explain', target, '--json']),
        POLL_TIMEOUT_MS
      );
      const trimmed = output.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch {
      return null;
    }
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
   * Start herdr's headless server on the host.
   *
   * The app could already INSTALL herdr and could not start it, which left the
   * most recoverable failure of the three as the only one with no way out —
   * `server_not_running` told you to open a terminal on another machine.
   *
   * `herdr server`, not `herdr`: the bare command launches or attaches the
   * interactive session, which over a non-interactive SSH exec would be a TUI
   * with nobody at it. The headless server is the mode meant for this.
   *
   * `nohup … &` and the redirects are what let it outlive the SSH channel that
   * spawned it. Measured on a real host: the parent shell exits immediately, the
   * server answers within about five seconds, and it is still up long after.
   *
   * Safe to press twice — herdr refuses a second instance with "herdr server is
   * already running" rather than racing itself. Which is why this reports
   * SUCCESS on that message: a button whose job is "make the server run" has
   * done its job if the server is running.
   */
  async startServer(): Promise<void> {
    await this.shell(
      `nohup ${commandWord(this.herdr)} server >/dev/null 2>&1 & echo started`,
      LAUNCH_TIMEOUT_MS
    );
    // The spawn returns immediately; the socket takes a moment. Confirm rather
    // than assume, so the banner does not clear on a server that never came up.
    for (let attempt = 0; attempt < SERVER_START_POLLS; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, SERVER_START_INTERVAL_MS));
      try {
        await this.snapshot();
        return;
      } catch {
        /* not up yet */
      }
    }
    throw new HerdrError(
      'server_start_failed',
      "herdr was started on the host but didn't come up. Check it there — `herdr status server`."
    );
  }

  /**
   * Install one of herdr's agent integrations on the host.
   *
   * The Claude integration is what makes herdr report `agent_session.value` —
   * the transcript filename this whole app is built on. Without it every pane
   * reports a null session, the thread cannot identify which conversation it is
   * looking at, and it refuses to guess.
   *
   * We already detected that precisely and told the user which command to run;
   * this is the same thing with the terminal step removed. Less invasive than
   * `installHerdr`, which pipes a remote script into a shell — this runs a
   * subcommand of a binary already trusted enough to be driving the machine.
   */
  // MARK: - Notification watcher

  /** Whether this host runs the notification watcher, and which version. */
  async watcherStatus(): Promise<WatcherState> {
    return parseWatcherStatus(await this.shell(watcherStatusCommand(), POLL_TIMEOUT_MS));
  }

  /**
   * Install or update the notification watcher as a service on this host, and
   * start it. Answers with the state it ended in.
   */
  async installWatcher(): Promise<WatcherState> {
    return parseWatcherStatus(await this.shell(watcherInstallCommand(this.herdr), LAUNCH_TIMEOUT_MS));
  }

  /** Stop and remove the app-installed watcher for this host's session. */
  async removeWatcher(): Promise<void> {
    await this.shell(watcherRemoveCommand(), SEND_TIMEOUT_MS);
  }

  /**
   * The integrations this app relies on (Claude, Codex) that the host reports
   * as `outdated`. herdr 0.9.1 moved the Claude integration from v9 to v10
   * (when its SessionStart hook fires) and says to reinstall, and nothing
   * tells a user who upgraded herdr that theirs is now stale (#93).
   *
   * Null when the host cannot be asked: no socket, or a herdr without
   * `integration.list`. Best effort, so any failure is also null, never a
   * banner of its own.
   */
  async outdatedIntegrations(): Promise<('claude' | 'codex')[] | null> {
    if ((await this.socket.detect()) === null) return null;
    try {
      const result = await this.socket.call('integration.list', {}, POLL_TIMEOUT_MS);
      return asArray(field(result, 'integrations')).flatMap((item) => {
        if (typeof item !== 'object' || item === null) return [];
        const { target, state } = item as { target?: unknown; state?: unknown };
        return (target === 'claude' || target === 'codex') && state === 'outdated' ? [target] : [];
      });
    } catch {
      return null;
    }
  }

  async installIntegration(name = 'claude'): Promise<void> {
    const output = await this.shell(
      shellCommand([this.herdr, 'integration', 'install', name]),
      INSTALL_TIMEOUT_MS
    );
    checkEnvelope(output);
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
    // keep only entries ending in "/" and strip it.
    //
    // The trailing `; true` this used to end with made EVERY failure — no such
    // directory, no permission to read it — arrive as exit 0 with no output, so
    // the picker said "No subfolders here" about a folder it never opened.
    // Now a failed `cd`, and an `ls` that produced nothing at all, exit
    // non-zero; a directory that is readable but empty still exits 0. `ls` is
    // allowed to fail once it HAS printed entries, because one broken symlink
    // is a non-zero exit on macOS and that listing is still worth showing.
    const command = [
      `cd ${shellQuote(path)} 2>/dev/null || exit 3`,
      'entries=$(ls -1Lp 2>/dev/null) || [ -n "$entries" ] || exit 4',
      'printf %s "$entries"',
    ].join('\n');
    const output = await this.shell(command, POLL_TIMEOUT_MS).catch((thrown: unknown) => {
      throw thrown instanceof HerdrError && thrown.code === 'ssh_command_failed'
        ? new HerdrError(
            'dir_unreadable',
            `Couldn't read ${path} on the host. It may not exist, or this account may not have permission to open it.`
          )
        : thrown;
    });
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
  async paneVisible(paneId: string, lines: number): Promise<string> {
    const route = await this.socket.detect();
    if (route !== null) {
      const result = await this.socket.call(
        'pane.read',
        { pane_id: paneId, source: 'visible', lines },
        SCREEN_TIMEOUT_MS
      );
      const text = field(field(result, 'read'), 'text');
      return typeof text === 'string' ? text : '';
    }
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
   *
   * The legacy path. Prefer `sendPrompt`, which uses the agent-aware verb where
   * the host has it.
   */
  async sendMessage(paneId: string, text: string): Promise<void> {
    const output = await this.shell(
      shellCommand([this.herdr, 'pane', 'run', paneId, text]),
      SEND_TIMEOUT_MS
    );
    checkEnvelope(output);
  }

  /**
   * Submit a prompt to the agent in a pane.
   *
   * Returns what the HOST observed:
   *
   * - `delivered` — herdr watched the agent react. Nothing to verify.
   * - `stalled`   — herdr watched and nothing moved within its window. The
   *                 prompt is sitting in the composer; this is the failure the
   *                 blind Enter used to guess at, reported by name.
   * - `unverified` — the host has no `agent prompt`, so `pane run` sent
   *                 keystrokes and only the caller can tell whether they took.
   *
   * A three-way answer rather than a boolean because the caller does something
   * different in each case, and collapsing `stalled` into "false" would put it
   * back on the legacy guessing path it exists to replace.
   *
   * `agent prompt` is understood by herdr as "give this text to the agent", so
   * a success means delivered. `pane run` only means "the keystrokes were
   * sent", which is why `unverified` still costs the caller a status watch.
   *
   * WHY A PROBE RATHER THAN TRY-AND-FALL-BACK. The obvious shape is to attempt
   * `agent prompt` and fall back to `pane run` when it errors — and that is
   * unsafe here, because "it errored" and "it did nothing" are not the same
   * thing. A verb that half-landed would then be followed by a second send, and
   * a duplicated prompt is exactly the class of bug this replaces. `--help`
   * cannot send anything, so probing once per host per app run costs one
   * round-trip and removes the ambiguity.
   */
  async sendPrompt(paneId: string, text: string): Promise<PromptOutcome> {
    if ((await this.socket.detect()) !== null) {
      return this.sendPromptViaSocket(paneId, text);
    }
    if (!(await this.supportsAgentPrompt())) {
      await this.sendMessage(paneId, text);
      return 'unverified';
    }

    try {
      const output = await this.shell(
        shellCommand([
          this.herdr,
          'agent',
          'prompt',
          paneId,
          text,
          // Let the HOST decide whether the prompt landed. Its own help:
          // "When submission starts from a non-working state, --wait first
          // requires an observed state change within 5000ms; otherwise it
          // returns agent_prompt_stalled."
          //
          // That is precisely the case the blind Enter was written for — a
          // prompt left sitting in the composer — except herdr observes it
          // instead of us guessing after a fixed sleep, and it says so by name.
          '--wait',
          '--timeout',
          String(PROMPT_WAIT_MS),
        ]),
        // Our deadline has to outlast the host's, or we abandon a wait that is
        // about to answer and report a failure the host never had.
        PROMPT_WAIT_MS + SEND_TIMEOUT_MS
      );
      checkEnvelope(output);
      return 'delivered';
    } catch (thrown) {
      // The one error that is an ANSWER rather than a failure: herdr watched,
      // and nothing moved. The message is still in the composer.
      if (thrown instanceof HerdrError && thrown.code === 'agent_prompt_stalled') {
        return 'stalled';
      }
      throw thrown;
    }
  }

  /**
   * `agent.prompt` on the socket. Same three answers as the CLI path, read off
   * different fields:
   *
   * - a success is `delivered`. Upstream herdr answers `{ agent }` and nothing
   *   more, and with `wait.until` set that answer only comes once it OBSERVED
   *   the agent reach one of those states. The one exception is the
   *   jerryfane/herdr fork, which adds `delivery: "written_to_pty"` when it
   *   only knows the bytes went in; that stays `unverified` for the caller's
   *   status watch. Reading "no `submitted` field" as unverified, as this did
   *   before, sent every upstream prompt down the fallback-Enter path (#76);
   * - a `timeout` error from herdr is the host saying it sent the text and
   *   watched for `working` and nothing moved, which is what `stalled` has
   *   always meant. A transport timeout is not that, and is rethrown;
   * - `agent_blocked` is upstream refusing before sending anything, because the
   *   agent has a question open. It is rethrown with words a person can act on;
   * - `invalid_request` naming an unknown variant is a herdr too old for the
   *   verb. Nothing was sent, so the legacy path is safe to try.
   *
   * `until` is `working` and `blocked` — an agent that stops to ask permission
   * has read the prompt just as surely. Not `done` or `idle`: an agent already
   * in either state would match at once and the wait would observe nothing.
   */
  private async sendPromptViaSocket(paneId: string, text: string): Promise<PromptOutcome> {
    try {
      const result = await this.socket.call(
        'agent.prompt',
        {
          target: paneId,
          text,
          wait: { until: ['working', 'blocked'], timeout_ms: PROMPT_WAIT_MS },
        },
        PROMPT_WAIT_MS + SEND_TIMEOUT_MS
      );
      return field(result, 'delivery') === 'written_to_pty' ? 'unverified' : 'delivered';
    } catch (thrown) {
      if (thrown instanceof HerdrError) {
        // herdr's own timeout only. The transport's means nobody knows whether
        // the prompt landed, and the caller has to find out (#83).
        if ((thrown.code === 'timeout' && !thrown.transport) || thrown.code === 'agent_prompt_stalled') {
          return 'stalled';
        }
        if (thrown.code === 'agent_blocked') throw new HerdrError('agent_blocked', AGENT_BLOCKED_MESSAGE);
        if (isUnknownMethod(thrown)) {
          await this.sendMessage(paneId, text);
          return 'unverified';
        }
      }
      throw thrown;
    }
  }

  /**
   * Whether a subcommand exists, asked without invoking it.
   *
   * Three answers, not two, because "the host said no" and "the host couldn't
   * be asked" age differently: the first is a fact about this herdr and can be
   * memoised, while the second is a fact about one moment of the network and
   * must not be.
   */
  private async probe(subcommand: readonly string[]): Promise<ProbeOutcome> {
    try {
      const result = await this.transport.exec(
        withPath(shellCommand([this.herdr, ...subcommand, '--help'])),
        POLL_TIMEOUT_MS
      );
      if (!result.ok) return 'unreachable';
      return result.exitCode === 0 ? 'supported' : 'unsupported';
    } catch {
      return 'unreachable';
    }
  }

  /**
   * Stop what the agent is doing, without ending the session.
   *
   * Escape is Claude's own "stop this turn" — the agent stays alive and the
   * conversation survives, which is what someone reaching for a stop button on
   * a phone almost always means. `interruptHard` is the other thing.
   *
   * The two spellings are a hedge, not indecision. Our one proven key name is
   * the capitalised `Enter` that quick replies have always sent, while the
   * Raycast extension — shipping against the same CLI — sends lowercase `esc`.
   * Both cannot be checked from here, and a stop button that silently does
   * nothing is worse than one that costs an extra round-trip on hosts where the
   * first spelling is wrong. Whichever works, works.
   */
  async interrupt(paneId: string): Promise<void> {
    await this.sendFirstAccepted(paneId, ['Escape', 'esc']);
  }

  /**
   * Ctrl-C. A bigger hammer: this can exit the agent process and end the
   * session, losing the conversation, so the UI asks first.
   */
  async interruptHard(paneId: string): Promise<void> {
    await this.sendFirstAccepted(paneId, ['ctrl+c', 'C-c']);
  }

  /** Try each spelling in turn; the last failure is the one that surfaces. */
  private async sendFirstAccepted(paneId: string, spellings: readonly string[]): Promise<void> {
    let last: unknown = null;
    for (const key of spellings) {
      try {
        await this.sendKeys(paneId, [key]);
        return;
      } catch (thrown) {
        last = thrown;
      }
    }
    throw last instanceof Error
      ? last
      : new HerdrError('send_keys_failed', "The host didn't accept that key.");
  }

  /**
   * Tell the host what this pane is doing, for its own sidebar.
   *
   * Display-only and one-way: herdr renders `$token` values in
   * `ui.sidebar.agents.rows`, and nothing here changes agent state. The point is
   * that a desktop looking at the sidebar can see which agents are being driven
   * from the phone and on what model — information that today exists only inside
   * this app, on a screen the desktop cannot see.
   *
   * `ttlMs` is the whole safety story. The phone is an unreliable reporter: it
   * gets backgrounded, loses the tailnet, or is simply put down. A TTL means the
   * label expires on its own rather than leaving the desktop with a stale claim
   * that a chat is live when nobody has touched it for an hour.
   *
   * `seq` orders concurrent reports. Best-effort throughout: decoration must
   * never take down a send.
   */
  async reportMetadata(
    paneId: string,
    options: { source: string; tokens: Record<string, string>; ttlMs: number; seq: number }
  ): Promise<void> {
    const argv = [this.herdr, 'pane', 'report-metadata', paneId, '--source', options.source];
    for (const [name, value] of Object.entries(options.tokens)) {
      argv.push('--token', `${name}=${value}`);
    }
    argv.push('--ttl-ms', String(options.ttlMs), '--seq', String(options.seq));
    try {
      checkEnvelope(await this.shell(shellCommand(argv), SEND_TIMEOUT_MS));
    } catch {
      /* decoration, never fatal */
    }
  }

  /** Send raw keys to a pane, e.g. a quick reply to a blocked prompt. */
  async sendKeys(paneId: string, keys: readonly string[]): Promise<void> {
    await this.request('pane.send_keys', { pane_id: paneId, keys }, SEND_TIMEOUT_MS, async () => {
      const output = await this.shell(
        shellCommand([this.herdr, 'pane', 'send-keys', paneId, ...keys]),
        SEND_TIMEOUT_MS
      );
      checkEnvelope(output);
    });
  }

  /**
   * Create a new workspace rooted at `cwd` without stealing focus on the
   * desktop. Follow with `startAgent` on the returned root pane.
   */
  async createWorkspace(cwd: string, label: string | null): Promise<WorkspaceCreation> {
    const named = label !== null && label.length > 0 ? label : null;
    const result = await this.request(
      'workspace.create',
      { cwd, label: named, focus: false },
      LAUNCH_TIMEOUT_MS,
      () => {
        const argv = [this.herdr, 'workspace', 'create', '--cwd', cwd, '--no-focus'];
        if (named !== null) argv.push('--label', named);
        return this.run(argv, LAUNCH_TIMEOUT_MS);
      }
    );
    return decodeWorkspaceCreation(result);
  }

  /** Give a workspace a new label. The chat list reads it as the chat's title. */
  async renameWorkspace(workspaceId: string, label: string): Promise<void> {
    await this.request(
      'workspace.rename',
      { workspace_id: workspaceId, label },
      SEND_TIMEOUT_MS,
      async () => {
        const output = await this.shell(
          shellCommand([this.herdr, 'workspace', 'rename', workspaceId, label]),
          SEND_TIMEOUT_MS
        );
        checkEnvelope(output);
      }
    );
  }

  /**
   * Close a workspace, stopping every tab, pane and process inside it.
   *
   * Destructive on the host, not just in the app — which is why the caller
   * confirms first and says so in those words.
   */
  async closeWorkspace(workspaceId: string): Promise<void> {
    await this.request(
      'workspace.close',
      { workspace_id: workspaceId },
      LAUNCH_TIMEOUT_MS,
      async () => {
        const output = await this.shell(
          shellCommand([this.herdr, 'workspace', 'close', workspaceId]),
          LAUNCH_TIMEOUT_MS
        );
        checkEnvelope(output);
      }
    );
  }

  /**
   * Launch an agent in a freshly created pane's shell. Uses `pane run`, which
   * types the command and presses Enter in one request.
   *
   * The legacy path. Prefer `startNamedAgent`.
   */
  async startAgent(paneId: string, command = 'claude'): Promise<void> {
    const output = await this.shell(
      shellCommand([this.herdr, 'pane', 'run', paneId, command]),
      LAUNCH_TIMEOUT_MS
    );
    checkEnvelope(output);
  }

  /**
   * Start an agent the way herdr wants to be asked.
   *
   * `agent start` does in one blocking call what typing `claude` into a shell
   * only hopes for: it REGISTERS the agent, NAMES it, attaches the `--kind`
   * integration — which is what produces `agent_session.value`, the one field
   * the whole transcript reader depends on — and returns only once the agent is
   * interactive.
   *
   * The old path starts a bare process and waits for herdr's screen detection to
   * notice. When it doesn't, the thread sits empty for eighty seconds before
   * concluding the integration is missing, which is a long time to look broken
   * for something that was never registered in the first place.
   *
   * Returns whether the named path was used, so the caller knows whether the
   * agent is guaranteed interactive or merely launched.
   */
  async startNamedAgent(
    paneId: string,
    name: string,
    kind: string,
    agentArgs: readonly string[],
    fallbackCommand: string,
    timeoutMs = LAUNCH_TIMEOUT_MS
  ): Promise<boolean> {
    if (!(await this.supportsAgentStart())) {
      await this.startAgent(paneId, fallbackCommand);
      return false;
    }

    for (let attempt = 0; ; attempt += 1) {
      try {
        const output = await this.shell(
          shellCommand([
            this.herdr,
            'agent',
            'start',
            name,
            '--kind',
            kind,
            '--pane',
            paneId,
            '--timeout',
            String(timeoutMs),
            // Everything after `--` reaches the agent. Without it herdr launches
            // a bare `claude`, which loses the permission mode the new-chat
            // screen just asked about — every tool call would stop and ask.
            ...(agentArgs.length > 0 ? ['--', ...agentArgs] : []),
          ]),
          // The host blocks for up to its own timeout, so ours has to outlast it
          // — otherwise we give up on an agent that is about to come up, and the
          // caller falls back and starts a SECOND one in the same pane.
          timeoutMs + LAUNCH_TIMEOUT_MS
        );
        checkEnvelope(output);
        return true;
      } catch (thrown) {
        const busy = thrown instanceof HerdrError && thrown.code === 'agent_pane_busy';
        if (!busy) throw thrown;

        // `agent_pane_busy` means "that pane is not an available shell", and for
        // a pane we created a moment ago it almost always means the shell has
        // not reached its prompt yet. `pane run` never checked, which is why the
        // old path appeared to work — it typed into a shell that was not ready
        // and got away with it.
        //
        // Nothing was started, so retrying is safe and cannot double-launch.
        if (attempt < PANE_READY_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, PANE_READY_INTERVAL_MS));
          continue;
        }
        // Still not a shell after several seconds. Fall back to the path that
        // shipped for months rather than refusing to start a chat at all.
        await this.startAgent(paneId, fallbackCommand);
        return false;
      }
    }
  }

  /**
   * Memoised for the client's lifetime — one per host, not one per send — with
   * the answer's provenance kept, because the two sources age differently: a
   * version-derived answer is settled, while a probe-derived one is superseded
   * by the first snapshot that reports a version (see `snapshot`).
   */
  private agentPrompt: CapabilityMemo | null = null;
  private agentStart: CapabilityMemo | null = null;

  private supportsAgentPrompt(): Promise<boolean> {
    this.agentPrompt ??= this.agentVerbsMemo(['agent', 'prompt'], (memo) => {
      if (this.agentPrompt === memo) this.agentPrompt = null;
    });
    return this.agentPrompt.answer;
  }

  private supportsAgentStart(): Promise<boolean> {
    this.agentStart ??= this.agentVerbsMemo(['agent', 'start'], (memo) => {
      if (this.agentStart === memo) this.agentStart = null;
    });
    return this.agentStart.answer;
  }

  /**
   * Both agent-aware verbs arrived together, so one question answers both.
   *
   * Ask the VERSION first. The snapshot has already told us what this host is —
   * measured on 0.7.4 and 0.8.0, `agent prompt` and `agent start --kind` are
   * exactly the 0.8.0 line — so the `--help` round-trip is only needed before
   * the first poll lands, or against a host that reports no version at all.
   *
   * The probe stays as the fallback rather than being deleted, because "reports
   * no version" is a real state: it is what every herdr older than the field
   * looks like, and those are precisely the hosts where guessing wrong is worst.
   *
   * A probe that could not reach the host still answers false — the fallback is
   * the right call for THIS send — but asks `forget` to drop the memo, so one
   * network blip before the first poll cannot downgrade the host permanently.
   */
  private agentVerbsMemo(
    subcommand: readonly string[],
    forget: (memo: CapabilityMemo) => void
  ): CapabilityMemo {
    if (this.hostVersion !== null) {
      return {
        provenance: 'version',
        answer: Promise.resolve(atLeast(this.hostVersion, AGENT_VERBS_VERSION)),
      };
    }
    const memo: CapabilityMemo = {
      provenance: 'probe',
      answer: this.probe(subcommand).then((outcome) => {
        if (outcome === 'unreachable') forget(memo);
        return outcome === 'supported';
      }),
    };
    return memo;
  }

  /**
   * Block until the agent in a pane reaches one of `statuses`, or the timeout
   * elapses. Backs delivery verification: after submitting a prompt the agent
   * should flip to `working`, or to `blocked` when it stops to ask. Returns
   * false on timeout rather than throwing; not reaching the state is the answer
   * the caller wants.
   *
   * The CLI path is only reached on hosts older than the socket and than
   * `agent prompt` (herdr < 0.8), whose `agent wait` takes a single `--status`,
   * so it waits for the first status only. (0.8 renamed the flag `--until`.)
   */
  async waitAgentStatus(
    paneId: string,
    statuses: AgentStatus | readonly AgentStatus[],
    timeoutMs: number
  ): Promise<boolean> {
    const until: readonly AgentStatus[] = typeof statuses === 'string' ? [statuses] : statuses;
    const status = until[0] ?? 'working';
    if ((await this.socket.detect()) !== null) {
      try {
        await this.socket.call(
          'agent.wait',
          { target: paneId, until, timeout_ms: timeoutMs },
          timeoutMs + SEND_TIMEOUT_MS
        );
        return true;
      } catch {
        return false;
      }
    }
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

  /**
   * One request to herdr: over the socket when this host can be reached that
   * way, otherwise through `legacy`, the CLI command that shipped before the
   * socket layer existed.
   *
   * A socket error is NOT a reason to fall back. The two paths reach the same
   * server, so a refusal on one is a refusal on the other, and retrying a write
   * through the CLI after the socket reported a failure is how a prompt gets
   * sent twice. The single exception is a herdr too old to know the METHOD,
   * which means nothing happened; `sendPromptViaSocket` handles that where it
   * matters and the reads here simply throw, because a host that old also lacks
   * the CLI verbs the app needs.
   */
  private async request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    legacy: () => Promise<unknown>
  ): Promise<unknown> {
    if ((await this.socket.detect()) === null) return legacy();
    return this.socket.call(method, params, timeoutMs);
  }

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
      throw transportError(result);
    }
    if (result.exitCode === 127) {
      // Worth one extra round-trip: this is the error people actually hit when
      // setting up a host, and "not installed, or not on PATH, or wrong path"
      // asks them to guess which of three unrelated fixes applies.
      throw await this.diagnoseMissingHerdr();
    }
    if (result.exitCode !== 0) {
      // herdr can print its error envelope AND exit non-zero. The envelope is
      // the better answer — `agent_prompt_stalled` arriving with exit 1 must
      // stay a diagnosis rather than collapse into a generic exit-code error.
      throw (
        herdrErrorFrom(result.stdout) ??
        herdrErrorFrom(result.stderr) ??
        exitCodeError(result.exitCode, result.stderr)
      );
    }
    return result.stdout;
  }

  /**
   * Work out WHY herdr wasn't found, instead of listing the possibilities.
   *
   * Three different situations produce exit 127 and they need three different
   * fixes: install it, tell us where it already is, or make it executable. We
   * used to print all three and let the reader work out which one they were in.
   */
  private async diagnoseMissingHerdr(): Promise<HerdrError> {
    const location = await this.locateHerdr();
    // A path the user typed in full is not a PATH problem: nothing runs there.
    // Saying "installed elsewhere, not on PATH" sent them looking for a PATH
    // setting when the fix was the path they had just typed (#4 acceptance).
    const explicit = this.herdr.includes('/');
    switch (location.kind) {
      case 'found':
        return new HerdrError(
          'herdr_not_on_path',
          explicit && location.path !== this.herdr
            ? `Nothing runs at ${this.herdr}. herdr is installed at ${location.path}; use that as this host's herdr path.`
            : `herdr is installed at ${location.path}, but a non-interactive SSH session can't find it. Set that as this host's herdr path.`
        );
      case 'not_executable':
        return new HerdrError(
          'herdr_not_executable',
          `herdr is at ${location.path} but isn't executable. On the host, run: chmod +x ${location.path}`
        );
      case 'missing':
        return new HerdrError(
          'herdr_not_found',
          explicit
            ? `Nothing runs at ${this.herdr}, and herdr isn't installed anywhere usual on this account. Check the herdr path, or install herdr on the host.`
            : "herdr isn't installed on this account. Install it on the host, or set its full path as this host's herdr path if it lives somewhere unusual."
        );
      case 'unknown':
        return exitCodeError(127);
    }
  }

  /**
   * Where herdr is on the host, if anywhere.
   *
   * Checks the same places the PATH prefix covers, plus whatever the login
   * shell would resolve. Everything is `2>/dev/null` and the script always
   * ends in exit 0, because a diagnosis that itself fails tells the user
   * nothing. It ends by falling off the end, never `exit 0`: the transport
   * marks a finished command by what runs after it (#103).
   *
   * One line per statement, joined with newlines. Joined with `; ` it read
   * `do; [ -e …`, a syntax error in bash and sh that only zsh forgave, so on a
   * Linux host with a bash login shell this diagnosis never worked.
   */
  async locateHerdr(): Promise<HerdrLocation> {
    const script = [
      `p=$(command -v ${commandWord(this.herdr)} 2>/dev/null)`,
      'if [ -z "$p" ]; then',
      '  for c in "$HOME/.local/bin/herdr" "$HOME/bin/herdr" /opt/homebrew/bin/herdr /usr/local/bin/herdr /usr/bin/herdr; do',
      '    if [ -e "$c" ]; then p="$c"; break; fi',
      '  done',
      'fi',
      'if [ -z "$p" ]; then echo NONE; elif [ -x "$p" ]; then echo "EXEC $p"; else echo "NOEXEC $p"; fi',
    ].join('\n');

    const result = await this.transport.exec(withPath(script), POLL_TIMEOUT_MS);
    if (!result.ok || result.exitCode !== 0) return { kind: 'unknown' };

    const line = result.stdout.trim().split('\n').pop()?.trim() ?? '';
    if (line === 'NONE') return { kind: 'missing' };
    if (line.startsWith('EXEC ')) return { kind: 'found', path: line.slice(5) };
    if (line.startsWith('NOEXEC ')) return { kind: 'not_executable', path: line.slice(7) };
    return { kind: 'unknown' };
  }
}

/** See `probe`. */
type ProbeOutcome = 'supported' | 'unsupported' | 'unreachable';

/** A memoised capability answer, tagged with where it came from. */
interface CapabilityMemo {
  readonly provenance: 'version' | 'probe';
  readonly answer: Promise<boolean>;
}

/** Where herdr is on a host, as far as we could tell. */
export type HerdrLocation =
  | { kind: 'missing' }
  | { kind: 'found'; path: string }
  | { kind: 'not_executable'; path: string }
  /** The probe itself failed — say nothing rather than something wrong. */
  | { kind: 'unknown' };

/**
 * herdr rejects a method it has never heard of as `invalid_request` with
 * "unknown variant `x`" in the message. Measured on the 12 Sep build, which
 * answered `pane.turns` that way before the handoff to a build that has it.
 */
function isUnknownMethod(error: HerdrError): boolean {
  return error.code === 'invalid_request' && error.message.includes('unknown variant');
}

function field(result: unknown, key: string): unknown {
  return typeof result === 'object' && result !== null
    ? (result as Record<string, unknown>)[key]
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
