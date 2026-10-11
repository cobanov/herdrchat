import { decodePane, type AgentInfo, type Tab, type TabLayout } from '../herdr/models';
import { paneAccessibilityLabel, spaceLayoutModel, tabAccessibilityLabel, type SpaceLayoutInput } from '../spaces/layout';
import { popoverPlacement } from '../spaces/popover';

const agent = (paneId: string, kind = 'claude'): AgentInfo => ({
  agent: kind, agentStatus: 'idle', cwd: '/srv/api', foregroundCwd: null, focused: false, paneId, tabId: 't1', terminalId: null,
  workspaceId: 'w1', agentSession: null, stateChangeSeq: null, completionSeq: null, inputPending: false, name: null, title: null,
});
const tab = (tabId: string, number: number, label: string): Tab => ({
  tabId, workspaceId: 'w1', number, label, focused: false, paneCount: 0, agentStatus: 'idle',
});
const box = (paneId: string, x: number, y: number, width: number, height: number, focused = false) => ({ paneId, focused, rect: { x, y, width, height } });
const layout = (tabId: string, panes: TabLayout['panes'], extra: Partial<TabLayout> = {}): TabLayout => ({
  workspaceId: 'w1', tabId, focusedPaneId: null, zoomed: false, panes, splits: [], ...extra,
});

const input = (over: Partial<SpaceLayoutInput> = {}): SpaceLayoutInput => ({
  workspaceId: 'w1',
  activeTabId: 'w1:t1',
  tabs: [tab('w1:t2', 2, 'logs'), tab('w1:t1', 1, 'api')],
  layouts: [
    // A left/right split, the shell under the agent on the left. herdr's
    // area starts after its sidebar, here at column 26.
    layout('w1:t1', [box('w1:p1', 26, 0, 80, 32), box('w1:p3', 26, 32, 80, 16), box('w1:p2', 106, 0, 80, 48, true)], { focusedPaneId: 'w1:p2' }),
    layout('w1:t2', [box('w1:p4', 26, 0, 160, 48, true)]),
  ],
  panes: [
    { paneId: 'w1:p1', agent: agent('w1:p1'), status: 'blocked', sessionTitle: 'Archived projects migration', agentName: null },
    { paneId: 'w1:p2', agent: agent('w1:p2', 'codex'), status: 'working', sessionTitle: null, agentName: 'web' },
  ],
  shellPanes: [
    { paneId: 'w1:p3', pane: decodePane({ pane_id: 'w1:p3', workspace_id: 'w1' }), processName: 'vim' },
    { paneId: 'w1:p4', pane: decodePane({ pane_id: 'w1:p4', workspace_id: 'w1', title: 'npm run dev' }), processName: null },
  ],
  ...over,
});

