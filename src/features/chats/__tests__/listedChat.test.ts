import { listChats, machineNotice, openFor, readsOf, rowKey, rowTestKey } from '../listedChat';
import type { ChatSummary } from '../useWorkspaces';

const nuku = { id: 'demo-nuku', label: 'nuku' };
const chat: ChatSummary = {
  workspaceId: 'w1', title: 'kenneth-bot', number: 1, status: 'idle', agents: [], panes: [], preview: null,
  sessionSig: null, restoreError: null, sessionTitle: null, agentName: null,
};

it('tags every row and pane with its connection and machine', () => {
  const pane = { paneId: 'w1:p1', agent: {} as never, sessionSig: null, preview: null, status: 'idle' as const, sessionTitle: null, agentName: null };
  const [listed] = listChats([{ ...chat, panes: [pane] }], 'demo/demo-nuku', nuku);
  expect(listed?.connectionId).toBe('demo/demo-nuku');
  expect(listed?.machine).toEqual(nuku);
  expect(listed?.panes[0]).toMatchObject({ paneId: 'w1:p1', connectionId: 'demo/demo-nuku', machine: nuku });
});

// herdr numbers each machine's workspaces from w1, like the host's.
it('keys a row by its connection and workspace, so a machine\'s w1 is not the host\'s', () => {
  expect(rowKey({ connectionId: 'demo', workspaceId: 'w1' })).not.toBe(rowKey({ connectionId: 'demo/demo-nuku', workspaceId: 'w1' }));
});

// No slash, which a connection id has; the host's rows keep the ids every flow uses.
it('builds a slash-free testID key, leaving the host\'s rows as they were', () => {
  expect(rowTestKey({ workspaceId: 'w1', machine: nuku })).toBe('demo-nuku-w1');
  expect(rowTestKey({ workspaceId: 'w1', machine: nuku }, 'w1:p1')).toBe('demo-nuku-w1:p1');
  expect(rowTestKey({ workspaceId: 'w2', machine: null })).toBe('w2');
  expect(rowTestKey({ workspaceId: 'w2' })).toBe('w2');
});

it('compares the open chat and read markers on the row\'s own connection', () => {
  const open = { connectionId: 'demo', key: 'w1' };
  expect(openFor(open, { connectionId: 'demo' })).toBe('w1');
  expect(openFor(open, { connectionId: 'demo/demo-nuku' })).toBeNull();
  expect(openFor(null, { connectionId: 'demo' })).toBeNull();
  const read = { sessionSig: 's', openedAt: 1 };
  const reads = new Map([['demo/demo-nuku', new Map([['w1', read]])]]);
  expect(readsOf(reads, { connectionId: 'demo/demo-nuku' }).get('w1')).toBe(read);
  expect(readsOf(reads, { connectionId: 'demo' }).size).toBe(0);
});

describe('machineNotice', () => {
  it('keeps the jump\'s own sentence, which names both computers', () => {
    expect(machineNotice('klaw', "Gimel can't reach klaw right now.", 'connect_failed')).toBe("Gimel can't reach klaw right now.");
  });
  it('puts the machine first on herdr\'s own sentence, which does not name it', () => {
    expect(machineNotice('klaw', "herdr isn't installed here.", 'herdr_not_found')).toBe("klaw: herdr isn't installed here.");
    expect(machineNotice('klaw', 'Connection refused', 'connect_failed')).toBe('klaw: Connection refused');
  });
});
