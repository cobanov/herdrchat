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

import { clean } from './ansi';

/** One selectable choice: the keys to send and the label to show. */
export interface BlockedOption {
  /** 1-based menu index. */
  number: number;
  /** e.g. "Yes, and don't ask again". */
  label: string;
}

export interface BlockedPrompt {
  question: string | null;
  options: BlockedOption[];
}

/**
 * Keys that submit a choice: press the number, then Enter.
 *
 * One key per DIGIT. A ten-option menu is rare but real, and "10" is not a key
 * — sending it as one would either be dropped or land as a bare "1".
 */
export function optionKeys(option: BlockedOption): string[] {
  return [...String(option.number)].concat('Enter');
}

/**
 * Parse the tail of an agent pane into a question plus numbered options.
 * Returns a prompt with no options when the buffer holds no recognizable menu;
 * the UI then falls back to its generic chips rather than inventing choices.
 */
export function parseBlockedPrompt(raw: string): BlockedPrompt {
  const lines = raw.split('\n').map(clean);

  const options: BlockedOption[] = [];
  let firstOptionLine: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const option = parseOption(line);
    if (option === null) continue;
    // Keep the LAST contiguous menu: a later menu supersedes an earlier one
    // still lingering in the scrollback.
    const last = options[options.length - 1];
    if (last !== undefined && option.number <= last.number) {
      options.length = 0;
      firstOptionLine = index;
    }
    if (firstOptionLine === null) firstOptionLine = index;
    options.push(option);
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
  return { question: question.length > 0 ? question : null, options };
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
  return [prompt.question ?? '', ...prompt.options.map((o) => `${o.number}.${o.label}`)].join('\n');
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

/** Whether these are the exact keys of the reply in flight. */
export function isPendingKeys(pending: BlockedPending | null, keys: readonly string[]): boolean {
  if (pending === null || pending.keys.length !== keys.length) return false;
  return pending.keys.every((key, index) => key === keys[index]);
}

// MARK: - Internals

const SELECTION_MARKERS = ['❯', '▶', '>', '→', '•', '*'];
const KEYBOARD_HINT = /\s*\((esc|enter|return)\)\s*$/i;

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

  const label = after.slice(1).trim().replace(KEYBOARD_HINT, '').trim();
  if (label.length === 0) return null;

  return { number, label };
}
