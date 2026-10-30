import { HerdrClient } from '../herdr/client';
import { HerdrError } from '../herdr/protocol';
import { isSocketProbe } from '../herdr/socket';
import type { HerdrTransport } from '../herdr/transport';

/**
 * The client on a host that CAN be reached over the socket. The probe answers
 * python3; every other command is matched against `replies` by the method name
 * inside the request it carries.
 */
function socketHost(replies: Record<string, string | (() => string)>) {
  const commands: string[] = [];
  const transport: HerdrTransport = {
    exec: async (command: string) => {
      if (isSocketProbe(command)) {
        return { ok: true, exitCode: 0, stdout: 'BRIDGE python3\nSOCK /tmp/h.sock\n', stderr: '' } as never;
      }
      commands.push(command);
      const method = /"method":"([a-z_.]+)"/.exec(command)?.[1] ?? '';
      const reply = replies[method];
      if (reply === undefined) {
        return { ok: true, exitCode: 0, stdout: '{"id":"x","result":{"type":"ok"}}', stderr: '' } as never;
      }
      const stdout = typeof reply === 'string' ? reply : reply();
      return { ok: true, exitCode: 0, stdout, stderr: '' } as never;
    },
    streamLines: async function* () {},
  };
  return { commands, client: new HerdrClient(transport) };
}

const requestIn = (command: string): { method: string; params: Record<string, unknown> } => {
  const start = command.indexOf(`'{"id"`);
  const end = command.lastIndexOf(`}'`);
  return JSON.parse(command.slice(start + 1, end + 1).replaceAll(`'\\''`, "'")) as never;
};

