import { act, renderHook } from '@testing-library/react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import { confirmDestructive } from '@/components/ActionSheet';
import { HerdrClient } from '@/lib/herdr/client';
import { forgetWorkspace } from '@/state/threadCache';
import { useChatActions } from '../useChatActions';
import type { ChatSummary } from '../useWorkspaces';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
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
  agents: [], preview: null, sessionSig: null,
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
    expect(onClosed).toHaveBeenCalledWith('w2');
    expect(refresh).toHaveBeenCalledTimes(1);
  }
});
