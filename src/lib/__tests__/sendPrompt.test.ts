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
