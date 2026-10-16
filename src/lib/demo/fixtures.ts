/**
 * The fictional machine the demo connects to.
 *
 * Everything here is invented. The shapes are herdr's, so the real decoders in
 * `models.ts` accept them without a special case — if herdr's shape changes,
 * this fails the same way a real host would, which is the point of using the
 * real path rather than a mock.
 */

import { splitImages } from '../transcript/images';
import { projectDirName } from '../transcript/parser';
import { DEMO_GIT_STATUS } from './scenarios';
import { delegationSeed } from './subagents';

/** One agent pane on the demo host. */
export interface DemoPane {
  paneId: string;
  cwd: string;
  agentStatus: 'idle' | 'working' | 'blocked' | 'done';
  /**
   * Claude unless named; OMP reports its journal's path rather than an id,
   * and so would Gemini, once herdr keeps its session. opencode stands for an
   * agent the app has no reader for: its screen is its chat.
   */
  agent?: 'claude' | 'omp' | 'grok' | 'agy' | 'gemini' | 'opencode';
  /**
   * The title the session gave itself, which titles its chat. Left out on
   * two of them, so the Demo also shows a chat titled by its workspace.
   */
  title?: string;
}

/**
 * A pane with no agent in it: a shell, which the list shows as a terminal row
 * and the terminal screen attaches to (`src/lib/demo/terminal.ts`).
 */
export interface DemoShellPane {
  paneId: string;
  /** Its terminal, as the snapshot's `terminal_id`: what its terminal attaches by. */
  terminalId: string;
  cwd: string;
  /** The title the program gave its terminal, which its row and layout box show. */
  title?: string;
}

/**
 * One tab of a demo workspace, for the snapshot's `tabs` and `layouts`: its
 * label, and each pane's rect in cells (x, y, width, height) over a
 * `DEMO_TAB_COLUMNS` × `DEMO_TAB_ROWS` area, as herdr measures them.
 */
export interface DemoTab {
  label: string;
  panes: readonly { paneId: string; rect: readonly [number, number, number, number] }[];
  /** The pane the tab's focus is in; its first pane when left out. */
  focusedPaneId?: string;
  /** Zoomed on its focused pane. */
  zoomed?: boolean;
}

/** A demo tab's area, in cells: a laptop's terminal beside herdr's sidebar. */
export const DEMO_TAB_COLUMNS = 160;
export const DEMO_TAB_ROWS = 48;

/** A demo workspace: its first pane inline, any further agents in `morePanes`. */
export interface DemoWorkspace extends DemoPane {
  workspaceId: string;
  label: string;
  number: number;
  /** More agents in the same workspace, each a chat of its own in the list. */
  morePanes?: readonly DemoPane[];
  /** Panes with no agent, after the agents in herdr's order. */
  shellPanes?: readonly DemoShellPane[];
  /**
   * Its tabs, first active. Left out: one tab named after the workspace,
   * its panes side by side (`demoTabs`).
   */
  tabs?: readonly DemoTab[];
}

