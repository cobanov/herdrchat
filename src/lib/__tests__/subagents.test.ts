import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecResult } from '../../../modules/herdr-ssh/src';
import type { HerdrTransport } from '../herdr/transport';
import { parseAgentMeta } from '../subagents/meta';
import {
  ABSENT_EXIT,
  agentIdFromPath,
  agentMetaPath,
  agentTranscriptPath,
  agentsDir,
  isInertId,
  parseResolveOutput,
  readChangedCommand,
  resolveAgentCommand,
  sessionDir,
  workflowRunPath,
} from '../subagents/paths';
import { SubagentReader } from '../subagents/reader';
import { scriptMeta } from '../subagents/scriptMeta';
import { parseTaskNotices } from '../subagents/taskNotice';
import { agentState, isRunning, parseWorkflowRun, runIdFromResult } from '../subagents/workflowRun';
import { parseTranscriptLine } from '../transcript/parser';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'subagents', name), 'utf8');

const SESSION = '/home/dev/.claude/projects/-home-dev-app/e6bdce5c-d85f-4bd3-a264-c2590385b030';

describe('subagent paths', () => {
  it('finds the session folder from the session, a subagent and a workflow agent', () => {
    expect(sessionDir(`${SESSION}.jsonl`)).toBe(SESSION);
    expect(sessionDir(`${SESSION}/subagents/agent-a53e546bf8054816f.jsonl`)).toBe(SESSION);
    expect(sessionDir(`${SESSION}/subagents/workflows/wf_31a24808-cdf/agent-ad075041706d83df1.jsonl`)).toBe(SESSION);
    expect(sessionDir('relative.jsonl')).toBeNull();
    expect(sessionDir(`${SESSION}.json`)).toBeNull();
  });

  it('builds where each file lives', () => {
    expect(agentTranscriptPath(SESSION, 'a53e')).toBe(`${SESSION}/subagents/agent-a53e.jsonl`);
    expect(agentMetaPath(SESSION, 'a53e')).toBe(`${SESSION}/subagents/agent-a53e.meta.json`);
    expect(agentTranscriptPath(SESSION, 'ad07', 'wf_31a24808-cdf')).toBe(`${SESSION}/subagents/workflows/wf_31a24808-cdf/agent-ad07.jsonl`);
    expect(agentsDir(SESSION, 'wf_1')).toBe(`${SESSION}/subagents/workflows/wf_1`);
    expect(workflowRunPath(SESSION, 'wf_31a24808-cdf')).toBe(`${SESSION}/workflows/wf_31a24808-cdf.json`);
    expect(agentIdFromPath(`${SESSION}/subagents/agent-a53e546bf8054816f.jsonl`)).toBe('a53e546bf8054816f');
    expect(agentIdFromPath(`${SESSION}.jsonl`)).toBeNull();
  });

  it('refuses an id that is not obviously inert', () => {
    expect(isInertId('toolu_01JBU6JVEfRNvjE9SADCDZDv')).toBe(true);
    expect(isInertId('wf_31a24808-cdf')).toBe(true);
    expect(isInertId("x'; rm -rf ~")).toBe(false);
    expect(isInertId('../agent')).toBe(false);
    expect(resolveAgentCommand(SESSION, "x' y")).toBeNull();
  });
});

// Commands arrive in the host's login shell, which is often zsh, and zsh
// aborts a whole command on a glob that matches nothing.
const SHELLS = ['sh', 'zsh'].filter((shell) => spawnSync(shell, ['-c', ':']).status === 0);

