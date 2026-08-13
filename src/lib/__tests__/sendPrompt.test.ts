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
    await expect(client.sendPrompt('pane-1', 'hello')).resolves.toBe('delivered');
    expect(sends(commands)).toHaveLength(1);
    expect(sends(commands)[0]).toContain("'agent' 'prompt' 'pane-1' 'hello'");
  });

  it('falls back to pane run when the host does not, and says so', async () => {
    // Returning false is what tells the thread it still has to verify delivery.
    const { client, commands } = host({ hasAgentPrompt: false });
    await expect(client.sendPrompt('pane-1', 'hello')).resolves.toBe('unverified');
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
    await expect(new HerdrClient(transport).sendPrompt('pane-1', 'hi')).resolves.toBe('unverified');
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
    await expect(client.sendPrompt('pane-1', 'hello')).resolves.toBe('unverified');
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

describe('a stalled prompt', () => {
  /** A host whose `agent prompt --wait` reports that nothing moved. */
  function stallingHost() {
    const commands: string[] = [];
    const transport: HerdrTransport = {
      exec: async (command: string) => {
        commands.push(command);
        if (command.includes('--help')) {
          return { ok: true, exitCode: 0, stdout: '', stderr: '' } as never;
        }
        return {
          ok: true,
          exitCode: 0,
          stdout: JSON.stringify({
            error: { code: 'agent_prompt_stalled', message: 'no state change observed' },
          }),
          stderr: '',
        } as never;
      },
      streamLines: async function* () {},
    };
    return { commands, client: new HerdrClient(transport) };
  }

  it('is an answer, not a failure — it resolves rather than throwing', async () => {
    // herdr watched its own agent and saw nothing move. That is information the
    // caller acts on, not an error to propagate.
    const { client } = stallingHost();
    await expect(client.sendPrompt('pane-1', 'hello')).resolves.toBe('stalled');
  });

  it('asks the host to wait, and outlasts the host own deadline', async () => {
    const { client, commands } = stallingHost();
    await client.sendPrompt('pane-1', 'hello');
    // Not `find(c => c.includes("'agent' 'prompt'"))` — the capability probe is
    // literally `agent prompt --help` and matches that too.
    const sent = commands.find((c) => c.includes("'agent' 'prompt'") && !c.includes('--help')) ?? '';
    expect(sent).toContain("'--wait'");
    // herdr stalls at a fixed 5000ms and its help warns that a shorter
    // --timeout returns a generic `timeout` instead, losing the diagnosis.
    const timeout = Number(/'--timeout' '(\d+)'/.exec(sent)?.[1] ?? 0);
    expect(timeout).toBeGreaterThan(5000);
  });

  it('still throws for any other herdr error', async () => {
    // Only the stall is special. A real failure must not read as a quiet stall.
    const transport: HerdrTransport = {
      exec: async (command: string) => ({
        ok: true,
        exitCode: 0,
        stdout: command.includes('--help')
          ? ''
          : JSON.stringify({ error: { code: 'pane_not_found', message: 'gone' } }),
        stderr: '',
      }) as never,
      streamLines: async function* () {},
    };
    await expect(new HerdrClient(transport).sendPrompt('p', 'x')).rejects.toThrow(/gone/);
  });
});

describe('startNamedAgent', () => {
  /** A host that fails `agent start` with `agent_pane_busy` the first N times. */
  function flakyPane(busyTimes: number) {
    const commands: string[] = [];
    let seen = 0;
    const transport: HerdrTransport = {
      exec: async (command: string) => {
        commands.push(command);
        const ok = { ok: true, exitCode: 0, stdout: '', stderr: '' };
        if (command.includes('--help')) return { ...ok } as never;
        if (command.includes("'agent' 'start'")) {
          seen += 1;
          if (seen <= busyTimes) {
            return {
              ...ok,
              stdout: JSON.stringify({
                error: { code: 'agent_pane_busy', message: 'not an available shell' },
              }),
            } as never;
          }
        }
        return { ...ok, stdout: JSON.stringify({ ok: true, result: {} }) } as never;
      },
      streamLines: async function* () {},
    };
    return { commands, client: new HerdrClient(transport) };
  }

  const starts = (c: string[]) => c.filter((x) => x.includes("'agent' 'start'") && !x.includes('--help'));
  const runs = (c: string[]) => c.filter((x) => x.includes("'pane' 'run'"));

  it('passes the permission mode through to the agent', async () => {
    // herdr supplies the executable from --kind, so the mode has to ride after
    // `--`. Without it the new-chat screen's choice is silently dropped and
    // every tool call stops to ask.
    const { client, commands } = flakyPane(0);
    await client.startNamedAgent('p1', 'chat', 'claude', ['--permission-mode', 'bypassPermissions'], 'claude');
    expect(starts(commands)[0]).toContain("'--' '--permission-mode' 'bypassPermissions'");
  });

  it('retries a pane whose shell has not come up yet', async () => {
    // Measured against herdr 0.8.0: a pane created milliseconds ago answers
    // `agent_pane_busy`, and nothing was started — so a retry cannot double-run.
    const { client, commands } = flakyPane(2);
    await expect(
      client.startNamedAgent('p1', 'chat', 'claude', [], 'claude')
    ).resolves.toBe(true);
    expect(starts(commands)).toHaveLength(3);
    expect(runs(commands)).toEqual([]);
  });

  it('falls back to the legacy path when the pane never becomes a shell', async () => {
    const { client, commands } = flakyPane(99);
    await expect(
      client.startNamedAgent('p1', 'chat', 'claude', [], 'claude --permission-mode manual')
    ).resolves.toBe(false);
    expect(runs(commands)).toHaveLength(1);
    expect(runs(commands)[0]).toContain('--permission-mode manual');
  });

  it('does not retry an error that is not about pane readiness', async () => {
    // A timeout may mean the agent DID launch. Retrying that is how you end up
    // with two agents in one pane.
    const transport: HerdrTransport = {
      exec: async (command: string) =>
        ({
          ok: true,
          exitCode: 0,
          stdout: command.includes('--help')
            ? ''
            : JSON.stringify({ error: { code: 'timeout', message: 'took too long' } }),
          stderr: '',
        }) as never,
      streamLines: async function* () {},
    };
    await expect(
      new HerdrClient(transport).startNamedAgent('p1', 'chat', 'claude', [], 'claude')
    ).rejects.toThrow(/took too long/);
  });
});

/**
 * herdr can print its error envelope AND exit non-zero. The exit code must not
 * eat the diagnosis: a stall that reads as "exit 1" is back to guessing.
 */
describe('an error envelope arriving with a non-zero exit', () => {
  function exitingHost(reply: { exitCode: number; stdout?: string; stderr?: string }) {
    const transport: HerdrTransport = {
      exec: async (command: string) => {
        if (command.includes('--help')) {
          return { ok: true, exitCode: 0, stdout: '', stderr: '' } as never;
        }
        if (command.includes('command -v')) {
          // The exit-127 path diagnoses WHERE herdr is; "nowhere" keeps the
          // canned host on the plain herdr_not_found answer.
          return { ok: true, exitCode: 0, stdout: 'NONE', stderr: '' } as never;
        }
        return {
          ok: true,
          exitCode: reply.exitCode,
          stdout: reply.stdout ?? '',
          stderr: reply.stderr ?? '',
        } as never;
      },
      streamLines: async function* () {},
    };
    return new HerdrClient(transport);
  }

  const STALL_ENVELOPE = JSON.stringify({
    error: { code: 'agent_prompt_stalled', message: 'no state change observed' },
  });

  it('is recognised from stdout even when herdr also exits non-zero', async () => {
    // herdr can print the error envelope AND exit 1. The exit code must not eat
    // the diagnosis — a stall that reads as "exit 1" is back to guessing.
    const client = exitingHost({ exitCode: 1, stdout: STALL_ENVELOPE });
    await expect(client.sendPrompt('pane-1', 'hello')).resolves.toBe('stalled');
  });

  it('is recognised from stderr even when herdr also exits non-zero', async () => {
    const client = exitingHost({ exitCode: 1, stderr: STALL_ENVELOPE });
    await expect(client.sendPrompt('pane-1', 'hello')).resolves.toBe('stalled');
  });

  it('leaves a non-zero exit with no envelope as the generic error', async () => {
    const client = exitingHost({ exitCode: 1, stderr: 'segmentation fault' });
    await expect(client.sendPrompt('pane-1', 'hello')).rejects.toMatchObject({
      code: 'ssh_command_failed',
      message: expect.stringContaining('exit 1'),
    });
  });

  it('leaves the exit-127 diagnosis exactly as it was', async () => {
    const client = exitingHost({ exitCode: 127 });
    await expect(client.sendPrompt('pane-1', 'hello')).rejects.toMatchObject({
      code: 'herdr_not_found',
    });
  });
});

describe('capability memo provenance', () => {
  /**
   * A host whose `--help` answers are scripted per call, whose snapshots report
   * `version`, and which records every command.
   */
  function scriptedHost(probeReplies: readonly ('ok' | 'no' | 'throw')[], version: string) {
    const commands: string[] = [];
    let probeCalls = 0;
    const transport: HerdrTransport = {
      exec: async (command: string) => {
        commands.push(command);
        if (command.includes('--help')) {
          const reply = probeReplies[probeCalls] ?? 'ok';
          probeCalls += 1;
          if (reply === 'throw') throw new Error('connection reset');
          return { ok: true, exitCode: reply === 'ok' ? 0 : 1, stdout: '', stderr: '' } as never;
        }
        return {
          ok: true,
          exitCode: 0,
          stdout: JSON.stringify({ ok: true, result: { snapshot: { agents: [], version } } }),
          stderr: '',
        } as never;
      },
      streamLines: async function* () {},
    };
    return { commands, client: new HerdrClient(transport) };
  }

  const sends = (commands: string[]) => commands.filter((c) => !c.includes('--help'));

  it('recovers from a transport-failed probe once a snapshot reports 0.8.0', async () => {
    // One blip before the first poll must not downgrade the host for the
    // client's whole lifetime.
    const { client, commands } = scriptedHost(['throw'], '0.8.0');
    await expect(client.sendPrompt('pane-1', 'one')).resolves.toBe('unverified');
    await client.snapshot();
    await expect(client.sendPrompt('pane-1', 'two')).resolves.toBe('delivered');
    expect(commands.at(-1)).toContain("'agent' 'prompt'");
  });

  it('lets a reported version overrule a probe that answered no', async () => {
    // The probe said no (exit 1 — a mangled `--help`, an upgrade race), then the
    // snapshot said 0.8.0. The version is the host's own word; it wins.
    const { client, commands } = scriptedHost(['no'], '0.8.0');
    await expect(client.sendPrompt('pane-1', 'one')).resolves.toBe('unverified');
    await client.snapshot();
    await expect(client.sendPrompt('pane-1', 'two')).resolves.toBe('delivered');
    expect(commands.at(-1)).toContain("'agent' 'prompt'");
  });

  it('re-probes on the next send after a transport-failed probe', async () => {
    // No snapshot involved: "couldn't ask" is simply never cached as "no".
    const { client, commands } = scriptedHost(['throw', 'ok'], '0.8.0');
    await expect(client.sendPrompt('pane-1', 'one')).resolves.toBe('unverified');
    await expect(client.sendPrompt('pane-1', 'two')).resolves.toBe('delivered');
    expect(commands.filter((c) => c.includes('--help'))).toHaveLength(2);
    expect(sends(commands)).toHaveLength(2);
  });

  it('still caches a probe that genuinely answered no', async () => {
    const { client, commands } = scriptedHost(['no'], '0.8.0');
    await client.sendPrompt('pane-1', 'one');
    await client.sendPrompt('pane-1', 'two');
    expect(commands.filter((c) => c.includes('--help'))).toHaveLength(1);
  });
});
