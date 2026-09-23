/**
 * "The agent is waiting for input" parsing.
 *
 * When Claude blocks on a permission prompt or an AskUserQuestion, the choices
 * only exist on the pane's visible screen. Parsing them is what lets the
 * quick-reply bar show what each option actually does instead of bare "1 / 2"
 * chips.
 *
 * Behaviour ported from the original SwiftUI implementation (see git
 * history before the Expo rewrite).
 */

import { BORDER_CHARS, clean, stripAnsi } from './ansi';

/** One selectable choice: the keys to send and the label to show. */
export interface BlockedOption {
  /** 1-based menu index. */
  number: number;
  /** e.g. "Yes, and don't ask again". */
  label: string;
  /** A multi-select row: whether it is ticked. Absent on an ordinary option. */
  checked?: boolean;
}

export interface BlockedPrompt {
  question: string | null;
  options: BlockedOption[];
  /**
   * The only safe answer is to close it (Esc). Set for Codex's file-mention
   * popup, which herdr counts as blocked (herdr #4495): Enter or a digit there
   * would pick a file into the prompt rather than answer anything.
   */
  dismissOnly?: boolean;
  /**
   * Claude's multi-select question: a digit ticks or unticks its row and
   * nothing is sent until "Continue" moves on to the review screen.
   */
  multiSelect?: boolean;
  /**
   * Whether a digit needs Enter behind it. False for Claude, which acts on the
   * digit alone; the Enter then lands on whatever comes next (#107). True
   * (the default) for Codex, whose own trust menu only moves the cursor on a
   * digit.
   */
  submitWithEnter?: boolean;
}

/**
 * Codex's `@` mention picker, recognised the way herdr's own manifest does it:
 * all three of its tab labels on screen at once.
 */
export function isMentionPopup(screen: string): boolean {
  return ['All Results', 'Filesystem Only', 'Plugins'].every((label) => screen.includes(label));
}

/**
 * Keys that submit a choice, or `null` when the choice cannot be typed at all.
 *
 * The digit, then Enter, except where the digit alone is the answer:
 *
 * - Claude acts on a numbered menu the instant a digit arrives (measured on
 *   2.1.280 for permission prompts and AskUserQuestion). The Enter behind it
 *   was harmless under a single question, landing in an empty composer, but
 *   under several it picked the NEXT question's highlighted option unasked.
 * - A multi-select row: the digit ticks it, and Enter ticks whichever row the
 *   cursor is on, so digit plus Enter changed two answers.
 *
 * Codex needs the Enter: its approval overlay acts on the digit, but its trust
 * menu only moves the cursor.
 *
 * There is no way to type "10" into one of these menus. Claude acts on a
 * numbered menu the instant a digit arrives, so `1` selects option 1 and closes
 * the menu, and the `0` and the Enter behind it land in the composer and submit
 * a bare "0". Tapping option 10 therefore committed option 1 AND took a stray
 * turn, and the pending spinner marked the row the user tapped while the wrong
 * option was already running.
 *
 * Sending one key per digit was an attempt to fix that and made it worse. So
 * this refuses instead: a menu that long is rare, and answering it in the
 * terminal is a much better outcome than answering it incorrectly from a phone.
 *
 * (Driving the selection cursor with arrow keys would genuinely work and is the
 * obvious next step — but it cannot be verified without a real agent showing a
 * ten-option menu, and guessing at key sequences aimed into a live agent is the
 * exact failure this function already has one of.)
 */
export function optionKeys(
  option: BlockedOption,
  prompt?: Pick<BlockedPrompt, 'multiSelect' | 'submitWithEnter'>
): string[] | null {
  if (!Number.isInteger(option.number) || option.number < 1 || option.number > 9) return null;
  const digit = String(option.number);
  if (prompt?.multiSelect === true || prompt?.submitWithEnter === false) return [digit];
  return [digit, 'Enter'];
}

/** Moves a multi-select question on: to the next question, or to the review. */
export const CONTINUE_KEYS: readonly string[] = ['Right'];

/**
 * Parse the tail of an agent pane into a question plus numbered options.
 * Returns a prompt with no options when the buffer holds no recognizable menu;
 * the UI then falls back to its generic chips rather than inventing choices.
 */
