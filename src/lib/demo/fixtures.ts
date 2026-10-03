/**
 * The fictional machine the demo connects to.
 *
 * Everything here is invented. The shapes are herdr's, so the real decoders in
 * `models.ts` accept them without a special case — if herdr's shape changes,
 * this fails the same way a real host would, which is the point of using the
 * real path rather than a mock.
 */

import { splitImages } from '../transcript/images';

export interface DemoWorkspace {
  workspaceId: string;
  label: string;
  number: number;
  paneId: string;
  cwd: string;
  agentStatus: 'idle' | 'working' | 'blocked' | 'done';
  /** Claude unless named; OMP reports its journal's path rather than an id. */
  agent?: 'claude' | 'omp';
}

export const DEMO_WORKSPACES: readonly DemoWorkspace[] = [
  {
    workspaceId: 'w1',
    label: 'herdrchat',
    number: 1,
    paneId: 'w1:p1',
    cwd: '/home/demo/herdrchat',
    agentStatus: 'blocked',
  },
  {
    workspaceId: 'w2',
    label: 'notes',
    number: 2,
    paneId: 'w2:p1',
    cwd: '/home/demo/notes',
    agentStatus: 'idle',
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
  },
];

/** Where the OMP demo agent keeps its journal, which herdr reports as its session. */
export const DEMO_OMP_PATHS: Readonly<Record<string, string>> = {
  'w4:p1': '/home/demo/.omp/agent/sessions/--home-demo-ledger--/2026-09-28T09-00-00_44444444-4444-4444-8444-444444444444.jsonl',
};

/** The Claude session id each demo workspace reports, and therefore its transcript filename. */
export const DEMO_SESSION_IDS: Readonly<Record<string, string>> = {
  'w1:p1': '11111111-1111-4111-8111-111111111111',
  'w2:p1': '22222222-2222-4222-8222-222222222222',
  'w3:p1': '33333333-3333-4333-8333-333333333333',
  'w5:p1': '55555555-5555-4555-8555-555555555555',
};

export const DEMO_HOME = '/home/demo';

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
          text: 'Before I write to `client.ts`: this changes what every caller of `listDirectories` sees on failure. Want me to go ahead?',
        },
      ],
    }),
  ],
  'w2:p1': [
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

/** The transcript a demo pane starts with, as the file's contents. */
export function transcriptFor(paneId: string): string {
  if (DEMO_OMP_PATHS[paneId] !== undefined) return `${OMP_SEED.join('\n')}\n`;
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
    ? 'Going ahead. Split the error state from the empty one and gave the error a Retry, so a failed read stops looking like an empty folder.'
    : 'Holding off. The change would alter what every caller of listDirectories sees on failure. Say the word when you want it.';
}

/**
 * Claude's visible screen on the blocked pane.
 *
 * The shape the real parser expects: the question, then a numbered menu, with
 * the selection marker Claude draws on the focused row.
 */
export const DEMO_BLOCKED_SCREEN = [
  '╭──────────────────────────────────────────────╮',
  '│ Edit file                                    │',
  '╰──────────────────────────────────────────────╯',
  '',
  'src/lib/herdr/client.ts',
  '',
  'Before I write to client.ts: this changes what every caller of',
  'listDirectories sees on failure. Want me to go ahead?',
  '',
  '❯ 1. Yes, go ahead',
  '  2. No, tell me more first',
  '',
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
