/**
 * The demo agent's longer tricks, each the shape a real Claude Code produces.
 *
 * They exist so every feature has a host to run against without SSH: a slash
 * command's panel, a question asked in several parts, a run of tool calls with
 * one failure, the folder-trust question a first start asks, a reply with a
 * table, a reply with two code blocks, an agent restyling the app through
 * the host's theme file, a "You should know" note offered on the host, a
 * subagent handed the review (its files in
 * subagents.ts), a `!` line run in the agent's shell, a long turn under
 * Claude's spinner. The UI tests drive the
 * Demo with the phrases below, and anyone
 * trying the Demo can type them too. Screens copy captures from Claude Code
 * 2.1.285 (see src/lib/__tests__/fixtures/screens), so the real parsers read
 * them without a special case.
 */

/** Typed into any demo chat, these start a scenario. */
export const DEMO_PHRASES = {
  questions: 'ask me two questions',
  tools: 'run the checks',
  trust: 'open a new folder',
  table: 'compare the options',
  code: 'show me the commands',
  theme: 'restyle the app',
  note: 'show me a note',
  delegate: 'delegate the review',
  think: 'think it over',
} as const;

// MARK: - Slash command panels

export interface ModelPanel {
  kind: 'model';
  /** Row under the cursor, 0-based. */
  cursor: number;
}

export interface EffortPanel {
  kind: 'effort';
  /** Index into EFFORT_LEVELS. */
  level: number;
}

export type DemoPanel = ModelPanel | EffortPanel;

export const DEMO_MODELS = [
  { name: 'Default (recommended)', detail: 'Opus 5 · Best for everyday, complex tasks', current: true },
  { name: 'Opus 5', detail: 'Best for everyday, complex tasks', current: false },
  { name: 'Sonnet 5', detail: 'Efficient for routine tasks', current: false },
  { name: 'Haiku 4.5', detail: 'Fastest for quick answers', current: false },
] as const;

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

const RULE = '▔'.repeat(96);

/** The panel `/model` opens, with the cursor on `cursor`. */
export function modelPanelScreen(panel: ModelPanel): string {
  return [
    RULE,
    '   Select model',
    '   Switch between Claude models. Your pick becomes the default for new sessions.',
    '',
    ...DEMO_MODELS.map((model, index) => {
      const lead = index === panel.cursor ? '   ❯ ' : '     ';
      const name = `${model.name}${model.current ? ' ✔' : ''}`.padEnd(25);
      return `${lead}${index + 1}. ${name}  ${model.detail}`;
    }),
    '',
    '   ● High effort ←/→ to adjust',
    '',
    '   Enter to set as default · s to use this session only · Esc to cancel',
  ].join('\n');
}

/** The slider `/effort` opens, with its marker over `level`. */
export function effortPanelScreen(panel: EffortPanel): string {
  const scale = '                             low     medium     high     xhigh      max';
  const word = EFFORT_LEVELS[panel.level] ?? 'high';
  // The marker sits over the middle of the level's word, as Claude draws it.
  const start = scale.indexOf(` ${word}`) + 1;
  const column = start + Math.floor(word.length / 2);
  const bar = `${' '.repeat(29)}${'─'.repeat(42)}`;
  const marked = `${bar.slice(0, column)}▲${bar.slice(column + 1)}      Ultracode  off`;
  return [
    RULE,
    '   Effort',
    '',
    '                             Faster                             Smarter',
    marked,
    `${scale}      Tab to toggle`,
    '',
    '   ←/→ to adjust · Enter to confirm · s for this session only · Esc to cancel',
  ].join('\n');
}