export function parseBlockedPrompt(raw: string): BlockedPrompt {
  const rawLines = raw.split('\n').map(stripAnsi);
  const lines = rawLines.map(clean);

  const options: BlockedOption[] = [];
  let firstOptionLine: number | null = null;
  /** Where the current menu's numbers start, in columns. */
  let menuColumn: number | null = null;
  /** Whether the lines since the last option still belong to it. */
  let underOption = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.length === 0) {
      underOption = false;
      continue;
    }
    // Indented past the numbers, straight under an option: that option's
    // description, the rest of a wrapped label, or a preview panel. Never a
    // new option, even when it starts "1." — an AskUserQuestion description
    // that did reset the menu and took option 1's place (#107).
    const column = contentColumn(rawLines[index] ?? '');
    if (underOption && menuColumn !== null && column > menuColumn) continue;
    const option = parseOption(line);
    if (option === null) {
      underOption = false;
      continue;
    }
    // Keep the LAST contiguous menu: a later menu supersedes an earlier one
    // still lingering in the scrollback.
    const last = options[options.length - 1];
    if (last !== undefined && option.number <= last.number) {
      options.length = 0;
      firstOptionLine = index;
    }
    if (firstOptionLine === null) firstOptionLine = index;
    options.push(option);
    menuColumn = column;
    underOption = true;
  }

  if (options.length === 0 || firstOptionLine === null) {
    return { question: null, options: [] };
  }

  // Question: the contiguous non-empty text lines immediately above the first
  // option, oldest first.
  const questionLines: string[] = [];
  let cursor = firstOptionLine - 1;
  while (cursor >= 0 && (lines[cursor] ?? '').length === 0) cursor -= 1;
  while (cursor >= 0) {
    const line = lines[cursor] ?? '';
    if (line.length === 0 || parseOption(line) !== null) break;
    questionLines.unshift(line);
    cursor -= 1;
  }

  const question = questionLines.join(' ').trim();
  const multiSelect = options.some((option) => option.checked !== undefined);
  return {
    question: question.length > 0 ? question : null,
    options,
    ...(multiSelect ? { multiSelect } : {}),
  };
}

export function isBlockedPromptEmpty(prompt: BlockedPrompt | null): boolean {
  return prompt === null || prompt.options.length === 0;
}

/**
 * A blocked-prompt reply in flight: keys were sent to the pane, but no poll has
 * yet observed the agent act on them. While one exists the options stay
 * disabled — the gap between a tap and the next status poll is otherwise wide
 * enough (up to ten seconds on the slowest poll setting) for a second tap to
 * push a second digit + Enter into a live agent.
 */
export interface BlockedPending {
  /** Exactly what was sent, so the UI can mark the tapped choice. */
  keys: readonly string[];
  /** Signature of the prompt being answered, from `blockedPromptSignature`. */
  promptSig: string | null;
  /** Epoch ms of the send, for the timeout. */
  sentAt: number;
}

/**
 * Identity of a parsed prompt. Null when nothing was parsed — an unreadable
 * pane is "unknown", not "a different question", so a flickering parse cannot
 * masquerade as a new prompt.
 */
export function blockedPromptSignature(prompt: BlockedPrompt | null): string | null {
  if (prompt === null || prompt.options.length === 0) return null;
  // Ticks included: toggling a multi-select row changes nothing else on screen,
  // and without them the reply would look undelivered until it timed out.
  const tick = (o: BlockedOption) => (o.checked === undefined ? '' : o.checked ? '[x]' : '[ ]');
  return [prompt.question ?? '', ...prompt.options.map((o) => `${o.number}.${tick(o)}${o.label}`)].join('\n');
}

export type PendingResolution = 'waiting' | 'delivered' | 'superseded' | 'timed_out';

/**
 * What one status-poll observation means for a reply in flight.
 *
 * `delivered` — the agent left blocked, so the keys landed.
 * `superseded` — a DIFFERENT prompt is on screen. A new question is a new
 *   decision; pending must not leak onto it and lock its options.
 * `timed_out` — still the same prompt after the deadline. The keys probably
 *   never landed; the options come back and the caller says so.
 */
