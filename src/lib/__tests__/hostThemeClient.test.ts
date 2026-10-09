import type { ExecResult } from '../../../modules/herdr-ssh/src';
import { POLL_TIMEOUT_MS, SEND_TIMEOUT_MS } from '../herdr/timeouts';
import type { HerdrTransport } from '../herdr/transport';
import { bootstrapCommand } from '../theme/bootstrap';
import { THEME_BEGIN, THEME_MISSING, themeFetchCommand, themeResetCommand } from '../theme/hostTheme';
import {
  bootstrapHostTheme,
  fetchHostTheme,
  HOST_THEME_CHECK_INTERVAL_MS,
  resetHostTheme,
  themeCheckDue,
} from '../theme/hostThemeClient';
import type { HostThemeFile } from '../theme/resolve';

const ok = (stdout: string): ExecResult => ({ ok: true, exitCode: 0, stdout, stderr: '' });

/** A host that answers every command with the next canned result, and remembers what it was asked. */
function canned(...answers: (ExecResult | Error)[]) {
  const calls: { command: string; timeoutMs: number }[] = [];
  const transport: HerdrTransport = {
    exec: async (command, timeoutMs) => {
      calls.push({ command, timeoutMs });
      const next = answers.shift() ?? ok('');
      if (next instanceof Error) throw next;
      return next;
    },
    streamLines: async function* () {
      yield* [];
    },
  };
  return { transport, calls };
}

const held: HostThemeFile = { kind: 'present', mtime: 100, text: '{"accent":"#123456"}' };

describe('fetchHostTheme', () => {
  it('sends the held mtime and keeps the held file when the host says unchanged', async () => {
    const { transport, calls } = canned(ok('100\n'));
    expect(await fetchHostTheme(transport, held)).toBe(held);
    expect(calls).toEqual([{ command: themeFetchCommand(100), timeoutMs: POLL_TIMEOUT_MS }]);
  });

  it('returns the new file when it changed', async () => {
    const { transport } = canned(ok(`101\n${THEME_BEGIN}\n{"name":"New"}\n`));
    expect(await fetchHostTheme(transport, held)).toEqual({ kind: 'present', mtime: 101, text: '{"name":"New"}\n' });
  });

  it('reads a removed file as missing', async () => {
    const { transport } = canned(ok(`${THEME_MISSING}\n`));
    expect(await fetchHostTheme(transport, held)).toEqual({ kind: 'missing' });
  });

  it('asks for the contents whatever the mtime when forced', async () => {
    const { transport, calls } = canned(ok(`100\n${THEME_BEGIN}\n${held.kind === 'present' ? held.text : ''}`));
    expect(await fetchHostTheme(transport, held, { force: true })).toEqual(held);
    expect(calls[0]?.command).toBe(themeFetchCommand(null));
  });

  // A failed check keeps the theme the phone has; only the host's own word
  // (the missing sentinel) takes it away.
  it.each<[string, ExecResult | Error]>([
    ['a transport failure', { ok: false, code: 'timeout', message: 'slow' }],
    ['a non-zero exit', { ok: true, exitCode: 1, stdout: `${THEME_MISSING}\n`, stderr: 'boom' }],
    ['output it does not recognise', ok('Welcome to Ubuntu\n')],
    ['a transport that throws', new Error('socket closed')],
  ])('is null on %s', async (_label, answer) => {
    const { transport } = canned(answer);
    expect(await fetchHostTheme(transport, held)).toBeNull();
  });
});

describe('bootstrap and reset', () => {
  it('runs the bootstrap with a poll deadline and reports success', async () => {
    const { transport, calls } = canned(ok(''));
    expect(await bootstrapHostTheme(transport)).toBe(true);
    expect(calls).toEqual([{ command: bootstrapCommand(), timeoutMs: POLL_TIMEOUT_MS }]);
    expect(await bootstrapHostTheme(canned({ ok: false, code: 'connect_failed', message: 'down' }).transport)).toBe(false);
  });

  it('runs the reset with a send deadline, since a person is waiting on it', async () => {
    const { transport, calls } = canned(ok(''));
    expect(await resetHostTheme(transport)).toBe(true);
    expect(calls).toEqual([{ command: themeResetCommand(), timeoutMs: SEND_TIMEOUT_MS }]);
    expect(await resetHostTheme(canned(new Error('gone')).transport)).toBe(false);
  });
});

describe('themeCheckDue', () => {
  it('is due when never checked, and then once the interval has passed', () => {
    expect(themeCheckDue(null, 0)).toBe(true);
    expect(themeCheckDue(1_000, 1_000 + HOST_THEME_CHECK_INTERVAL_MS - 1)).toBe(false);
    expect(themeCheckDue(1_000, 1_000 + HOST_THEME_CHECK_INTERVAL_MS)).toBe(true);
  });
});
