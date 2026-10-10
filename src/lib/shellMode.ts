/**
 * Claude Code's shell mode, from the phone's side: a line that starts with `!`
 * runs in the agent's shell rather than going to the model.
 *
 * The app sends it as typed and the terminal does the rest. Two things need
 * to know it is one: the composer, which says where the line will go before it
 * is sent, and the receipt, which must recognise the `<bash-input>` Claude
 * records as the same line.
 */

/** True when `draft` would run in the agent's shell: Claude only, `!` first, as the terminal reads it. */
export function isShellDraft(draft: string, agent: 'claude' | 'codex' | null): boolean {
  return agent === 'claude' && draft.startsWith('!');
}

/**
 * What a shell line and its record must share to be the same line.
 *
 * Claude records the command with or without a leading space
 * (`<bash-input> pwd</bash-input>` or `<bash-input>pwd</bash-input>`),
 * depending on its version and how the line was typed, so neither side can
 * be trusted to carry exactly one. The receipt trims both and compares `!pwd`,
 * so either spelling is confirmed. Text that does not start with `!` is
 * returned as it came.
 */
export function shellReceiptText(text: string): string {
  const trimmed = text.trim();
  return trimmed.startsWith('!') ? `!${trimmed.slice(1).trim()}` : trimmed;
}

/** What a shell block shows of its output: stdout, then stderr. */
export interface FoldedOutput {
  stdout: string;
  stderr: string;
  /** Lines in the whole output, stdout's and stderr's. */
  lines: number;
  /** Lines left out while folded; 0 when everything shows. */
  hidden: number;
}

/**
 * A command's output, cut to `limit` lines unless `open`. Counted in the
 * output's own lines, not wrapped ones, so "Show all 200 lines" says what
 * `seq 1 200` printed whatever the phone's width.
 *
 * stdout's first lines, then stderr's, but stdout never takes the whole fold
 * while there is stderr: up to half of it is kept for stderr's first lines.
 * Cutting stdout first hid a build's error under thirty lines of progress,
 * and the error is what the person ran the command to see.
 */
export function foldShellOutput(stdout: string, stderr: string, limit: number, open: boolean): FoldedOutput {
  const out = splitLines(stdout);
  const err = splitLines(stderr);
  const lines = out.length + err.length;
  if (open || lines <= limit) return { stdout, stderr, lines, hidden: 0 };
  const forErr = Math.min(err.length, Math.max(1, Math.floor(limit / 2)));
  const keptOut = out.slice(0, Math.max(0, limit - forErr));
  const keptErr = err.slice(0, limit - keptOut.length);
  return { stdout: keptOut.join('\n'), stderr: keptErr.join('\n'), lines, hidden: lines - limit };
}

/** The whole output as one text, for the clipboard: stdout, then stderr. */
export function shellOutputText(stdout: string, stderr: string): string {
  return [stdout, stderr].filter((part) => part.length > 0).join('\n');
}

function splitLines(text: string): string[] {
  return text.length === 0 ? [] : text.split('\n');
}
