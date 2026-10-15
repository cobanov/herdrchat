import type { AgentInfo } from '@/lib/herdr/models';
import { paneTarget } from '../paneTarget';
import type { ChatSummary, PaneSummary } from '../useWorkspaces';

const agent = (paneId: string, title: string): AgentInfo => ({
  agent: 'claude', agentStatus: 'idle', cwd: '/a', foregroundCwd: null, focused: false, paneId, tabId: 't1', terminalId: null,
  workspaceId: 'w6', agentSession: null, stateChangeSeq: null, completionSeq: null, inputPending: false, name: null, title,
});
const pane = (paneId: string, title: string): PaneSummary => ({
  paneId, agent: agent(paneId, title), sessionSig: paneId, preview: null, status: 'idle', sessionTitle: title, agentName: null,
});
const summary = (panes: PaneSummary[]): ChatSummary => ({
  workspaceId: 'w6', title: 'api', number: 6, status: 'idle', agents: panes.map((item) => item.agent), panes, preview: null,
  sessionSig: null, shellPanes: [], tabs: [], layouts: [], activeTabId: null, tabCount: 0, paneCount: 0, restoreError: null,
  sessionTitle: null, agentName: null,
});

// Opened from a row under a space card or from the layout view, an agent of
// several is its own chat; the only agent is the workspace chat, the same one
// its Agents row opens, so the two share a thread, a read and a pin.
it('opens one agent of several as its own chat, and the only one as the workspace chat', () => {
  const p1 = pane('w6:p1', 'Archived projects migration');
  const p2 = pane('w6:p2', 'Save button wrap');
  expect(paneTarget(summary([p1, p2]), p2)).toEqual({ paneId: 'w6:p2', title: 'Save button wrap', key: 'w6/w6:p2' });
  expect(paneTarget(summary([p1]), p1)).toEqual({ paneId: undefined, title: 'Archived projects migration', key: 'w6' });
});
