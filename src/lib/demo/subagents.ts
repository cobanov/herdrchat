/**
 * The Demo's subagents and its workflow, in the files Claude Code writes for
 * them (src/lib/subagents/paths.ts), so the app reads them by its real rules:
 *
 * - the notes chat (w2) once handed a link check to a subagent, which
 *   finished, and started a review workflow that is still running: two
 *   phases, three agents, the last of them mid-way;
 * - `delegate the review`, typed into any Demo chat, starts a subagent that
 *   works for a few seconds, its transcript growing, before its result lands,
 *   so a card can be seen going from running to done.
 *
 * Self-contained, not built on fixtures.ts: the notes chat's seed is made
 * from these lines, and fixtures.ts imports them.
 */

const MODEL = 'claude-opus-5';
const SUBAGENT_MODEL = 'claude-sonnet-5';

/** The demo link check's call, agent and files. */
export const DEMO_LINKS = {
  toolUseId: 'toolu_demo_links',
  agentId: 'a1f0c3d5e7b9a2c4e',
  description: 'Check the release notes for broken links',
} as const;

/** The demo review workflow's call and run. */
export const DEMO_REVIEW = {
  toolUseId: 'toolu_demo_review',
  runId: 'wf_d3m0a1b2-c4e',
  taskId: 'wdemo0001',
  name: 'release-review',
  summary: 'Check the release, then review its wording',
} as const;

/** The three agents of the review run: two checks done, the review still going. */
const REVIEW_AGENTS = [
  { agentId: 'a2b4c6d8e0f1a3b5c', label: 'check:links', phase: 1, state: 'done', durationMs: 48_200, tokens: 21_450, toolCalls: 6, lastTool: ['WebFetch', 'herdr.dev/docs/keys'], result: 'Every link resolves but one: example.com/old-guide (404).' },
  { agentId: 'a3c5e7f9b1d3a5c7e', label: 'check:changelog', phase: 1, state: 'done', durationMs: 35_900, tokens: 17_020, toolCalls: 4, lastTool: ['Read', 'CHANGELOG.md'], result: 'The changelog lists every change the notes mention.' },
  { agentId: 'a4d6f8b0c2e4a6c8f', label: 'review:wording', phase: 2, state: 'progress', durationMs: null, tokens: 9_310, toolCalls: 3, lastTool: ['Read', 'RELEASE_NOTES.md'], result: null },
] as const;

const REVIEW_PHASES = [
  { title: 'Check', detail: 'links and changelog, one agent each' },
  { title: 'Review', detail: 'read the notes as a newcomer would' },
] as const;

// MARK: - Lines

function main(type: 'user' | 'assistant', uuid: string, timestamp: string, content: unknown): string {
  const message: Record<string, unknown> = { role: type, content };
  if (type === 'assistant') {
    message.model = MODEL;
    message.usage = { input_tokens: 18_420, cache_read_input_tokens: 61_300 };
  }
  return JSON.stringify({ type, uuid, timestamp, message });
}

/** A line of a subagent's own transcript: a sidechain, carrying its agent id. */
function agentLine(agentId: string, type: 'user' | 'assistant', uuid: string, timestamp: string, content: unknown): string {
  const message: Record<string, unknown> = { role: type, content };
  if (type === 'assistant') {
    message.model = SUBAGENT_MODEL;
    message.usage = { input_tokens: 4_210, cache_read_input_tokens: 12_800 };
  }
  return JSON.stringify({ isSidechain: true, agentId, type, uuid, timestamp, message });
}

const toolUse = (id: string, name: string, input: Record<string, unknown>) => [{ type: 'tool_use', id, name, input }];
const toolResult = (id: string, text: string, isError = false) =>
  [{ type: 'tool_result', tool_use_id: id, content: text, ...(isError ? { is_error: true } : {}) }];

