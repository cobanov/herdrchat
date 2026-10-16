import { jumpCommand, withMachine } from '@/lib/herdr/machine';
import { MAX_COMMAND_BYTES } from '@/lib/herdr/socket';
import { MissingCredentialsError, SshHerdrTransport } from '../sshTransport';

const mockConnect = jest.fn();
jest.mock('../../../modules/herdr-ssh/src', () => ({
  connect: (...args: unknown[]) => mockConnect(...args),
  disconnect: jest.fn(async () => undefined),
  exec: jest.fn(),
  streamLines: jest.fn(),
  SshStreamError: class SshStreamError extends Error {
    readonly code: string;
    constructor(failure: { code: string; message: string }) {
      super(failure.message);
      this.name = 'SshStreamError';
      this.code = failure.code;
    }
  },
}));

describe('SshHerdrTransport (#98)', () => {
  it('names a missing key or password instead of attempting an empty login', async () => {
    const transport = new SshHerdrTransport('host-1', async () => {
      throw new MissingCredentialsError("The private key for mini isn't on this device.");
    });
    await expect(transport.exec('true', 1000)).resolves.toMatchObject({
      ok: false,
      code: 'credentials_missing',
      message: expect.stringContaining("isn't on this device"),
    });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('still reports any other config failure as a connect failure', async () => {
    const transport = new SshHerdrTransport('host-2', async () => {
      throw new Error('keychain unavailable');
    });
    await expect(transport.exec('true', 1000)).resolves.toMatchObject({ ok: false, code: 'connect_failed' });
  });
});

// HC-5: a host that connects but names no key cannot be pinned, so it is a
// failure, never a pin of nothing.
it('refuses a connection that reports no host key fingerprint', async () => {
  mockConnect.mockResolvedValueOnce({ ok: true, fingerprint: '' });
  const pinned = jest.fn();
  const transport = new SshHerdrTransport('host-6', async () => ({ host: 'h', port: 22, username: 'u', auth: { kind: 'password', password: 'p' } }) as never, pinned);
  await expect(transport.exec('true', 1000)).resolves.toMatchObject({
    ok: false,
    code: 'connect_failed',
    message: expect.stringContaining('no key fingerprint'),
  });
  expect(pinned).not.toHaveBeenCalled();
  mockConnect.mockClear();
});

// #105: the CLI send paths had no size guard at all.
it('refuses a command longer than a host shell accepts as one argument', async () => {
  const transport = new SshHerdrTransport('host-3', async () => {
    throw new Error('never reached');
  });
  await expect(transport.exec(`herdr pane run w1:p1 '${'a'.repeat(130 * 1024)}'`, 1000)).resolves.toMatchObject({
    ok: false,
    code: 'request_too_large',
  });
  expect(mockConnect).not.toHaveBeenCalled();
});

// A machine's command grows on the way: one more level of quoting turns each
// `'` into four bytes. The cap is checked on what the host's shell gets,
// the jumped command, so a prompt that fits a host and not a jump still says
// it is too long rather than failing on the host with E2BIG.
it('refuses a jumped command that only the jump made too long', async () => {
  const transport = new SshHerdrTransport('host-5', async () => {
    throw new Error('never reached');
  });
  const prompt = `herdr pane run w1:p1 '${"it'''s ".repeat(4_000)}${'a'.repeat(90 * 1024)}'`;
  expect(Buffer.byteLength(prompt)).toBeLessThan(MAX_COMMAND_BYTES);
  expect(Buffer.byteLength(jumpCommand('klaw', prompt, 1000))).toBeGreaterThan(MAX_COMMAND_BYTES);
  await expect(withMachine(transport, 'klaw').exec(prompt, 1000)).resolves.toMatchObject({
    ok: false,
    code: 'request_too_large',
  });
  expect(mockConnect).not.toHaveBeenCalled();
});

// #109: a stream that could not open lost its failure code.
it('says why a stream could not open', async () => {
  const transport = new SshHerdrTransport('host-4', async () => {
    throw new MissingCredentialsError("The password for mini isn't on this device.");
  });
  const open = async () => {
    for await (const _line of transport.streamLines('tail -f x', 1000)) void _line;
  };
  await expect(open()).rejects.toMatchObject({ name: 'SshStreamError', code: 'credentials_missing' });
});
