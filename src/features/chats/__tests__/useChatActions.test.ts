import { act, renderHook } from '@testing-library/react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import { confirmDestructive, showActionSheet } from '@/components/ActionSheet';
import { HerdrClient } from '@/lib/herdr/client';
import { forgetWorkspace } from '@/state/threadCache';
import { useChatActions } from '../useChatActions';
import type { ChatSummary } from '../useWorkspaces';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/components/ActionSheet', () => ({ confirmDestructive: jest.fn(), showActionSheet: jest.fn() }));
jest.mock('@/lib/haptics', () => ({ haptics: { medium: jest.fn() } }));
jest.mock('@/state/threadCache', () => ({ forgetWorkspace: jest.fn().mockResolvedValue(undefined) }));

const client = new HerdrClient({
  exec: async () => ({ ok: true, exitCode: 0, stdout: '', stderr: '' }),
  streamLines: async function* () { yield* []; },
});
// Only passed through to the mocked cache operation in these hook tests.
const db = {} as SQLiteDatabase;
const summary: ChatSummary = {
  workspaceId: 'w2', title: 'Notes', number: 2, status: 'idle',
  agents: [], panes: [], preview: null, sessionSig: null, restoreError: null, sessionTitle: null, agentName: null,
};

afterEach(() => { jest.restoreAllMocks(); jest.clearAllMocks(); });

it.each([false, true])('leaves the selected detail only after a successful confirmed close (failure=%s)', async (fails) => {
  const close = jest.spyOn(client, 'closeWorkspace');
  if (fails) close.mockRejectedValue(new Error('Host unavailable'));
  else close.mockResolvedValue(undefined);
  const onClosed = jest.fn();
  const refresh = jest.fn().mockResolvedValue(undefined);
  const { result } = await renderHook(() => useChatActions({ client, connectionId: 'demo', db, refresh, onClosed }));
  await act(() => result.current.closeChat(summary));
  expect(close).not.toHaveBeenCalled();
  expect(onClosed).not.toHaveBeenCalled();
  await act(async () => {
    jest.mocked(confirmDestructive).mock.calls[0]?.[0].onConfirm();
  });
  expect(close).toHaveBeenCalledWith('w2');
  if (fails) {
    expect(onClosed).not.toHaveBeenCalled();
    expect(forgetWorkspace).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Host unavailable');
  } else {
    expect(forgetWorkspace).toHaveBeenCalledWith(db, 'demo', 'w2');
    expect(onClosed).toHaveBeenCalledWith('w2', 'demo');
    expect(refresh).toHaveBeenCalledTimes(1);
  }
});

// The sheet and the confirmation name the row that was pressed, which is
// titled by its session, and the confirmation still says which workspace stops.
it('names the chat by its session in the sheet and the close confirmation', async () => {
  const titled: ChatSummary = { ...summary, sessionTitle: 'Release notes summary' };
  const { result } = await renderHook(() => useChatActions({ client, connectionId: 'demo', db, refresh: jest.fn() }));
  await act(() => result.current.manageChat(titled));
  expect(jest.mocked(showActionSheet).mock.calls[0]?.[0].title).toBe('Release notes summary');
  await act(() => result.current.closeChat(titled));
  const asked = jest.mocked(confirmDestructive).mock.calls[0]?.[0];
  expect(asked?.title).toBe('Close Release notes summary?');
  expect(asked?.message).toMatch(/^This closes workspace Notes: every tab/);
  await act(() => result.current.closeChat(summary));
  expect(jest.mocked(confirmDestructive).mock.calls[1]?.[0].title).toBe('Close Notes?');
  expect(jest.mocked(confirmDestructive).mock.calls[1]?.[0].message).toMatch(/^Every tab, pane/);
});

// A chat on one of the host's machines is closed and renamed on that machine,
// through its own client, and its cache is dropped under its own connection:
// the host's client would close the host's workspace with the same id.
it('runs a machine row\'s close and rename on the machine', async () => {
  const machineClient = new HerdrClient({
    exec: async () => ({ ok: true, exitCode: 0, stdout: '', stderr: '' }),
    streamLines: async function* () { yield* []; },
  });
  const hostClose = jest.spyOn(client, 'closeWorkspace').mockResolvedValue(undefined);
  const machineClose = jest.spyOn(machineClient, 'closeWorkspace').mockResolvedValue(undefined);
  const onClosed = jest.fn();
  const targetOf = (row: ChatSummary) =>
    row.workspaceId === 'w2' ? { client: machineClient, connectionId: 'demo/demo-nuku' } : null;
  const { result } = await renderHook(() => useChatActions({
    client, connectionId: 'demo', targetOf, db, refresh: jest.fn().mockResolvedValue(undefined), onClosed,
  }));
  await act(() => result.current.closeChat(summary));
  await act(async () => {
    jest.mocked(confirmDestructive).mock.calls[0]?.[0].onConfirm();
  });
  expect(machineClose).toHaveBeenCalledWith('w2');
  expect(hostClose).not.toHaveBeenCalled();
  expect(forgetWorkspace).toHaveBeenCalledWith(db, 'demo/demo-nuku', 'w2');
  expect(onClosed).toHaveBeenCalledWith('w2', 'demo/demo-nuku');

  await act(() => result.current.renameChat(summary));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/rename-chat',
    params: { workspaceId: 'w2', title: 'Notes', connectionId: 'demo/demo-nuku' },
  });
});
