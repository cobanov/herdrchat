import { MissingCredentialsError, SshHerdrTransport } from '../herdr/sshTransport';

const mockConnect = jest.fn();
jest.mock('../../../modules/herdr-ssh/src', () => ({
  connect: (...args: unknown[]) => mockConnect(...args),
  disconnect: jest.fn(async () => undefined),
  exec: jest.fn(),
  streamLines: jest.fn(),
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
