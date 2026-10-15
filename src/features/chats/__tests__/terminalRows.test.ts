import { HerdrClient } from '@/lib/herdr/client';
import { DemoHost } from '@/lib/demo/host';
import { decodePane, type Pane } from '@/lib/herdr/models';
import { HerdrError } from '@/lib/herdr/protocol';
import type { BatchAnswer } from '@/lib/herdr/socket';
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
  it("puts the Demo's shell panes under w6 and w7, and nowhere else", async () => {
    const snapshot = await new HerdrClient(new DemoHost()).snapshot();
    const summaries = buildSummaries(snapshot.workspaces ?? [], snapshot.agents, new Map(), [], snapshot.panes);
    expect(summaries.map((summary) => [summary.workspaceId, summary.shellPanes.map((row) => row.paneId)])).toEqual([
      ['w1', []], ['w2', []], ['w3', []], ['w4', []], ['w5', []], ['w6', ['w6:p3', 'w6:p4']], ['w7', ['w7:p2']], ['w8', []], ['w9', []],
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
  /** How many batches were asked: each is one SSH exec. */
  let batches = 0;
  beforeEach(() => {
    batches = 0;
  });
  /** A batch ask answering each pane as `ask` would, one failure not the others'. */
  const each = (ask: (paneId: string) => Promise<unknown>) => async (paneIds: readonly string[]): Promise<BatchAnswer[]> => {
    batches += 1;
    const answers: BatchAnswer[] = [];
    for (const paneId of paneIds) {
      try {
        answers.push({ ok: true, result: await ask(paneId) });
      } catch (thrown) {
        answers.push({ ok: false, error: thrown as HerdrError });
      }
    }
    return answers;
  };
  const unreachable = async (): Promise<BatchAnswer[]> => { throw new HerdrError('socket_unavailable', 'none'); };

  it('asks every due pane in one batch, and none when none is due', async () => {
    const cache = new Map<string, CachedProcessName>();
    const panes = [pane('w1:p2'), pane('w1:p3'), pane('w1:p4'), pane('w1:p5'), pane('w1:p6'), pane('w1:p7')];
    const ask = each(async () => reply('zsh'));
    await refreshProcessNames(ask, panes, cache, false);
    expect(batches).toBe(1);
    await refreshProcessNames(ask, panes, cache, false);
    expect(batches).toBe(1);
    await refreshProcessNames(ask, panes, cache, true);
    expect(batches).toBe(2);
  });

  it('names the panes that answered when one in the middle fails', async () => {
    const cache = new Map<string, CachedProcessName>([['w1:p3', { terminalId: 'term_w1:p3', name: 'htop' }]]);
    const panes = [pane('w1:p2'), pane('w1:p3'), pane('w1:p4')];
    await refreshProcessNames(async () => [
      { ok: true, result: reply('vim') },
      { ok: false, error: new HerdrError('pane_not_found', 'gone') },
      { ok: true, result: reply('-zsh') },
    ], panes, cache, true);
    expect([...cache]).toEqual([
      ['w1:p3', { terminalId: 'term_w1:p3', name: 'htop' }],
      ['w1:p2', { terminalId: 'term_w1:p2', name: 'vim' }],
      ['w1:p4', { terminalId: 'term_w1:p4', name: 'zsh' }],
    ]);
  });

  it('records a pane left out of a short answer as unanswered', async () => {
    const cache = new Map<string, CachedProcessName>();
    await refreshProcessNames(async () => [{ ok: true, result: reply('vim') }], [pane('w1:p2'), pane('w1:p3')], cache, false);
    expect(cache.get('w1:p2')?.name).toBe('vim');
    expect(cache.get('w1:p3')).toEqual({ terminalId: 'term_w1:p3', name: null });
  });

  it('asks for new panes, keeps the answers, and asks everyone on a sweep', async () => {
    const asked: string[] = [];
    const cache = new Map<string, CachedProcessName>();
    const panes = [pane('w1:p1', { agent: 'claude' }), pane('w1:p2'), pane('w1:p3')];
    const ask = async (paneId: string) => {
      asked.push(paneId);
      return reply(paneId === 'w1:p2' ? 'vim' : '-zsh');
    };
    await refreshProcessNames(each(ask), panes, cache, false);
    // Never the chat's pane: it has no terminal row.
    expect(asked).toEqual(['w1:p2', 'w1:p3']);
    expect([...cache]).toEqual([
      ['w1:p2', { terminalId: 'term_w1:p2', name: 'vim' }],
      ['w1:p3', { terminalId: 'term_w1:p3', name: 'zsh' }],
    ]);
    asked.length = 0;
    await refreshProcessNames(each(ask), panes, cache, false);
    expect(asked).toEqual([]);
    await refreshProcessNames(each(ask), panes, cache, true);
    expect(asked).toEqual(['w1:p2', 'w1:p3']);
  });

  it('forgets a pane that left, or whose id now holds another terminal', async () => {
    const cache = new Map<string, CachedProcessName>([
      ['w1:p2', { terminalId: 'term_old', name: 'vim' }],
      ['w1:p9', { terminalId: 'term_w1:p9', name: 'htop' }],
    ]);
    await refreshProcessNames(unreachable, [pane('w1:p2')], cache, false);
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
    await refreshProcessNames(each(ask), panes, cache, false);
    expect(asked).toEqual(['w1:p2', 'w1:p3']);
    asked.length = 0;
    await refreshProcessNames(each(ask), panes, cache, false);
    await refreshProcessNames(each(ask), panes, cache, false);
    expect(asked).toEqual([]);
    await refreshProcessNames(each(ask), panes, cache, true);
    expect(asked).toEqual(['w1:p2', 'w1:p3']);
  });

  it('keeps what it knew when the host cannot answer', async () => {
    const cache = new Map<string, CachedProcessName>([['w1:p2', { terminalId: 'term_w1:p2', name: 'vim' }]]);
    await refreshProcessNames(unreachable, [pane('w1:p2')], cache, true);
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
  // The Demo: w6 has two agents and the shell panes w6:p3 and w6:p4; w7 one
  // agent and the shell w7:p2, so its agent is a row under its card too.
  const listed = async () => {
    const snapshot = await new HerdrClient(new DemoHost()).snapshot();
    return listChats(buildSummaries(snapshot.workspaces ?? [], snapshot.agents, new Map(), [], snapshot.panes), 'demo', null);
  };

  it("hangs a workspace's shell pane under its card in Spaces", async () => {
    const rows = chatListRows('spaces', await listed(), '', new Map(), true);
    const w6 = rows.flatMap((row) => (row.kind === 'chat' || row.kind === 'group' ? [] : [`${row.kind}:${row.kind === 'pane' ? row.pane.paneId : row.kind === 'tab' ? `${row.tabId}:${row.label ?? ''}` : row.terminal.paneId}`]));
    // Without the snapshot's `tabs` (not passed here), w6's dev server is
    // still set apart by its tab id's number, under a line with no label.
    expect(w6).toEqual(['pane:w6:p1', 'pane:w6:p2', 'terminal:w6:p3', 'tab:w6:t2:', 'terminal:w6:p4', 'pane:w7:p1', 'terminal:w7:p2']);
  });

  // Android has no terminal: a row would only open the screen saying so.
  // Without the shells, w6's agents share one tab and nothing divides them.
  it('lists no terminal rows where no terminal can open', async () => {
    const rows = chatListRows('spaces', await listed(), '', new Map(), false);
    expect(rows.some((row) => row.kind === 'terminal')).toBe(false);
    expect(rows.some((row) => row.kind === 'tab')).toBe(false);
    expect(rows.some((row) => row.kind === 'pane' && row.pane.paneId === 'w6:p2')).toBe(true);
  });

  // An agent row carries no shells, and the view of agents lists none.
  it('lists no terminal rows in Agents', async () => {
    const rows = chatListRows('agents', await listed(), '', new Map(), true);
    expect(rows.some((row) => row.kind === 'terminal')).toBe(false);
    expect(rows.some((row) => row.kind === 'chat' && row.summary.workspaceId === 'w6')).toBe(true);
  });
});
