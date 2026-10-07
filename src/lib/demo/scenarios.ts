/**
 * The demo agent's longer tricks, each the shape a real Claude Code produces.
 *
 * They exist so every feature has a host to run against without SSH: a slash
 * command's panel, a question asked in several parts, a run of tool calls with
 * one failure, the folder-trust question a first start asks, a reply with a
 * table. The UI tests drive the Demo with the phrases below, and anyone
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