export const DEMO_WORKSPACES: readonly DemoWorkspace[] = [
  {
    workspaceId: 'w1',
    label: 'herdrchat',
    number: 1,
    paneId: 'w1:p1',
    cwd: '/home/demo/herdrchat',
    agentStatus: 'blocked',
    title: 'Folder picker read errors',
  },
  {
    workspaceId: 'w2',
    label: 'notes',
    number: 2,
    paneId: 'w2:p1',
    cwd: '/home/demo/notes',
    agentStatus: 'idle',
    title: 'Release notes summary',
  },
  {
    workspaceId: 'w3',
    label: 'scratch',
    number: 3,
    paneId: 'w3:p1',
    cwd: '/home/demo/scratch',
    agentStatus: 'done',
  },
  {
    workspaceId: 'w4',
    label: 'ledger',
    number: 4,
    paneId: 'w4:p1',
    cwd: '/home/demo/ledger',
    agentStatus: 'idle',
    agent: 'omp',
  },
  {
    workspaceId: 'w5',
    label: 'journal',
    number: 5,
    paneId: 'w5:p1',
    cwd: '/home/demo/journal',
    agentStatus: 'idle',
    title: 'Daily screen journal',
  },
  {
    // Two agents in one workspace, each its own chat. One is busy so the
    // workspace row has a state to aggregate.
    workspaceId: 'w6',
    label: 'api',
    number: 6,
    paneId: 'w6:p1',
    cwd: '/home/demo/api',
    agentStatus: 'idle',
    title: 'Archived projects migration',
    morePanes: [{ paneId: 'w6:p2', cwd: '/home/demo/api/web', agentStatus: 'working', title: 'Save button wrap' }],
    // A shell beside the two agents: the terminal row, and its recorded
    // screen. A second shell, a dev server, alone in a tab of its own.
    shellPanes: [
      { paneId: 'w6:p3', terminalId: 'term_w6_p3', cwd: '/home/demo/api' },
      { paneId: 'w6:p4', terminalId: 'term_w6_p4', cwd: '/home/demo/api/web', title: 'npm run dev' },
    ],
    // The layout view's two tabs: the agents side by side with the shell
    // under the first one, then the dev server's tab.
    tabs: [
      {
        label: 'api',
        panes: [
          { paneId: 'w6:p1', rect: [0, 0, 80, 32] },
          { paneId: 'w6:p3', rect: [0, 32, 80, 16] },
          { paneId: 'w6:p2', rect: [80, 0, 80, 48] },
        ],
        focusedPaneId: 'w6:p2',
      },
      { label: 'server', panes: [{ paneId: 'w6:p4', rect: [0, 0, 160, 48] }] },
    ],
  },
  {
    // One agent beside a shell: a space card titled by the workspace, with
    // the agent (still the workspace's chat) and then the terminal under it,
    // not the agent's own card with the terminal hanging off it.
    workspaceId: 'w7',
    label: 'site',
    number: 7,
    paneId: 'w7:p1',
    cwd: '/home/demo/site',
    agentStatus: 'idle',
    title: 'Landing page copy',
    shellPanes: [{ paneId: 'w7:p2', terminalId: 'term_w7_p2', cwd: '/home/demo/site' }],
    // The agent above, the shell in a strip below it.
    tabs: [{
      label: 'site',
      panes: [{ paneId: 'w7:p1', rect: [0, 0, 160, 32] }, { paneId: 'w7:p2', rect: [0, 32, 160, 16] }],
    }],
  },
  {
    // A Grok chat, read from its ACP update log. Untitled, so the chat is
    // named after its workspace.
    workspaceId: 'w8',
    label: 'infra',
    number: 8,
    paneId: 'w8:p1',
    cwd: '/home/demo/infra',
    agentStatus: 'idle',
    agent: 'grok',
  },
  {
    // An agent whose history the app cannot read: its chat is its screen.
    workspaceId: 'w9',
    label: 'docs',
    number: 9,
    paneId: 'w9:p1',
    cwd: '/home/demo/docs',
    agentStatus: 'idle',
    agent: 'opencode',
  },
  {
    // An Antigravity chat, read from agy's conversation log by its id.
    workspaceId: 'wA',
    label: 'assets',
    number: 10,
    paneId: 'wA:p1',
    cwd: '/home/demo/assets',
    agentStatus: 'idle',
    agent: 'agy',
  },
  {
    // A Gemini CLI chat, read from its session log by a reported path (as it reads once herdr keeps one).
    workspaceId: 'wB',
    label: 'scripts',
    number: 11,
    paneId: 'wB:p1',
    cwd: '/home/demo/scripts',
    agentStatus: 'idle',
    agent: 'gemini',
  },
];

/**
 * A demo workspace's tabs: its own, or one named after it with every pane
 * side by side in herdr's order (agents, then shells).
 */
export function demoTabs(workspace: DemoWorkspace): readonly DemoTab[] {
  if (workspace.tabs !== undefined) return workspace.tabs;
  const ids = [...demoPanes(workspace).map((pane) => pane.paneId), ...(workspace.shellPanes ?? []).map((pane) => pane.paneId)];
  const width = Math.floor(DEMO_TAB_COLUMNS / Math.max(1, ids.length));
  return [{
    label: workspace.label,
    panes: ids.map((paneId, index) => ({
      paneId,
      rect: [index * width, 0, index === ids.length - 1 ? DEMO_TAB_COLUMNS - index * width : width, DEMO_TAB_ROWS] as const,
    })),
  }];
}

/** The tab a demo pane is in, as herdr names it (`w6:t2`). */
export function demoTabId(workspace: DemoWorkspace, paneId: string): string {
  const index = demoTabs(workspace).findIndex((tab) => tab.panes.some((pane) => pane.paneId === paneId));
  return `${workspace.workspaceId}:t${Math.max(0, index) + 1}`;
}

/** Every agent pane of a demo workspace, first pane first. */
export function demoPanes(workspace: DemoWorkspace): DemoPane[] {
  const { paneId, cwd, agentStatus, agent, title } = workspace;
  return [{
    paneId, cwd, agentStatus, ...(agent === undefined ? {} : { agent }), ...(title === undefined ? {} : { title }),
  }, ...(workspace.morePanes ?? [])];
}

/** Where the OMP demo agent keeps its journal, which herdr reports as its session. */
export const DEMO_OMP_PATHS: Readonly<Record<string, string>> = {
  'w4:p1': '/home/demo/.omp/agent/sessions/--home-demo-ledger--/2026-09-28T09-00-00_44444444-4444-4444-8444-444444444444.jsonl',
};

/** The Grok session id each Grok pane reports: the name of its session folder. */
export const DEMO_GROK_SESSIONS: Readonly<Record<string, string>> = {
  'w8:p1': '01a13fe8-0000-7000-8000-000000000008',
};

/** Where Grok keeps a session: a folder named by its id, under one for its cwd. */
export function demoGrokPath(cwd: string, session: string): string {
  return `${DEMO_HOME}/.grok/sessions/${encodeURIComponent(cwd)}/${session}/updates.jsonl`;
}

/** The conversation id each Antigravity pane reports: the name of its folder under `brain`. */
export const DEMO_AGY_SESSIONS: Readonly<Record<string, string>> = {
  'wA:p1': '6e990404-0000-4000-8000-00000000000a',
};

