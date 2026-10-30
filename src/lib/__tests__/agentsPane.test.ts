import {
  AGENT_ROW,
  drawsAgentsPane,
  hasRunningAgents,
  parseAgentRow,
  parseAgentsPane,
  parseElapsed,
  parseTokenCount,
  rowState,
} from '../transcript/agentsPane';
import { extractLivePreview } from '../transcript/livePreview';

const ESC = '\u001b';

/**
 * The shape of a real screen (Claude Code 2.1.310, read with `herdr pane read
 * --source visible`) while six background agents ran, its task texts and
 * names made up: the reply, the spinner of an agent waiting on them, the
 * composer between its rules, the footer, Claude's update notice, then the
 * agents pane with five rows padded into columns and `↓ 3 more`.
 */
const PANE = [
  '  ⏺ main',
  "  ◯ fork             Verifying the parser's output matches the notes             26m 52s · ↓ 156.7k tokens",
  '  ◯ general-purpose  Removing the old build directory                          1h 13m 1s · ↓ 286.9k tokens',
  '  ◯ general-purpose  Waiting on results.txt · then summarising                    51m 42s · ↓ 135.1k tokens',
  '  ◯ general-purpose  Reading the host guard fixtures                               11m 31s · ↓ 251.1k tokens',
  '  ◯ general-purpose  Fixing an import in the tests                                     45s · ↓ 980 tokens',
  '  ↓ 3 more',
];
const ABOVE = [
  '  Waiting on you: the dashboard step for the custom hostname.',
  '',
  '✻ Waiting for 6 background agents to finish',
  '',
  `${'─'.repeat(100)} project ─`,
  '❯ status update',
  '─'.repeat(110),
  '  ⏵⏵ auto mode on · 9 shells · ← for agents · ↓ to manage',
  '                                                       Update available! Run: brew upgrade claude-code@latest',
  '',
];
const SCREEN = [...ABOVE, ...PANE, ''].join('\n');

