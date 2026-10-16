import { groupChats, paneChats, spaceCardMode } from '../chatGroups';
import type { TerminalPane } from '@/lib/terminal/rows';
import type { AgentInfo, Pane } from '@/lib/herdr/models';
import type { ChatSummary, PaneSummary } from '../useWorkspaces';

const chat = (workspaceId: string, status: ChatSummary['status']): ChatSummary => ({
  workspaceId, title: workspaceId, status, number: 1, agents: [], panes: [], preview: null, sessionSig: null, shellPanes: [], tabs: [], layouts: [], activeTabId: null, tabCount: 0, paneCount: 0, restoreError: null, sessionTitle: null, agentName: null,
});
const chats = [chat('idle-a', 'idle'), chat('busy', 'working'), chat('approval', 'blocked'), chat('idle-b', 'done'), chat('unknown', 'unknown')];
const ids = (rows: ReturnType<typeof groupChats>) => rows.map((row) =>
  row.kind === 'chat' ? row.summary.workspaceId : row.kind === 'pane' ? `pane:${row.pane.paneId}` : row.kind === 'tab' ? `tab:${row.tabId}` : row.id);

const agentIn = (workspaceId: string, paneId: string, agent: string | null, cwd: string): AgentInfo => ({
  agent, agentStatus: 'idle', cwd, foregroundCwd: null, focused: false, paneId, tabId: 't1', terminalId: null,
  workspaceId, agentSession: null, stateChangeSeq: null, completionSeq: null, inputPending: false, name: null, title: null,
});
const paneOf = (agent: AgentInfo): PaneSummary => ({ paneId: agent.paneId, agent, sessionSig: null, preview: null, status: 'idle', sessionTitle: null, agentName: null });
const withAgents = (summary: ChatSummary, agents: AgentInfo[]): ChatSummary => ({
  ...summary, agents, panes: agents.filter((agent) => agent.agent !== null).map(paneOf),
});

it('prioritizes live state, preserves order and includes chats without an agent', () => {
  expect(ids(groupChats(chats, ''))).toEqual(['needs-you', 'approval', 'working', 'busy', 'idle', 'idle-a', 'idle-b', 'unknown']);
  expect(ids(groupChats([chat('busy', 'blocked')], ''))).toEqual(['needs-you', 'busy']);
});

it('keeps every group open, including after clearing a search', () => {
  expect(ids(groupChats(chats, '  IDLE-b '))).toEqual(['idle', 'idle-b']);
  expect(groupChats(chats, 'missing')).toEqual([]);
  expect(groupChats([], '')).toEqual([]);
  expect(groupChats(chats, '').filter(row => row.kind === 'chat')).toHaveLength(chats.length);
});

it('matches a folder or provider without requiring a transcript or session id', () => {
  const workspace = chat('Release', 'idle');
  workspace.agents = [{
    agent: 'codex', agentStatus: 'idle', cwd: '/work/Acme/API', foregroundCwd: null,
    focused: true, paneId: 'p1', tabId: 't1', terminalId: null, workspaceId: 'Release', agentSession: null, stateChangeSeq: null, completionSeq: null, inputPending: false, name: null, title: null,
  }];
  expect(ids(groupChats([workspace], 'acme/api'))).toEqual(['idle', 'Release']);
  expect(ids(groupChats([workspace], 'CODEX'))).toEqual(['idle', 'Release']);
});

it('puts pinned chats first, in pin order, whatever they are doing', () => {
  const pinned = new Map([['idle-b', 20], ['approval', 10]]);
  expect(ids(groupChats(chats, '', pinned))).toEqual([
    'pinned', 'approval', 'idle-b', 'working', 'busy', 'idle', 'idle-a', 'unknown',
  ]);
  expect(ids(groupChats(chats, 'idle-b', pinned))).toEqual(['pinned', 'idle-b']);
});

// Two agents in one workspace used to be one row naming one of them; the
// other was invisible except as unattributed lines in the merged thread.
it('lists each agent under a workspace that holds two or more of them', () => {
  const api = withAgents(chat('api', 'working'), [
    agentIn('api', 'api:p1', 'claude', '/home/demo/api'),
    agentIn('api', 'api:p2', 'claude', '/home/demo/api/web'),
    agentIn('api', 'api:p3', null, '/home/demo/api'),
  ]);
  const solo = withAgents(chat('solo', 'idle'), [agentIn('solo', 'solo:p1', 'claude', '/home/demo/solo')]);
  expect(ids(groupChats([api, solo], ''))).toEqual(['working', 'api', 'pane:api:p1', 'pane:api:p2', 'idle', 'solo']);
  // The group counts chats, not the agents under them.
  expect(groupChats([api, solo], '')[0]).toMatchObject({ kind: 'group', count: 1 });
});

