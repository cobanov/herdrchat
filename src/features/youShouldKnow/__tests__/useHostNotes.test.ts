import { renderHook } from '@testing-library/react-native';

import { DEMO_YSK_ELSEWHERE, DEMO_YSK_PATH, demoYskStore } from '@/lib/demo/scenarios';
import { notesBarLine, notesBarText, parseYskFile, type NoteChat } from '@/lib/youShouldKnow/notes';
import { resetYouShouldKnowSession, useYouShouldKnow } from '@/state/youShouldKnow';
import { useAllNotes, useHostNotesOf, useNotesOf } from '../useHostNotes';

const CONNECTIONS = [{ id: 'demo', name: 'Demo' }, { id: 'mac', name: 'Gimel' }, { id: 'pi', name: 'Pi' }];
let mockOthers: { id: string; name: string }[] = [];
jest.mock('@/state/connections', () => ({
  useSelectedConnection: () => ({ id: 'demo', name: 'Demo' }),
  useConnections: (select: (state: { connections: { id: string; name: string }[] }) => unknown) => select({ connections: CONNECTIONS }),
}));
jest.mock('@/features/chats/useHostChats', () => ({ useOtherHosts: () => mockOthers }));

const DEMO_SESSION = '22222222-2222-4222-8222-222222222222';
const MAC_SESSION = '44444444-4444-4444-8444-444444444444';
const chat = (sessionId: string, workspaceId: string): NoteChat => ({ sessionId, workspaceId, paneId: `${workspaceId}:p1`, soleAgent: true, title: 'Notes' });

function hold(connectionId: string, sessionId: string, now: number, chats: NoteChat[]) {
  useYouShouldKnow.getState().update(connectionId, () => ({
    path: DEMO_YSK_PATH, detectedAt: 1, version: '1 1', file: parseYskFile(JSON.stringify(demoYskStore(sessionId, now))), chats,
  }));
}

beforeEach(() => {
  resetYouShouldKnowSession();
  mockOthers = [];
  hold('demo', DEMO_SESSION, 1_000_000, [chat(DEMO_SESSION, 'w2')]);
  // The mac's notes are newer by a minute.
  hold('mac', MAC_SESSION, 1_060_000, []);
  // A host looked at without the plugin: a stale file there must not count.
  useYouShouldKnow.getState().update('pi', () => ({
    path: null, detectedAt: 1, version: null, file: parseYskFile(JSON.stringify(demoYskStore('x', 0))), chats: [],
  }));
});

it('adds up the notes of several hosts for the chats’ bar, a host without the plugin adding nothing', async () => {
  const { result } = await renderHook(() => useNotesOf(['demo', 'mac', 'pi']));
  expect(notesBarLine(notesBarText(result.current)!)).toBe('✦ 4 notes for you');
  // Newest first, across hosts.
  expect(result.current.map((note) => note.sessionId)).toEqual([MAC_SESSION, DEMO_SESSION, DEMO_YSK_ELSEWHERE, DEMO_YSK_ELSEWHERE]);
  const none = await renderHook(() => useNotesOf(['pi', 'unknown']));
  expect(none.result.current).toEqual([]);
});

it('gives each note its host and the chat there whose session it is', async () => {
  const { result } = await renderHook(() => useHostNotesOf(['demo', 'mac', 'pi']));
  const ofDemo = result.current.filter((entry) => entry.connectionId === 'demo');
  expect(ofDemo.map((entry) => [entry.hostName, entry.note.sessionId, entry.chat])).toEqual([
    ['Demo', DEMO_SESSION, chat(DEMO_SESSION, 'w2')],
    ['Demo', DEMO_YSK_ELSEWHERE, null],
  ]);
  // The mac's sessions run in no listed chat: another session there.
  expect(result.current.filter((entry) => entry.connectionId === 'mac').every((entry) => entry.hostName === 'Gimel' && entry.chat === null)).toBe(true);
  expect(result.current.some((entry) => entry.connectionId === 'pi')).toBe(false);
});

it('lists the selected host and every host whose chats join its list', async () => {
  const alone = await renderHook(() => useAllNotes());
  expect(alone.result.current.connectionIds).toEqual(['demo']);
  expect(new Set(alone.result.current.notes.map((entry) => entry.connectionId))).toEqual(new Set(['demo']));
  mockOthers = [{ id: 'mac', name: 'Gimel' }];
  const several = await renderHook(() => useAllNotes());
  expect(several.result.current.connectionIds).toHaveLength(2);
  expect(new Set(several.result.current.notes.map((entry) => entry.connectionId))).toEqual(new Set(['demo', 'mac']));
});
