import type { AgentInfo } from '@/lib/herdr/models';
import type { ThreadRead } from '@/lib/unread';
import { agentPrefRow, agentRowKey, agentRows, agentTestKey, isAgentUnread, type AgentRow } from '../agentRows';
import { groupChats } from '../chatGroups';
import { listChats, rowKey } from '../listedChat';
import { agentContext, rowTitle } from '../rowText';
import type { ChatSummary, PaneSummary } from '../useWorkspaces';

const agentIn = (workspaceId: string, paneId: string, agent: string | null, cwd: string, title: string | null = null): AgentInfo => ({
  agent, agentStatus: 'idle', cwd, foregroundCwd: null, focused: false, paneId, tabId: 't1', terminalId: null,
  workspaceId, agentSession: null, stateChangeSeq: null, completionSeq: null, inputPending: false, name: null, title,
});
const preview = (text: string, timestamp: number) => ({ text, timestamp, fromUser: false });
/** A workspace as `buildSummaries` makes one: titled by its one agent, panes for its conversational ones. */
const workspace = (
  workspaceId: string, label: string, status: ChatSummary['status'], agents: AgentInfo[],
  panes: Partial<Record<string, Partial<PaneSummary>>> = {}
): ChatSummary => {
  const conversational = agents.filter((agent) => agent.agent !== null);
  const titled = conversational.length === 1 ? conversational[0] : undefined;
  return {
    workspaceId, title: label, number: 1, status, agents,
    panes: conversational.map((agent): PaneSummary => ({
      paneId: agent.paneId, agent, sessionSig: `sig-${agent.paneId}`, preview: null, status: 'idle',
      sessionTitle: agent.title, agentName: agent.name, ...panes[agent.paneId],
    })),
    preview: null, sessionSig: conversational.map((agent) => `sig-${agent.paneId}`).join(',') || null, shellPanes: [], restoreError: null,
    sessionTitle: titled?.title ?? null, agentName: titled?.name ?? null,
  };
};

// The Demo's shape: w2 one agent, w6 two (one working), w7 a shell only.
const notes = workspace('w2', 'notes', 'idle', [agentIn('w2', 'w2:p1', 'claude', '/home/demo/notes', 'Release notes summary')]);
const api = workspace('w6', 'api', 'working', [
  agentIn('w6', 'w6:p1', 'claude', '/home/demo/api', 'Archived projects migration'),
  agentIn('w6', 'w6:p2', 'codex', '/home/demo/api/web', 'Save button wrap'),
  agentIn('w6', 'w6:p3', null, '/home/demo/api'),
], { 'w6:p2': { status: 'working', preview: preview('wrapping', 20) }, 'w6:p1': { preview: preview('migrated', 10) } });
const shell = workspace('w7', 'shell', 'unknown', [agentIn('w7', 'w7:p1', null, '/home/demo')]);
const host = listChats([notes, api, shell], 'gimel', null);
const nuku = listChats(
  [workspace('w1', 'kenneth-bot', 'blocked', [agentIn('w1', 'w1:p1', 'claude', '/home/demo/bot', 'Nightly digest')])],
  'gimel/demo-nuku', { id: 'demo-nuku', label: 'nuku' }
);
const rows = agentRows([...host, ...nuku]);
const byKey = (key: string): AgentRow => {
  const row = rows.find((item) => item.chatKey === key);
  if (row === undefined) throw new Error(`no row ${key}`);
  return row;
};