describe('spaceLayoutModel', () => {
  it('lists every tab in number order, titled, the active one marked', () => {
    const tabs = spaceLayoutModel(input());
    expect(tabs.map((item) => [item.tabId, item.title, item.active, item.paneCount])).toEqual([
      ['w1:t1', 'api', true, 3], ['w1:t2', 'logs', false, 1],
    ]);
  });

  it('scales each pane from cells to a unit square over its tab, wherever the area starts', () => {
    const [first] = spaceLayoutModel(input());
    expect(first?.columns).toBe(160);
    expect(first?.rows).toBe(48);
    expect(first?.panes.map((pane) => [pane.paneId, pane.x, pane.y, pane.width, pane.height])).toEqual([
      ['w1:p1', 0, 0, 0.5, 32 / 48],
      ['w1:p3', 0, 32 / 48, 0.5, 16 / 48],
      ['w1:p2', 0.5, 0, 0.5, 1],
    ]);
  });

  it('names an agent by its provider and session, a shell by what runs there', () => {
    const [first, second] = spaceLayoutModel(input());
    expect(first?.panes.map((pane) => [pane.paneId, pane.kind, pane.label, pane.detail, pane.status, pane.focused])).toEqual([
      ['w1:p1', 'agent', 'Claude', 'Archived projects migration', 'blocked', false],
      ['w1:p3', 'shell', 'vim', null, null, false],
      ['w1:p2', 'agent', 'Codex', 'web', 'working', true],
    ]);
    // No program reported: the pane's own title, else "Shell".
    expect(second?.panes[0]).toMatchObject({ kind: 'shell', label: 'npm run dev' });
    const untitled = spaceLayoutModel(input({ shellPanes: [] }));
    expect(untitled[1]?.panes[0]).toMatchObject({ kind: 'shell', label: 'Shell' });
  });

  it('draws a zoomed tab as its zoomed pane alone, full size', () => {
    const zoomed = spaceLayoutModel(input({
      layouts: [layout('w1:t1', [box('w1:p1', 0, 0, 80, 48), box('w1:p2', 80, 0, 80, 48)], { zoomed: true, focusedPaneId: 'w1:p1' })],
    }));
    expect(zoomed[0]).toMatchObject({ zoomed: true, paneCount: 2 });
    expect(zoomed[0]?.panes).toEqual([expect.objectContaining({ paneId: 'w1:p1', zoomed: true, x: 0, y: 0, width: 1, height: 1 })]);
    expect(tabAccessibilityLabel(zoomed[0]!)).toBe('api, active tab, zoomed on one of 2 panes');
  });

  it('falls back to "Tab N", and to the layouts alone when herdr sent no tabs', () => {
    const unlabelled = spaceLayoutModel(input({ tabs: [tab('w1:t1', 1, ''), tab('w1:t2', 2, '  ')] }));
    expect(unlabelled.map((item) => item.title)).toEqual(['Tab 1', 'Tab 2']);
    const noTabs = spaceLayoutModel(input({ tabs: [] }));
    expect(noTabs.map((item) => [item.tabId, item.number, item.title])).toEqual([['w1:t1', 1, 'Tab 1'], ['w1:t2', 2, 'Tab 2']]);
    // A tab herdr sent no geometry for is still listed, with nothing in it.
    const noLayouts = spaceLayoutModel(input({ layouts: [] }));
    expect(noLayouts.map((item) => [item.title, item.panes.length, item.columns])).toEqual([['api', 0, 0], ['logs', 0, 0]]);
    expect(spaceLayoutModel(input({ tabs: [], layouts: [] }))).toEqual([]);
  });

  it('names a box to VoiceOver', () => {
    const [first] = spaceLayoutModel(input());
    expect(first?.panes.map(paneAccessibilityLabel)).toEqual([
      'Claude, Archived projects migration, needs you',
      'Terminal, vim',
      'Codex, web, working, focused',
    ]);
  });
});

describe('popoverPlacement', () => {
  const column = { x: 0, y: 100, width: 320, height: 800 };
  const phone = { x: 0, y: 0, width: 320, height: 900 };
  const want = { width: 300, maxHeight: 500, margin: 16, gap: 4 };

  it('hangs below a button high on the list, its right edge under the button, when the list is the window', () => {
    expect(popoverPlacement({ x: 260, y: 200, width: 44, height: 44 }, column, phone, want)).toEqual({ left: 16, width: 288, top: 248, maxHeight: 500 });
    const wide = { ...column, width: 1000 };
    expect(popoverPlacement({ x: 600, y: 200, width: 44, height: 44 }, wide, { ...phone, width: 1000 }, want)).toMatchObject({ left: 344, width: 300 });
  });

  it('rises above a button low on the list, capped at the room there', () => {
    expect(popoverPlacement({ x: 260, y: 800, width: 44, height: 44 }, column, phone, want)).toEqual({ left: 16, width: 288, bottom: 104, maxHeight: 500 });
    const short = { ...column, height: 300 };
    expect(popoverPlacement({ x: 260, y: 300, width: 44, height: 44 }, short, { ...phone, height: 400 }, want)).toMatchObject({ bottom: 104, maxHeight: 180 });
  });

  // iPad: the card floats beside the sidebar at its full width, level with
  // the button, and leaves the rows under the button uncovered.
  const sidebar = { x: 0, y: 0, width: 320, height: 1000 };
  const ipad = { x: 0, y: 0, width: 1180, height: 1000 };

  it('floats beside the sidebar, its top level with a button high on the list', () => {
    expect(popoverPlacement({ x: 260, y: 200, width: 44, height: 44 }, sidebar, ipad, want)).toEqual({ left: 336, width: 300, top: 200, maxHeight: 500 });
  });

  it('floats beside the sidebar, its bottom level with a button low on the list', () => {
    expect(popoverPlacement({ x: 260, y: 900, width: 44, height: 44 }, sidebar, ipad, want)).toEqual({ left: 336, width: 300, bottom: 56, maxHeight: 500 });
  });

  it('stays inside the column when the window has no room beside it', () => {
    expect(popoverPlacement({ x: 260, y: 200, width: 44, height: 44 }, sidebar, { ...ipad, width: 600 }, want)).toMatchObject({ left: 16, width: 288 });
  });
});
