import { HerdrClient } from '@/lib/herdr/client';
import { DemoHost } from '@/lib/demo/host';
import { decodePane, type Pane } from '@/lib/herdr/models';
import { HerdrError } from '@/lib/herdr/protocol';
import { buildSummaries, refreshProcessNames, type CachedProcessName } from '../useWorkspaces';
import { terminalContext } from '../rowText';
import { chatListRows } from '../chatListRows';
import { listChats } from '../listedChat';

jest.mock('../../usePollGate', () => ({ usePollGate: () => true }));
jest.mock('../../useHostEvents', () => ({ useHostEvents: () => false }));
jest.mock('@/state/settings', () => ({ useSettings: () => 1 }));
jest.mock('@/state/hostTheme', () => ({ checkHostTheme: async () => true }));
jest.mock('@/state/hostMachines', () => ({ refreshHostMachines: async () => true }));
jest.mock('@/state/slashCommands', () => ({ scanSlashCatalogue: async () => undefined }));

const pane = (paneId: string, overrides: Record<string, unknown> = {}): Pane =>
  decodePane({ pane_id: paneId, workspace_id: paneId.split(':')[0], terminal_id: `term_${paneId}`, cwd: '/home/demo/api', ...overrides });

describe('terminal rows in the chat list', () => {
  it("puts the Demo's shell pane under w6, and nowhere else", async () => {
    const snapshot = await new HerdrClient(new DemoHost()).snapshot();
    const summaries = buildSummaries(snapshot.workspaces ?? [], snapshot.agents, new Map(), [], snapshot.panes);
    expect(summaries.map((summary) => [summary.workspaceId, summary.shellPanes.map((row) => row.paneId)])).toEqual([
      ['w1', []], ['w2', []], ['w3', []], ['w4', []], ['w5', []], ['w6', ['w6:p3']],
    ]);
    // The two agents are still two chats of their own, and the shell is not one.
    expect(summaries[5]?.panes.map((row) => row.paneId)).toEqual(['w6:p1', 'w6:p2']);
  });

  it('carries the program herdr reported for each row', () => {
    const summaries = buildSummaries(
      [{ workspaceId: 'w1', label: 'api', number: 1, agentStatus: 'idle', focused: false, activeTabId: null, paneCount: 2, tabCount: 1 }],
      [],
      new Map(),
      [],
      [pane('w1:p1', { agent: 'claude' }), pane('w1:p2')],
      new Map([['w1:p2', 'htop']])
    );
    expect(summaries[0]?.shellPanes).toEqual([{ paneId: 'w1:p2', pane: pane('w1:p2'), processName: 'htop' }]);
  });
});

describe('refreshProcessNames', () => {
  const reply = (name: string) => ({ process_info: { foreground_processes: [{ name }] } });

  it('asks for new panes, keeps the answers, and asks everyone on a sweep', async () => {
    const asked: string[] = [];
    const cache = new Map<string, CachedProcessName>();
    const panes = [pane('w1:p1', { agent: 'claude' }), pane('w1:p2'), pane('w1:p3')];
    const ask = async (paneId: string) => {
      asked.push(paneId);
      return reply(paneId === 'w1:p2' ? 'vim' : '-zsh');
    };
    await refreshProcessNames(ask, panes, cache, false);
    // Never the chat's pane: it has no terminal row.
    expect(asked).toEqual(['w1:p2', 'w1:p3']);
    expect([...cache]).toEqual([
      ['w1:p2', { terminalId: 'term_w1:p2', name: 'vim' }],
      ['w1:p3', { terminalId: 'term_w1:p3', name: 'zsh' }],
    ]);
    asked.length = 0;
    await refreshProcessNames(ask, panes, cache, false);
    expect(asked).toEqual([]);
    await refreshProcessNames(ask, panes, cache, true);
    expect(asked).toEqual(['w1:p2', 'w1:p3']);
  });

  it('forgets a pane that left, or whose id now holds another terminal', async () => {
    const cache = new Map<string, CachedProcessName>([
      ['w1:p2', { terminalId: 'term_old', name: 'vim' }],
      ['w1:p9', { terminalId: 'term_w1:p9', name: 'htop' }],
    ]);
    await refreshProcessNames(async () => { throw new HerdrError('socket_unavailable', 'none'); }, [pane('w1:p2')], cache, false);
    // The old answers are gone; the new terminal is recorded as unanswered.
    expect([...cache]).toEqual([['w1:p2', { terminalId: 'term_w1:p2', name: null }]]);
  });

  it('asks a pane herdr gave no name for again only on a sweep', async () => {
    const asked: string[] = [];
    const cache = new Map<string, CachedProcessName>();
    const panes = [pane('w1:p2'), pane('w1:p3')];
    // An older herdr without `pane.process_info`, and one with nothing in front.
    const ask = async (paneId: string) => {
      asked.push(paneId);
      if (paneId === 'w1:p2') throw new HerdrError('unknown_method', 'unknown method');
      return { process_info: { foreground_processes: [] } };
    };
    await refreshProcessNames(ask, panes, cache, false);
    expect(asked).toEqual(['w1:p2', 'w1:p3']);
    asked.length = 0;
    await refreshProcessNames(ask, panes, cache, false);
    await refreshProcessNames(ask, panes, cache, false);
    expect(asked).toEqual([]);
    await refreshProcessNames(ask, panes, cache, true);
    expect(asked).toEqual(['w1:p2', 'w1:p3']);
  });

  it('keeps what it knew when the host cannot answer', async () => {
    const cache = new Map<string, CachedProcessName>([['w1:p2', { terminalId: 'term_w1:p2', name: 'vim' }]]);
    await refreshProcessNames(async () => { throw new HerdrError('socket_unavailable', 'none'); }, [pane('w1:p2')], cache, true);
    expect(cache.get('w1:p2')?.name).toBe('vim');
  });
});

describe('terminalContext', () => {
  it("names the program and the folder it is working in", () => {
    expect(terminalContext(pane('w1:p2', { foreground_cwd: '/home/demo/api/web' }), 'vim')).toBe('vim · api/web');
    expect(terminalContext(pane('w1:p2'), null)).toBe('Shell · demo/api');
    expect(terminalContext(pane('w1:p2', { agent: 'letta' }), null)).toBe('Letta · demo/api');
    expect(terminalContext(pane('w1:p2', { cwd: '/' }), '-zsh')).toBe('zsh');
  });
});

describe('chatListRows', () => {
  // The Demo: w6 has two agents and the shell pane w6:p3.
  const listed = async () => {
    const snapshot = await new HerdrClient(new DemoHost()).snapshot();
    return listChats(buildSummaries(snapshot.workspaces ?? [], snapshot.agents, new Map(), [], snapshot.panes), 'demo', null);
  };

  it("hangs a workspace's shell pane under its card in Spaces", async () => {
    const rows = chatListRows('spaces', await listed(), '', new Map());
    const w6 = rows.flatMap((row) => (row.kind === 'chat' || row.kind === 'group' ? [] : [`${row.kind}:${row.kind === 'pane' ? row.pane.paneId : row.terminal.paneId}`]));
    expect(w6).toEqual(['pane:w6:p1', 'pane:w6:p2', 'terminal:w6:p3']);
  });

  // Every agent row carries its workspace's `shellPanes`; the view of agents
  // must still list none of them.
  it('lists no terminal rows in Agents', async () => {
    const rows = chatListRows('agents', await listed(), '', new Map());
    expect(rows.some((row) => row.kind === 'terminal')).toBe(false);
    expect(rows.some((row) => row.kind === 'chat' && row.summary.workspaceId === 'w6')).toBe(true);
  });
});