describe('agentRows', () => {
  it('lists one row per conversational agent, in the host\'s order, and leaves a shell-only workspace out', () => {
    expect(rows.map((row) => row.chatKey)).toEqual(['w2', 'w6/w6:p1', 'w6/w6:p2', 'w1']);
  });

  // A one-agent workspace is the same chat in both views: the same thread,
  // read marker, pin and testID.
  it('keeps a one-agent workspace as its workspace chat', () => {
    const row = byKey('w2');
    expect(row.pane).toBeNull();
    expect(row.workspace).toBe(host[0]);
    expect(rowTitle(row)).toBe('Release notes summary');
    expect(agentRowKey(row)).toBe(rowKey(row));
    expect(agentTestKey(row)).toBe('w2');
    expect(row.sessionSig).toBe('sig-w2:p1');
  });

  it('gives each agent of a workspace that runs several its own row, titled by its session', () => {
    const p2 = byKey('w6/w6:p2');
    expect(p2.pane?.paneId).toBe('w6:p2');
    expect(p2.workspaceId).toBe('w6');
    expect(rowTitle(p2)).toBe('Save button wrap');
    expect(rowTitle(byKey('w6/w6:p1'))).toBe('Archived projects migration');
    expect(agentTestKey(p2)).toBe('w6:p2');
    expect(agentRowKey(p2)).toBe('gimel\nw6/w6:p2');
  });

  // The workspace rolls both agents up; each agent's row is that agent alone.
  it('carries the agent\'s own status, preview and session, not the workspace\'s', () => {
    const p1 = byKey('w6/w6:p1');
    const p2 = byKey('w6/w6:p2');
    expect([p1.status, p2.status]).toEqual(['idle', 'working']);
    expect([p1.preview?.text, p2.preview?.text]).toEqual(['migrated', 'wrapping']);
    expect([p1.sessionSig, p2.sessionSig]).toEqual(['sig-w6:p1', 'sig-w6:p2']);
    expect(p2.agents.map((agent) => agent.paneId)).toEqual(['w6:p2']);
  });

  it('keeps a machine\'s row on its connection, with its machine', () => {
    const bot = byKey('w1');
    expect(bot.connectionId).toBe('gimel/demo-nuku');
    expect(bot.machine).toEqual({ id: 'demo-nuku', label: 'nuku' });
    expect(agentTestKey(bot)).toBe('demo-nuku-w1');
    expect(agentRowKey(bot)).toBe('gimel/demo-nuku\nw1');
  });

  // herdr restarted and w3's agent did not come back: no pane, but the
  // conversation the person most needs to hear about.
  it('keeps a workspace whose agent failed to restore, as one row', () => {
    const lost = { ...workspace('w3', 'lost', 'unknown', [agentIn('w3', 'w3:p1', null, '/home/demo')]), restoreError: 'Session file missing.' };
    const listed = agentRows(listChats([lost, shell], 'gimel', null));
    expect(listed.map((row) => [row.chatKey, row.pane, row.restoreError])).toEqual([['w3', null, 'Session file missing.']]);
  });

  // The one rule both views read pins and mutes by, so they agree.
  it('pins and mutes an agent of several as its own chat, then its lone-agent pref, then its card', () => {
    const p2 = byKey('w6/w6:p2');
    expect(agentPrefRow(host[1]!, host[1]!.panes[1]!)).toEqual({
      connectionId: 'gimel', workspaceId: 'w6', sessionSig: 'sig-w6:p2', chatKey: 'w6/w6:p2',
      inherits: [{ key: 'w6', sessionSig: 'sig-w6:p2' }, { key: 'w6', sessionSig: 'sig-w6:p1,sig-w6:p2' }],
    });
    expect(p2.inherits).toEqual(agentPrefRow(host[1]!, host[1]!.panes[1]!).inherits);
    expect(byKey('w2').inherits).toEqual([]);
  });

  it('is empty for an empty list', () => {
    expect(agentRows([])).toEqual([]);
  });
});

describe('agentRows through groupChats', () => {
  const ids = (items: ReturnType<typeof groupChats<AgentRow>>) =>
    items.map((item) => (item.kind === 'group' ? item.id : item.kind === 'chat' ? item.summary.chatKey : `pane:${item.pane.paneId}`));

  it('groups each agent by its own state, with no pane rows under any of them', () => {
    expect(ids(groupChats(rows, '', new Map(), agentRowKey))).toEqual([
      'needs-you', 'w1', 'working', 'w6/w6:p2', 'idle', 'w2', 'w6/w6:p1',
    ]);
  });

  it('puts a pinned agent in Pinned, by its own key, leaving its sibling where it was', () => {
    const pinned = new Map([['gimel\nw6/w6:p1', 1]]);
    expect(ids(groupChats(rows, '', pinned, agentRowKey))).toEqual([
      'pinned', 'w6/w6:p1', 'needs-you', 'w1', 'working', 'w6/w6:p2', 'idle', 'w2',
    ]);
  });

  it('finds an agent by its own folder or provider, and every agent by its workspace or machine', () => {
    expect(ids(groupChats(rows, 'api/web', new Map(), agentRowKey))).toEqual(['working', 'w6/w6:p2']);
    expect(ids(groupChats(rows, 'codex', new Map(), agentRowKey))).toEqual(['working', 'w6/w6:p2']);
    expect(ids(groupChats(rows, 'api', new Map(), agentRowKey))).toEqual(['working', 'w6/w6:p2', 'idle', 'w6/w6:p1']);
    expect(ids(groupChats(rows, 'nuku', new Map(), agentRowKey))).toEqual(['needs-you', 'w1']);
  });
});