export function resolveBlockedPending(
  pending: BlockedPending,
  observed: { blocked: boolean; promptSig: string | null; now: number; timeoutMs: number }
): PendingResolution {
  if (!observed.blocked) return 'delivered';
  if (observed.promptSig !== null && observed.promptSig !== pending.promptSig) return 'superseded';
  if (observed.now - pending.sentAt >= observed.timeoutMs) return 'timed_out';
  return 'waiting';
}

/**
 * How long a blocked-prompt reply may sit unconfirmed before the options come
 * back and the user is told to check the agent.
 *
 * Two constraints pull opposite ways and both are real.
 *
 * The window must span several POLLS, because only a poll can observe the agent
 * moving on. The poll interval is a setting — `STATUS_POLL_MS * pollScale`,
 * with pollScale 1, 2 or 5 — so a constant sized for the fastest rate fits
 * barely one observation at the slowest. That is the bug: a reply that landed
 * perfectly well ran out the clock, the options re-enabled, and the banner
 * claimed it might not have arrived, reopening the double-tap window this state
 * exists to close.
 *
 * The window must also stay short in WALL-CLOCK terms, because a reply the
 * terminal genuinely dropped must not lock the bar for a minute. Scaling
 * naively with the interval trades the first bug for that one.
 *
 * So: three intervals, floored at the window the default rate already used.
 * The default setting is unchanged, the slow settings get three observations
 * instead of one, and the worst case is half a minute rather than a full one.
 */
export function blockedPendingTimeout(pollIntervalMs: number): number {
  return Math.max(BLOCKED_PENDING_FLOOR_MS, pollIntervalMs * 3);
}

/** What the fixed six-times-2s window used to be, kept as the lower bound. */
const BLOCKED_PENDING_FLOOR_MS = 12_000;

/** Whether these are the exact keys of the reply in flight. */
export function isPendingKeys(pending: BlockedPending | null, keys: readonly string[]): boolean {
  if (pending === null || pending.keys.length !== keys.length) return false;
  return pending.keys.every((key, index) => key === keys[index]);
}

// MARK: - Internals

// `›` is Codex's cursor. Without it Codex's highlighted option, the first
// one, was not recognised at all and the menu started at 2.
const SELECTION_MARKERS = ['❯', '›', '▶', '>', '→', '•', '*'];
// Codex also names a shortcut letter: "Yes, proceed (y)".
const KEYBOARD_HINT = /\s*\((esc|enter|return|tab|[a-z])\)\s*$/i;
/** A multi-select row's box: `[ ]`, or ticked. */
const CHECKBOX = /^\[([ xX✔✓])\]\s*/;
/** Where a label ends and a preview panel beside it begins. */
const SIDE_PANEL = /\s{2,}[│┃┌└├╭╰].*$/;

/**
 * The column a line's text starts at, past box borders and a cursor marker.
 * An option's is where its number starts.
 */
function contentColumn(line: string): number {
  let index = 0;
  while (index < line.length && BORDER_CHARS.includes(line[index] ?? '')) index += 1;
  const marker = SELECTION_MARKERS.find((candidate) => line.startsWith(candidate, index));
  if (marker !== undefined) {
    index += marker.length;
    while (index < line.length && (line[index] === ' ' || line[index] === '\t')) index += 1;
  }
  return index;
}

/** Parse a single cleaned line as a menu option, e.g. "❯ 2. Yes, allow all". */
function parseOption(line: string): BlockedOption | null {
  let text = line;
  for (const marker of SELECTION_MARKERS) {
    if (text.startsWith(marker)) {
      text = text.slice(marker.length).trim();
      break;
    }
  }

  const digits = /^\d+/.exec(text)?.[0];
  if (digits === undefined) return null;
  const number = Number(digits);

  const after = text.slice(digits.length);
  const punctuation = after.charAt(0);
  if (punctuation !== '.' && punctuation !== ')') return null;

  let label = after.slice(1).trim().replace(SIDE_PANEL, '').replace(KEYBOARD_HINT, '').trim();
  const box = CHECKBOX.exec(label);
  if (box !== null) label = label.slice(box[0].length).trim();
  if (label.length === 0) return null;

  return box === null ? { number, label } : { number, label, checked: box[1] !== ' ' };
}
