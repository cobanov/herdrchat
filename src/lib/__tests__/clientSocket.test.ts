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