it('finds an agent row by its folder or provider, and every agent by the workspace name', () => {
  const api = withAgents(chat('api', 'idle'), [
    agentIn('api', 'api:p1', 'claude', '/home/demo/api'),
    agentIn('api', 'api:p2', 'codex', '/home/demo/api/web'),
  ]);
  expect(ids(groupChats([api], 'api/web'))).toEqual(['idle', 'api', 'pane:api:p2']);
  expect(ids(groupChats([api], 'CODEX'))).toEqual(['idle', 'api', 'pane:api:p2']);
  expect(ids(groupChats([api], 'api'))).toEqual(['idle', 'api', 'pane:api:p1', 'pane:api:p2']);
  expect(groupChats([api], 'missing')).toEqual([]);
});

// herdr calls Antigravity `agy`; its row says "Antigravity", and the search
// for that word found nothing on a real host.
it('finds an agent by the name its row shows, not only herdr\'s id for it', () => {
  const space = withAgents(chat('wJ', 'idle'), [
    agentIn('wJ', 'wJ:p1', 'agy', '/Users/me/GitHub'),
    agentIn('wJ', 'wJ:p2', 'grok', '/Users/me/GitHub'),
  ]);
  expect(ids(groupChats([space], 'antigravity'))).toEqual(['idle', 'wJ', 'pane:wJ:p1']);
  expect(ids(groupChats([space], 'agy'))).toEqual(['idle', 'wJ', 'pane:wJ:p1']);
});

it('keeps an agent row under its workspace when the workspace is pinned', () => {
  const api = withAgents(chat('api', 'blocked'), [
    agentIn('api', 'api:p1', 'claude', '/a'),
    agentIn('api', 'api:p2', 'omp', '/b'),
  ]);
  expect(ids(groupChats([api], '', new Map([['api', 1]])))).toEqual(['pinned', 'api', 'pane:api:p1', 'pane:api:p2']);
});

// A search that lists only some agents still has to end the rail at the last
// one shown; ending it at the workspace's last agent left it hanging into the
// next row.
it('marks the first and last agent row actually listed', () => {
  const api = withAgents(chat('api', 'idle'), [
    agentIn('api', 'api:p1', 'claude', '/home/demo/api'),
    agentIn('api', 'api:p2', 'codex', '/home/demo/api/web'),
    agentIn('api', 'api:p3', 'claude', '/home/demo/api/docs'),
  ]);
  const ends = (rows: ReturnType<typeof groupChats>) => rows.flatMap((row) =>
    row.kind === 'pane' ? [`${row.pane.paneId}:${row.first ? 'first' : ''}:${row.last ? 'last' : ''}`] : []);
  expect(ends(groupChats([api], ''))).toEqual(['api:p1:first:', 'api:p2::', 'api:p3::last']);
  expect(ends(groupChats([api], 'CLAUDE'))).toEqual(['api:p1:first:', 'api:p3::last']);
  expect(ends(groupChats([api], 'CODEX'))).toEqual(['api:p2:first:last']);
});

// A row is titled by its session, so a search for that title finds it, and
// under a workspace of several agents, only the agent it names.
it('finds a chat, and an agent row, by its session title', () => {
  const titled = (agent: AgentInfo, title: string): AgentInfo => ({ ...agent, title });
  const api = withAgents(chat('api', 'idle'), [
    titled(agentIn('api', 'api:p1', 'claude', '/home/demo/api'), 'API contract'),
    titled(agentIn('api', 'api:p2', 'claude', '/home/demo/api/web'), 'Web build'),
  ]);
  const panes = api.panes.map((pane) => ({ ...pane, sessionTitle: pane.agent.title }));
  const solo = withAgents(chat('solo', 'idle'), [titled(agentIn('solo', 'solo:p1', 'claude', '/home/demo/solo'), 'Parser refactor')]);
  expect(ids(groupChats([{ ...api, panes }, solo], 'web build'))).toEqual(['idle', 'api', 'pane:api:p2']);
  expect(ids(groupChats([{ ...api, panes }, solo], 'PARSER'))).toEqual(['idle', 'solo']);
});