describe.each(SHELLS)('resolving which agent a call started, in %s', (shell) => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'herdrchat subagents '));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const run = (command: string) => spawnSync(shell, ['-c', command], { encoding: 'utf8', timeout: 10_000 });

  it('prints nothing, and succeeds, when the session has no subagents folder yet', () => {
    const result = run(resolveAgentCommand(join(root, 'session'), 'toolu_01JBU6JVEfRNvjE9SADCDZDv')!);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    // The folder there, no agent in it yet.
    mkdirSync(join(root, 'session', 'subagents'), { recursive: true });
    const empty = run(resolveAgentCommand(join(root, 'session'), 'toolu_01JBU6JVEfRNvjE9SADCDZDv')!);
    expect([empty.status, empty.stdout, empty.stderr]).toEqual([0, '', '']);
    expect(parseResolveOutput(result.stdout, 'toolu_01JBU6JVEfRNvjE9SADCDZDv')).toBeNull();
  });

  // The quoted id, so an agent whose description mentions another call's id
  // is not mistaken for it; and never "the newest file".
  it('finds the agent whose meta names the call, among others', () => {
    const dir = join(root, 'session');
    mkdirSync(join(dir, 'subagents'), { recursive: true });
    writeFileSync(join(dir, 'subagents', 'agent-a0a441d0e74951027.meta.json'),
      '{"agentType":"Explore","description":"look at toolu_01JBU6JVEfRNvjE9SADCDZDvX","toolUseId":"toolu_other","spawnDepth":1}');
    writeFileSync(join(dir, 'subagents', 'agent-a53e546bf8054816f.meta.json'), fixture('meta-plain.json'));
    writeFileSync(join(dir, 'subagents', 'agent-a53e546bf8054816f.jsonl'), '');

    const result = run(resolveAgentCommand(dir, 'toolu_01JBU6JVEfRNvjE9SADCDZDv')!);
    expect(result.status).toBe(0);
    expect(parseResolveOutput(result.stdout, 'toolu_01JBU6JVEfRNvjE9SADCDZDv')).toEqual({
      agentId: 'a53e546bf8054816f',
      meta: expect.objectContaining({ description: 'Fix play key launching Music', model: 'opus', requestShape: 'background' }),
    });
    // An agent that has not written its meta yet is "starting", not an error.
    const missing = run(resolveAgentCommand(dir, 'toolu_not_started')!);
    expect(missing.status).toBe(0);
    expect(missing.stdout).toBe('');
  });

  it('refuses output whose meta names a different call', () => {
    expect(parseResolveOutput(`agent-a1.meta.json\n${fixture('meta-plain.json')}`, 'toolu_someone_else')).toBeNull();
    expect(parseResolveOutput('garbage', 'toolu_01JBU6JVEfRNvjE9SADCDZDv')).toBeNull();
  });

  it('reads a run file only when it changed, and says when it is not there', () => {
    const path = join(root, 'wf_1.json');
    expect(run(readChangedCommand(path, null)).status).toBe(ABSENT_EXIT);
    writeFileSync(path, '{"status":"running"}');
    const first = run(readChangedCommand(path, null));
    const [signature, ...rest] = first.stdout.split('\n');
    expect(rest.join('\n')).toBe('{"status":"running"}');
    const again = run(readChangedCommand(path, signature!));
    expect(again.stdout).toBe(`${signature}\n`);
    writeFileSync(path, '{"status":"completed"}');
    expect(run(readChangedCommand(path, signature!)).stdout).toContain('completed');
  });
});

describe('SubagentReader', () => {
  const host = (answer: (command: string) => ExecResult) => {
    const commands: string[] = [];
    const transport: HerdrTransport = {
      exec: async (command) => {
        commands.push(command);
        return answer(command);
      },
      streamLines: async function* () {},
    };
    return { transport, commands };
  };

  it('asks again until the agent starts, then remembers it', async () => {
    let started = false;
    const { transport, commands } = host(() => ({
      ok: true, exitCode: 0, stderr: '',
      stdout: started ? `agent-a53e546bf8054816f.meta.json\n${fixture('meta-plain.json')}\n` : '',
    }));
    const reader = new SubagentReader(transport);
    await expect(reader.resolve(SESSION, 'toolu_01JBU6JVEfRNvjE9SADCDZDv')).resolves.toBeNull();
    started = true;
    await expect(reader.resolve(SESSION, 'toolu_01JBU6JVEfRNvjE9SADCDZDv')).resolves.toMatchObject({ agentId: 'a53e546bf8054816f' });
    await new SubagentReader(transport).resolve(SESSION, 'toolu_01JBU6JVEfRNvjE9SADCDZDv');
    expect(commands).toHaveLength(2);
  });

  it('answers a dropped connection with nothing, for the next tick to retry', async () => {
    const { transport } = host(() => ({ ok: false, code: 'timeout', message: 'slow' }));
    await expect(new SubagentReader(transport).resolve(SESSION, 'toolu_x')).resolves.toBeNull();
    await expect(new SubagentReader(transport).readIfChanged(`${SESSION}/workflows/wf_1.json`, null))
      .resolves.toEqual({ kind: 'unknown', reason: 'slow' });
  });

  it('tells a changed run file from an unchanged one and a missing one', async () => {
    const answers: ExecResult[] = [
      { ok: true, exitCode: ABSENT_EXIT, stdout: '', stderr: '' },
      { ok: true, exitCode: 0, stdout: '123 20\n{"status":"running"}', stderr: '' },
      { ok: true, exitCode: 0, stdout: '123 20\n', stderr: '' },
    ];
    const { transport } = host(() => answers.shift()!);
    const reader = new SubagentReader(transport);
    await expect(reader.readIfChanged('/x.json', null)).resolves.toEqual({ kind: 'absent' });
    await expect(reader.readIfChanged('/x.json', null)).resolves.toEqual({ kind: 'text', signature: '123 20', text: '{"status":"running"}' });
    await expect(reader.readIfChanged('/x.json', '123 20')).resolves.toEqual({ kind: 'unchanged', signature: '123 20' });
  });
});