/** A panel's answer to a key: the panel after it, or what the command printed as it closed. */
export function panelKey(panel: DemoPanel, key: string): { panel: DemoPanel } | { printed: string } {
  if (key === 'Escape' || key === 'Esc') return { printed: 'Cancelled' };
  if (panel.kind === 'model') {
    if (key === 'Up') return { panel: { ...panel, cursor: Math.max(0, panel.cursor - 1) } };
    if (key === 'Down') return { panel: { ...panel, cursor: Math.min(DEMO_MODELS.length - 1, panel.cursor + 1) } };
    const name = DEMO_MODELS[panel.cursor]?.name ?? 'Default';
    if (key === 's') return { printed: `Set model to ${name} for this session only` };
    if (key === 'Enter') return { printed: `Set model to ${name} and saved as your default for new sessions` };
    return { panel };
  }
  if (key === 'Left') return { panel: { ...panel, level: Math.max(0, panel.level - 1) } };
  if (key === 'Right') return { panel: { ...panel, level: Math.min(EFFORT_LEVELS.length - 1, panel.level + 1) } };
  const level = EFFORT_LEVELS[panel.level] ?? 'high';
  if (key === 's') return { printed: `Set effort level to ${level} (this session only)` };
  if (key === 'Enter') return { printed: `Set effort level to ${level} (saved as your default for new sessions)` };
  return { panel };
}

/** The panel a command opens, or null for a command that only prints. */
export function panelFor(command: string): DemoPanel | null {
  const name = command.trim().split(/\s+/)[0];
  if (name === '/model') return { kind: 'model', cursor: 0 };
  if (name === '/effort') return { kind: 'effort', level: 2 };
  return null;
}

// MARK: - A long turn

/**
 * The pane while Claude works, as a phone read it in a report: the spinner,
 * the update notice right under it, the composer and the mode line. The live
 * preview took the spinner and the notice for the answer, and three working
 * lines showed for one turn. What the Demo shows while it thinks it over.
 */
export const DEMO_WORKING_SCREEN = [
  '❯ think it over',
  '',
  '✶ Propagating…',
  `${' '.repeat(60)}✔ Update installed · Restart to update`,
  '─'.repeat(96),
  '❯ ',
  '─'.repeat(96),
  '  ⏵⏵ accept edits on (shift+tab to cycle) · esc to interrupt',
].join('\n');

/**
 * The same for Grok, shaped like Grok 4.7's own screen: it keeps its reply
 * scrolled out of view, so only its scrollbar is beside the blank rows, then
 * its braille spinner and timer, and its composer box. The preview took the
 * spinner line for the answer (src/lib/__tests__/fixtures/screens/grok-*).
 */
export const DEMO_GROK_WORKING_SCREEN = [
  ...Array.from({ length: 6 }, () => `${' '.repeat(100)}█`),
  `   ⠙ Responding… 0.4s${' '.repeat(70)}14s ⇣24.4k [stop]`,
  `  ╭${'─'.repeat(96)}╮`,
  `  │ ❯${' '.repeat(94)}│`,
  `  ╰${'─'.repeat(60)} Grok 4.7 (xhigh) · always-approve ─╯`,
  '  Shift+Tab:mode  │  Ctrl+c:cancel  │  Ctrl+x:shortcuts',
].join('\n');

export const DEMO_THINK_REPLY = 'Thought it over. The plan holds: ship the fix first, then the follow-ups.';

// MARK: - A table

/**
 * A reply with a table, in the shape agents use to compare things. Each part
 * is one that used to push a row out of line with its header: columns of very
 * different widths, a cell long enough to wrap, a right-aligned number column,
 * bold and code in cells, and a pipe inside a code span.
 */
export const DEMO_TABLE_REPLY = [
  'Here is how the three ways in compare:',
  '',
  '| Option | Setup | Latency (ms) | Notes |',
  '|---|---|--:|---|',
  '| **SSH** | `ssh-keygen` | 38 | Works wherever the port is open; the host key is pinned on first contact. |',
  '| Tailscale | one login | 12 | Nothing exposed to the internet. |',
  '| Relay | none | 140 | Push only, never chat: `watcher | relay | APNs`. |',
  '',
  'Tailscale is the one to start with.',
].join('\n');

// MARK: - Code blocks

/**
 * A reply with two fenced blocks, a command and a config snippet, the shape
 * that showed "Copy code only" putting both on the clipboard at once. Each
 * block has its own Copy, and the long-press sheet a row for each.
 */
