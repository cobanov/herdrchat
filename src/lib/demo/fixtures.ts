/**
 * The fictional machine the demo connects to.
 *
 * Everything here is invented. The shapes are herdr's, so the real decoders in
 * `models.ts` accept them without a special case — if herdr's shape changes,
 * this fails the same way a real host would, which is the point of using the
 * real path rather than a mock.
 */

export interface DemoWorkspace {
  workspaceId: string;
  label: string;
  number: number;
  paneId: string;
  cwd: string;
  agentStatus: 'idle' | 'working' | 'blocked' | 'done';
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
];

/** The Claude session id each demo workspace reports, and therefore its transcript filename. */
export const DEMO_SESSION_IDS: Readonly<Record<string, string>> = {
  'w1:p1': '11111111-1111-4111-8111-111111111111',
  'w2:p1': '22222222-2222-4222-8222-222222222222',
  'w3:p1': '33333333-3333-4333-8333-333333333333',
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
  return JSON.stringify({ type, uuid, timestamp, message });
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
          text: 'Before I write to `client.ts` — this changes what every caller of `listDirectories` sees on failure. Want me to go ahead?',
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

/** The transcript a demo pane starts with, as the file's contents. */
export function transcriptFor(paneId: string): string {
  const lines = SEEDS[paneId] ?? [];
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
  const quoted = prompt.trim().slice(0, 80);
  return `You said “${quoted}”.\n\nThis is the demo host, so nothing actually ran — but everything above this line is the real app: the transcript reader, the live tail and the byte cursor all did their normal work to put this on your screen.`;
}

/** What the demo agent says once a menu choice has been tapped. */
export function answeredReply(choice: string): string {
  return choice === '1'
    ? 'Going ahead. Split the error state from the empty one and gave the error a Retry, so a failed read stops looking like an empty folder.'
    : 'Holding off. The change would alter what every caller of listDirectories sees on failure — say the word when you want it.';
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
  'Before I write to client.ts — this changes what every caller of',
  'listDirectories sees on failure. Want me to go ahead?',
  '',
  '❯ 1. Yes, go ahead',
  '  2. No, tell me more first',
  '',
].join('\n');
