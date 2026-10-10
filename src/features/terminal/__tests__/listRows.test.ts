import { groupChats } from '@/features/chats/chatGroups';
import type { ChatSummary, PaneSummary } from '@/features/chats/useWorkspaces';
import type { AgentInfo, Pane } from '@/lib/herdr/models';
import type { TerminalPane } from '@/lib/terminal/rows';
import { withTerminalRows } from '../listRows';

const agent = (paneId: string): AgentInfo => ({
  agent: 'claude', agentStatus: 'idle', cwd: '/home/demo/api', foregroundCwd: null, focused: false, paneId, tabId: 't1', terminalId: null,
  workspaceId: paneId.split(':')[0] ?? '', agentSession: null, stateChangeSeq: null, completionSeq: null, inputPending: false, name: null, title: null,
});
const paneSummary = (paneId: string): PaneSummary => ({ paneId, agent: agent(paneId), sessionSig: paneId, status: 'idle', preview: null, sessionTitle: null, agentName: null });
const shell = (paneId: string): TerminalPane => ({
  paneId,
  pane: { paneId, workspaceId: paneId.split(':')[0] ?? '', tabId: 't1', agent: null, cwd: '/home/demo/api', foregroundCwd: null, focused: false, title: null } as unknown as Pane,
  processName: 'zsh',
});
const chat = (workspaceId: string, panes: PaneSummary[], shellPanes: TerminalPane[]): ChatSummary => ({
  workspaceId, title: workspaceId, number: 1, status: 'idle', agents: panes.map((pane) => pane.agent), panes,
  preview: null, sessionSig: 'x', shellPanes, restoreError: null, sessionTitle: null, agentName: null,
});

const shape = (rows: ReturnType<typeof withTerminalRows>) => rows.map((row) =>
  row.kind === 'group' ? row.id
    : row.kind === 'chat' ? row.summary.workspaceId
      : row.kind === 'pane' ? `pane ${row.pane.paneId}${row.first ? ' first' : ''}${row.last ? ' last' : ''}`
        : `terminal ${row.terminal.paneId}${row.first ? ' first' : ''}${row.last ? ' last' : ''}`);

// The rail under a card is one line from the card to the last row: the
// terminals carry it on from the agents, and the agent's row that used to
// end it no longer does.
it("lists a workspace's terminals after its agents, on one rail", () => {
  const rows = withTerminalRows(groupChats([
    chat('w6', [paneSummary('w6:p1'), paneSummary('w6:p2')], [shell('w6:p3'), shell('w6:p4')]),
    chat('w7', [paneSummary('w7:p1')], [shell('w7:p2')]),
    chat('w8', [paneSummary('w8:p1')], []),
  ], ''));
  expect(shape(rows)).toEqual([
    'idle',
    'w6', 'pane w6:p1 first', 'pane w6:p2', 'terminal w6:p3', 'terminal w6:p4 last',
    // One agent is the card itself, so the terminal is the first row under it.
    'w7', 'terminal w7:p2 first last',
    'w8',
  ]);
});

it('adds nothing to a workspace with no other panes', () => {
  const rows = groupChats([chat('w6', [paneSummary('w6:p1'), paneSummary('w6:p2')], [])], '');
  expect(withTerminalRows(rows)).toEqual(rows);
});
