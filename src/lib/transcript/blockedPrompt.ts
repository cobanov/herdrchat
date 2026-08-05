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

/** Keys that submit a choice: press the number, then Enter. */
export function optionKeys(option: BlockedOption): string[] {
  return [String(option.number), 'Enter'];
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
