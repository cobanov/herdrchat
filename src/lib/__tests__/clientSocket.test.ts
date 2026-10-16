import { HerdrClient } from '../herdr/client';
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
    const { client, commands } = socketHost({ 'workspace.create': created });
    const creation = await client.createWorkspace('/home/u/proj', 'proj');
    expect(creation.rootPane.paneId).toBe('w9:p1');
    expect(requestIn(commands[0] ?? '').params).toEqual({ cwd: '/home/u/proj', label: 'proj', focus: false });
    await client.createWorkspace('/home/u/proj', '');
    expect(requestIn(commands[1] ?? '').params).toEqual({ cwd: '/home/u/proj', label: null, focus: false });
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