const LINKS_PROMPT = 'Open RELEASE_NOTES.md and check every link in it. Report the ones that do not resolve, with their line.';
/** The agent's last word, which is also what its call returns. 🔗 so the byte offsets meet an emoji. */
const LINKS_RESULT = 'Checked 3 links 🔗. Two resolve; https://example.com/old-guide returns 404, on line 15.';

const REVIEW_SCRIPT = [
  'export const meta = {',
  `  name: '${DEMO_REVIEW.name}',`,
  `  description: '${DEMO_REVIEW.summary}',`,
  `  phases: [${REVIEW_PHASES.map((phase) => `{ title: '${phase.title}', detail: '${phase.detail}' }`).join(', ')}],`,
  '}',
  '',
  'export default async function review({ agent, phase }) {',
  "  phase('Check')",
  "  await Promise.all([agent('check:links'), agent('check:changelog')])",
  "  phase('Review')",
  "  return agent('review:wording')",
  '}',
].join('\n');

/**
 * Where the notes chat starts: a link check handed to a subagent that
 * finished, then a review workflow launched in the background. Before the
 * chat's summary, so the thread still opens on the summary it always did.
 */
export function delegationSeed(sessionDir: string): string[] {
  return [
    main('user', 'd2-0a', '2026-08-19T08:30:00.000Z', 'check the release notes for broken links, then start a review of the release'),
    main('assistant', 'd2-0b', '2026-08-19T08:30:06.000Z', toolUse(DEMO_LINKS.toolUseId, 'Agent', {
      description: DEMO_LINKS.description,
      subagent_type: 'general-purpose',
      model: 'sonnet',
      prompt: LINKS_PROMPT,
    })),
    main('user', 'd2-0c', '2026-08-19T08:31:12.000Z', toolResult(DEMO_LINKS.toolUseId, LINKS_RESULT)),
    main('assistant', 'd2-0d', '2026-08-19T08:31:20.000Z', toolUse(DEMO_REVIEW.toolUseId, 'Workflow', { script: REVIEW_SCRIPT })),
    main('user', 'd2-0e', '2026-08-19T08:31:21.000Z', toolResult(DEMO_REVIEW.toolUseId, [
      `Workflow launched in background. Task ID: ${DEMO_REVIEW.taskId}`,
      `Summary: ${DEMO_REVIEW.summary}`,
      `Transcript dir: ${sessionDir}/subagents/workflows/${DEMO_REVIEW.runId}`,
      `Script file: ${sessionDir}/workflows/scripts/${DEMO_REVIEW.name}-${DEMO_REVIEW.runId}.js`,
      `Run ID: ${DEMO_REVIEW.runId}`,
    ].join('\n'))),
    main('assistant', 'd2-0f', '2026-08-19T08:31:30.000Z', [{
      type: 'text',
      text: 'One dead link: https://example.com/old-guide returns 404. The review is running in the background; I will summarise when it ends.',
    }]),
  ];
}

// MARK: - Files