describe('HerdrClient over the socket', () => {
  // The iPad's list and open chat poll side by side, and a send re-reads the
  // snapshot a poll may be reading at that moment: one read serves them all.
  it('shares a snapshot already on its way, and asks again once it is back', async () => {
    const { client, commands } = socketHost({
      'session.snapshot':
        '{"id":"x","result":{"type":"session_snapshot","snapshot":{"version":"0.9.0","workspaces":[],"tabs":[],"panes":[],"agents":[]}}}',
    });
    const reads = () => commands.filter((command) => !isSocketProbe(command)).length;
    const [a, b] = await Promise.all([client.snapshot(), client.snapshot()]);
    expect(a).toBe(b);
    expect(reads()).toBe(1);
    await client.snapshot();
    expect(reads()).toBe(2);
  });

  // A send decides on a second Enter from the snapshot (#76); one that started
  // before the keys went out can say idle when the agent is already blocked.
  it('reads a fresh snapshot even with one on its way', async () => {
    const { client, commands } = socketHost({
      'session.snapshot':
        '{"id":"x","result":{"type":"session_snapshot","snapshot":{"version":"0.9.0","workspaces":[],"tabs":[],"panes":[],"agents":[]}}}',
    });
    const reads = () => commands.filter((command) => !isSocketProbe(command)).length;
    await Promise.all([client.snapshot(), client.snapshot({ fresh: true })]);
    expect(reads()).toBe(2);
  });

  it('reads the snapshot with session.snapshot and remembers the version', async () => {
    const { client, commands } = socketHost({
      'session.snapshot':
        '{"id":"x","result":{"type":"session_snapshot","snapshot":{"version":"0.9.0","workspaces":[],"tabs":[],"panes":[],"agents":[]}}}',
    });
    await client.snapshot();
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain('python3 -S -c');
    expect(requestIn(commands[0] ?? '').method).toBe('session.snapshot');
    expect(client.reportedVersion).toBe('0.9.0');
  });

  it('lists agents, workspaces and panes without a single herdr CLI invocation', async () => {
    const { client, commands } = socketHost({
      'agent.list': '{"id":"x","result":{"type":"agents","agents":[]}}',
      'workspace.list': '{"id":"x","result":{"type":"workspaces","workspaces":[]}}',
      'pane.list': '{"id":"x","result":{"type":"panes","panes":[]}}',
    });
    await client.agents();
    await client.workspaces();
    await client.panes();
    expect(commands.map((c) => requestIn(c).method)).toEqual(['agent.list', 'workspace.list', 'pane.list']);
    expect(commands.some((c) => c.includes("'herdr' 'agent'"))).toBe(false);
  });

  describe('sendPrompt', () => {
    const prompted = (delivery: string) =>
      `{"id":"x","result":{"type":"agent_prompted","delivery":"${delivery}","agent":{"pane_id":"w1:p1","agent_status":"working"}}}`;

    it('asks the host to wait for the agent to react, and reports submitted as delivered', async () => {
      const { client, commands } = socketHost({ 'agent.prompt': prompted('submitted') });
      await expect(client.sendPrompt('w1:p1', "it's a 'quoted' prompt\nwith two lines")).resolves.toBe(
        'delivered'
      );
      expect(commands).toHaveLength(1);
      const request = requestIn(commands[0] ?? '');
      expect(request.method).toBe('agent.prompt');
      expect(request.params).toMatchObject({
        target: 'w1:p1',
        text: "it's a 'quoted' prompt\nwith two lines",
        wait: { until: ['working', 'blocked'] },
      });
    });

    it("reads upstream's plain success as delivered", async () => {
      // Upstream herdr has no `delivery` field: `{ agent }` after an observed
      // working/blocked. Treating that as unverified sent every upstream prompt
      // down the fallback-Enter path (#76).
      const { client } = socketHost({
        'agent.prompt': '{"id":"x","result":{"type":"agent_info","agent":{"pane_id":"w1:p1","agent_status":"blocked"}}}',
      });
      await expect(client.sendPrompt('w1:p1', 'hi')).resolves.toBe('delivered');
    });

    it('explains an upstream agent_blocked refusal in words a person can act on', async () => {
      const { client, commands } = socketHost({
        'agent.prompt': '{"id":"x","error":{"code":"agent_blocked","message":"agent is blocked"}}',
      });
      await expect(client.sendPrompt('w1:p1', 'hi')).rejects.toMatchObject({
        code: 'agent_blocked',
        message: expect.stringContaining('waiting on a question'),
      });
      expect(commands).toHaveLength(1);
    });

    // A new chat in a new folder: Claude's trust question is open, and the
    // raw "pending unknown input prompt" reached the screen as is.
    it('explains an agent_input_pending refusal the same way', async () => {
      const { client, commands } = socketHost({
        'agent.prompt':
          '{"id":"x","error":{"code":"agent_input_pending","message":"agent wDS:p1 has a pending unknown input prompt; chat prompt was not written"}}',
      });
      await expect(client.sendPrompt('w1:p1', 'hi')).rejects.toMatchObject({
        code: 'agent_input_pending',
        message: expect.stringContaining('waiting on a question'),
      });
      await expect(client.sendCommand('w1:p1', '/model')).rejects.toMatchObject({
        message: expect.stringContaining('waiting on a question'),
      });
      expect(commands).toHaveLength(2);
    });

    it('leaves written_to_pty for the caller to verify', async () => {
      const { client } = socketHost({ 'agent.prompt': prompted('written_to_pty') });
      await expect(client.sendPrompt('w1:p1', 'hi')).resolves.toBe('unverified');
    });

    it("reads the host's wait timeout as a stall", async () => {
      const { client } = socketHost({
        'agent.prompt': '{"id":"x","error":{"code":"timeout","message":"timed out waiting for agent status"}}',
      });
      await expect(client.sendPrompt('w1:p1', 'hi')).resolves.toBe('stalled');
    });

    it('does not read a transport timeout as a stall (#83)', async () => {
      // The SSH layer gave up (a half-open connection). The prompt may have
      // landed, so this must not come back as "never picked up".
      const transport: HerdrTransport = {
        exec: async (command: string) =>
          isSocketProbe(command)
            ? ({ ok: true, exitCode: 0, stdout: 'BRIDGE python3\nSOCK /tmp/h.sock\n', stderr: '' } as never)
            : ({ ok: false, code: 'timeout', message: "The host didn't answer in time." } as never),
        streamLines: async function* () {},
      };
      await expect(new HerdrClient(transport).sendPrompt('w1:p1', 'hello')).rejects.toMatchObject({
        code: 'timeout',
        transport: true,
      });
    });

    it('falls back to pane run only when the host has never heard of the method', async () => {
      // Nothing was sent, so a second attempt through the CLI cannot double up.
      const { client, commands } = socketHost({
        'agent.prompt':
          '{"id":"x","error":{"code":"invalid_request","message":"invalid request: unknown variant `agent.prompt`, expected one of `ping`"}}',
      });
      await expect(client.sendPrompt('w1:p1', 'hi')).resolves.toBe('unverified');
      expect(commands).toHaveLength(2);
      expect(commands[1]).toContain("'pane' 'run' 'w1:p1' 'hi'");
    });

    it('surfaces every other refusal instead of retrying through the CLI', async () => {
      // The socket and the CLI reach the same server. A refusal on one is a
      // refusal on the other, and a retry is how a prompt gets sent twice.
      const { client, commands } = socketHost({
        'agent.prompt': '{"id":"x","error":{"code":"agent_not_ready","message":"not an active named agent"}}',
      });
      await expect(client.sendPrompt('w1:p1', 'hi')).rejects.toMatchObject({ code: 'agent_not_ready' });
      expect(commands).toHaveLength(1);
    });

    it('never probes --help on a socket host', async () => {
      const { client, commands } = socketHost({ 'agent.prompt': prompted('submitted') });
      await client.sendPrompt('w1:p1', 'one');
      await client.sendPrompt('w1:p1', 'two');
      expect(commands.filter((c) => c.includes('--help'))).toHaveLength(0);
    });
  });

  describe('integrationIssues (#93)', () => {
    // The shape herdr answers, trimmed. `available` is whether the agent is on the host's PATH.
    const list = (claude: string, codex: string, omp: string, pi = 'not_installed', available = { claude: true, codex: true, omp: true, pi: true }) =>
      `{"id":"x","result":{"type":"integration_list","integrations":[` +
      `{"target":"pi","label":"pi","command":"pi","available":${available.pi},"state":"${pi}"},` +
      `{"target":"claude","label":"claude","command":"claude","available":${available.claude},"state":"${claude}"},` +
      `{"target":"codex","label":"codex","command":"codex","available":${available.codex},"state":"${codex}"},` +
      `{"target":"omp","label":"omp","command":"omp","available":${available.omp},"state":"${omp}"}]}}`;
    const none = { claude: false, codex: false, omp: false, pi: false };

    it('names the integrations the host reports as outdated', async () => {
      const { client } = socketHost({ 'integration.list': list('outdated', 'current', 'outdated', 'current') });
      await expect(client.integrationIssues()).resolves.toEqual([
        { name: 'claude', state: 'outdated' },
        { name: 'omp', state: 'outdated' },
      ]);
    });

    it('names an outdated Pi integration', async () => {
      const { client } = socketHost({ 'integration.list': list('current', 'current', 'current', 'outdated') });
      await expect(client.integrationIssues()).resolves.toEqual([{ name: 'pi', state: 'outdated' }]);
    });

    it('names a missing integration for an agent the host has, the chat that waits forever', async () => {
      const { client } = socketHost({ 'integration.list': list('not_installed', 'current', 'current', 'current', { ...none, claude: true }) });
      await expect(client.integrationIssues()).resolves.toEqual([{ name: 'claude', state: 'missing' }]);
    });

    it('says nothing about an integration whose agent the host does not have', async () => {
      const { client } = socketHost({ 'integration.list': list('current', 'not_installed', 'not_installed', 'not_installed', { ...none, claude: true }) });
      await expect(client.integrationIssues()).resolves.toEqual([]);
    });

    it('reports none when everything is current', async () => {
      const { client } = socketHost({ 'integration.list': list('current', 'current', 'current', 'current') });
      await expect(client.integrationIssues()).resolves.toEqual([]);
    });

    it('says nothing on a herdr without integration.list', async () => {
      const { client } = socketHost({
        'integration.list': '{"id":"x","error":{"code":"invalid_request","message":"unknown variant `integration.list`"}}',
      });
      await expect(client.integrationIssues()).resolves.toBeNull();
    });
  });

  it('sends keys with pane.send_keys', async () => {
    const { client, commands } = socketHost({});
    await client.sendKeys('w1:p1', ['Enter']);
    expect(requestIn(commands[0] ?? '')).toMatchObject({
      method: 'pane.send_keys',
      params: { pane_id: 'w1:p1', keys: ['Enter'] },
    });
  });

  it('creates a workspace without stealing focus, labelled only when asked', async () => {
    const created =
      '{"id":"x","result":{"type":"workspace_created","workspace":{"workspace_id":"w9","label":"x"},"tab":{},"root_pane":{"pane_id":"w9:p1","workspace_id":"w9"}}}';
    // The folder check (no socket method) prints the folder, as the host would.
    const { client, commands } = socketHost({ 'workspace.create': created, '': () => '/home/u/proj\n' });
    const creates = () => commands.filter((command) => command.includes('workspace.create'));
    const creation = await client.createWorkspace('/home/u/proj', 'proj');
    expect(creation.rootPane.paneId).toBe('w9:p1');
    expect(requestIn(creates()[0] ?? '').params).toEqual({ cwd: '/home/u/proj', label: 'proj', focus: false });
    await client.createWorkspace('/home/u/proj', '');
    expect(requestIn(creates()[1] ?? '').params).toEqual({ cwd: '/home/u/proj', label: null, focus: false });
  });

  // Seen on a real host: herdr made the workspace for a folder that does not
  // exist in the home folder instead, and the agent started there.
  it('refuses a folder that is not on the host, before making anything', async () => {
    const commands: string[] = [];
    const transport: HerdrTransport = {
      exec: async (command: string) => {
        commands.push(command);
        if (isSocketProbe(command)) return { ok: true, exitCode: 0, stdout: 'BRIDGE python3\nSOCK /tmp/h.sock\n', stderr: '' } as never;
        return { ok: true, exitCode: 1, stdout: '', stderr: '' } as never;
      },
      streamLines: async function* () {},
    };
    await expect(new HerdrClient(transport).createWorkspace('/home/u/no-such', null))
      .rejects.toMatchObject({ code: 'dir_missing', message: expect.stringContaining('/home/u/no-such') });
    expect(commands.some((command) => command.includes('workspace.create'))).toBe(false);
  });

  it('waits for a status with agent.wait and answers false on timeout', async () => {
    const { client, commands } = socketHost({
      'agent.wait': '{"id":"x","error":{"code":"timeout","message":"timed out waiting for agent status"}}',
    });
    await expect(client.waitAgentStatus('w1:p1', 'working', 3500)).resolves.toBe(false);
    expect(requestIn(commands[0] ?? '').params).toEqual({ target: 'w1:p1', until: ['working'], timeout_ms: 3500 });
  });

  it('reads the visible screen through pane.read', async () => {
    const { client } = socketHost({
      'pane.read': '{"id":"x","result":{"type":"pane_read","read":{"pane_id":"w1:p1","text":"❯ hello\\n","truncated":false}}}',
    });
    await expect(client.paneVisible('w1:p1', 40)).resolves.toBe('❯ hello\n');
  });
});

