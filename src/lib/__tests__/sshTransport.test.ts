import { MissingCredentialsError, SshHerdrTransport } from '../herdr/sshTransport';

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