/** Every subagent file the notes chat's session has, by absolute path. */
export function demoSubagentFiles(sessionDir: string): Map<string, string> {
  const files = new Map<string, string>();
  const subagents = `${sessionDir}/subagents`;

  files.set(`${subagents}/agent-${DEMO_LINKS.agentId}.meta.json`, `${JSON.stringify({
    agentType: 'general-purpose',
    description: DEMO_LINKS.description,
    toolUseId: DEMO_LINKS.toolUseId,
    spawnDepth: 1,
    requestShape: 'foreground',
    requestNonInteractive: true,
    model: 'sonnet',
  })}\n`);
  const id = DEMO_LINKS.agentId;
  files.set(`${subagents}/agent-${id}.jsonl`, lines([
    agentLine(id, 'user', 'dl-1', '2026-08-19T08:30:07.000Z', LINKS_PROMPT),
    agentLine(id, 'assistant', 'dl-2', '2026-08-19T08:30:15.000Z', toolUse('toolu_demo_dl1', 'Grep', { pattern: 'https?://', path: 'RELEASE_NOTES.md', output_mode: 'content' })),
    agentLine(id, 'user', 'dl-3', '2026-08-19T08:30:16.000Z', toolResult('toolu_demo_dl1',
      'RELEASE_NOTES.md:4: https://herdr.dev/docs/hosts\nRELEASE_NOTES.md:9: https://herdr.dev/docs/keys\nRELEASE_NOTES.md:15: https://example.com/old-guide')),
    agentLine(id, 'assistant', 'dl-4', '2026-08-19T08:30:40.000Z', toolUse('toolu_demo_dl2', 'WebFetch', { url: 'https://example.com/old-guide', prompt: 'Does this page exist?' })),
    agentLine(id, 'user', 'dl-5', '2026-08-19T08:30:52.000Z', toolResult('toolu_demo_dl2', 'Request failed with status code 404', true)),
    agentLine(id, 'assistant', 'dl-6', '2026-08-19T08:31:11.000Z', [{ type: 'text', text: LINKS_RESULT }]),
  ]));

  const runDir = `${subagents}/workflows/${DEMO_REVIEW.runId}`;
  for (const agent of REVIEW_AGENTS) {
    files.set(`${runDir}/agent-${agent.agentId}.meta.json`, `${JSON.stringify({
      agentType: 'workflow-subagent',
      description: agent.label,
      workflowPhase: REVIEW_PHASES[agent.phase - 1]?.title,
      spawnDepth: 1,
      requestShape: 'foreground',
      requestNonInteractive: false,
      model: 'opus',
    })}\n`);
    const [tool, target] = agent.lastTool;
    files.set(`${runDir}/agent-${agent.agentId}.jsonl`, lines([
      agentLine(agent.agentId, 'user', `${agent.label}-1`, '2026-08-19T08:31:22.000Z', `You are ${agent.label} in the ${DEMO_REVIEW.name} workflow.`),
      agentLine(agent.agentId, 'assistant', `${agent.label}-2`, '2026-08-19T08:31:30.000Z', toolUse(`toolu_${agent.agentId}`, tool, tool === 'WebFetch' ? { url: `https://${target}` } : { file_path: target })),
      ...(agent.result === null ? [] : [
        agentLine(agent.agentId, 'user', `${agent.label}-3`, '2026-08-19T08:31:40.000Z', toolResult(`toolu_${agent.agentId}`, 'ok')),
        agentLine(agent.agentId, 'assistant', `${agent.label}-4`, '2026-08-19T08:32:05.000Z', [{ type: 'text', text: agent.result }]),
      ]),
    ]));
  }
  files.set(`${sessionDir}/workflows/${DEMO_REVIEW.runId}.json`, JSON.stringify(reviewRun(sessionDir)));
  return files;
}

