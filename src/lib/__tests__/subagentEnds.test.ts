import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { delegationFromLines } from '../subagents/delegationEnd';
import { ABSENT_EXIT, delegationLinesCommand, workflowJournalPath } from '../subagents/paths';
import { handbackPointer, parseHandback } from '../subagents/taskNotice';
import { parseWorkflowJournal } from '../subagents/workflowRun';
import { threadItems } from '../threadItems';
import { parseTranscript, parseTranscriptLine } from '../transcript/parser';

/**
 * A background agent's whole life in a real session (Claude Code 2.1.294,
 * trimmed and anonymised): its call, its launch, its report handed back as a
 * message, the notification pointing to it, a `SendMessage` that resumed it,
 * its second report, and the second notification, which names the
 * `SendMessage` rather than the call.
 */
const LIFE = readFileSync(join(__dirname, 'fixtures', 'subagents', 'background-handback.jsonl'), 'utf8');
const LINES = LIFE.trimEnd().split('\n');
const CALL = 'toolu_01JBU6JVEfRNvjE9SADCDZDv';
const AGENT = 'ad5da2496dc7bc8c0';
const upTo = (count: number) => `${LINES.slice(0, count).join('\n')}\n`;

describe('a background agent\'s hand-back', () => {
  it('reads the report from the structured origin and from the text, without the frame or its indent', () => {
    const body = '[Subagent hand-back] The text below is the final report. The report follows:\n  ## Done\n  \n  Fixed it.';
    expect(parseHandback({ kind: 'peer', from: AGENT, handback: true, body }, null)).toEqual({ agentId: AGENT, report: '## Done\n\nFixed it.' });
    expect(parseHandback(null, `Another Claude session sent a message:\n<agent-message from="${AGENT}">\n${body}\n</agent-message>\n\nThat "other Claude session"…`))
      .toEqual({ agentId: AGENT, report: '## Done\n\nFixed it.' });
    // A peer's plain message is not one, nor is an id that is not inert.
    expect(parseHandback({ kind: 'peer', from: AGENT, body: 'hello' }, null)).toBeNull();
    expect(parseHandback(null, '<agent-message from="a1">hello</agent-message>')).toBeNull();
    expect(parseHandback({ kind: 'peer', from: '../x', handback: true, body }, null)).toBeNull();
  });

  it('finds the agent a notification points to', () => {
    expect(handbackPointer('This agent\'s report was delivered to you as a message from "ad5da2496dc7bc8c0" (its SubagentHandback call).'))
      .toBe(AGENT);
    expect(handbackPointer('Two links were dead.')).toBeNull();
    expect(handbackPointer(null)).toBeNull();
  });

  it('is a segment no bubble draws, from the user line and from the queued attachment', () => {
    const segments = LINES.map((line) => parseTranscriptLine(line)?.segments ?? []);
    expect(segments[2]).toEqual([{ kind: 'handback', agentId: AGENT, report: expect.stringMatching(/^\*\*Found the cause/) }]);
    expect(segments[6]).toEqual([{ kind: 'handback', agentId: AGENT, report: expect.stringMatching(/^\*\*Everything now uses/) }]);
    expect(threadItems(parseTranscript(LIFE), { showSidechain: false }).map((placed) => placed.item.kind)).toEqual(['subagent', 'tools']);
  });

  // Before, the card folded open onto "This agent's report was delivered to
  // you as a message…", for every background agent.
  it('is what the card shows once the agent ends, not the notification\'s pointer', () => {
    expect(delegationFromLines(upTo(2), CALL)).toMatchObject({ state: 'running', background: true, agentId: AGENT });
    expect(delegationFromLines(upTo(4), CALL)).toMatchObject({
      state: 'done', result: expect.stringMatching(/^\*\*Found the cause/), tokens: expect.any(Number),
    });
  });

  // Resumed with SendMessage after its first report, it works again: the
  // card said done until the next notification, which names the SendMessage.
  it('runs again when resumed, until it reports again', () => {
    expect(delegationFromLines(upTo(6), CALL)).toMatchObject({ state: 'running', result: null });
    expect(delegationFromLines(upTo(7), CALL)).toMatchObject({ state: 'done', result: expect.stringMatching(/^\*\*Everything now uses/) });
    expect(delegationFromLines(LIFE, CALL)).toMatchObject({ state: 'done', result: expect.stringMatching(/^\*\*Everything now uses/) });
  });

  it('says nothing for lines that do not hold the call', () => {
    expect(delegationFromLines(LINES.slice(2).join('\n'), CALL)).toBeNull();
    expect(delegationFromLines('', CALL)).toBeNull();
  });
});

