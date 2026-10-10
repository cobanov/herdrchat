import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { ChatPref } from '@/lib/chatPrefs';
import type { ServerConnection } from '@/state/connections';
import { loadChatPrefs, saveChatPref } from '@/state/db';
import { publishMutedChats } from '@/features/notifications/mutedChats';
import { listChats, rowKey, type ListedChat } from '../listedChat';
import { useChatPrefs } from '../useChatPrefs';
import type { ChatSummary } from '../useWorkspaces';

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('@/lib/haptics', () => ({ haptics: { selection: jest.fn() } }));
jest.mock('@/features/notifications/mutedChats', () => ({ publishMutedChats: jest.fn().mockResolvedValue(undefined) }));
/** Prefs as saved, by connection id, then workspace id. */
const mockSaved = new Map<string, Map<string, ChatPref>>();
jest.mock('@/state/db', () => ({
  loadChatPrefs: jest.fn(async (_db: unknown, connectionId: string) => new Map(mockSaved.get(connectionId) ?? [])),
  saveChatPref: jest.fn(async () => undefined),
}));

const db = {} as SQLiteDatabase;
const host = { id: 'gimel', name: 'Gimel', host: 'gimel', port: 22, username: 'me' } as ServerConnection;
const klawId = 'gimel/m-klaw';
const w1: ChatSummary = {
  workspaceId: 'w1', title: 'notes', number: 1, status: 'idle', agents: [], panes: [], preview: null,
  sessionSig: 'sig-host', restoreError: null, sessionTitle: null, agentName: null,
};
const [hostRow] = listChats([w1], host.id, null) as [ListedChat];
const [klawRow] = listChats([{ ...w1, title: 'kenneth-bot', sessionSig: 'sig-klaw' }], klawId, { id: 'm-klaw', label: 'klaw' }) as [ListedChat];
const summaries = [hostRow, klawRow];

beforeEach(() => {
  mockSaved.clear();
  jest.clearAllMocks();
});

// Both rows are `w1`. Pins were saved under the selected host's id, so a pin
// on klaw's w1 landed on Gimel's w1.
it('files a pin under the row\'s own connection, and reads it back by row', async () => {
  mockSaved.set(klawId, new Map([['w1', { sessionSig: 'sig-klaw', pinnedAt: 5, muted: false }]]));
  const { result } = await renderHook(() => useChatPrefs(db, host, summaries, [host.id, klawId]));
  await waitFor(() => expect(result.current.pinnedAt.size).toBe(1));
  expect(jest.mocked(loadChatPrefs).mock.calls.map((call) => call[1])).toEqual(expect.arrayContaining([host.id, klawId]));
  expect([...result.current.pinnedAt.keys()]).toEqual([rowKey(klawRow)]);
  expect(result.current.isPinned(klawRow)).toBe(true);
  expect(result.current.isPinned(hostRow)).toBe(false);

  await act(async () => result.current.togglePin(klawRow));
  expect(saveChatPref).toHaveBeenLastCalledWith(db, klawId, 'w1', 'sig-klaw', { pinnedAt: null });
  await act(async () => result.current.togglePin(hostRow));
  expect(saveChatPref).toHaveBeenLastCalledWith(db, host.id, 'w1', 'sig-host', { pinnedAt: expect.any(Number) });
});

// The host's notifier does not watch its machines' sessions, so a mute there
// would be a promise nothing keeps.
it('offers no mute on a machine\'s row, and saves none', async () => {
  mockSaved.set(klawId, new Map([['w1', { sessionSig: 'sig-klaw', pinnedAt: null, muted: true }]]));
  const { result } = await renderHook(() => useChatPrefs(db, host, summaries, [host.id, klawId]));
  await waitFor(() => expect(loadChatPrefs).toHaveBeenCalledTimes(2));
  expect(result.current.canMute(klawRow)).toBe(false);
  expect(result.current.isMuted(klawRow)).toBe(false);
  expect(result.current.canMute(hostRow)).toBe(true);

  await act(async () => result.current.toggleMute(klawRow));
  expect(saveChatPref).not.toHaveBeenCalled();
  expect(publishMutedChats).not.toHaveBeenCalled();

  await act(async () => result.current.toggleMute(hostRow));
  expect(saveChatPref).toHaveBeenCalledWith(db, host.id, 'w1', 'sig-host', { muted: true });
});
