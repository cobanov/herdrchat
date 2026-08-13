import { HerdrClient } from '../herdr/client';
import type { HerdrTransport } from '../herdr/transport';

/**
 * A host that answers `--help` according to `hasAgentPrompt`, envelopes every
 * other command as ok, and records what it was asked to run.
 */
function host({ hasAgentPrompt }: { hasAgentPrompt: boolean }) {
  const commands: string[] = [];
  const transport: HerdrTransport = {
    exec: async (command: string) => {
      commands.push(command);
      const isProbe = command.includes('--help');
      const exitCode = isProbe && !hasAgentPrompt ? 1 : 0;
      return {
        ok: true,
        exitCode,
        stdout: isProbe ? '' : JSON.stringify({ ok: true, result: {} }),
        stderr: '',
      } as never;
    },
    streamLines: async function* () {},
  };
  return { transport, commands, client: new HerdrClient(transport) };
}

const sends = (commands: string[]) => commands.filter((c) => !c.includes('--help'));

describe('sendPrompt', () => {
  it('uses the agent-aware verb when the host has it, and says so', async () => {
    const { client, commands } = host({ hasAgentPrompt: true });
    await expect(client.sendPrompt('pane-1', 'hello')).resolves.toBe(true);
    expect(sends(commands)).toHaveLength(1);
    expect(sends(commands)[0]).toContain("'agent' 'prompt' 'pane-1' 'hello'");
  });

  it('falls back to pane run when the host does not, and says so', async () => {
    // Returning false is what tells the thread it still has to verify delivery.
    const { client, commands } = host({ hasAgentPrompt: false });
    await expect(client.sendPrompt('pane-1', 'hello')).resolves.toBe(false);
    expect(sends(commands)).toHaveLength(1);
    expect(sends(commands)[0]).toContain("'pane' 'run' 'pane-1' 'hello'");
  });

  it('never sends twice for one prompt, on either path', async () => {
    // The reason this is a probe and not try-then-fall-back: a verb that
    // half-landed followed by a retry is a duplicated prompt.
    for (const hasAgentPrompt of [true, false]) {
      const { client, commands } = host({ hasAgentPrompt });
      await client.sendPrompt('pane-1', 'hello');
      expect(sends(commands)).toHaveLength(1);
    }
  });

  it('probes once per client, not once per send', async () => {
    const { client, commands } = host({ hasAgentPrompt: true });
    await client.sendPrompt('pane-1', 'one');
    await client.sendPrompt('pane-1', 'two');
    await client.sendPrompt('pane-1', 'three');
    expect(commands.filter((c) => c.includes('--help'))).toHaveLength(1);
    expect(sends(commands)).toHaveLength(3);
  });

  it('treats an unreachable host during the probe as unsupported', async () => {
    // A false negative costs the legacy path, which shipped for months. A false
    // positive would send prompts into a verb the host does not have.
    const commands: string[] = [];
    let first = true;
    const transport: HerdrTransport = {
      exec: async (command: string) => {
        commands.push(command);
        if (first && command.includes('--help')) {
          first = false;
          throw new Error('connection reset');
        }
        return {
          ok: true,
          exitCode: 0,
          stdout: JSON.stringify({ ok: true, result: {} }),
          stderr: '',
        } as never;
      },
      streamLines: async function* () {},
    };
    await expect(new HerdrClient(transport).sendPrompt('pane-1', 'hi')).resolves.toBe(false);
    expect(sends(commands)[0]).toContain("'pane' 'run'");
  });

  it('quotes a multi-line prompt as one argument', async () => {
    // `pane run` is one command line, which is what made multi-line fragile.
    const { client, commands } = host({ hasAgentPrompt: true });
    await client.sendPrompt('pane-1', 'line one\nline two');
    expect(sends(commands)[0]).toContain("'line one\nline two'");
  });
});

describe('capability gating by reported version', () => {
  /** A host that answers snapshots with `version` and records every command. */
  function versioned(version: string | null) {
    const commands: string[] = [];
    const transport: HerdrTransport = {
      exec: async (command: string) => {
        commands.push(command);
        const snapshot: Record<string, unknown> = { agents: [] };
        if (version !== null) snapshot.version = version;
        return {
          ok: true,
          exitCode: 0,
          stdout: command.includes('--help')
            ? ''
            : JSON.stringify({ ok: true, result: { snapshot } }),
          stderr: '',
        } as never;
      },
      streamLines: async function* () {},
    };
    return { transport, commands, client: new HerdrClient(transport) };
  }

  const probes = (commands: string[]) => commands.filter((c) => c.includes('--help'));

  it('spends no round-trip once a snapshot has reported 0.8.0', async () => {
    // The version has been in the snapshot all along. Asking `--help` for
    // something the host already told us is a wasted SSH round-trip per client.
    const { client, commands } = versioned('0.8.0');
    await client.snapshot();
    await client.sendPrompt('pane-1', 'hello');
    expect(probes(commands)).toEqual([]);
    expect(commands.at(-1)).toContain("'agent' 'prompt'");
  });

  it('uses the legacy path on 0.7.4 without probing', async () => {
    // Measured: 0.7.4 has no `agent prompt`. The version alone settles it.
    const { client, commands } = versioned('0.7.4');
    await client.snapshot();
    await expect(client.sendPrompt('pane-1', 'hello')).resolves.toBe(false);
    expect(probes(commands)).toEqual([]);
    expect(commands.at(-1)).toContain("'pane' 'run'");
  });

  it('still probes when the host reports no version at all', async () => {
    // Every herdr older than the field looks like this, and those are exactly
    // the hosts where guessing wrong is worst.
    const { client, commands } = versioned(null);
    await client.snapshot();
    await client.sendPrompt('pane-1', 'hello');
    expect(probes(commands)).toHaveLength(1);
  });

  it('exposes the version for the UI to quote', async () => {
    const { client } = versioned('0.8.0');
    expect(client.reportedVersion).toBeNull();
    await client.snapshot();
    expect(client.reportedVersion).toBe('0.8.0');
  });
});
