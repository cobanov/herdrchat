import Native from '../HerdrSshModule';
import { streamLines, type SshConfig } from '..';
import { SshHerdrTransport } from '../../../../src/lib/herdr/sshTransport';

jest.mock('../HerdrSshModule', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(), disconnect: jest.fn(), exec: jest.fn(),
    startStream: jest.fn(), stopStream: jest.fn(), addListener: jest.fn(),
  },
}));
const native = jest.mocked(Native);
const config: SshConfig = { host: '127.0.0.1', port: 22, username: 'test', auth: { kind: 'password', password: 'fixture' } };
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

beforeEach(() => {
  jest.resetAllMocks();
  native.connect.mockResolvedValue({ ok: true, fingerprint: 'pin-A' });
  native.disconnect.mockResolvedValue(undefined);
  native.exec.mockResolvedValue({ ok: true, stdout: '', stderr: '', exitCode: 0 });
  native.startStream.mockResolvedValue({ ok: true });
  native.stopStream.mockResolvedValue(undefined);
  native.addListener.mockReturnValue({ remove: jest.fn() });
});

it('shares opening and waits for durable pin storage before any command', async () => {
  let saved!: () => void;
  const persist = jest.fn(() => new Promise<void>(resolve => { saved = resolve; }));
  const transport = new SshHerdrTransport('host', async () => config, persist);
  const commands = [transport.exec('one', 1000), transport.exec('two', 1000)];
  await flush();
  expect(native.connect).toHaveBeenCalledTimes(1);
  expect(native.exec).not.toHaveBeenCalled();
  saved();
  await Promise.all(commands);
  expect(native.exec).toHaveBeenCalledTimes(2);
});

it('closes after a failed pin save, executes nothing, and permits a later fresh attempt', async () => {
  const persist = jest.fn().mockRejectedValueOnce(new Error('Keychain write failed')).mockResolvedValue(undefined);
  const transport = new SshHerdrTransport('host', async () => config, persist);
  await expect(transport.exec('write', 1000)).resolves.toMatchObject({ ok: false });
  expect(native.disconnect).toHaveBeenCalledWith('host');
  expect(native.exec).not.toHaveBeenCalled();
  await expect(transport.exec('read', 1000)).resolves.toMatchObject({ ok: true });
  expect(native.connect).toHaveBeenCalledTimes(2);
});

it('aborts 20 silent streams without waiting for a host event or leaking listeners', async () => {
  const remove = jest.fn();
  native.addListener.mockReturnValue({ remove });
  for (let i = 0; i < 20; i += 1) {
    const controller = new AbortController();
    const reader = streamLines('host', 'tail', 1000, controller.signal);
    const waiting = reader.next();
    await flush();
    controller.abort();
    await expect(waiting).resolves.toEqual({ done: true, value: undefined });
  }
  expect(remove).toHaveBeenCalledTimes(60);
  expect(new Set(native.stopStream.mock.calls.map(call => call[0])).size).toBe(20);
});

it('stops again after an aborted start registers its native handle', async () => {
  let started!: () => void;
  native.startStream.mockImplementation(() => new Promise(resolve => {
    started = () => resolve({ ok: true });
  }));
  const controller = new AbortController();
  const waiting = streamLines('host', 'tail', 1000, controller.signal).next();
  controller.abort();
  expect(native.stopStream).toHaveBeenCalledTimes(1);
  started();
  await expect(waiting).resolves.toMatchObject({ done: true });
  expect(native.stopStream).toHaveBeenCalledTimes(2);
});

it('does not start a stream that was already cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(streamLines('host', 'tail', 1000, controller.signal).next()).resolves.toMatchObject({ done: true });
  expect(native.startStream).not.toHaveBeenCalled();
});
