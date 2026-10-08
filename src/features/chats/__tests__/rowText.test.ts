import { rowContext, sharedFolder, statusLabel } from '../rowText';
import type { AgentInfo } from '@/lib/herdr/models';
import type { ChatSummary, PaneSummary } from '../useWorkspaces';

const agentIn = (paneId: string, agent: string | null, cwd: string, focused = false): AgentInfo => ({
  agent, agentStatus: 'idle', cwd, foregroundCwd: null, focused, paneId, tabId: 't1', terminalId: null,
  workspaceId: 'w6', agentSession: null, stateChangeSeq: null, completionSeq: null, inputPending: false,
});
const workspace = (agents: AgentInfo[]): ChatSummary => ({
  workspaceId: 'w6', title: 'api', number: 6, status: 'idle', agents,
  panes: agents.filter((agent) => agent.agent !== null).map((agent): PaneSummary => ({
    paneId: agent.paneId, agent, sessionSig: null, preview: null, status: 'idle',
  })),
  preview: null, sessionSig: null, restoreError: null,
});

describe('sharedFolder', () => {
  it('finds the deepest folder every path is in', () => {
    expect(sharedFolder(['/home/demo/api', '/home/demo/api/web'])).toBe('home/demo/api');
    expect(sharedFolder(['/home/demo/api/web', '/home/demo/api/docs'])).toBe('home/demo/api');
  });
  it('is the folder itself when every path is the same', () => {
    expect(sharedFolder(['/a/b', '/a/b', '/a/b'])).toBe('a/b');
  });
  // A shared prefix of a name is not a shared folder.
  it('compares whole folder names, not characters', () => {
    expect(sharedFolder(['/home/demo/api', '/home/demo/apiv2'])).toBe('home/demo');
  });
  it('is empty when the paths share only the root, or there are none', () => {
    expect(sharedFolder(['/srv/api', '/home/demo'])).toBe('');
    expect(sharedFolder(['/', '/a'])).toBe('');
    expect(sharedFolder([])).toBe('');
  });
});

describe('rowContext', () => {
  it('names the one agent and its folder, as before', () => {
    expect(rowContext(workspace([agentIn('w6:p1', 'claude', '/home/demo/api')]))).toBe('Claude · demo/api');
    expect(rowContext(workspace([agentIn('w6:p1', null, '/home/demo')]))).toBe('Terminal');
  });
  it('names several agents together, with the folder they share', () => {
    expect(rowContext(workspace([
      agentIn('w6:p1', 'claude', '/home/demo/api'),
      agentIn('w6:p2', 'claude', '/home/demo/api/web'),
    ]))).toBe('2 agents · Claude · demo/api');
  });
  // With nothing in common there is no folder to name, not an empty slot.
  it('leaves out the folder when the agents share none', () => {
    expect(rowContext(workspace([
      agentIn('w6:p1', 'claude', '/srv/api'),
      agentIn('w6:p2', 'codex', '/home/web'),
    ]))).toBe('2 agents · Claude, Codex');
  });
});

it('says what an agent is doing when it has no line to show', () => {
  expect(statusLabel('blocked')).toBe('Waiting for you');
  expect(statusLabel('working')).toBe('Working');
  expect(statusLabel('idle')).toBe('Idle');
});
