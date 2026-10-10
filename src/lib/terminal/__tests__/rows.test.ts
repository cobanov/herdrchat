import { decodePane, type Pane } from '../../herdr/models';
import {
  cleanProcessName,
  decodeProcessName,
  isTerminalRow,
  processLabel,
  processNamesDue,
  terminalPanes,
  UNKNOWN_PROCESS,
} from '../rows';

const pane = (overrides: Partial<Pane>): Pane => ({
  paneId: 'w1:p1',
  workspaceId: 'w1',
  tabId: 'w1:t1',
  terminalId: 'term_1',
  agent: null,
  agentStatus: 'unknown',
  cwd: '/home/demo/api',
  foregroundCwd: null,
  focused: false,
  title: null,
  ...overrides,
});

describe('isTerminalRow', () => {
  it('leaves a conversational agent to its chat, and rows everything else', () => {
    expect(isTerminalRow({ agent: 'claude' })).toBe(false);
    expect(isTerminalRow({ agent: 'codex' })).toBe(false);
    expect(isTerminalRow({ agent: 'omp' })).toBe(false);
    expect(isTerminalRow({ agent: null })).toBe(true);
    expect(isTerminalRow({ agent: 'letta' })).toBe(true);
  });
});

describe('terminalPanes', () => {
  it("lists one workspace's non-chat panes in herdr's order, with their programs", () => {
    const panes = [
      pane({ paneId: 'w1:p1', agent: 'claude' }),
      pane({ paneId: 'w1:p2' }),
      pane({ paneId: 'w2:p1', workspaceId: 'w2' }),
      pane({ paneId: 'w1:p3', agent: 'letta' }),
    ];
    const rows = terminalPanes(panes, 'w1', new Map([['w1:p2', 'vim']]));
    expect(rows.map((row) => [row.paneId, row.processName])).toEqual([['w1:p2', 'vim'], ['w1:p3', null]]);
  });
});

describe('processLabel', () => {
  it('names the program, else the agent, else the terminal title, else Shell', () => {
    expect(processLabel({ agent: null, title: null }, '-zsh')).toBe('zsh');
    expect(processLabel({ agent: null, title: null }, '/usr/bin/vim')).toBe('vim');
    expect(processLabel({ agent: 'letta', title: null }, null)).toBe('Letta');
    expect(processLabel({ agent: null, title: ' make watch ' }, null)).toBe('make watch');
    expect(processLabel({ agent: null, title: null }, '  ')).toBe(UNKNOWN_PROCESS);
  });

  it('cleans a login shell and a path', () => {
    expect(cleanProcessName('-zsh')).toBe('zsh');
    expect(cleanProcessName('/opt/homebrew/bin/htop')).toBe('htop');
    expect(cleanProcessName('')).toBeNull();
    expect(cleanProcessName(null)).toBeNull();
  });
});

describe('decodeProcessName', () => {
  // As `herdr pane process-info --pane w6:p2` printed it on herdr 0.9.
  const cli = {
    process_info: {
      foreground_process_group_id: 34100,
      foreground_processes: [{ argv: ['-zsh'], argv0: 'zsh', cmdline: '-zsh', cwd: '/x', name: 'zsh', pid: 34100 }],
      pane_id: 'w6:p2',
      shell_pid: 34100,
    },
    type: 'pane_process_info',
  };

  it("reads the first foreground process's name", () => {
    expect(decodeProcessName(cli)).toBe('zsh');
    expect(decodeProcessName(cli.process_info)).toBe('zsh');
  });

  it('falls back to argv0, and to null for anything else', () => {
    expect(decodeProcessName({ foreground_processes: [{ argv0: '-bash' }] })).toBe('bash');
    expect(decodeProcessName({ foreground_processes: [] })).toBeNull();
    expect(decodeProcessName(null)).toBeNull();
    expect(decodeProcessName('zsh')).toBeNull();
  });
});

describe('processNamesDue', () => {
  const rows = terminalPanes([pane({ paneId: 'w1:p2' }), pane({ paneId: 'w1:p3', terminalId: 'term_3' })], 'w1');

  it('asks for a new pane now, and for all of them on a sweep', () => {
    const known = new Map([['w1:p2', { terminalId: 'term_1' }]]);
    expect(processNamesDue(rows, known, false)).toEqual(['w1:p3']);
    expect(processNamesDue(rows, known, true)).toEqual(['w1:p2', 'w1:p3']);
  });

  it('asks again when a recycled pane id holds a new terminal', () => {
    const known = new Map([['w1:p2', { terminalId: 'term_old' }], ['w1:p3', { terminalId: 'term_3' }]]);
    expect(processNamesDue(rows, known, false)).toEqual(['w1:p2']);
  });
});

describe('decodePane', () => {
  it("takes a pane's title without its status glyph", () => {
    expect(decodePane({ pane_id: 'w1:p1', terminal_title: '✳ x', terminal_title_stripped: 'x', title: 'y' }).title).toBe('x');
    expect(decodePane({ pane_id: 'w1:p1', title: 'y' }).title).toBe('y');
    expect(decodePane({ pane_id: 'w1:p1' }).title).toBeNull();
  });
});
