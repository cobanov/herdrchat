import { renderHook } from '@testing-library/react-native';

import { DEMO_HEADSUP_PATH, demoHeadsUpStore } from '@/lib/demo/scenarios';
import { barLine, barText, parseHeadsUpFile, type HeadsUpChat, type HeadsUpItem } from '@/lib/headsup/items';
import { resetHeadsUpSession, useHeadsUp } from '@/state/headsUp';
import { useHeadsUpItems, useHeadsUpItemsOf, useOpenHeadsUpItems } from '../useHeadsUpHosts';

const CONNECTIONS = [{ id: 'demo', name: 'Demo' }, { id: 'mac', name: 'Gimel' }, { id: 'pi', name: 'Pi' }];
let mockOthers: { id: string; name: string }[] = [];
jest.mock('@/state/connections', () => ({
  useSelectedConnection: () => ({ id: 'demo', name: 'Demo' }),
  useConnections: (select: (state: { connections: { id: string; name: string }[] }) => unknown) => select({ connections: CONNECTIONS }),
}));
jest.mock('@/features/chats/useHostChats', () => ({ useOtherHosts: () => mockOthers }));

const bar = (items: readonly HeadsUpItem[]) => {
  const text = barText(items);
  return text === null ? null : barLine(text);
};

const DEMO_SESSION = '22222222-2222-4222-8222-222222222222';
const MAC_SESSION = '44444444-4444-4444-8444-444444444444';
const chat = (sessionId: string, workspaceId: string): HeadsUpChat => ({ sessionId, workspaceId, paneId: `${workspaceId}:p1`, soleAgent: true });

function hold(connectionId: string, sessionId: string, chats: HeadsUpChat[]) {
  const raw = demoHeadsUpStore({ sessionId, folder: 'notes' }, Date.now());
  useHeadsUp.getState().update(connectionId, () => ({
    path: DEMO_HEADSUP_PATH, detectedAt: 1, version: '1 1', file: parseHeadsUpFile(JSON.stringify(raw)), chats,
  }));
}

beforeEach(() => {
  resetHeadsUpSession();
  mockOthers = [];
  hold('demo', DEMO_SESSION, [chat(DEMO_SESSION, 'w2')]);
  hold('mac', MAC_SESSION, []);
  // A host looked at without the mod: a stale file there must not count.
  useHeadsUp.getState().update('pi', () => ({
    path: null, detectedAt: 1, version: null, file: parseHeadsUpFile(JSON.stringify(demoHeadsUpStore({ sessionId: 'x', folder: 'x' }, 0))), chats: [],
  }));
});

it('adds up the open items of several hosts for the chats’ bar, a host without the mod adding nothing', async () => {
  const ids = ['demo', 'mac', 'pi'];
  const { result } = await renderHook(() => useOpenHeadsUpItems(ids));
  expect(bar(result.current)).toBe('⚑ 2 blocking · 10 need you · 4 questions · 2 follow-ups · 2 failures · 2 notes');
  const one = await renderHook(() => useOpenHeadsUpItems(['demo']));
  expect(bar(one.result.current)).toBe('⚑ 1 blocking · 5 need you · 2 questions · 1 follow-up · 1 failure · 1 note');
  const none = await renderHook(() => useOpenHeadsUpItems(['pi', 'unknown']));
  expect(none.result.current).toEqual([]);
});

it('gives each item its host and the chat there that raised it', async () => {
  const ids = ['demo', 'mac', 'pi'];
  const { result } = await renderHook(() => useHeadsUpItemsOf(ids));
  const ofDemo = result.current.filter((entry) => entry.connectionId === 'demo');
  const ofMac = result.current.filter((entry) => entry.connectionId === 'mac');
  expect(ofDemo.length).toBeGreaterThan(0);
  expect(ofDemo.every((entry) => entry.hostName === 'Demo')).toBe(true);
  expect(ofDemo.find((entry) => entry.item.id === 'demohu1q')?.chat).toEqual(chat(DEMO_SESSION, 'w2'));
  // The mac's sessions run nowhere listed: no chat to go to.
  expect(ofMac.every((entry) => entry.hostName === 'Gimel' && entry.chat === null)).toBe(true);
  expect(result.current.some((entry) => entry.connectionId === 'pi')).toBe(false);
});

it('lists the selected host and every host whose chats join its list', async () => {
  const alone = await renderHook(() => useHeadsUpItems());
  expect(alone.result.current.hostCount).toBe(1);
  expect(new Set(alone.result.current.items.map((entry) => entry.connectionId))).toEqual(new Set(['demo']));
  mockOthers = [{ id: 'mac', name: 'Gimel' }];
  const several = await renderHook(() => useHeadsUpItems());
  expect(several.result.current.hostCount).toBe(2);
  expect(new Set(several.result.current.items.map((entry) => entry.connectionId))).toEqual(new Set(['demo', 'mac']));
});