describe('an open chat poll on one channel', () => {
  const SNAPSHOT = '{"id":"x","result":{"type":"session_snapshot","snapshot":{"version":"0.9.0","workspaces":[],"tabs":[],"panes":[],"agents":[]}}}';
  const replies: Record<string, string> = {
    'session.snapshot': SNAPSHOT,
    'pane.read': '{"id":"x","result":{"type":"pane_read","read":{"text":"⠋ Working"}}}',
    'pane.report_metadata': '{"id":"x","result":{"type":"ok"}}',
  };
  /** A bridge host that answers each request of a batch in its own section. */
  function batchHost() {
    const commands: string[] = [];
    const transport: HerdrTransport = {
      exec: async (command: string) => {
        if (isSocketProbe(command)) {
          return { ok: true, exitCode: 0, stdout: 'BRIDGE python3\nSOCK /tmp/h.sock\n', stderr: '' } as never;
        }
        commands.push(command);
        const methods = [...command.matchAll(/"method":"([a-z_.]+)"/g)].map((match) => match[1] ?? '');
        const stdout = methods.map((method, index) =>
          `\n@@hc-batch-begin ${index}\n${replies[method] ?? ''}\n@@hc-batch-end ${index} 0\n`).join('');
        return { ok: true, exitCode: 0, stdout, stderr: '' } as never;
      },
      streamLines: async function* () {},
    };
    return { commands, client: new HerdrClient(transport) };
  }
  const methodsIn = (command: string) => [...command.matchAll(/"method":"([a-z_.]+)"/g)].map((match) => match[1]);

  afterEach(() => jest.useRealTimers());

  // A working chat read its snapshot and its screen on two channels each poll,
  // and its presence on a third every 20 s.
  it('asks for the snapshot, the screen and the presence together', async () => {
    jest.useFakeTimers();
    const { client, commands } = batchHost();
    client.reportMetadata('w1:p1', { source: 'herdrchat', tokens: { phone: 'on' }, ttlMs: 45_000, seq: 1 });
    const polled = await client.pollSnapshot({ paneId: 'w1:p1', lines: 30 });
    expect(commands).toHaveLength(1);
    expect(methodsIn(commands[0] ?? '')).toEqual(['session.snapshot', 'pane.read', 'pane.report_metadata']);
    expect(polled.screen).toBe('⠋ Working');
    expect(polled.snapshot.version).toBe('0.9.0');
    await jest.advanceTimersByTimeAsync(10_000);
    expect(commands).toHaveLength(1);
  });

  // The list beside an open chat on iPad takes the chat's poll for its own.
  it('remembers the last snapshot any read brought, until it is as old as asked', async () => {
    jest.useFakeTimers();
    const { client } = batchHost();
    expect(client.recentSnapshot(3_000)).toBeNull();
    const polled = await client.pollSnapshot({ paneId: 'w1:p1', lines: 30 });
    await jest.advanceTimersByTimeAsync(1_000);
    expect(client.recentSnapshot(3_000)).toEqual({ snapshot: polled.snapshot, ageMs: 1_000 });
    await jest.advanceTimersByTimeAsync(2_000);
    expect(client.recentSnapshot(3_000)).toBeNull();
  });

  it('sends a presence report on its own when no poll carries it', async () => {
    jest.useFakeTimers();
    const { client, commands } = batchHost();
    client.reportMetadata('w1:p1', { source: 'herdrchat', tokens: { phone: 'on' }, ttlMs: 45_000, seq: 1 });
    client.reportMetadata('w1:p1', { source: 'herdrchat', tokens: { phone: 'on', model: 'grok-5' }, ttlMs: 45_000, seq: 2 });
    await jest.advanceTimersByTimeAsync(5_000);
    expect(commands).toHaveLength(1);
    expect(methodsIn(commands[0] ?? '')).toEqual(['pane.report_metadata']);
    expect(commands[0]).toContain('"seq":2');
  });
});

