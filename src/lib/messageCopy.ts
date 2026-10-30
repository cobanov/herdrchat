import { parseMarkdown } from './markdown';
import { displayText, type ChatMessage } from './transcript/message';

/**
 * What a long press on a bubble can put on the clipboard.
 *
 * The whole message, and each code block on its own, because on a phone they
 * are genuinely different jobs. An agent's answer is usually prose wrapped
 * around the thing you actually wanted — a command, a path, a diff — and
 * pasting the prose into a terminal is useless. Extracting the code by hand on
 * a touchscreen is worse.
 *
 * One block at a time, never joined: a reply with a command, then a config
 * snippet, then a second command used to put all three on the clipboard under
 * "Copy code only", when the person wanted the one they meant (reported from a
 * phone). Each block in a message also has its own Copy (`Markdown`).
 *
 * Pure so a test can pin it, which matters more here than it looks: no code
 * option may appear for a block with nothing in it, or it copies an empty
 * string and silently clears whatever the clipboard held.
 */

/** How long a block's label may run in the sheet before it is cut, so a row stays one line. */
export const COPY_LABEL_CHARS = 32;

export interface CodeBlockCopy {
  /** What the sheet row names it by: its language and first line, cut to `COPY_LABEL_CHARS`. */
  label: string;
  /** The block exactly as written, less the blank lines at its end. */
  content: string;
}

export interface CopyOptions {
  /** Everything the bubble shows, as the markdown the agent wrote. */
  full: string;
  /** Each fenced block with something in it, in order. Empty for most messages. */
  blocks: CodeBlockCopy[];
}

/**
 * What copying one code block puts on the clipboard: the block as written,
 * less the newlines at its end (a blank line before the closing fence is not
 * part of the command). Not trimmed further, so the first line keeps its
 * indentation and a pasted snippet still lines up. Windows line endings
 * become plain ones: the parser splits on `\n` and leaves each line its `\r`,
 * and a stray carriage return pasted into a terminal is a keypress.
 */
export function codeToCopy(content: string): string {
  return content.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
}

/** Whether a block holds anything to copy. Copying one that does not clears the clipboard. */
export function hasCode(content: string): boolean {
  return content.trim().length > 0;
}

/**
 * "sh: git status --short", or just the first line when the block names no
 * language. `suffix` (" (2)") tells apart blocks that would read the same, and
 * is kept whole when the label is cut. The cut counts characters, not UTF-16
 * units, so an emoji at the edge is not split in half.
 */
export function codeBlockLabel(language: string | null, content: string, suffix = ''): string {
  const first = content.split('\n').find((line) => line.trim().length > 0)?.trim() ?? '';
  const label = Array.from(language === null ? first : `${language.toLowerCase()}: ${first}`);
  const room = COPY_LABEL_CHARS - Array.from(suffix).length;
  const cut = label.length > room ? `${label.slice(0, room - 1).join('').trimEnd()}…` : label.join('');
  return cut + suffix;
}

export function copyOptions(message: ChatMessage): CopyOptions {
  const full = displayText(message);
  const code = parseMarkdown(full).flatMap((block) =>
    block.kind === 'code' && hasCode(block.content) ? [block] : []
  );
  // Two blocks that start alike ("sh: cd repo" twice) would give two sheet rows
  // reading the same and copying different things, so those are numbered.
  const plain = code.map((block) => codeBlockLabel(block.language, block.content));
  const seen = new Map<string, number>();
  const blocks = code.map((block, index) => {
    const label = plain[index] ?? '';
    const twins = plain.filter((other) => other === label).length;
    const nth = (seen.get(label) ?? 0) + 1;
    seen.set(label, nth);
    return {
      label: twins > 1 ? codeBlockLabel(block.language, block.content, ` (${nth})`) : label,
      content: codeToCopy(block.content),
    };
  });
  return { full, blocks };
}
