import { DEFAULT_SESSION, isNamedSession, withSession } from '../herdr/session';
import type { HerdrTransport } from '../herdr/transport';

function recorder(): { transport: HerdrTransport; commands: string[] } {
  const commands: string[] = [];
  const transport: HerdrTransport = {
    exec: async (command) => {
      commands.push(command);
      return { ok: true, stdout: '', stderr: '', exitCode: 0 } as never;
    },
    streamLines: async function* (command) {
      commands.push(command);
    },
  };
  return { transport, commands };
}

describe('isNamedSession', () => {
  it.each([null, undefined, '', '   ', DEFAULT_SESSION, ' default '])(
    'treats %p as unnamed',
    (value) => {
      expect(isNamedSession(value)).toBe(false);
    }
  );

  it('accepts a real name', () => {
    expect(isNamedSession('work')).toBe(true);
  });
});

describe('withSession', () => {
  it('returns the same transport when there is no named session', () => {
    // Identity, not a wrapper: nothing to add, and a pass-through layer would
    // appear in every stack trace for no reason.
    const { transport } = recorder();
    expect(withSession(transport, null)).toBe(transport);
    expect(withSession(transport, DEFAULT_SESSION)).toBe(transport);
  });

  it('exports HERDR_SESSION ahead of the command', async () => {
    const { transport, commands } = recorder();
    await withSession(transport, 'work').exec('herdr api snapshot', 1000);
    expect(commands[0]).toBe("export HERDR_SESSION='work'; herdr api snapshot");
  });

  it('covers streamLines too, not just exec', async () => {
    // The transcript tail goes through streamLines. Binding only `exec` would
    // read the right workspaces from the wrong session's transcript.
    const { transport, commands } = recorder();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const line of withSession(transport, 'work').streamLines('tail -f x', 1000)) {
      /* drain */
    }
    expect(commands[0]).toBe("export HERDR_SESSION='work'; tail -f x");
  });

  it('quotes a name with a space or a quote in it', async () => {
    const { transport, commands } = recorder();
    await withSession(transport, "my 'sess").exec('herdr ping', 1000);
    expect(commands[0]).toBe(`export HERDR_SESSION='my '\\''sess'; herdr ping`);
  });

  it('trims the stored name', async () => {
    const { transport, commands } = recorder();
    await withSession(transport, '  work  ').exec('herdr ping', 1000);
    expect(commands[0]).toBe("export HERDR_SESSION='work'; herdr ping");
  });
});