describe('worktrees, tabs and splits', () => {
  const created = (key: string, pane: string) =>
    `{"id":"x","result":{"type":"x","${key}":{"pane_id":"${pane}","workspace_id":"w2","tab_id":"w2:t1","terminal_id":"term_9","agent_status":"unknown","cwd":"/srv/app"},"workspace":{"workspace_id":"w2","label":"fix","number":2,"agent_status":"unknown"}}}`;

  it('creates a worktree without stealing the desktop focus, read like a new workspace', async () => {
    // The folder check (no socket method) prints the folder, as for a workspace.
    const { client, commands } = socketHost({ 'worktree.create': created('root_pane', 'w2:p1'), '': () => '/srv/app\n' });
    const creation = await client.createWorktree('/srv/app', 'fix');
    expect(requestIn(commands.find((command) => command.includes('worktree.create')) ?? '')).toMatchObject({
      method: 'worktree.create',
      params: { cwd: '/srv/app', label: 'fix', focus: false },
    });
    expect(creation).toMatchObject({ workspace: { workspaceId: 'w2', label: 'fix' }, rootPane: { paneId: 'w2:p1' } });
  });

  it('opens a tab or a split as a shell pane, with its terminal', async () => {
    const { client, commands } = socketHost({
      'tab.create': created('root_pane', 'w2:p2'),
      'pane.split': created('pane', 'w2:p3'),
    });
    await expect(client.createTab('w2')).resolves.toMatchObject({ paneId: 'w2:p2', terminalId: 'term_9', agent: null });
    await expect(client.splitPane('w2:p1', 'right')).resolves.toMatchObject({ paneId: 'w2:p3' });
    expect(commands.map((c) => requestIn(c))).toEqual([
      { id: expect.any(String), method: 'tab.create', params: { workspace_id: 'w2', focus: false } },
      { id: expect.any(String), method: 'pane.split', params: { target_pane_id: 'w2:p1', direction: 'right', focus: false } },
    ]);
  });

  it('says in plain words why a folder outside a repository has no worktree', async () => {
    const { client } = socketHost({
      'worktree.create': '{"id":"x","error":{"code":"not_git_worktree","message":"Herdr worktree actions require a path inside a Git work tree"}}',
    });
    await expect(client.createWorktree('/srv/notes', null)).rejects.toMatchObject({
      code: 'not_git_worktree',
      message: expect.stringContaining('Turn off New worktree'),
    });
  });
});