describe('a running workflow\'s journal', () => {
  // As measured on 2.1.294: the run file appears only when the run ends.
  const JOURNAL = [
    '{"type":"launched"}',
    '{"type":"started","key":"v2:bbe7","agentId":"a1e124fa42fc9531b","label":"implement:lib","phase":"Lib"}',
    '{"type":"result","key":"v2:bbe7","agentId":"a1e124fa42fc9531b","result":{"commit":"eef9112","files":["src/lib/a.ts"]}}',
    '{"type":"started","key":"v2:3bed","agentId":"aa823f45fbd2f422d","label":"review:correctness","phase":"Review"}',
    '{"type":"started","key":"v2:3bee","agentId":"a8ebb94aa032dbf8a","label":"review:rules","phase":"Review"}',
    '{"type":"result","key":"v2:3bee","agentId":"a8ebb94aa032dbf8a","result":{"findings":[]}}',
    '{"type":"started","key":"v2:3bef","agentId":"a6fa5865ea6',
  ].join('\n');

  it('groups its agents under the phases they started in, done once they have a result', () => {
    const run = parseWorkflowJournal(JOURNAL)!;
    expect(run.phases.map((phase) => [phase.title, phase.agents.map((agent) => [agent.label, agent.agentId, agent.state])])).toEqual([
      ['Lib', [['implement:lib', 'a1e124fa42fc9531b', 'done']]],
      ['Review', [['review:correctness', 'aa823f45fbd2f422d', 'running'], ['review:rules', 'a8ebb94aa032dbf8a', 'done']]],
    ]);
    // What only the run file says stays unknown; a null status reads as running.
    expect(run).toMatchObject({ name: null, status: null, totalTokens: null, agentCount: 3 });
  });

  it('is nothing before an agent has started', () => {
    expect(parseWorkflowJournal('{"type":"launched"}\n')).toBeNull();
    expect(parseWorkflowJournal('')).toBeNull();
  });

  it('lives in the run\'s agents folder', () => {
    expect(workflowJournalPath('/s', 'wf_1')).toBe('/s/subagents/workflows/wf_1/journal.jsonl');
  });
});

const SHELLS = ['sh', 'zsh'].filter((shell) => spawnSync(shell, ['-c', ':']).status === 0);

describe.each(SHELLS)('reading the lines that name an agent, in %s', (shell) => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'herdrchat ends '));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const run = (command: string) => spawnSync(shell, ['-c', command], { encoding: 'utf8', timeout: 10_000 });

  it('prints only those lines, again only when they changed, and succeeds when none match', () => {
    const path = join(root, 'session.jsonl');
    expect(run(delegationLinesCommand(path, [CALL], null)!).status).toBe(ABSENT_EXIT);
    writeFileSync(path, `{"other":1}\n${LINES[0]}\n{"other":2}\n`);
    const first = run(delegationLinesCommand(path, [CALL, AGENT], null)!);
    expect(first.status).toBe(0);
    const [signature, ...rest] = first.stdout.split('\n');
    expect(rest.join('\n')).toBe(`${LINES[0]}\n`);
    expect(run(delegationLinesCommand(path, [CALL, AGENT], signature!)!).stdout).toBe(`${signature}\n`);
    writeFileSync(path, LIFE);
    const all = run(delegationLinesCommand(path, [CALL, AGENT], signature!)!);
    expect(delegationFromLines(all.stdout.slice(all.stdout.indexOf('\n') + 1), CALL)?.state).toBe('done');
    const none = run(delegationLinesCommand(path, ['toolu_nobody'], null)!);
    expect([none.status, none.stderr]).toEqual([0, '']);
  });

  it('refuses an id that could widen the command', () => {
    expect(delegationLinesCommand('/x', ["a' -e '"], null)).toBeNull();
    expect(delegationLinesCommand('/x', [], null)).toBeNull();
  });
});