/** Where agy keeps a conversation's log: a folder named by its id. */
export function demoAgyPath(session: string): string {
  return `${DEMO_HOME}/.gemini/antigravity-cli/brain/${session}/.system_generated/logs/transcript.jsonl`;
}

/** Where each Gemini pane's log is: the path its session report names. */
export const DEMO_GEMINI_PATHS: Readonly<Record<string, string>> = {
  'wB:p1': '/home/demo/.gemini/tmp/scripts/chats/session-2026-08-20T10-15-5c1e2d3a.jsonl',
};

/** The Claude session id each demo workspace reports, and therefore its transcript filename. */
export const DEMO_SESSION_IDS: Readonly<Record<string, string>> = {
  'w1:p1': '11111111-1111-4111-8111-111111111111',
  'w2:p1': '22222222-2222-4222-8222-222222222222',
  'w3:p1': '33333333-3333-4333-8333-333333333333',
  'w5:p1': '55555555-5555-4555-8555-555555555555',
  'w6:p1': '66666666-6666-4666-8666-666666666661',
  'w6:p2': '66666666-6666-4666-8666-666666666662',
  'w7:p1': '88888888-8888-4888-8888-888888888888',
};

export const DEMO_HOME = '/home/demo';

/**
 * A Claude demo pane's session folder, where its subagents and workflow runs
 * live: the transcript path without `.jsonl`. Null for a pane with no Claude
 * session (the OMP one).
 */
export function demoSessionDir(paneId: string): string | null {
  const pane = DEMO_WORKSPACES.flatMap(demoPanes).find((candidate) => candidate.paneId === paneId);
  const session = DEMO_SESSION_IDS[paneId];
  if (pane === undefined || session === undefined || pane.agent === 'omp') return null;
  return `${DEMO_HOME}/.claude/projects/${projectDirName(pane.cwd)}/${session}`;
}

// MARK: - Transcripts
//
// Claude Code's own JSONL, one object per line, so the real parser handles it
// with no special case. The emoji is deliberate: byte offsets are UTF-8 bytes
// and `String.length` is UTF-16 units, and a demo that quietly used only ASCII
// would skip the one rule most likely to break a reader.

interface Line {
  type: 'user' | 'assistant';
  uuid: string;
  timestamp: string;
  content: unknown;
  model?: string;
}

function line({ type, uuid, timestamp, content, model }: Line): string {
  const message: Record<string, unknown> = { role: type, content };
  if (model !== undefined) {
    message.model = model;
    message.usage = { input_tokens: 18_420, cache_read_input_tokens: 61_300 };
  }
  // Claude records the turn's effort beside the message; the header shows it.
  return JSON.stringify(model === undefined ? { type, uuid, timestamp, message } : { type, uuid, timestamp, effort: 'high', message });
}

const MODEL = 'claude-opus-5';

