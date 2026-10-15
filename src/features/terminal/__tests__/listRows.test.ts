import { groupChats } from '@/features/chats/chatGroups';
import type { ChatSummary, PaneSummary } from '@/features/chats/useWorkspaces';
import type { AgentInfo, Pane, Tab } from '@/lib/herdr/models';
import type { TerminalPane } from '@/lib/terminal/rows';
import { terminalRowParams, withTerminalRows } from '../listRows';
import { terminalIdParam } from '../navigation';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

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
  preview: null, sessionSig: 'x', shellPanes, tabs: [], layouts: [], activeTabId: null, tabCount: 0, paneCount: 0, restoreError: null, sessionTitle: null, agentName: null,
});

const shape = (rows: ReturnType<typeof withTerminalRows>) => rows.map((row) =>
  row.kind === 'group' ? row.id
    : row.kind === 'chat' ? row.summary.workspaceId
      : row.kind === 'pane' ? `pane ${row.pane.paneId}${row.first ? ' first' : ''}${row.last ? ' last' : ''}`
        : row.kind === 'tab' ? `tab ${row.tabId}${row.label === null ? '' : ` "${row.label}"`}${row.first ? ' first' : ''}`
        : `terminal ${row.terminal.paneId}${row.first ? ' first' : ''}${row.last ? ' last' : ''}`);

// The rail under a card is one line from the card to the last row: the
// terminals carry it on from the agents, and the agent's row that used to
// end it no longer does.
it("lists a workspace's terminals after its agents, on one rail", () => {
  const rows = withTerminalRows(groupChats([
    chat('w6', [paneSummary('w6:p1'), paneSummary('w6:p2')], [shell('w6:p3'), shell('w6:p4')]),
    chat('w7', [paneSummary('w7:p1')], [shell('w7:p2')]),
    chat('w8', [paneSummary('w8:p1')], []),
  ], ''), true);
  expect(shape(rows)).toEqual([
    'idle',
    'w6', 'pane w6:p1 first', 'pane w6:p2', 'terminal w6:p3', 'terminal w6:p4 last',
    // One agent beside a shell is a space card too: the agent is a row under
    // it, then the terminal, so the terminal does not read as the agent's.
    'w7', 'pane w7:p1 first', 'terminal w7:p2 last',
    'w8',
  ]);
});

it('adds nothing to a workspace with no other panes', () => {
  const rows = groupChats([chat('w6', [paneSummary('w6:p1'), paneSummary('w6:p2')], [])], '');
  expect(withTerminalRows(rows, true)).toEqual(rows);
});

// Android: a terminal row would only open the screen saying there is none.
it('adds no terminal rows where no terminal can open', () => {
  const rows = groupChats([chat('w6', [paneSummary('w6:p1')], [shell('w6:p3')])], '');
  expect(withTerminalRows(rows, false)).toEqual(rows);
});

