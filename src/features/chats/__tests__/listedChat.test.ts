import { listChats, openFor, readsOf, rowKey, rowTestKey } from '../listedChat';
import type { ChatSummary } from '../useWorkspaces';

const mac = { id: 'mac', label: 'MacBook' };
const chat: ChatSummary = {
  workspaceId: 'w1', title: 'kenneth-bot', number: 1, status: 'idle', agents: [], panes: [], preview: null,
  sessionSig: null, shellPanes: [], tabs: [], layouts: [], activeTabId: null, tabCount: 0, paneCount: 0, restoreError: null, sessionTitle: null, agentName: null,
};

it('tags every row and pane with its connection and host', () => {
  const pane = { paneId: 'w1:p1', agent: {} as never, sessionSig: null, preview: null, status: 'idle' as const, sessionTitle: null, agentName: null };
  const [listed] = listChats([{ ...chat, panes: [pane] }], 'mac', mac);
  expect(listed?.connectionId).toBe('mac');
  expect(listed?.host).toEqual(mac);
  expect(listed?.panes[0]).toMatchObject({ paneId: 'w1:p1', connectionId: 'mac', host: mac });
});

// herdr numbers each host's workspaces from w1.
it('keys a row by its connection and workspace, so one host\'s w1 is not another\'s', () => {
  expect(rowKey({ connectionId: 'demo', workspaceId: 'w1' })).not.toBe(rowKey({ connectionId: 'mac', workspaceId: 'w1' }));
});

// The selected host's rows keep the ids every flow uses.
it('leads another host\'s testID key with its id, leaving the selected host\'s as they were', () => {
  expect(rowTestKey({ workspaceId: 'w1', host: mac })).toBe('mac-w1');
  expect(rowTestKey({ workspaceId: 'w1', host: mac }, 'w1:p1')).toBe('mac-w1:p1');
  expect(rowTestKey({ workspaceId: 'w2', host: null })).toBe('w2');
  expect(rowTestKey({ workspaceId: 'w2' })).toBe('w2');
});

it('compares the open chat and read markers on the row\'s own connection', () => {
  const open = { connectionId: 'demo', key: 'w1' };
  expect(openFor(open, { connectionId: 'demo' })).toBe('w1');
  expect(openFor(open, { connectionId: 'mac' })).toBeNull();
  expect(openFor(null, { connectionId: 'demo' })).toBeNull();
  const read = { sessionSig: 's', openedAt: 1 };
  const reads = new Map([['mac', new Map([['w1', read]])]]);
  expect(readsOf(reads, { connectionId: 'mac' }).get('w1')).toBe(read);
  expect(readsOf(reads, { connectionId: 'demo' }).size).toBe(0);
});