const SEEDS: Readonly<Record<string, readonly string[]>> = {
  'w1:p1': [
    line({
      type: 'user',
      uuid: 'd1-1',
      timestamp: '2026-08-19T09:12:04.000Z',
      content: 'the folder picker shows "No subfolders here" even when the read failed. can you look?',
    }),
    line({
      type: 'assistant',
      uuid: 'd1-2',
      timestamp: '2026-08-19T09:12:19.000Z',
      model: MODEL,
      content: [
        {
          type: 'text',
          text: "Found it. `listDirectories` appended `; true`, so an unreadable path exits 0 and an empty directory, a wrong path and a dropped connection all arrive looking identical.\n\nI'll split error from empty and give the error state a Retry.",
        },
      ],
    }),
    line({
      type: 'assistant',
      uuid: 'd1-3',
      timestamp: '2026-08-19T09:12:41.000Z',
      model: MODEL,
      content: [
        { type: 'tool_use', name: 'Read', input: { file_path: 'src/lib/herdr/client.ts' } },
      ],
    }),
    line({
      type: 'user',
      uuid: 'd1-4',
      timestamp: '2026-08-19T09:13:02.000Z',
      content: 'nice 🎯 ship it',
    }),
    line({
      type: 'assistant',
      uuid: 'd1-5',
      timestamp: '2026-08-19T09:13:30.000Z',
      model: MODEL,
      content: [
        {
          type: 'text',
          text: 'Before I change it, I’ll reproduce it: an unreadable folder should fail the directories test, not pass as an empty list.',
        },
      ],
    }),
  ],
  'w2:p1': [
    // A subagent that finished and a workflow still running, before the summary
    // the chat has always opened on (src/lib/demo/subagents.ts).
    ...delegationSeed(demoSessionDir('w2:p1') ?? ''),
    // A `!` command run in the agent's shell, with two lines of output.
    shellInputLine(DEMO_GIT_STATUS.command, 'd2-0g', '2026-08-19T08:35:00.000Z'),
    shellOutputLine(DEMO_GIT_STATUS.stdout, '', 'd2-0h', '2026-08-19T08:35:00.040Z'),
    line({
      type: 'user',
      uuid: 'd2-1',
      timestamp: '2026-08-19T08:40:00.000Z',
      content: 'summarise the release notes into three bullets',
    }),
    line({
      type: 'assistant',
      uuid: 'd2-2',
      timestamp: '2026-08-19T08:40:22.000Z',
      model: MODEL,
      content: [
        {
          type: 'text',
          text: '- Host keys are pinned on first contact and shown as `SHA256:…`\n- The transcript cursor no longer skips a message on a lossy decode\n- Blocked prompts disable their options while a reply is in flight',
        },
      ],
    }),
  ],
  'w3:p1': [
    line({
      type: 'user',
      uuid: 'd3-1',
      timestamp: '2026-08-19T07:05:00.000Z',
      content: 'scratch pad — nothing running here',
    }),
  ],
  'w6:p1': [
    line({
      type: 'user',
      uuid: 'd6a-1',
      timestamp: '2026-08-19T10:02:00.000Z',
      content: 'write the migration that adds archived_at to projects',
    }),
    line({
      type: 'assistant',
      uuid: 'd6a-2',
      timestamp: '2026-08-19T10:02:31.000Z',
      model: MODEL,
      content: [
        {
          type: 'text',
          text: 'Added `0042_projects_archived_at`: a nullable `archived_at` column and an index on it. Existing rows stay unarchived, so nothing needs a backfill.',
        },
      ],
    }),
  ],
  'w6:p2': [
    line({
      type: 'user',
      uuid: 'd6b-1',
      timestamp: '2026-08-19T10:05:00.000Z',
      content: 'the save button wraps onto two lines on a narrow screen',
    }),
    line({
      type: 'assistant',
      uuid: 'd6b-2',
      timestamp: '2026-08-19T10:05:20.000Z',
      model: MODEL,
      content: [
        {
          type: 'text',
          text: 'The label sits in a flex row with no `white-space: nowrap`, so the toolbar squeezes it. Fixing the CSS in `web/toolbar.css` now.',
        },
      ],
    }),
  ],
  'w7:p1': [
    line({
      type: 'user',
      uuid: 'd7-1',
      timestamp: '2026-08-19T11:00:00.000Z',
      content: 'tighten the landing page headline, it runs to three lines on a phone',
    }),
    line({
      type: 'assistant',
      uuid: 'd7-2',
      timestamp: '2026-08-19T11:00:18.000Z',
      model: MODEL,
      content: [
        {
          type: 'text',
          text: 'Cut it to "Your agents, in your pocket" and moved the rest into the subhead. It fits on two lines at 320pt; the dev server below is serving it.',
        },
      ],
    }),
  ],
};

// MARK: - A long history
//
// Longer than the window a thread opens with, so reading it to the start takes
// scrolling back through pages. Every day has the agent look at a screenshot,
// the way a session checking a simulator does: the picture comes back as
// base64 inside the transcript, twice, which is what made byte windows open on
// a dozen rows and page back one picture at a time.

/** Days in the journal; four transcript lines each. */
export const HISTORY_DAYS = 130;
const PICTURE = 'iVBORw0KGgoAAAANSUhEUgAA'.repeat(170);

function historyLines(): string[] {
  const lines: string[] = [];
  for (let day = 0; day < HISTORY_DAYS; day += 1) {
    const at = (second: number) => new Date(Date.UTC(2026, 6, 1, 9, 0, second) + day * 86_400_000).toISOString();
    const call = `toolu_h${day}`;
    lines.push(
      line({ type: 'user', uuid: `h${day}-q`, timestamp: at(0), content: day === 0 ? 'the first entry: start a journal' : `day ${day}: what changed on screen?` }),
      line({
        type: 'assistant', uuid: `h${day}-t`, timestamp: at(5), model: MODEL,
        content: [{ type: 'tool_use', id: call, name: 'Read', input: { file_path: `/tmp/day-${day}.png` } }],
      }),
      JSON.stringify({
        type: 'user', uuid: `h${day}-r`, timestamp: at(6),
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call, content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PICTURE } }] }] },
        toolUseResult: { type: 'image', file: { base64: PICTURE, type: 'image/png' } },
      }),
      line({
        type: 'assistant', uuid: `h${day}-a`, timestamp: at(20), model: MODEL,
        content: [{ type: 'text', text: day === 0 ? 'Journal started. I will note what each screenshot shows.' : `Day ${day}: the list kept its place and the header shows the model.` }],
      }),
    );
  }
  return lines;
}

// MARK: - OMP
//
// OMP's own journal (oh-my-pi), as the OMP parser reads it: a session header,
// then one record per message, tool results naming their call.

const OMP_MODEL = 'anthropic/claude-sonnet-5';

function ompRecord(id: string, timestamp: string, message: Record<string, unknown>): string {
  return JSON.stringify({ type: 'message', id, parentId: null, timestamp, message: { timestamp: Date.parse(timestamp), ...message } });
}