describe('updateHerdr', () => {
  const snap = (version: string) =>
    `{"id":"x","result":{"type":"session_snapshot","snapshot":{"version":"${version}","workspaces":[],"tabs":[],"panes":[],"agents":[]}}}`;

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // A plain `herdr update` left the running server, and so the version the app
  // reads, where it was.
  it('hands the running server over and answers the version it then reports', async () => {
    const versions = ['0.9.1', '0.9.1', '0.9.5'];
    const { client, commands } = socketHost({ 'session.snapshot': () => snap(versions.shift() ?? '0.9.5') });
    await client.snapshot();
    const updated = client.updateHerdr();
    await jest.advanceTimersByTimeAsync(5_000);
    await expect(updated).resolves.toBe('0.9.5');
    expect(commands.some((c) => c.includes("'herdr' 'update' '--handoff'"))).toBe(true);
  });

  /**
   * A host whose herdr binary is already 0.9.5 and whose server runs 0.9.1.
   * `update` answers as `update --handoff` does there: herdr says "already up
   * to date", or a Homebrew herdr refuses; either way nothing is handed over.
   */
  function staleServerHost(update: { exitCode: number; stdout: string }, binary = '0.9.5') {
    let handedOff = false;
    const commands: string[] = [];
    const transport: HerdrTransport = {
      exec: async (command: string) => {
        if (isSocketProbe(command)) return { ok: true, exitCode: 0, stdout: 'BRIDGE python3\nSOCK /tmp/h.sock\n', stderr: '' } as never;
        commands.push(command);
        const answer = (stdout: string, exitCode = 0) => ({ ok: true, exitCode, stdout, stderr: '' }) as never;
        if (command.includes('"method":"session.snapshot"')) return answer(snap(handedOff ? '0.9.5' : '0.9.1'));
        if (command.includes('"method":"server.live_handoff"')) {
          handedOff = true;
          return answer('{"id":"x","result":{"type":"ok"}}');
        }
        if (command.includes("'update' '--handoff'")) return answer(update.stdout, update.exitCode);
        if (command.includes('command -v')) return answer('EXEC /home/u/.local/bin/herdr\n');
        if (command.includes("'--version'")) return answer(`herdr ${binary}\n`);
        return answer('');
      },
      streamLines: async function* () {},
    };
    return { commands, client: new HerdrClient(transport) };
  }

  // herdr hands nothing over when there is nothing to install, so the people
  // who had already run a plain `herdr update` were told to update and could not.
  it.each([
    ['says it is already up to date', { exitCode: 0, stdout: 'already up to date (0.9.5)\n' }],
    ['refuses, as on Homebrew', { exitCode: 1, stdout: 'herdr is managed by Homebrew; run brew upgrade herdr\n' }],
  ])('hands a server behind its binary over to that binary when update %s', async (_, update) => {
    const { client, commands } = staleServerHost(update);
    await client.snapshot();
    const updated = client.updateHerdr();
    await jest.advanceTimersByTimeAsync(30_000);
    await expect(updated).resolves.toBe('0.9.5');
    const handoff = commands.find((c) => c.includes('"method":"server.live_handoff"')) ?? '';
    expect(requestIn(handoff).params).toEqual({ import_exe: '/home/u/.local/bin/herdr', expected_version: '0.9.5' });
  });

  it("shows update's refusal when the binary is no newer than the server", async () => {
    const { client, commands } = staleServerHost({ exitCode: 1, stdout: 'herdr is managed by Homebrew; run brew upgrade herdr\n' }, '0.9.1');
    await client.snapshot();
    const updated = client.updateHerdr();
    const outcome = expect(updated).rejects.toBeInstanceOf(HerdrError);
    await jest.advanceTimersByTimeAsync(30_000);
    await outcome;
    expect(commands.some((c) => c.includes('server.live_handoff'))).toBe(false);
  });
});