// Every host's workspaces are numbered from w1, so in a list of several a
// workspace id does not name a row: pins and the agents under a row go by the
// row's key, and the host's name finds its chats.
describe('chats on several hosts', () => {
  const onHost = (summary: ChatSummary, label: string | null) => ({
    ...summary, connectionId: label ?? 'demo', host: label === null ? null : { id: label, label },
  });
  const key = (summary: { connectionId: string; workspaceId: string }) => `${summary.connectionId}\n${summary.workspaceId}`;
  const host = onHost(chat('w1', 'idle'), null);
  const nuku = onHost({ ...chat('w1', 'idle'), title: 'kenneth-bot' }, 'nuku');

  it('groups another host\'s chat like any other, and keeps a pin to its own row', () => {
    expect(groupChats([host, nuku], '', new Map(), key).filter((row) => row.kind === 'chat')).toHaveLength(2);
    const pinned = groupChats([host, nuku], '', new Map([[key(nuku), 1]]), key);
    expect(pinned.map((row) => (row.kind === 'chat' ? row.summary.connectionId : row.kind === 'group' ? row.id : ''))).toEqual([
      'pinned', 'nuku', 'idle', 'demo',
    ]);
  });

  it('finds a host\'s chats by its name, with every agent under them', () => {
    const multi = onHost(withAgents({ ...chat('w2', 'idle'), title: 'api' }, [
      agentIn('w2', 'w2:p1', 'claude', '/srv/api'),
      agentIn('w2', 'w2:p2', 'codex', '/srv/web'),
    ]), 'nuku');
    expect(ids(groupChats([host, nuku, multi], 'NUKU', new Map(), key))).toEqual(['idle', 'w1', 'w2', 'pane:w2:p1', 'pane:w2:p2']);
  });

  it('lists the agents under each of two rows that share a workspace id', () => {
    const agents = (prefix: string) => [
      agentIn('w2', `${prefix}:p1`, 'claude', '/srv/api'),
      agentIn('w2', `${prefix}:p2`, 'claude', '/srv/api/web'),
    ];
    const onSelected = onHost(withAgents(chat('w2', 'idle'), agents('host')), null);
    const onNuku = onHost(withAgents(chat('w2', 'idle'), agents('nuku')), 'nuku');
    expect(ids(groupChats([onSelected, onNuku], '', new Map(), key))).toEqual([
      'idle', 'w2', 'pane:host:p1', 'pane:host:p2', 'w2', 'pane:nuku:p1', 'pane:nuku:p2',
    ]);
  });
});

// A workspace's card is one chat only when that is all the workspace holds.
// One agent beside a shell used to be the agent's card with the terminal row
// under it, which read as if the terminal belonged to the agent.
describe('space cards', () => {
  const shell = (paneId: string): TerminalPane => ({
    paneId, processName: null,
    pane: { paneId, workspaceId: 'w', tabId: 't1', terminalId: null, agent: null, agentStatus: 'unknown', cwd: '/a', foregroundCwd: null, focused: false, title: null } satisfies Pane,
  });
  const one = withAgents(chat('solo', 'idle'), [agentIn('solo', 'solo:p1', 'claude', '/a')]);
  const two = withAgents(chat('api', 'idle'), [agentIn('api', 'api:p1', 'claude', '/a'), agentIn('api', 'api:p2', 'codex', '/a/b')]);
  const withShell = { ...withAgents(chat('term', 'idle'), [agentIn('term', 'term:p1', 'claude', '/a')]), shellPanes: [shell('term:p2')] };
  const shellOnly = { ...chat('logs', 'idle'), shellPanes: [shell('logs:p1')] };

  it('is a chat for one agent and nothing else, and a space otherwise', () => {
    expect(spaceCardMode(one)).toBe('chat');
    expect(spaceCardMode(withShell)).toBe('space');
    expect(spaceCardMode(two)).toBe('space');
    expect(spaceCardMode(shellOnly)).toBe('space');
  });

  // Its card says "Couldn't restore" and opens the conversation, as it did
  // before spaces: as a space it opened a layout with nothing in it to tap.
  it('keeps a workspace whose one agent failed to restore as that chat', () => {
    const lost = { ...chat('lost', 'unknown'), restoreError: 'Session file missing.' };
    expect(spaceCardMode(lost)).toBe('chat');
    expect(paneChats(lost)).toEqual([]);
    // Beside a shell it is a space still, and with no error an empty one is too.
    expect(spaceCardMode({ ...lost, shellPanes: [shell('lost:p2')] })).toBe('space');
    expect(spaceCardMode(chat('empty', 'unknown'))).toBe('space');
  });

  it("lists every agent of a space under it, and none under a chat", () => {
    expect(paneChats(one)).toEqual([]);
    expect(paneChats(withShell).map((pane) => pane.paneId)).toEqual(['term:p1']);
    expect(paneChats(two).map((pane) => pane.paneId)).toEqual(['api:p1', 'api:p2']);
    expect(paneChats(shellOnly)).toEqual([]);
    expect(ids(groupChats([withShell, one], ''))).toEqual(['idle', 'term', 'pane:term:p1', 'solo']);
  });

  it("still narrows a space's agent rows by a search", () => {
    expect(ids(groupChats([two], 'codex'))).toEqual(['idle', 'api', 'pane:api:p2']);
  });
});

it('lists the idle chat that finished last first, and the ones with no message after them', () => {
  const at = (workspaceId: string, timestamp: number | null): ChatSummary => ({
    ...chat(workspaceId, 'idle'),
    preview: timestamp === null ? null : { text: 'done', timestamp, fromUser: false },
  });
  const items = groupChats([at('w1', 100), at('w2', null), at('w3', 300), chat('w4', 'done'), at('w5', 200)], '');
  expect(items.filter((item) => item.kind === 'chat').map((item) => item.kind === 'chat' ? item.summary.workspaceId : ''))
    .toEqual(['w3', 'w5', 'w1', 'w2', 'w4']);
});