const OMP_SEED: readonly string[] = [
  JSON.stringify({ type: 'session', version: 3, id: '44444444-4444-4444-8444-444444444444', timestamp: '2026-08-19T08:00:00.000Z', cwd: '/home/demo/ledger' }),
  ompRecord('o-1', '2026-08-19T08:01:00.000Z', { role: 'user', content: 'why does the monthly total skip the last day?' }),
  ompRecord('o-2', '2026-08-19T08:01:10.000Z', {
    role: 'assistant', model: OMP_MODEL,
    content: [{ type: 'toolCall', id: 'o-call-1', name: 'read', arguments: { path: 'src/totals.ts' } }],
  }),
  ompRecord('o-3', '2026-08-19T08:01:11.000Z', { role: 'toolResult', toolCallId: 'o-call-1', toolName: 'read', content: [{ type: 'text', text: 'export function monthTotal(…)' }] }),
  ompRecord('o-4', '2026-08-19T08:01:20.000Z', {
    role: 'assistant', model: OMP_MODEL,
    content: [{ type: 'text', text: 'The range ends with `<` on the first of the month, so the last day is never counted. Changing it to `<=` on the last day fixes it.' }],
  }),
];

/** One more OMP user or assistant record, for when the demo is used. */
export function ompLine(role: 'user' | 'assistant', text: string, id: string, timestamp: string): string {
  return ompRecord(id, timestamp, role === 'user'
    ? { role, content: text }
    : { role, model: OMP_MODEL, content: [{ type: 'text', text }] });
}

// MARK: - Grok
//
// Grok's own log (`updates.jsonl`): ACP `session/update` notifications, one a
// line, each message whole, a tool's result its final update.

const GROK_MODEL = 'grok-5';

function grokUpdate(eventId: string, timestamp: string, update: Record<string, unknown>): string {
  const ms = Date.parse(timestamp);
  return JSON.stringify({
    timestamp: Math.floor(ms / 1000),
    method: 'session/update',
    params: { sessionId: DEMO_GROK_SESSIONS['w8:p1'], update, _meta: { eventId, agentTimestampMs: ms } },
  });
}

const GROK_SEED: readonly string[] = [
  grokUpdate('g-1', '2026-08-19T09:01:00.000Z', {
    sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'why does the deploy check fail every other run?' },
    _meta: { modelId: GROK_MODEL, promptIndex: 0 },
  }),
  grokUpdate('g-2', '2026-08-19T09:01:05.000Z', {
    sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Running the check twice to see what differs.' },
  }),
  grokUpdate('g-3', '2026-08-19T09:01:06.000Z', {
    sessionUpdate: 'tool_call', toolCallId: 'g-call-1', title: 'Run the deploy check',
    rawInput: { command: 'npm run check:deploy' }, _meta: { 'x.ai/tool': { name: 'run_terminal_command', kind: 'execute' } },
  }),
  grokUpdate('g-4', '2026-08-19T09:01:20.000Z', {
    sessionUpdate: 'tool_call_update', toolCallId: 'g-call-1', status: 'completed',
    content: [{ type: 'content', content: { type: 'text', text: 'health: 503 (warming up)' } }],
  }),
  grokUpdate('g-5', '2026-08-19T09:01:30.000Z', {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'The check runs before the service has warmed up, so the first probe gets a 503. Waiting for `/ready` before probing fixes it.' },
  }),
];

