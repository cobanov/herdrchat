import { parseMarkdown } from './markdown';
import { displayText, type ChatMessage } from './transcript/message';

/**
 * What a long press on a bubble can put on the clipboard.
 *
 * Two options rather than one, because on a phone they are genuinely different
 * jobs. An agent's answer is usually prose wrapped around the thing you actually
 * wanted — a command, a path, a diff — and pasting the prose into a terminal is
 * useless. Extracting the code by hand on a touchscreen is worse.
 *
 * Pure so a test can pin it, which matters more here than it looks: the code
 * option must not appear when there is no code, or it copies an empty string and
 * silently clears whatever the clipboard held.
 */

export interface CopyOptions {
  /** Everything the bubble shows, as the markdown the agent wrote. */
  full: string;
  /**
   * Just the fenced code, blocks joined by a blank line. Null when the message
   * has none — which is most of them.
   */
  code: string | null;
}

export function copyOptions(message: ChatMessage): CopyOptions {
  const full = displayText(message);
  const blocks = parseMarkdown(full).filter(
    (block): block is Extract<ReturnType<typeof parseMarkdown>[number], { kind: 'code' }> =>
      block.kind === 'code'
  );

  const code = blocks
    .map((block) => block.content.trim())
    .filter((content) => content.length > 0)
    .join('\n\n');

  return { full, code: code.length > 0 ? code : null };
}
