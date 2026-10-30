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
  /** The block exactly as written, less its trailing newline. */
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
 * less the trailing newline. Not trimmed further, so the first line keeps its
 * indentation and a pasted snippet still lines up.
 */
export function codeToCopy(content: string): string {
  return content.replace(/\n+$/, '');
}

/** "sh: git status --short", or just the first line when the block names no language. */
export function codeBlockLabel(language: string | null, content: string): string {
  const first = content.split('\n').find((line) => line.trim().length > 0)?.trim() ?? '';
  const label = language === null ? first : `${language.toLowerCase()}: ${first}`;
  return label.length > COPY_LABEL_CHARS ? `${label.slice(0, COPY_LABEL_CHARS - 1).trimEnd()}…` : label;
}

export function copyOptions(message: ChatMessage): CopyOptions {
  const full = displayText(message);
  const blocks = parseMarkdown(full).flatMap((block) =>
    block.kind === 'code' && block.content.trim().length > 0
      ? [{ label: codeBlockLabel(block.language, block.content), content: codeToCopy(block.content) }]
      : []
  );
  return { full, blocks };
}
