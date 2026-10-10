import Native from '../HerdrSshModule';
import {
  DEFAULT_TERM,
  base64FromBytes,
  closeShell,
  openShell,
  utf8Bytes,
  writeShellText,
  type ShellClosedEvent,
} from '..';

jest.mock('../HerdrSshModule', () => ({
  __esModule: true,
  default: {
    openShell: jest.fn(), writeShell: jest.fn(), resizeShell: jest.fn(), closeShell: jest.fn(),
    addListener: jest.fn(),
  },
}));
const native = jest.mocked(Native);

type Listener = (event: ShellClosedEvent) => void;
let listeners: { listener: Listener; remove: jest.Mock }[] = [];
const emit = (event: ShellClosedEvent) => [...listeners].forEach(({ listener }) => listener(event));

beforeEach(() => {
  jest.resetAllMocks();
  listeners = [];
  native.addListener.mockImplementation(((_name: string, listener: Listener) => {
    const entry = { listener, remove: jest.fn(() => { listeners = listeners.filter(other => other !== entry); }) };
    listeners.push(entry);
    return { remove: entry.remove };
  }) as unknown as typeof native.addListener);
  native.openShell.mockImplementation(async (_id, shellId) => ({ ok: true, shellId }));
  native.writeShell.mockResolvedValue({ ok: true });
  native.closeShell.mockResolvedValue(undefined);
});

it('encodes text as UTF-8 base64, as Data(base64Encoded:) reads it', () => {
  for (const text of ['', 'a', 'ab', 'abc', '\u001b[A', 'é', '→ ok', '🙂 x']) {
    expect(base64FromBytes(utf8Bytes(text))).toBe(Buffer.from(text, 'utf8').toString('base64'));
  }
  expect(base64FromBytes(Uint8Array.from([0, 255, 128]))).toBe('AP+A');
});

it('opens with the default TERM under a fresh id, and hears only its own end', async () => {
  const onClosed = jest.fn();
  const first = await openShell('host', { command: 'herdr agent attach w1:p1', cols: 80, rows: 24, startTimeoutMs: 1000, onClosed });
  const second = await openShell('host', { command: 'true', cols: 80, rows: 24, startTimeoutMs: 1000 });
  if (!first.ok || !second.ok) throw new Error('expected both to open');
  expect(first.shellId).not.toBe(second.shellId);
  expect(native.openShell).toHaveBeenCalledWith('host', first.shellId, 'herdr agent attach w1:p1', 80, 24, DEFAULT_TERM, 1000);

  emit({ shellId: second.shellId, reason: 'exited', exitCode: 0 });
  expect(onClosed).not.toHaveBeenCalled();
  emit({ shellId: first.shellId, reason: 'connection_lost' });
  expect(onClosed).toHaveBeenCalledWith({ shellId: first.shellId, reason: 'connection_lost' });
  expect(listeners).toHaveLength(0);
});

it('listens before the channel opens, so an instant exit is not missed', async () => {
  const onClosed = jest.fn();
  native.openShell.mockImplementation(async (_id, shellId) => {
    emit({ shellId, reason: 'exited', exitCode: 127 });
    return { ok: true, shellId };
  });
  await openShell('host', { command: 'herdr', cols: 80, rows: 24, startTimeoutMs: 1000, onClosed });
  expect(onClosed).toHaveBeenCalledWith(expect.objectContaining({ reason: 'exited', exitCode: 127 }));
});

it('drops the listener when opening fails or the app closes the shell', async () => {
  native.openShell.mockResolvedValueOnce({ ok: false, code: 'not_connected', message: 'no' });
  const failed = await openShell('host', { command: 'x', cols: 1, rows: 1, startTimeoutMs: 1, onClosed: jest.fn() });
  expect(failed.ok).toBe(false);
  expect(listeners).toHaveLength(0);

  const onClosed = jest.fn();
  const opened = await openShell('host', { command: 'x', cols: 1, rows: 1, startTimeoutMs: 1, onClosed });
  if (!opened.ok) throw new Error('expected to open');
  await closeShell(opened.shellId);
  expect(native.closeShell).toHaveBeenCalledWith(opened.shellId);
  emit({ shellId: opened.shellId, reason: 'exited', exitCode: 0 });
  expect(onClosed).not.toHaveBeenCalled();
});

it('writes text as base64 bytes', async () => {
  await writeShellText('t1', '\u0003');
  expect(native.writeShell).toHaveBeenCalledWith('t1', 'Aw==');
});