describe('grouped by tab', () => {
  const inTab = <T extends PaneSummary | TerminalPane>(row: T, tabId: string): T =>
    'agent' in row ? { ...row, agent: { ...row.agent, tabId } } : { ...row, pane: { ...row.pane, tabId } };
  const tab = (tabId: string, number: number, label: string): Tab => ({
    tabId, workspaceId: 'w6', number, label, focused: false, paneCount: 1, agentStatus: 'idle',
  });
  const w6 = (tabs: Tab[]) => chat(
    'w6',
    [inTab(paneSummary('w6:p1'), 'w6:t1'), inTab(paneSummary('w6:p2'), 'w6:t3'), inTab(paneSummary('w6:p5'), 'w6:t1')],
    [inTab(shell('w6:p3'), 'w6:t3'), inTab(shell('w6:p4'), 'w6:t2')],
  );
  const named = [tab('w6:t1', 1, 'agents'), tab('w6:t2', 2, '2'), tab('w6:t3', 3, 'web')];

  // Tabs in number order, each tab's agents then its terminals; a line
  // before every tab but the first, a label only on a named one ("2" is
  // herdr numbering a tab nobody named). The rail is still the card's: the
  // leading label carries it up to the card, so the row under it is not
  // `first` (its rail would overlap the label's, a darker step in dark mode).
  it("lists a workspace's rows tab by tab, the first labelled tab with no line", () => {
    expect(shape(withTerminalRows(groupChats([{ ...w6(named), tabs: named }], ''), true))).toEqual([
      'idle', 'w6',
      'tab w6:t1 "agents" first', 'pane w6:p1', 'pane w6:p5',
      'tab w6:t2', 'terminal w6:p4',
      'tab w6:t3 "web"', 'pane w6:p2', 'terminal w6:p3 last',
    ]);
  });

  // An unnamed first tab has nothing to draw: no line goes above the first tab.
  it('starts an unnamed first tab with no item', () => {
    const tabs = [tab('w6:t1', 1, '1'), tab('w6:t2', 2, 'server'), tab('w6:t3', 3, '')];
    expect(shape(withTerminalRows(groupChats([{ ...w6(tabs), tabs }], ''), true))).toEqual([
      'idle', 'w6', 'pane w6:p1 first', 'pane w6:p5',
      'tab w6:t2 "server"', 'terminal w6:p4',
      'tab w6:t3', 'pane w6:p2', 'terminal w6:p3 last',
    ]);
  });

  // The Demo keeps both of w6's tabs named, so the line-only look (an
  // unnamed tab after the first) is covered here and in TabDivider.test.
  // A herdr that sends no `tabs`: ordered by the number in the tab id, unlabelled.
  it('orders by the tab id without the snapshot\'s tabs', () => {
    expect(shape(withTerminalRows(groupChats([w6([])], ''), true))).toEqual([
      'idle', 'w6', 'pane w6:p1 first', 'pane w6:p5',
      'tab w6:t2', 'terminal w6:p4',
      'tab w6:t3', 'pane w6:p2', 'terminal w6:p3 last',
    ]);
  });

  it('draws nothing for rows all in one tab', () => {
    const one = chat('w6', [inTab(paneSummary('w6:p1'), 'w6:t2'), inTab(paneSummary('w6:p2'), 'w6:t2')], [inTab(shell('w6:p3'), 'w6:t2')]);
    const tabs = [tab('w6:t1', 1, 'empty'), tab('w6:t2', 2, 'all')];
    expect(shape(withTerminalRows(groupChats([{ ...one, tabs }], ''), true))).toEqual([
      'idle', 'w6', 'pane w6:p1 first', 'pane w6:p2', 'terminal w6:p3 last',
    ]);
  });

  // A search that leaves agents of one tab, and the only shell in it too.
  it('draws nothing when a search leaves rows in one tab', () => {
    const searched = chat('w6', [inTab({ ...paneSummary('w6:p1'), agent: { ...agent('w6:p1'), agent: 'codex' } }, 'w6:t1'), inTab(paneSummary('w6:p2'), 'w6:t2')], [inTab(shell('w6:p3'), 'w6:t1')]);
    const tabs = [tab('w6:t1', 1, 'api'), tab('w6:t2', 2, 'web')];
    expect(shape(withTerminalRows(groupChats([{ ...searched, tabs }], 'codex'), true))).toEqual([
      'idle', 'w6', 'pane w6:p1 first', 'terminal w6:p3 last',
    ]);
  });
});

// A shell pane is attached by its own terminal id, so the row must hand it on;
// without one the screen says it needs a newer herdr, never the session view.
it("opens a terminal row's pane by its terminal id", () => {
  const withId: TerminalPane = { ...shell('w6:p3'), pane: { ...shell('w6:p3').pane, terminalId: 'term_w6_p3' } };
  expect(terminalRowParams('srv-1', withId)).toEqual(expect.objectContaining({ connectionId: 'srv-1', paneId: 'w6:p3', kind: 'shell', terminalId: 'term_w6_p3' }));
  expect(terminalRowParams('srv-1', shell('w6:p3')).terminalId).toBe('');
  expect([terminalIdParam('term_w6_p3'), terminalIdParam(''), terminalIdParam(undefined)]).toEqual(['term_w6_p3', null, null]);
});