describe('agent meta', () => {
  it('reads a plain subagent and a workflow agent', () => {
    expect(parseAgentMeta(fixture('meta-plain.json'))).toEqual({
      agentType: 'general-purpose',
      description: 'Fix play key launching Music',
      toolUseId: 'toolu_01JBU6JVEfRNvjE9SADCDZDv',
      spawnDepth: 1,
      model: 'opus',
      requestShape: 'background',
      workflowPhase: null,
    });
    expect(parseAgentMeta(fixture('meta-workflow.json'))).toMatchObject({
      agentType: 'workflow-subagent', toolUseId: null, workflowPhase: 'Review', description: 'review:keychain-safe-write',
    });
  });

  it('gives nothing for a half-written file', () => {
    expect(parseAgentMeta('{"agentType":"gen')).toBeNull();
    expect(parseAgentMeta('[]')).toBeNull();
  });
});

describe('workflow run', () => {
  it('groups agents under their phases, in order, with their state', () => {
    const run = parseWorkflowRun(fixture('run.json'))!;
    expect(run.name).toBe('caret-release-gap-build');
    expect(run.status).toBe('running');
    expect(isRunning(run.status)).toBe(true);
    expect(run.phases.map((phase) => [phase.title, phase.agents.map((agent) => [agent.label, agent.state])])).toEqual([
      ['Build', [['build:ios-review-hygiene', 'done'], ['build:ios-onboarding-denial', 'done']]],
      ['Review', [['review:keychain-safe-write', 'running']]],
    ]);
    expect(run.phases[1]!.agents[0]).toMatchObject({
      agentId: 'a0093b25b73b945bf', model: 'claude-opus-5-5', lastTool: 'Bash: npm test', tokens: 40210, toolCalls: 12, durationMs: null,
    });
    expect(run.phases[0]!.detail).toBe('one agent per PR-sized package, each in its own worktree');
    // Empty log lines are not lines.
    expect(run.logs).toEqual(['20 of 20 packages have an open PR']);
  });

  it('keeps the last good run when the file is read mid-rewrite', () => {
    const good = parseWorkflowRun(fixture('run.json'));
    const half = fixture('run.json').slice(0, 300);
    expect(parseWorkflowRun(half, good)).toBe(good);
    expect(parseWorkflowRun(half)).toBeNull();
  });

  it('builds phases from progress when the script listed none, and keeps an agent outside them', () => {
    const run = parseWorkflowRun(JSON.stringify({
      status: 'completed',
      workflowProgress: [
        { type: 'workflow_phase', index: 1, title: 'Scan' },
        { type: 'workflow_agent', index: 1, label: 'scan', phaseIndex: 1, state: 'done' },
        { type: 'workflow_agent', index: 2, label: 'loose', state: 'error', error: 'boom' },
      ],
    }))!;
    expect(run.phases.map((phase) => [phase.title, phase.agents.map((agent) => agent.state)])).toEqual([
      ['Scan', ['done']],
      ['Agents', ['failed']],
    ]);
    expect(run.phases[1]!.agents[0]!.error).toBe('boom');
    expect(isRunning(run.status)).toBe(false);
  });

  it('reads the four agent states Claude writes', () => {
    expect(['start', 'progress', 'done', 'error'].map(agentState)).toEqual(['running', 'running', 'done', 'failed']);
  });

  it('finds the run id in the Workflow call result', () => {
    const result = 'Workflow launched in background. Task ID: w2z9jiho1\nSummary: Implement per-agent chats\n' +
      'Transcript dir: /Users/dev/.claude/projects/-x/e6bd/subagents/workflows/wf_31a24808-cdf\n' +
      'Script file: /Users/dev/.claude/projects/-x/e6bd/workflows/scripts/herdrchat-multi-agent-wf_31a24808-cdf.js\n' +
      'Run ID: wf_31a24808-cdf\nTo resume after editing the script: Workflow({…})';
    expect(runIdFromResult(result)).toBe('wf_31a24808-cdf');
    expect(runIdFromResult('Error: refused')).toBeNull();
    expect(runIdFromResult(null)).toBeNull();
  });
});

