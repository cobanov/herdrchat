import { groupChats } from '../chatGroups';
import type { AgentInfo } from '@/lib/herdr/models';
import type { ChatSummary, PaneSummary } from '../useWorkspaces';

const chat = (workspaceId: string, status: ChatSummary['status']): ChatSummary => ({
  workspaceId, title: workspaceId, status, number: 1, agents: [], panes: [], preview: null, sessionSig: null, restoreError: null,
});
const chats = [chat('idle-a', 'idle'), chat('busy', 'working'), chat('approval', 'blocked'), chat('idle-b', 'done'), chat('unknown', 'unknown')];
const ids = (rows: ReturnType<typeof groupChats>) => rows.map((row) =>
  row.kind === 'chat' ? row.summary.workspaceId : row.kind === 'pane' ? `pane:${row.pane.paneId}` : row.id);

const agentIn = (workspaceId: string, paneId: string, agent: string | null, cwd: string): AgentInfo => ({
  agent, agentStatus: 'idle', cwd, foregroundCwd: null, focused: false, paneId, tabId: 't1', terminalId: null,
  workspaceId, agentSession: null, stateChangeSeq: null, completionSeq: null, inputPending: false,
});
const paneOf = (agent: AgentInfo): PaneSummary => ({ paneId: agent.paneId, agent, sessionSig: null, preview: null, status: 'idle' });
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
    focused: true, paneId: 'p1', tabId: 't1', terminalId: null, workspaceId: 'Release', agentSession: null, stateChangeSeq: null, completionSeq: null, inputPending: false,
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