describe('the agents pane', () => {
  it('reads every row of a real screen, with its fold', () => {
    const pane = parseAgentsPane(SCREEN);
    expect(pane?.hidden).toBe(3);
    expect(pane?.rows).toEqual([
      { state: 'running', kind: 'fork', task: "Verifying the parser's output matches the notes", elapsedMs: (26 * 60 + 52) * 1_000, tokens: 156_700 },
      { state: 'running', kind: 'general-purpose', task: 'Removing the old build directory', elapsedMs: ((60 + 13) * 60 + 1) * 1_000, tokens: 286_900 },
      { state: 'running', kind: 'general-purpose', task: 'Waiting on results.txt · then summarising', elapsedMs: (51 * 60 + 42) * 1_000, tokens: 135_100 },
      { state: 'running', kind: 'general-purpose', task: 'Reading the host guard fixtures', elapsedMs: (11 * 60 + 31) * 1_000, tokens: 251_100 },
      { state: 'running', kind: 'general-purpose', task: 'Fixing an import in the tests', elapsedMs: 45_000, tokens: 980 },
    ]);
  });

  it('reads through ANSI colour around the glyphs and the columns', () => {
    const coloured = SCREEN
      .replace('⏺ main', `${ESC}[1m⏺${ESC}[0m main`)
      .replaceAll('◯ ', `${ESC}[38;5;244m◯${ESC}[39m `)
      .replace('26m 52s', `${ESC}[2m26m 52s${ESC}[0m`);
    const pane = parseAgentsPane(coloured);
    expect(pane?.rows).toHaveLength(5);
    expect(pane?.rows[0]?.elapsedMs).toBe((26 * 60 + 52) * 1_000);
    expect(pane?.rows[0]?.task).not.toContain(ESC);
  });

  it('has no fold without a `↓ N more`, and accepts `●` for the header', () => {
    const pane = parseAgentsPane(['  ● main', PANE[1], ''].join('\n'));
    expect(pane).toMatchObject({ hidden: 0, rows: [{ kind: 'fork' }] });
  });

  it('ends at the first line that is not a row', () => {
    const pane = parseAgentsPane([...PANE.slice(0, 3), '  ◯ fork   a row that lost its figures', ...PANE.slice(3)].join('\n'));
    expect(pane?.rows).toHaveLength(2);
    expect(pane?.hidden).toBe(0);
  });

  it('is no pane without one: a plain screen, a Codex screen, a header without rows', () => {
    expect(parseAgentsPane(ABOVE.join('\n'))).toBeNull();
    expect(parseAgentsPane('')).toBeNull();
    const codex = [
      '• Working (40s • esc to interrupt)',
      '',
      '› Ask Codex to do anything',
      'gpt-6-astra xhigh · project · ← for agents',
    ].join('\n');
    expect(parseAgentsPane(codex)).toBeNull();
    expect(parseAgentsPane([...ABOVE, '  ⏺ main', ''].join('\n'))).toBeNull();
    // A reply that happens to start the same way is not the header.
    expect(parseAgentsPane('⏺ main is ahead of origin by two commits\n  ◯ fork  x')).toBeNull();
  });

  it('reads the pane at the bottom, not an older one scrolled into the history', () => {
    const older = ['  ⏺ main', '  ◯ fork             Old task                1m 2s · ↓ 1k tokens', ''];
    expect(parseAgentsPane([...older, ...ABOVE, ...PANE].join('\n'))?.rows).toHaveLength(5);
  });

  it('maps the state marks: hollow runs, filled or ticked is done, crossed failed', () => {
    expect(['◯', '○'].map(rowState)).toEqual(['running', 'running']);
    expect(['⏺', '●', '◉', '✓', '✔'].map(rowState)).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(['✗', '✘', '×'].map(rowState)).toEqual(['failed', 'failed', 'failed']);
    expect(rowState('?')).toBe('running');
    expect(parseAgentRow('✔ general-purpose  Done with it                3s · ↓ 1.2M tokens')).toMatchObject({ state: 'done', tokens: 1_200_000 });
    expect(parseAgentRow('✘ Explore  Failed at it                1h · ↓ 10 tokens')).toMatchObject({ state: 'failed', kind: 'Explore', elapsedMs: 3_600_000 });
  });

  it('parses durations and token counts', () => {
    expect(parseElapsed('9m 49s')).toBe(589_000);
    expect(parseElapsed('1h 13m 1s')).toBe(4_381_000);
    expect(parseElapsed('2h 3m')).toBe(7_380_000);
    expect(parseElapsed('45s')).toBe(45_000);
    expect(parseElapsed('1h')).toBe(3_600_000);
    expect(parseElapsed('')).toBeNull();
    expect(parseElapsed('3s 2m')).toBeNull();
    expect(parseTokenCount('156.7k')).toBe(156_700);
    expect(parseTokenCount('1.2M')).toBe(1_200_000);
    expect(parseTokenCount('980')).toBe(980);
    expect(parseTokenCount('lots')).toBeNull();
  });

  it("reads a plugin's namespaced agent and a count with a comma", () => {
    const pane = parseAgentsPane([
      '  ⏺ main',
      '  ◯ fork                   Verifying x           9m 49s · ↓ 980 tokens',
      '  ◯ code-review:reviewer   Reviewing the diff    9m 49s · ↓ 1,234 tokens',
      '  ↓ 1 more',
    ].join('\n'));
    expect(pane?.rows.map((row) => [row.kind, row.tokens])).toEqual([['fork', 980], ['code-review:reviewer', 1_234]]);
    expect(pane?.hidden).toBe(1);
  });

  it('matches a row by its columns, the task lazily', () => {
    expect(AGENT_ROW.test('◯ fork  a  b  12s · ↓ 1k tokens')).toBe(true);
    expect(parseAgentRow('◯ fork  a  b  12s · ↓ 1k tokens')?.task).toBe('a  b');
    // One space is not a column gap.
    expect(parseAgentRow('◯ fork Verifying it  12s · ↓ 1k tokens')).toBeNull();
  });
});