describe('workflow script meta', () => {
  // The input as the thread has it: flattened, not JSON.
  it('reads the name and description out of the meta block', () => {
    const input = "{script: export const meta = {\n  name: 'herdrchat-multi-agent',\n  description: 'Implement per-agent chats inside a herdr workspace, then review and fix',\n  phases: [\n    { title: 'Data', detail: 'lib' },\n  ],\n}\nexport default async function () { const name: 'x' }}";
    expect(scriptMeta(input)).toEqual({
      name: 'herdrchat-multi-agent',
      description: 'Implement per-agent chats inside a herdr workspace, then review and fix',
    });
  });

  it('takes double quotes and escapes, and names a re-run by its saved script', () => {
    expect(scriptMeta('export const meta = { name: "it\'s \\"here\\"", description: "d" }').name).toBe('it\'s "here"');
    expect(scriptMeta('{scriptPath: /Users/dev/.claude/projects/-x/e6bd/workflows/scripts/herdrchat-host-theme-wf_57d05f0f-9f9.js}'))
      .toEqual({ name: 'herdrchat-host-theme', description: null });
    expect(scriptMeta('export default async () => {}')).toEqual({ name: null, description: null });
    expect(scriptMeta(null)).toEqual({ name: null, description: null });
  });
});

describe('task notifications', () => {
  const AGENT_NOTICE =
    '<task-notification>\n<task-id>a53e546bf8054816f</task-id>\n<tool-use-id>toolu_01YHaw6KgVXRztcfnALFWkii</tool-use-id>\n' +
    '<output-file>/private/tmp/x/tasks/a53e546bf8054816f.output</output-file>\n<status>completed</status>\n' +
    '<summary>Agent "Catalog API, auth, streams, signing" finished</summary>\n' +
    '<note>A task-notification fires each time this agent stops.</note>\n' +
    '<result>The catalog is in the report.\n</result>\n' +
    '<usage><subagent_tokens>153883</subagent_tokens><tool_uses>29</tool_uses><duration_ms>249552</duration_ms></usage>\n</task-notification>';

  it('reads what a background agent finished with', () => {
    expect(parseTaskNotices(AGENT_NOTICE)).toEqual([{
      toolUseId: 'toolu_01YHaw6KgVXRztcfnALFWkii',
      taskId: 'a53e546bf8054816f',
      status: 'completed',
      summary: 'Agent "Catalog API, auth, streams, signing" finished',
      result: 'The catalog is in the report.',
      tokens: 153883,
      toolUses: 29,
      durationMs: 249552,
    }]);
    // A notification about no call (a cron fire) is not one of these.
    expect(parseTaskNotices('<task-notification><task-id>x</task-id><status>completed</status></task-notification>')).toEqual([]);
  });

  // Claude writes it as its own user turn, which the harness rule hides; the
  // notice survives as a segment no bubble draws.
  it('survives parsing as a notice, from the user line and from the queued attachment', () => {
    const line = JSON.stringify({
      parentUuid: 'p', isSidechain: false, type: 'user', uuid: 'n1', timestamp: '2026-09-16T19:07:25.433Z',
      origin: { kind: 'task-notification' }, promptSource: 'system',
      message: { role: 'user', content: AGENT_NOTICE },
    });
    expect(parseTranscriptLine(line)).toMatchObject({
      id: 'n1', role: 'user', segments: [{ kind: 'taskNotice', notice: { toolUseId: 'toolu_01YHaw6KgVXRztcfnALFWkii', status: 'completed' } }],
    });
    const queued = JSON.stringify({
      type: 'attachment', uuid: 'n2', timestamp: '2026-10-09T04:11:40.220Z', isSidechain: false,
      attachment: { type: 'queued_command', commandMode: 'task-notification', prompt: AGENT_NOTICE.replace('completed', 'killed') },
    });
    expect(parseTranscriptLine(queued)?.segments).toEqual([
      { kind: 'taskNotice', notice: expect.objectContaining({ status: 'killed' }) },
    ]);
    // Any other harness turn stays hidden, as before.
    const other = JSON.stringify({ type: 'user', uuid: 'n3', promptSource: 'system', message: { role: 'user', content: 'scheduled' } });
    expect(parseTranscriptLine(other)).toBeNull();
  });
});

// So a failure in the shell tests above is a shell problem, not a missing one.
it('has a POSIX sh to run the commands against', () => {
  expect(execFileSync('sh', ['-c', 'printf ok'], { encoding: 'utf8' })).toBe('ok');
});
