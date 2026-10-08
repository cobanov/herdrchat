import { isChatUnread, isPaneUnread } from '../chatUnread';
import type { AgentInfo } from '@/lib/herdr/models';
import type { ThreadRead } from '@/lib/unread';
import type { ChatSummary, PaneSummary } from '../useWorkspaces';

const agentIn = (paneId: string): AgentInfo => ({
  agent: 'claude', agentStatus: 'idle', cwd: '/home/demo/api', foregroundCwd: null, focused: false, paneId, tabId: 't1',
  terminalId: null, workspaceId: 'w6', agentSession: null, stateChangeSeq: null, completionSeq: null, inputPending: false,
});
const pane = (paneId: string, sessionSig: string, timestamp: number): PaneSummary => ({
  paneId, agent: agentIn(paneId), sessionSig, status: 'idle', preview: { text: 'done', timestamp, fromUser: false },
});
const workspace = (panes: PaneSummary[]): ChatSummary => ({
  workspaceId: 'w6', title: 'api', number: 6, status: 'idle', agents: panes.map((item) => item.agent), panes,
  preview: panes[0]?.preview ?? null, sessionSig: 'group', restoreError: null,
});
const read = (sessionSig: string, openedAt: number): ThreadRead => ({ sessionSig, openedAt });

const p1 = pane('w6:p1', 'one', 100);
const p2 = pane('w6:p2', 'two', 200);
const api = workspace([p1, p2]);

it('reads each agent by its own chat key', () => {
  const reads = new Map([['w6/w6:p1', read('one', 150)]]);
  expect(isPaneUnread(api, p1, reads)).toBe(false);
  expect(isPaneUnread(api, p2, reads)).toBe(true);
  // Unread while any of its agents is.
  expect(isChatUnread(api, reads)).toBe(true);
  expect(isChatUnread(api, new Map([...reads, ['w6/w6:p2', read('two', 250)]]))).toBe(false);
});

// herdr recycles pane ids: a marker for the conversation that used to be in
// this pane says nothing about the one there now.
it('treats a new session in a recycled pane as unread', () => {
  const reads = new Map([['w6/w6:p2', read('two', 250)]]);
  expect(isPaneUnread(api, p2, reads)).toBe(false);
  const recycled = pane('w6:p2', 'three', 200);
  expect(isPaneUnread(workspace([p1, recycled]), recycled, reads)).toBe(true);
});

// The merged thread shows every agent's lines; reading it reads them all.
it('counts the workspace thread as reading every agent in it', () => {
  const reads = new Map([['w6', read('group', 300)]]);
  expect(isChatUnread(api, reads)).toBe(false);
  // Only while it was the same set of conversations.
  expect(isChatUnread({ ...api, sessionSig: 'regrouped' }, reads)).toBe(true);
});

it('never marks the chat that is open beside the list', () => {
  const none = new Map<string, ThreadRead>();
  expect(isPaneUnread(api, p2, none, 'w6/w6:p2')).toBe(false);
  expect(isChatUnread(api, none, 'w6/w6:p2')).toBe(true);
  expect(isChatUnread(api, none, 'w6')).toBe(false);
  expect(isPaneUnread(api, p1, none, 'w6')).toBe(false);
});

it('leaves a one-agent workspace exactly as it was', () => {
  const solo: ChatSummary = { ...workspace([p1]), sessionSig: 'one' };
  expect(isChatUnread(solo, new Map())).toBe(true);
  expect(isChatUnread(solo, new Map([['w6', read('one', 150)]]))).toBe(false);
  // Its pane's own key is not what it reads.
  expect(isChatUnread(solo, new Map([['w6/w6:p1', read('one', 150)]]))).toBe(true);
});