/** The review's run file, as Claude writes it mid-run. */
function reviewRun(sessionDir: string): Record<string, unknown> {
  const startTime = Date.parse('2026-08-19T08:31:21.000Z');
  return {
    runId: DEMO_REVIEW.runId,
    timestamp: '2026-08-19T08:31:21.000Z',
    taskId: DEMO_REVIEW.taskId,
    script: REVIEW_SCRIPT,
    scriptPath: `${sessionDir}/workflows/scripts/${DEMO_REVIEW.name}-${DEMO_REVIEW.runId}.js`,
    agentCount: REVIEW_AGENTS.length,
    logs: ['2 of 2 checks passed', 'Review started'],
    summary: DEMO_REVIEW.summary,
    workflowName: DEMO_REVIEW.name,
    status: 'running',
    startTime,
    phases: REVIEW_PHASES.map((phase) => ({ ...phase, model: 'opus' })),
    defaultModel: MODEL,
    workflowProgress: [
      ...REVIEW_PHASES.map((phase, index) => ({ type: 'workflow_phase', index: index + 1, title: phase.title })),
      ...REVIEW_AGENTS.map((agent, index) => ({
        type: 'workflow_agent',
        index: index + 1,
        label: agent.label,
        phaseIndex: agent.phase,
        phaseTitle: REVIEW_PHASES[agent.phase - 1]?.title,
        agentId: agent.agentId,
        model: 'claude-opus-5',
        state: agent.state,
        startedAt: startTime + index * 1_000,
        queuedAt: startTime,
        attempt: 1,
        lastToolName: agent.lastTool[0],
        lastToolSummary: agent.lastTool[1],
        tokens: agent.tokens,
        toolCalls: agent.toolCalls,
        ...(agent.durationMs === null ? {} : { durationMs: agent.durationMs }),
        ...(agent.result === null ? {} : { resultPreview: agent.result }),
      })),
    ],
    totalTokens: REVIEW_AGENTS.reduce((total, agent) => total + agent.tokens, 0),
    totalToolCalls: REVIEW_AGENTS.reduce((total, agent) => total + agent.toolCalls, 0),
  };
}

function lines(written: readonly string[]): string {
  return `${written.join('\n')}\n`;
}

// MARK: - `delegate the review`

/** What the scenario's subagent is asked, and what it finally says. */
export const DELEGATE_DESCRIPTION = 'Review the release notes wording';
const DELEGATE_PROMPT = 'Read RELEASE_NOTES.md as someone new to the app would, and list anything unclear.';
export const DELEGATE_RESULT = 'The notes read well. One suggestion: say what "pinned on first contact" means for someone who has never seen a host key prompt.';

/** The steps of the scenario's subagent, each a beat apart: start, work, finish. */
export interface DelegateStep {
  /** Lines for the main transcript. */
  main: string[];
  /** Lines appended to the subagent's own transcript. */
  agent: string[];
  /** The meta file, written with the first step. */
  meta: string | null;
}

/**
 * The scenario's subagent: its call and meta first, then a tool call in its
 * own transcript, then its answer there and its result in the main one, then
 * the main agent's closing line. A foreground agent, so its card runs until
 * the result lands.
 */
export function delegateSteps(toolUseId: string, agentId: string): ((uuid: () => string, timestamp: string) => DelegateStep)[] {
  const read = `${toolUseId}_read`;
  return [
    (uuid, timestamp) => ({
      main: [main('assistant', uuid(), timestamp, toolUse(toolUseId, 'Agent', {
        description: DELEGATE_DESCRIPTION, subagent_type: 'general-purpose', model: 'sonnet', prompt: DELEGATE_PROMPT,
      }))],
      agent: [agentLine(agentId, 'user', uuid(), timestamp, DELEGATE_PROMPT)],
      meta: `${JSON.stringify({
        agentType: 'general-purpose', description: DELEGATE_DESCRIPTION, toolUseId, spawnDepth: 1,
        requestShape: 'foreground', requestNonInteractive: true, model: 'sonnet',
      })}\n`,
    }),
    (uuid, timestamp) => ({
      main: [],
      agent: [
        agentLine(agentId, 'assistant', uuid(), timestamp, toolUse(read, 'Read', { file_path: 'RELEASE_NOTES.md' })),
        agentLine(agentId, 'user', uuid(), timestamp, toolResult(read, '# 0.11\n\n- Host keys are pinned on first contact…')),
      ],
      meta: null,
    }),
    (uuid, timestamp) => ({
      main: [
        main('user', uuid(), timestamp, toolResult(toolUseId, DELEGATE_RESULT)),
        main('assistant', uuid(), timestamp, [{ type: 'text', text: `The reviewer is done. ${DELEGATE_RESULT}` }]),
      ],
      agent: [agentLine(agentId, 'assistant', uuid(), timestamp, [{ type: 'text', text: DELEGATE_RESULT }])],
      meta: null,
    }),
  ];
}