describe('the live preview over the agents pane', () => {
  it('shows only the prose, never a row or the spinner-like last row', () => {
    const preview = extractLivePreview(SCREEN);
    expect(preview).toBe('Waiting on you: the dashboard step for the custom hostname.');
  });

  it('shows the prose above the working spinner with the pane below the footer', () => {
    const working = [
      '⏺ The caption writer still defaults to the old model. Sending it back to',
      '  the agent that did the rest of the removal.',
      '',
      '✽ Whisking… (37s · ↓ 1.8k tokens · thinking)',
      '',
      ...ABOVE.slice(4).map((line) => line.replace('9 shells', '5 shells · esc to interrupt')),
      '                                                                                        2% until auto-compact',
      '',
      ...PANE,
    ].join('\n');
    expect(extractLivePreview(working)).toBe(
      'The caption writer still defaults to the old model. Sending it back to\nthe agent that did the rest of the removal.'
    );
  });

  it('never anchors on a pane row the parser cannot read', () => {
    const working = [
      '⏺ The caption writer still defaults to the old model. Sending it back to',
      '  the agent that did the rest of the removal.',
      '',
      '✽ Whisking… (37s · ↓ 1.8k tokens · thinking)',
      '',
      ...ABOVE.slice(4).map((line) => line.replace('9 shells', '5 shells · esc to interrupt')),
      '  ⏺ main',
      '  ◯ fork                   Verifying x                            9m 49s · ↓ 980 tokens',
      // A row cut short by a narrow terminal, and a count with a comma.
      '  ◯ general-purpose        Reading the host guard fix',
      '  ◯ general-purpose        Reading the host guard fixtures        9m 49s · ↓ 1,234,567.8 tokens',
      '  ↓ 1 more',
    ].join('\n');
    expect(extractLivePreview(working)).toBe(
      'The caption writer still defaults to the old model. Sending it back to\nthe agent that did the rest of the removal.'
    );
    // Without the footer, a row shaped like one is still pane, not the spinner.
    expect(extractLivePreview([
      'Some real prose the agent is writing right now.',
      '✽ Whisking… (37s · ↓ 1.8k tokens · thinking)',
      // One space after the kind: not a row to the parser.
      '  ◯ general-purpose Reading the notes  9m 49s · ↓ 980 tokens',
    ].join('\n'))).toBe('Some real prose the agent is writing right now.');
  });

  it('is null when the pane is all there is', () => {
    expect(extractLivePreview(['✻ Waiting for 6 background agents to finish', '', ...ABOVE.slice(4), ...PANE].join('\n'))).toBeNull();
    expect(extractLivePreview(PANE.join('\n'))).toBeNull();
  });
});

// Two notes on #186: every agent paid a screen read at each turn end for a
// pane only Claude draws, and the poll slowed to 30 s with agents running, so
// the bar said "working" long after the last one finished.
describe('who reads the pane, and when it keeps the poll fast', () => {
  it('is drawn by Claude Code alone', () => {
    expect(drawsAgentsPane('claude')).toBe(true);
    for (const agent of ['codex', 'grok', 'gemini', 'omp', 'agy', 'pi', null, undefined]) {
      expect(drawsAgentsPane(agent)).toBe(false);
    }
  });

  const row = (state: 'running' | 'done' | 'failed') =>
    ({ state, kind: 'general-purpose', task: 'Reviewing', elapsedMs: 1_000, tokens: null });

  it('has running agents while any row on screen runs', () => {
    expect(hasRunningAgents({ rows: [row('done'), row('running')], hidden: 0 })).toBe(true);
    expect(hasRunningAgents({ rows: [row('done'), row('failed')], hidden: 3 })).toBe(false);
    expect(hasRunningAgents(null)).toBe(false);
  });

  it('reads a pane of finished rows as nothing running', () => {
    const pane = parseAgentsPane(['  ⏺ main', '  ⏺ general-purpose  Reviewing the notes   12s · ↓ 12.4k tokens'].join('\n'));
    expect(pane?.rows).toHaveLength(1);
    expect(hasRunningAgents(pane)).toBe(false);
  });
});