export const DEMO_CODE_REPLY = [
  'Check what changed first:',
  '',
  '```sh',
  'git status --short',
  '```',
  '',
  'Then set the theme in the config:',
  '',
  '```json',
  '{"theme": "dark"}',
  '```',
].join('\n');

// MARK: - A question in two parts

export const DEMO_QUESTIONS = [
  { question: 'Pick a color', options: ['Blue', 'Green'] },
  { question: 'Pick a size', options: ['Small', 'Large'] },
] as const;

/**
 * The pane while the agent waits on its questions: one question per step,
 * then the review screen that submits them.
 */
export function questionScreen(step: number, answers: readonly string[]): string {
  const tabs = `←  ${DEMO_QUESTIONS.map((q, index) => `${index < answers.length ? '☒' : '☐'} ${q.question.split(' ').pop()}`).join('  ')}  ✔ Submit  →`;
  const current = DEMO_QUESTIONS[step];
  if (current !== undefined) {
    return [
      tabs,
      '',
      current.question,
      ...current.options.map((option, index) => `${index === 0 ? '❯' : ' '} ${index + 1}. ${option}`),
      `  ${current.options.length + 1}. Type something.`,
      '',
      'Enter to select · Tab/Arrow keys to navigate · Esc to cancel',
    ].join('\n');
  }
  return [
    tabs,
    '',
    'Review your answers',
    ...DEMO_QUESTIONS.flatMap((q, index) => [` ● ${q.question}`, `   → ${answers[index] ?? ''}`]),
    '',
    'Ready to submit your answers?',
    '❯ 1. Submit answers',
    '  2. Cancel',
  ].join('\n');
}

/** The option a digit picks on a question step, or null for a key that picks nothing. */
export function questionAnswer(step: number, key: string): string | null {
  const options: readonly string[] = DEMO_QUESTIONS[step]?.options ?? [];
  return options[Number(key) - 1] ?? null;
}

// MARK: - Folder trust

/** The folder the trust scenario asks about. */
export const DEMO_TRUST_FOLDER = '/home/demo/youtube';

/** Rows of Claude's folder-trust menu, top to bottom. The cursor starts on the first. */
export const TRUST_OPTIONS = ['No, exit', 'Yes, I trust this folder'] as const;

/**
 * What Claude shows on a first start in a folder it has not been told to
 * trust (2.1.286): no numbers, a cursor, Enter takes its row. herdr reports
 * the agent idle with input pending, and refuses prompts until it is answered.
 */
export function trustScreen(cursor: number): string {
  return [
    '─'.repeat(96),
    ' Accessing workspace:',
    '',
    ` ${DEMO_TRUST_FOLDER}`,
    '',
    " Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source",
    " project, or work from your team). If not, take a moment to review what's in this folder first.",
    '',
    " Claude Code'll be able to read, edit, and execute files here.",
    '',
    ' Security guide',
    '',
    ...TRUST_OPTIONS.map((option, index) => `${index === cursor ? ' ❯ ' : '   '}${option}`),
    '',
    ' Enter to confirm · Esc to cancel',
  ].join('\n');
}

// MARK: - A theme written by the agent

/**
 * What the demo agent writes to ~/.herdrchat/theme.json when asked to restyle
 * the app: a warm accent far from the periwinkle, so a screenshot shows at a
 * glance that the theme took, and a name for Settings to show. White text
 * clears 4.5:1 on it, so the accent rule keeps it as the bubble unchanged.
 */
export const DEMO_THEME = {
  $schema: './theme.schema.json',
  name: 'Demo dusk',
  accent: '#B5562F',
} as const;

export const DEMO_THEME_TEXT = `${JSON.stringify(DEMO_THEME, null, 2)}\n`;

export const DEMO_THEME_REPLY = [
  `Done. I wrote ~/.herdrchat/theme.json with a warm dusk accent and named it "${DEMO_THEME.name}".`,
  '',
  'The app picks it up the next time its chat list is on screen (it checks about every 10 seconds there), or right away from Settings > Appearance > Reload theme.',
].join('\n');

// MARK: - You should know

/**
 * Where the demo's "You should know" store is: Claude Code's plugin store,
 * under the name the built-in plugin and its marketplace give it.
 */
