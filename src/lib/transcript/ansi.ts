/**
 * Scrubbing a terminal's visible screen down to text.
 *
 * Shared by `blockedPrompt.ts` and `livePreview.ts`, which both read
 * `herdr pane read --source visible`. They each had their own copy of this and
 * the copies drifted: `livePreview`'s CSI pattern was missing the escape byte,
 * so it matched "`[` followed by a letter" and ate ordinary prose — `[TODO]`
 * came out as `ODO]` — while leaving the real escape byte in the string.
 *
 * Escape and bell are written `\u001b` and `\u0007` rather than typed as the
 * bytes themselves. A literal 0x1B is invisible in every editor, terminal and
 * diff view, which is exactly how two versions of one regex came to look
 * identical while behaving differently. Keep them spelled out.
 */

/** `ESC [ … <letter>` — colours, cursor moves, erases. */
const CSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

/**
 * `ESC ] … BEL` or `ESC ] … ESC \` — OSC, which is how a terminal sets its
 * title. Stripped before CSI because its payload is arbitrary text and may
 * contain sequences the CSI pattern would otherwise match.
 */
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

/** Any other escape-introduced sequence, and a lone trailing escape byte. */
const OTHER_ESCAPE = /\u001b[@-Z\\-_]?/g;

/** The box-drawing and padding characters that frame a TUI panel. */
export const BORDER_CHARS = '│┃|╭╮╰╯─┌┐└┘├┤ \t';

/** Remove every escape sequence, leaving no stray escape bytes behind. */
export function stripAnsi(line: string): string {
  return line.replace(OSC, '').replace(CSI, '').replace(OTHER_ESCAPE, '');
}

/**
 * Strip escapes, then trim the border characters that wrap a boxed line.
 *
 * Only the ENDS are trimmed. Bars in the MIDDLE of a line separate the fields
 * of a status bar, and `livePreview` depends on still being able to see them —
 * it normalises them itself afterwards.
 */
export function clean(line: string): string {
  const text = stripAnsi(line);
  let start = 0;
  let end = text.length;
  while (start < end && BORDER_CHARS.includes(text[start] ?? '')) start += 1;
  while (end > start && BORDER_CHARS.includes(text[end - 1] ?? '')) end -= 1;
  return text.slice(start, end);
}