/** One more Grok prompt or reply, for when the demo is used. */
export function grokLine(role: 'user' | 'assistant', text: string, id: string, timestamp: string): string {
  return grokUpdate(id, timestamp, role === 'user'
    ? { sessionUpdate: 'user_message_chunk', content: { type: 'text', text }, _meta: { modelId: GROK_MODEL } }
    : { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
}

// MARK: - Antigravity
//
// agy's own log (`transcript.jsonl`): one step a line, the person's input, the
// model's turn with its tool calls, a tool's output (agy 1.3.6).

function agyStep(index: number, timestamp: string, type: string, fields: Record<string, unknown>): string {
  return JSON.stringify({
    step_index: index,
    source: type === 'USER_INPUT' ? 'USER_EXPLICIT' : 'MODEL',
    type,
    status: 'DONE',
    created_at: timestamp,
    ...fields,
  });
}

function agyPrompt(index: number, timestamp: string, text: string, model: string | null = null): string {
  const change = model === null ? '' : `\n<USER_SETTINGS_CHANGE>\nThe user changed setting \`Model Selection\` from None to ${model}. No need to comment on this change if the user doesn't ask about it.\n</USER_SETTINGS_CHANGE>`;
  return agyStep(index, timestamp, 'USER_INPUT', {
    content: `<USER_REQUEST>\n${text}\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: ${timestamp}.\n</ADDITIONAL_METADATA>${change}`,
  });
}

const AGY_SEED: readonly string[] = [
  agyPrompt(0, '2026-08-19T09:20:00Z', 'which icon sizes does the app still need?', 'Gemini 3.8 Flash (High)'),
  agyStep(1, '2026-08-19T09:20:04Z', 'PLANNER_RESPONSE', {
    input_tokens: 11_831, cache_read_tokens: 0, output_tokens: 203,
    thinking: 'Listing what is in the icon folder first.',
    tool_calls: [{
      name: 'run_command',
      args: { CommandLine: '"ls assets/icons"', Cwd: '"/home/demo/assets"', toolAction: '"Listing icons"', toolSummary: '"List icons"' },
    }],
  }),
  agyStep(2, '2026-08-19T09:20:06Z', 'GENERIC', {
    content: 'Created At: 2026-08-19T09:20:06Z\nCompleted At: 2026-08-19T09:20:06Z\n\nThe command exited with code 0.\nOutput:\nicon-1024.png\r\nicon-180.png\r\n',
  }),
  agyStep(3, '2026-08-19T09:20:12Z', 'PLANNER_RESPONSE', {
    input_tokens: 2_791, cache_read_tokens: 18_559, output_tokens: 160,
    content: 'Only 1024 and 180 are there. The 120 and 87 point sizes are missing, so the build falls back to scaling the 180.',
  }),
];

/** One more Antigravity step, a prompt or a reply, for when the demo is used. */
export function agyLine(role: 'user' | 'assistant', text: string, index: number, timestamp: string): string {
  return role === 'user'
    ? agyPrompt(index, timestamp, text)
    : agyStep(index, timestamp, 'PLANNER_RESPONSE', { input_tokens: 21_400, cache_read_tokens: 0, content: text });
}

// MARK: - Gemini CLI
//
// Gemini's session log: its metadata, then a message a line, written again
// under its id as it changes. The reply's tool call and its result arrive as
// the same message a second time (Gemini CLI 0.64).

const GEMINI_MODEL = 'gemini-3-pro-preview';

function geminiMessage(id: string, timestamp: string, type: 'user' | 'gemini', fields: Record<string, unknown>): string {
  return JSON.stringify({ id, timestamp, type, ...fields });
}

/** The reply's tool call, done: its result is what Gemini gave the model. */
const GEMINI_CALL = {
  id: 'run_shell_command_1',
  name: 'run_shell_command',
  args: { command: './deploy.sh --dry-run', description: 'Dry-run the deploy' },
  result: [{ functionResponse: { id: 'run_shell_command_1', name: 'run_shell_command', response: {
    output: '<untrusted_context>\nOutput: ./deploy.sh: line 12: jq: command not found\nExit Code: 127\n</untrusted_context>',
  } } }],
  status: 'success',
  timestamp: '2026-08-20T10:15:31Z',
};

const GEMINI_REPLY = {
  content: 'Running it the way CI does.',
  thoughts: [{ subject: 'Reproducing', description: 'A dry run shows the first failing step.', timestamp: '2026-08-20T10:15:24Z' }],
  tokens: { input: 9_412, output: 61, cached: 0, thoughts: 120, tool: 0, total: 9_593 },
  model: GEMINI_MODEL,
};

const GEMINI_SEED: readonly string[] = [
  JSON.stringify({ sessionId: '5c1e2d3a-0000-4000-8000-00000000000b', projectHash: 'd3m0', startTime: '2026-08-20T10:15:00Z', lastUpdated: '2026-08-20T10:15:00Z', kind: 'main' }),
  geminiMessage('env-context', '2026-08-20T10:15:00Z', 'user', {
    content: [{ text: '<session_context>\nThis is the Gemini CLI. We are setting up the context for our chat.\n</session_context>' }],
  }),
  geminiMessage('g-u1', '2026-08-20T10:15:20Z', 'user', { content: [{ text: 'why does deploy.sh fail on a clean checkout?' }] }),
  JSON.stringify({ $set: { lastUpdated: '2026-08-20T10:15:20Z' } }),
  geminiMessage('g-a1', '2026-08-20T10:15:26Z', 'gemini', GEMINI_REPLY),
  // The same reply once its call is done: Gemini writes the whole message again.
  geminiMessage('g-a1', '2026-08-20T10:15:26Z', 'gemini', { ...GEMINI_REPLY, toolCalls: [GEMINI_CALL] }),
  // What Gemini sends the model back: a tool's answer, no one's message.
  geminiMessage('g-u2', '2026-08-20T10:15:31Z', 'user', { content: GEMINI_CALL.result }),
  geminiMessage('g-a2', '2026-08-20T10:15:38Z', 'gemini', {
    content: 'It calls `jq` on line 12, and a clean machine has none. Install it, or let the script parse with python3.',
    tokens: { input: 10_207, output: 44, cached: 8_192, thoughts: 0, tool: 0, total: 10_251 },
    model: GEMINI_MODEL,
  }),
];

/** One more Gemini message, a prompt or a reply, for when the demo is used. */
export function geminiLine(role: 'user' | 'assistant', text: string, id: string, timestamp: string): string {
  return role === 'user'
    ? geminiMessage(id, timestamp, 'user', { content: [{ text }] })
    : geminiMessage(id, timestamp, 'gemini', { content: text, model: GEMINI_MODEL, tokens: { input: 10_400, output: 20, cached: 0, thoughts: 0, tool: 0, total: 10_420 } });
}

/** The session id opencode's integration reports; no reader opens it. */
export const DEMO_SCREEN_SESSION = 'ses_demo9docs';

/** What an agent with no reader shows on its screen when the Demo starts. */
const SCREEN_SEED = [
  '┃  opencode',
  '',
  '> tidy the install section of the README',
  '',
  'Moved the Homebrew steps first and cut the duplicate PATH note.',
  '  README.md  +6 -11',
].join('\n');

/** The transcript a demo pane starts with, as the file's contents. */
export function transcriptFor(paneId: string): string {
  if (paneId === 'w9:p1') return `${SCREEN_SEED}\n`;
  if (DEMO_OMP_PATHS[paneId] !== undefined) return `${OMP_SEED.join('\n')}\n`;
  if (DEMO_GROK_SESSIONS[paneId] !== undefined) return `${GROK_SEED.join('\n')}\n`;
  if (DEMO_AGY_SESSIONS[paneId] !== undefined) return `${AGY_SEED.join('\n')}\n`;
  if (DEMO_GEMINI_PATHS[paneId] !== undefined) return `${GEMINI_SEED.join('\n')}\n`;
  const lines = paneId === 'w5:p1' ? historyLines() : SEEDS[paneId] ?? [];
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/** One more assistant turn, for when the demo agent "replies". */
export function replyLine(text: string, uuid: string, timestamp: string): string {
  return line({ type: 'assistant', uuid, timestamp, model: MODEL, content: [{ type: 'text', text }] });
}

/** The user's own turn, appended when they send from the composer. */
export function userLine(text: string, uuid: string, timestamp: string): string {
  return line({ type: 'user', uuid, timestamp, content: text });
}

/**
 * What the demo agent says back.
 *
 * Deliberately not a canned sentence: it quotes the person, so it is obvious
 * the message travelled rather than a fixture being revealed on a timer.
 */
export function replyFor(prompt: string): string {
  // Pictures travel as paths; the demo talks about them as pictures.
  const { text, paths } = splitImages(prompt);
  const quoted = text.slice(0, 80);
  const pictures = paths.length === 0 ? '' : paths.length === 1 ? 'a picture' : `${paths.length} pictures`;
  const said = quoted && pictures ? `You said “${quoted}” and sent ${pictures}.` : quoted ? `You said “${quoted}”.` : `You sent ${pictures}.`;
  return `${said}\n\nThis is the demo host, so nothing actually ran, but everything above this line is the real app: the transcript reader, the live tail and the byte cursor all did their normal work to put this on your screen.`;
}

/** What the demo agent says once a menu choice has been tapped. */
export function answeredReply(choice: string): string {
  return choice === '1'
    ? 'Going ahead. The repro failed as expected: the unreadable folder came back as an empty list. Split the error state from the empty one and gave the error a Retry, so a failed read stops looking like an empty folder.'
    : 'Holding off on the repro. Say the word when you want it run.';
}

/**
 * Claude's visible screen on the blocked pane: a Bash permission prompt in the
 * shape Claude Code 2.1.299 draws it in an 80-column pane (rebuilt from a real
 * capture, `permission-bash-tip-120`, with the Tip left out as when auto mode is
 * not on offer): the rule, the tool and its description, the command between
 * dashed rules in its `│ ` margin and wrapped at the pane's edge, the "could
 * not be checked" note, the auto-deny line (wrapped too), the question and its
 * menu. The parser reads the details from exactly this, and the blocked bar
 * shows them above the question.
 */
export const DEMO_BLOCKED_SCREEN = [
  '⏺ Bash(mkdir -p /tmp/demo-unreadable && chmod 000 /tmp/demo-unreadable && …)',
  '  ⎿  Waiting…',
  '',
  '────────────────────────────────────────────────────────────────────────────────',
  ' Bash command',
  ' Reproduce the empty-folder bug against an unreadable folder',
  '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
  ' │ mkdir -p /tmp/demo-unreadable && chmod 000 /tmp/demo-unreadable && npx jest',
  ' │ src/lib/__tests__/directories.test.ts; rm -rf /tmp/demo-unreadable',
  '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
  ' This command runs rm and could not be checked',
  ' ⚠ Claude Code will automatically deny this request in 1:32, to avoid blocking',
  ' progress on an unattended session',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. No',
  '',
  ' Esc to cancel · Tab to amend',
].join('\n');

/**
 * What Claude records for a slash command once it has run: the command as
 * typed, then what it printed. Both are `user` turns, as in a real transcript.
 */
export function commandLines(command: string, printed: string, uuids: [string, string], timestamp: string): string[] {
  const [name = '', ...args] = command.trim().split(/\s+/);
  const typed = `<command-name>${name}</command-name>\n<command-message>${name.slice(1)}</command-message>\n<command-args>${args.join(' ')}</command-args>`;
  return [
    line({ type: 'user', uuid: uuids[0], timestamp, content: typed }),
    line({ type: 'user', uuid: uuids[1], timestamp, content: `<local-command-stdout>${printed}</local-command-stdout>` }),
  ];
}

/**
 * What Claude records for a `!` line: the command, with a leading space as
 * Claude Code 2.1.286 wrote it (other versions write none), then what it
 * printed. Both are `user` turns, back to back, as in a real transcript.
 * The output is escaped as Claude escapes it (`&`, `<`, `>`); the command is not.
 */
export function shellInputLine(command: string, uuid: string, timestamp: string): string {
  return line({ type: 'user', uuid, timestamp, content: `<bash-input> ${command}</bash-input>` });
}

export function shellOutputLine(stdout: string, stderr: string, uuid: string, timestamp: string): string {
  const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return line({ type: 'user', uuid, timestamp, content: `<bash-stdout>${escape(stdout)}</bash-stdout><bash-stderr>${escape(stderr)}</bash-stderr>` });
}

/** An assistant turn that is one tool call. */
export function toolUseLine(name: string, input: Record<string, unknown>, id: string, uuid: string, timestamp: string): string {
  return line({ type: 'assistant', uuid, timestamp, model: MODEL, content: [{ type: 'tool_use', id, name, input }] });
}

/** A tool's result, which Claude writes as a `user` turn. */
export function toolResultLine(id: string, text: string, isError: boolean, uuid: string, timestamp: string): string {
  return line({
    type: 'user',
    uuid,
    timestamp,
    content: [{ type: 'tool_result', tool_use_id: id, content: text, ...(isError ? { is_error: true } : {}) }],
  });
}

// MARK: - A machine saved on the demo host
//
// The demo host has one machine saved on it, as a real host has after
// `herdr machine add nuku`. Its commands reach a second `DemoHost` built from
// the set below, through the same jump a real host's `ssh` would run, so the
// machine's chat goes through the real wrapper, reader and tail.

/** Everything one demo machine is made of. `DemoHost` takes one of these. */
export interface DemoFixtures {
  workspaces: readonly DemoWorkspace[];
  /** The Claude session id each pane reports, and therefore its transcript filename. */
  sessionIds: Readonly<Record<string, string>>;
  /** Where an OMP pane keeps its journal. */
  ompPaths: Readonly<Record<string, string>>;
  /** The session id each Grok pane reports. */
  grokSessions: Readonly<Record<string, string>>;
  /** The conversation id each Antigravity pane reports. */
  agySessions: Readonly<Record<string, string>>;
  /** Where a Gemini pane keeps its log, which its session report names. */
  geminiPaths: Readonly<Record<string, string>>;
  /** The transcript a pane starts with, as the file's contents. */
  transcript: (paneId: string) => string;
  /** The pane herdr reports as focused. */
  focusedPaneId: string;
  /** The machines saved on this one, as `herdr machine list --json` lists them. */
  machines: readonly DemoMachine[];
}

/** A machine saved on a demo host, and the demo machine behind it. */
export interface DemoMachine {
  id: string;
  label: string;
  target: string;
  session: string;
  enabled: boolean;
  fixtures: DemoFixtures;
}

export const DEMO_NUKU_WORKSPACES: readonly DemoWorkspace[] = [
  {
    workspaceId: 'w1',
    label: 'kenneth-bot',
    number: 1,
    paneId: 'w1:p1',
    cwd: '/home/demo/kenneth-bot',
    agentStatus: 'idle',
    title: 'Nightly digest',
  },
];

export const DEMO_NUKU_SESSION_IDS: Readonly<Record<string, string>> = {
  'w1:p1': '77777777-7777-4777-8777-777777777777',
};

const NUKU_SEEDS: Readonly<Record<string, readonly string[]>> = {
  'w1:p1': [
    line({
      type: 'user',
      uuid: 'n1-1',
      timestamp: '2026-08-19T06:00:00.000Z',
      content: 'run the nightly digest and tell me what stood out',
    }),
    line({
      type: 'assistant',
      uuid: 'n1-2',
      timestamp: '2026-08-19T06:00:41.000Z',
      model: MODEL,
      content: [
        {
          type: 'text',
          text: 'Digest is out. Two things stood out: the backup job ran twice, and three issues were closed without a linked change. Everything else was routine.',
        },
      ],
    }),
  ],
};

/** The demo host's machine `nuku`: one workspace, one idle Claude chat. */
export const DEMO_NUKU: DemoFixtures = {
  workspaces: DEMO_NUKU_WORKSPACES,
  sessionIds: DEMO_NUKU_SESSION_IDS,
  ompPaths: {},
  grokSessions: {},
  agySessions: {},
  geminiPaths: {},
  transcript: (paneId) => {
    const lines = NUKU_SEEDS[paneId] ?? [];
    return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
  },
  focusedPaneId: 'w1:p1',
  machines: [],
};

/** The machines saved on the demo host. */
export const DEMO_MACHINES: readonly DemoMachine[] = [
  { id: 'demo-nuku', label: 'nuku', target: 'nuku', session: 'default', enabled: true, fixtures: DEMO_NUKU },
];

/** The demo host itself. */
export const DEMO_HOST: DemoFixtures = {
  workspaces: DEMO_WORKSPACES,
  sessionIds: DEMO_SESSION_IDS,
  ompPaths: DEMO_OMP_PATHS,
  grokSessions: DEMO_GROK_SESSIONS,
  agySessions: DEMO_AGY_SESSIONS,
  geminiPaths: DEMO_GEMINI_PATHS,
  transcript: transcriptFor,
  focusedPaneId: 'w1:p1',
  machines: DEMO_MACHINES,
};