export const DEMO_YSK_PATH = '/home/demo/.claude/plugins/store/cc-plugin-you-should-know_builtin-19776595df2c.json';

/** The Claude session the second note is for: one no demo chat runs, as another session on the computer. */
export const DEMO_YSK_ELSEWHERE = '9c1e44aa-0b7d-4e6f-9a21-3c5d7e8f9a0b';

/** The demo chat's note: a Heads up offered with its explanation. */
export const DEMO_YSK_LINE = 'The release notes were written from the merged pull requests only, so fixes pushed straight to main are missing.';
export const DEMO_YSK_EXPLANATION = [
  '**Some fixes are not in the notes**',
  '- The summary lists what was merged through pull requests since the last tag.',
  '- Two fixes went straight to main without one, so they are in the release but not in the notes.',
].join('\n');

/** The other session's note, already explained. */
export const DEMO_YSK_OTHER_LINE = 'Invoice totals are rounded per line, so a long invoice can be a few cents off its PDF.';
export const DEMO_YSK_OTHER_TEXT = [
  '**Rounding per line adds up**',
  'Each line is rounded to the cent before the lines are added, while the PDF rounds the total once.',
  '',
  'A 40-line invoice can differ by up to 20 cents.',
].join('\n');

/** A key the plugin may add that this app does not know: every write must keep it. */
export const DEMO_YSK_UNKNOWN_KEY = 'futureSetting';

/**
 * The store once the demo's agent has a note to offer (`DEMO_PHRASES.note`):
 * a Heads up for the chat that asked, with its explanation, so Learn more and
 * Discuss in chat have something to show; a "You should know" already
 * explained for a session no chat runs; and a row showing nothing. Plus the
 * plugin's other keys, the back-off counters a write resets, and a key this
 * app does not know, which a write must leave as it is.
 */
export function demoYskStore(chatSessionId: string, now: number): Record<string, unknown> {
  const minutes = 60_000;
  return {
    sessions: [
      {
        id: chatSessionId,
        tag: 'Heads up',
        askedTurn: 6,
        offeredTurn: 6,
        view: { kind: 'offer', line: DEMO_YSK_LINE, explanation: DEMO_YSK_EXPLANATION, shownAt: now - 2 * minutes, promptsSurvived: 0 },
      },
      {
        id: DEMO_YSK_ELSEWHERE,
        tag: 'You should know',
        checks: 3,
        view: { kind: 'explained', line: DEMO_YSK_OTHER_LINE, text: DEMO_YSK_OTHER_TEXT, iteration: 1, shownAt: now - 40 * minutes },
      },
      { id: '0d3c2b1a-9f8e-4d7c-8b6a-5f4e3d2c1b0a', checked: 12 },
    ],
    seen: [DEMO_YSK_OTHER_LINE, DEMO_YSK_LINE],
    known: [],
    typedPastInARow: 3,
    looksToSkip: 2,
    [DEMO_YSK_UNKNOWN_KEY]: { kept: true },
  };
}

export const DEMO_YSK_REPLY = [
  'Done. "You should know" has a note for you about these release notes, and another session on this computer has one too.',
  '',
  'Pull down on the chat list to have the app look for it now; it otherwise looks every ten minutes.',
].join('\n');

// MARK: - Shell mode

/**
 * What the demo agent's shell prints for a `!` line. `! ls` lists the notes
 * folder's three files, which the UI suite waits for; anything else says it
 * did not run, on stderr, so the block's stderr colour is there to look at.
 * The seeded `! git status --short` in the notes chat prints two lines.
 */
export const DEMO_LS_OUTPUT = 'CHANGELOG.md\nREADME.md\nrelease-notes.md';

export const DEMO_GIT_STATUS = { command: 'git status --short', stdout: ' M release-notes.md\n?? draft-0.12.md' } as const;

export function demoShellOutput(command: string): { stdout: string; stderr: string } {
  if (command.trim() === 'ls') return { stdout: DEMO_LS_OUTPUT, stderr: '' };
  return { stdout: '', stderr: `demo: ${command.trim()}: this is the demo host, so nothing ran` };
}