describe('agentContext', () => {
  it('leads with the workspace, then the provider and the agent\'s own folder', () => {
    expect(agentContext({ ...byKey('w6/w6:p2'), title: 'server' })).toBe('server · Codex · api/web');
  });

  // `api · Codex · api/web` said "api" twice on one phone-width line.
  it('leaves off a workspace named after either folder shown', () => {
    expect(agentContext(byKey('w6/w6:p2'))).toBe('Codex · api/web');
  });

  it('says a workspace named after its folder once, in the folder', () => {
    expect(agentContext(byKey('w6/w6:p1'))).toBe('Claude · demo/api');
    expect(agentContext(byKey('w2'))).toBe('Claude · demo/notes');
  });

  it('puts the machine before the workspace', () => {
    expect(agentContext(byKey('w1'))).toBe('nuku · kenneth-bot · Claude · demo/bot');
  });

  // An untitled agent's row is titled by the workspace, so its line does not repeat it.
  it('leaves the workspace off a row it already titles', () => {
    const [untitled] = agentRows(listChats([workspace('w9', 'site', 'idle', [
      agentIn('w9', 'w9:p1', 'claude', '/srv/x/docs'), agentIn('w9', 'w9:p2', 'claude', '/srv/x/api', 'API'),
    ])], 'gimel', null)) as [AgentRow];
    expect(rowTitle(untitled)).toBe('site');
    expect(agentContext(untitled)).toBe('1 of 2 · Claude · x/docs');
  });

  // Two agents just started in one folder, neither titled yet: the rows
  // read "api" over "Claude · x/api" twice.
  it('tells untitled agents of one workspace apart', () => {
    const twins = agentRows(listChats([workspace('w9', 'api', 'idle', [
      agentIn('w9', 'w9:p1', 'claude', '/srv/x/api'), agentIn('w9', 'w9:p2', 'claude', '/srv/x/api'),
    ])], 'gimel', null));
    expect(twins.map(rowTitle)).toEqual(['api', 'api']);
    expect(twins.map((row) => agentContext(row))).toEqual(['1 of 2 · Claude · x/api', '2 of 2 · Claude · x/api']);
    // A titled agent needs no number.
    expect(byKey('w6/w6:p1').ordinal).toBeNull();
    expect(byKey('w2').ordinal).toBeNull();
  });
});

describe('isAgentUnread', () => {
  const read = (sessionSig: string, openedAt: number): ThreadRead => ({ sessionSig, openedAt });

  it('reads an agent of several by its own thread or the workspace\'s', () => {
    const p1 = byKey('w6/w6:p1');
    expect(isAgentUnread(p1, new Map())).toBe(true);
    expect(isAgentUnread(p1, new Map([['w6/w6:p1', read('sig-w6:p1', 11)]]))).toBe(false);
    expect(isAgentUnread(p1, new Map([['w6', read('sig-w6:p1,sig-w6:p2', 11)]]))).toBe(false);
    // Open beside the list (iPad): being read right now.
    expect(isAgentUnread(p1, new Map(), 'w6/w6:p1')).toBe(false);
  });

  it('reads a one-agent workspace as its workspace row does', () => {
    const [solo] = agentRows(listChats([{ ...notes, preview: preview('done', 30) }], 'gimel', null)) as [AgentRow];
    expect(isAgentUnread(solo, new Map())).toBe(true);
    expect(isAgentUnread(solo, new Map([['w2', read('sig-w2:p1', 31)]]))).toBe(false);
    expect(isAgentUnread(solo, new Map(), 'w2')).toBe(false);
  });
});
