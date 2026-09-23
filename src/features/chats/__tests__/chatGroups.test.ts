import { groupChats } from '../chatGroups';
import type { ChatSummary } from '../useWorkspaces';

const chat = (workspaceId: string, status: ChatSummary['status']): ChatSummary => ({
  workspaceId, title: workspaceId, status, number: 1, agents: [], preview: null, sessionSig: null, restoreError: null,
});
const chats = [chat('idle-a', 'idle'), chat('busy', 'working'), chat('approval', 'blocked'), chat('idle-b', 'done'), chat('unknown', 'unknown')];
const ids = (rows: ReturnType<typeof groupChats>) => rows.map((row) => row.kind === 'chat' ? row.summary.workspaceId : row.id);

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
    focused: true, paneId: 'p1', tabId: 't1', terminalId: null, workspaceId: 'Release', agentSession: null, stateChangeSeq: null, completionSeq: null,
  }];
  expect(ids(groupChats([workspace], 'acme/api'))).toEqual(['idle', 'Release']);
  expect(ids(groupChats([workspace], 'CODEX'))).toEqual(['idle', 'Release']);
});
