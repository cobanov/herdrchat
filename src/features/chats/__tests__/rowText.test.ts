import { paneContext, paneTitle, rowContext, rowTitle, sharedFolder, statusLabel } from '../rowText';
import type { AgentInfo } from '@/lib/herdr/models';
import type { ChatSummary, PaneSummary } from '../useWorkspaces';

const agentIn = (paneId: string, agent: string | null, cwd: string, focused = false): AgentInfo => ({
  agent, agentStatus: 'idle', cwd, foregroundCwd: null, focused, paneId, tabId: 't1', terminalId: null,
  workspaceId: 'w6', agentSession: null, stateChangeSeq: null, completionSeq: null, inputPending: false, name: null, title: null,
});
const workspace = (agents: AgentInfo[]): ChatSummary => {
  const conversational = agents.filter((agent) => agent.agent !== null);
  // As `buildSummaries` sets them: from the one conversational agent only.
  const titled = conversational.length === 1 ? conversational[0] : undefined;
  return {
    workspaceId: 'w6', title: 'api', number: 6, status: 'idle', agents,
    panes: conversational.map((agent): PaneSummary => ({
      paneId: agent.paneId, agent, sessionSig: null, preview: null, status: 'idle', sessionTitle: agent.title, agentName: agent.name,
    })),
    preview: null, sessionSig: null, restoreError: null,
    sessionTitle: titled?.title ?? null, agentName: titled?.name ?? null,
  };
};

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

// A chat is titled by its session; the workspace's label moves to the line
// under it, ahead of the agent and the folder.
describe('titles', () => {
  const titled = (paneId: string, cwd: string, title: string | null, name: string | null = null): AgentInfo =>
    ({ ...agentIn(paneId, 'claude', cwd), title, name });

  it('titles a one-agent chat by its session, and names the workspace in its line', () => {
    const chat = workspace([titled('w6:p1', '/home/demo/server', 'API contract')]);
    expect(rowTitle(chat)).toBe('API contract');
    expect(rowContext(chat)).toBe('api · Claude · demo/server');
  });
  it('titles it by the agent\'s herdr name before the session has a title', () => {
    const chat = workspace([titled('w6:p1', '/home/demo/server', null, 'api-pm')]);
    expect(rowTitle(chat)).toBe('api-pm');
    expect(rowContext(chat)).toBe('api · Claude · demo/server');
  });
  // herdr names a workspace after its folder. Said in front as well, the
  // label pushed the folder off a phone's one-line caption:
  // 'klaw-dashboard · Claude · azure/k…'.
  it('leaves the label to the folder when the folder is named the same', () => {
    const chat = { ...workspace([titled('w6:p1', '/Users/kenneth/Dropbox/dev/azure/klaw-dashboard', 'Dashboard login flow')]), title: 'Klaw-Dashboard' };
    expect(rowContext(chat)).toBe('Claude · azure/klaw-dashboard');
    expect(rowContext(workspace([titled('w6:p1', '/home/demo/api', 'API contract')]))).toBe('Claude · demo/api');
  });
  it('keeps the workspace label as the title, said once, with neither', () => {
    const chat = workspace([titled('w6:p1', '/home/demo/api', '  ')]);
    expect(rowTitle(chat)).toBe('api');
    expect(rowContext(chat)).toBe('Claude · demo/api');
    expect(rowTitle({ ...chat, title: '' })).toBe('w6');
  });
  it('keeps the label on a workspace of several agents, and titles each agent by its own session', () => {
    const chat = workspace([
      titled('w6:p1', '/home/demo/api', 'API contract'),
      titled('w6:p2', '/home/demo/api/web', null),
    ]);
    expect(rowTitle(chat)).toBe('api');
    expect(rowContext(chat)).toBe('2 agents · Claude · demo/api');
    expect(chat.panes.map((pane) => paneTitle(chat, pane))).toEqual(['API contract', 'api']);
  });
});

it('says what an agent is doing when it has no line to show', () => {
  expect(statusLabel('blocked')).toBe('Waiting for you');
  expect(statusLabel('working')).toBe('Working');
  expect(statusLabel('idle')).toBe('Idle');
});

// The list mixes the host's chats with its machines'; the machine is said
// before anything about the workspace, since the same folder on two
// computers is two chats.
describe('rowContext on a machine', () => {
  const nuku = { id: 'demo-nuku', label: 'nuku' };
  it('leads with the machine, then the workspace rule, the provider and the folder', () => {
    const titled = { ...workspace([{ ...agentIn('w6:p1', 'claude', '/home/demo/bot'), title: 'Nightly digest' }]), title: 'kenneth-bot', machine: nuku };
    expect(rowContext(titled)).toBe('nuku · kenneth-bot · Claude · demo/bot');
    // A workspace named after its folder is still said once, by the folder.
    const sameFolder = { ...workspace([{ ...agentIn('w6:p1', 'claude', '/home/demo/kenneth-bot'), title: 'Nightly digest' }]), title: 'kenneth-bot', machine: nuku };
    expect(rowContext(sameFolder)).toBe('nuku · Claude · demo/kenneth-bot');
  });
  it('leads a workspace of several agents with the machine too', () => {
    expect(rowContext({ ...workspace([
      agentIn('w6:p1', 'claude', '/home/demo/api'),
      agentIn('w6:p2', 'claude', '/home/demo/api/web'),
    ]), machine: nuku })).toBe('nuku · 2 agents · Claude · demo/api');
  });
  it('says nothing extra on the host', () => {
    expect(rowContext({ ...workspace([agentIn('w6:p1', 'claude', '/home/demo/api')]), machine: null })).toBe('Claude · demo/api');
  });
  it('leads an agent row\'s line with its machine', () => {
    const agent = agentIn('w6:p2', 'codex', '/home/demo/api/web');
    const pane: PaneSummary = { paneId: 'w6:p2', agent, sessionSig: null, preview: null, status: 'idle', sessionTitle: null, agentName: null };
    expect(paneContext({ machine: nuku }, pane)).toBe('nuku · Codex · api/web');
    expect(paneContext({ machine: null }, pane)).toBe('Codex · api/web');
  });
});
