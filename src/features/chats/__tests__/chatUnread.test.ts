import { chatWantsYou, isChatUnread, isPaneUnread } from '../chatUnread';
import type { AgentInfo } from '@/lib/herdr/models';
import type { ThreadRead } from '@/lib/unread';
import type { ChatSummary, PaneSummary } from '../useWorkspaces';

const agentIn = (paneId: string): AgentInfo => ({
  agent: 'claude', agentStatus: 'idle', cwd: '/home/demo/api', foregroundCwd: null, focused: false, paneId, tabId: 't1',
  terminalId: null, workspaceId: 'w6', agentSession: null, stateChangeSeq: null, completionSeq: null, inputPending: false, name: null, title: null,
});
const pane = (paneId: string, sessionSig: string, timestamp: number): PaneSummary => ({
  paneId, agent: agentIn(paneId), sessionSig, status: 'idle', preview: { text: 'done', timestamp, fromUser: false }, sessionTitle: null, agentName: null,
});
const workspace = (panes: PaneSummary[]): ChatSummary => ({
  workspaceId: 'w6', title: 'api', number: 6, status: 'idle', agents: panes.map((item) => item.agent), panes,
  preview: panes[0]?.preview ?? null, sessionSig: 'group', restoreError: null, sessionTitle: null, agentName: null,
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
  expect(isChatUnread(solo, new Map([['w6', read('one', 50)]]))).toBe(true);
});

// w6 had two agents and only p1's own chat was read. Closing p2 must not
// turn that read into a dot: it is the same conversation.
it("keeps a read made in the agent's own chat once its workspace is back to one agent", () => {
  const solo: ChatSummary = { ...workspace([p1]), sessionSig: 'one' };
  expect(isChatUnread(solo, new Map([['w6/w6:p1', read('one', 150)]]))).toBe(false);
  // Older than the reply, or about another conversation in a recycled pane.
  expect(isChatUnread(solo, new Map([['w6/w6:p1', read('one', 50)]]))).toBe(true);
  expect(isChatUnread(solo, new Map([['w6/w6:p1', read('gone', 150)]]))).toBe(true);
  // And the agent's own chat, still open beside the list, is being read.
  expect(isChatUnread(solo, new Map(), 'w6/w6:p1')).toBe(false);
});

// Reading the merged thread with Claude alone in it, then starting Codex
// beside it, lit Claude's row though its last line had been read.
it("lets the merged thread's read cover an agent after a sibling joins, leaves or restarts", () => {
  const a = pane('w6:p1', 'a', 100);
  const b = pane('w6:p2', 'b', 50);
  const grown: ChatSummary = { ...workspace([a, b]), sessionSig: 'a,b' };
  expect(isPaneUnread(grown, a, new Map([['w6', read('a', 150)]]))).toBe(false);
  // b was not in that thread, so it is still news.
  expect(isPaneUnread(grown, b, new Map([['w6', read('a', 150)]]))).toBe(true);
  // b ran /clear and is now c; a's read of the old pair still holds.
  const c = pane('w6:p2', 'c', 50);
  const restarted: ChatSummary = { ...workspace([a, c]), sessionSig: 'a,c' };
  expect(isPaneUnread(restarted, a, new Map([['w6', read('a,b', 150)]]))).toBe(false);
  expect(isPaneUnread(restarted, c, new Map([['w6', read('a,b', 150)]]))).toBe(true);
  // A new session in a's recycled pane was never in the marker.
  const recycled = pane('w6:p1', 'z', 100);
  expect(isPaneUnread({ ...workspace([recycled, b]), sessionSig: 'b,z' }, recycled, new Map([['w6', read('a,b', 150)]]))).toBe(true);
  // A merged read older than the line is still older.
  expect(isPaneUnread(grown, a, new Map([['w6', read('a', 90)]]))).toBe(true);
});

describe('chatWantsYou', () => {
  const blocked = (item: PaneSummary): PaneSummary => ({ ...item, status: 'blocked', preview: null });
  const quiet = (item: PaneSummary): PaneSummary => ({ ...item, preview: null });

  // On iPad, answering p2's menu beside the list counted p2 on the badge,
  // because the workspace's status rolls p2's blocked state up.
  it('does not count the agent open beside the list, only its siblings', () => {
    const waiting: ChatSummary = { ...workspace([quiet(p1), blocked(p2)]), status: 'blocked' };
    expect(chatWantsYou(waiting, new Map())).toBe(true);
    expect(chatWantsYou(waiting, new Map(), 'w6/w6:p2')).toBe(false);
    expect(chatWantsYou(waiting, new Map(), 'w6/w6:p1')).toBe(true);
    expect(chatWantsYou(waiting, new Map(), 'w6')).toBe(false);
  });

  it('still counts the workspace for an unread sibling of the open agent', () => {
    const unreadSibling: ChatSummary = { ...workspace([p1, blocked(p2)]), status: 'blocked' };
    expect(chatWantsYou(unreadSibling, new Map(), 'w6/w6:p2')).toBe(true);
  });

  it('counts a one-agent workspace by its status, as before', () => {
    const solo: ChatSummary = { ...workspace([blocked(p1)]), status: 'blocked' };
    expect(chatWantsYou(solo, new Map())).toBe(true);
    expect(chatWantsYou(solo, new Map(), 'w6')).toBe(false);
  });
});
