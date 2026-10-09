import { groupChats } from '../chatGroups';
import type { AgentInfo } from '@/lib/herdr/models';
import type { ChatSummary, PaneSummary } from '../useWorkspaces';

const chat = (workspaceId: string, status: ChatSummary['status']): ChatSummary => ({
  workspaceId, title: workspaceId, status, number: 1, agents: [], panes: [], preview: null, sessionSig: null, restoreError: null, sessionTitle: null, agentName: null,
});
const chats = [chat('idle-a', 'idle'), chat('busy', 'working'), chat('approval', 'blocked'), chat('idle-b', 'done'), chat('unknown', 'unknown')];
const ids = (rows: ReturnType<typeof groupChats>) => rows.map((row) =>
  row.kind === 'chat' ? row.summary.workspaceId : row.kind === 'pane' ? `pane:${row.pane.paneId}` : row.id);

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

// A machine's workspaces are numbered from w1 like the host's, so in one
// host's list a workspace id does not name a row: pins and the agents under a
// row go by the row's key, and the machine's label finds its chats.
describe('chats on a host\'s machines', () => {
  const onMachine = (summary: ChatSummary, label: string | null) => ({
    ...summary, connectionId: label === null ? 'demo' : `demo/${label}`, machine: label === null ? null : { id: label, label },
  });
  const key = (summary: { connectionId: string; workspaceId: string }) => `${summary.connectionId}\n${summary.workspaceId}`;
  const host = onMachine(chat('w1', 'idle'), null);
  const nuku = onMachine({ ...chat('w1', 'idle'), title: 'kenneth-bot' }, 'nuku');

  it('groups a machine\'s chat like any other, and keeps a pin to its own row', () => {
    expect(groupChats([host, nuku], '', new Map(), key).filter((row) => row.kind === 'chat')).toHaveLength(2);
    const pinned = groupChats([host, nuku], '', new Map([[key(nuku), 1]]), key);
    expect(pinned.map((row) => (row.kind === 'chat' ? row.summary.connectionId : row.kind === 'group' ? row.id : ''))).toEqual([
      'pinned', 'demo/nuku', 'idle', 'demo',
    ]);
  });

  it('finds a machine\'s chats by its label, with every agent under them', () => {
    const multi = onMachine(withAgents({ ...chat('w2', 'idle'), title: 'api' }, [
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
    const onHost = onMachine(withAgents(chat('w2', 'idle'), agents('host')), null);
    const onNuku = onMachine(withAgents(chat('w2', 'idle'), agents('nuku')), 'nuku');
    expect(ids(groupChats([onHost, onNuku], '', new Map(), key))).toEqual([
      'idle', 'w2', 'pane:host:p1', 'pane:host:p2', 'w2', 'pane:nuku:p1', 'pane:nuku:p2',
    ]);
  });
});
