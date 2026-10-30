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
  /**
   * The exact keys that pick it, for a menu with no numbers to type: arrows
   * that walk the cursor onto the row, then Enter. Absent where the number is
   * the answer.
   */
  keys?: readonly string[];
}

/**
 * What a permission prompt is asking to do, as Claude drew it above the
 * question: which tool, what it says it is for, the command or diff itself,
 * and any warning under it. Without this the phone showed only "Do you want to
 * proceed?", which is not something anyone can answer.
 */
export interface PromptDetails {
  /** The tool line: "Bash command · from the "zen-video-v6" workflow", "Edit file". */
  title: string | null;
  /** The prose line straight under the title: the tool's description, a file path. */
  summary: string | null;
  /**
   * The command, diff or preview, a line per line of it, with box borders,
   * the command's margin and the common indent removed. Lines the terminal
   * wrapped are joined, so copying gives the command as it will run.
   */
  body: string[];
  /** The lines between the body and the question, the auto-deny line among them. */
  notes: string[];
  /**
   * When Claude will deny the prompt on its own, as it printed it ("1:32",
   * "about 2 minutes"). Read from each poll's screen, never counted down
   * locally: the phone's clock is not the agent's.
   */
  deadline: string | null;
}

export interface BlockedPrompt {
  question: string | null;
  options: BlockedOption[];
  /**
   * What is being approved. Null for a prompt that is only its question (an
   * AskUserQuestion, the trust prompt) or where none could be read; absent on
   * prompts this parser did not build.
   */
  details?: PromptDetails | null;
  /**
   * The prompt is taller than the screen the app reads: its rule and tool
   * line have scrolled off, so nothing on screen says what it is for. The bar
   * says so instead of showing a command with no tool above it.
   */
  detailsOffScreen?: boolean;
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
  /**
   * The terminal shows no numbers (Claude's folder-trust question), so the
   * phone shows none either: a "1" here would name a key that does nothing.
   */
  unnumbered?: boolean;
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
  if (option.keys !== undefined) return [...option.keys];
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
  /** The line each option of the current menu starts on. */
  const optionLines: number[] = [];
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
      optionLines.length = 0;
      firstOptionLine = index;
    }
    if (firstOptionLine === null) firstOptionLine = index;
    options.push(option);
    optionLines.push(index);
    menuColumn = column;
    underOption = true;
  }

  if (options.length === 0 || firstOptionLine === null) {
    return parseTrustPrompt(raw) ?? { question: null, options: [], details: null };
  }
  joinWrappedLabels(options, optionLines, lines, rawLines, menuColumn);

  // Question: the contiguous text lines immediately above the first option,
  // oldest first, up to a blank line or a rule. Claude 2.1.299 closes a Write
  // prompt's file box with a dashed rule right above its question, and without
  // stopping there the whole box read as the question.
  const questionLines: string[] = [];
  let cursor = firstOptionLine - 1;
  while (cursor >= 0 && (lines[cursor] ?? '').length === 0) cursor -= 1;
  while (cursor >= 0) {
    const line = lines[cursor] ?? '';
    if (line.length === 0 || parseOption(line) !== null || isRuleLine(rawLines[cursor] ?? '')) break;
    questionLines.unshift(line);
    cursor -= 1;
  }

  const question = questionLines.join(' ').trim();
  const multiSelect = options.some((option) => option.checked !== undefined);
  const details = agyDetails(lines, rawLines, cursor + 1) ?? parsePromptDetails(rawLines, cursor + 1);
  return {
    question: question.length > 0 ? question : null,
    options,
    details: details === OFF_SCREEN ? null : codexCommand(details, question),
    ...(details === OFF_SCREEN ? { detailsOffScreen: true } : {}),
    ...(multiSelect ? { multiSelect } : {}),
  };
}

/**
 * The rest of a label the terminal wrapped onto the next row. Antigravity
 * wraps a long option back to the first column, under the menu rather than
 * past it, where a description would sit: "2. Yes, and always allow in this
 * conversation for" then "commands that start with 'echo'". A row between two
 * options, no further in than their numbers and not an option itself, is the
 * label above it going on. Below the last option it could be the key hints,
 * so it is left.
 */
function joinWrappedLabels(
  options: BlockedOption[],
  optionLines: readonly number[],
  lines: readonly string[],
  rawLines: readonly string[],
  menuColumn: number | null
): void {
  if (menuColumn === null) return;
  for (let at = 0; at + 1 < options.length; at += 1) {
    const option = options[at];
    const from = optionLines[at];
    const to = optionLines[at + 1];
    if (option === undefined || from === undefined || to === undefined) continue;
    const rest = lines.slice(from + 1, to).filter((line, offset) =>
      line.length > 0 && contentColumn(rawLines[from + 1 + offset] ?? '') <= menuColumn && parseOption(line) === null);
    if (rest.length > 0) option.label = [option.label, ...rest].join(' ');
  }
}

/**
 * Antigravity's permission prompt: the tool's name above the prompt's rule,
 * then "Requesting permission for:" and what it would run, indented, then the
 * question. Null for any other prompt.
 *
 *     Command
 *     ──────────────────────────────
 *
 *     Requesting permission for:
 *        echo herdrchat-probe
 *
 *     Run this command?
 */
function agyDetails(lines: readonly string[], rawLines: readonly string[], questionStart: number): PromptDetails | null {
  const asking = lines.lastIndexOf(AGY_REQUEST, questionStart - 1);
  if (asking < 0) return null;
  const body = lines.slice(asking + 1, questionStart).filter((line) => line.length > 0);
  // The tool's name is the line above the rule above the request. The rule is
  // read raw: cleaning strips its characters and leaves an empty line.
  let rule = asking - 1;
  while (rule >= 0 && (rawLines[rule] ?? '').trim().length === 0) rule -= 1;
  const title = rule > 0 && isRuleLine(rawLines[rule] ?? '') ? (lines[rule - 1] ?? '').trim() : '';
  return { title: title.length > 0 ? title : null, summary: null, body, notes: [], deadline: null };
}

const AGY_REQUEST = 'Requesting permission for:';

/** What `parsePromptDetails` returns for a prompt whose start has scrolled off. */
export const OFF_SCREEN = 'off-screen';

/**
 * Read what a prompt is asking to do from the lines above its question.
 *
 * Claude Code 2.1.299 draws a permission prompt like this (captured at 120
 * columns; at 80 the Tip and the auto-deny line wrap):
 *
 *     ────────────────────────────────────────    ← the prompt's own rule
 *     Bash command                                ← title
 *     Tip: auto mode handles these prompts …      ← Claude's hint, dropped
 *     Create and remove two temp files            ← summary
 *     ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 *     │ cd /repo && for f in a b; do …            ← body, its margin dropped
 *     ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 *     A variable in this command can't be checked before it runs    ← notes
 *     ⚠ Claude Code will automatically deny this request in 1:32, …
 *
 *     Do you want to proceed?                     ← question
 *
 * Older versions draw one rule (or a `╭` box) with the command under a blank
 * line. Either way the details are read ONLY from the prompt's own rule, with
 * the tool line straight under it. A command taller than the screen pushes
 * both off the top, and then nothing on screen says what the prompt is: this
 * returns `OFF_SCREEN` rather than take a command line for the title, which on
 * an approval screen would be worse than showing nothing.
 *
 * A line that ran to the pane's edge continues on the next, so wrapped lines
 * are joined before anything is classified: the body is the command as it
 * will run, and an auto-deny line wrapped in two still lands in the notes,
 * never in the body (which the prompt's signature includes).
 *
 * An AskUserQuestion has no tool line, only its header tab (`☐ Database`),
 * and gets null: its question already says everything. Codex draws no rule;
 * its approval is recognised by its own title.
 */
export function parsePromptDetails(rawLines: readonly string[], questionStart: number): PromptDetails | typeof OFF_SCREEN | null {
  /** Whether a dashed rule or a command's margin was passed on the way up. */
  let framed = false;
  for (let index = questionStart - 1; index >= 0; index -= 1) {
    const raw = rawLines[index] ?? '';
    if (isOpeningRule(raw)) return openedAt(rawLines, index, questionStart);
    if (CONVERSATION_MARKER.test(raw)) return codexDetails(rawLines, questionStart);
    if (isRuleLine(raw) || MARGIN.test(raw)) framed = true;
  }
  // The top of the screen reached inside a frame: the prompt began above it.
  return framed ? OFF_SCREEN : codexDetails(rawLines, questionStart);
}

/** The details of a prompt opened by the rule (or box top) at `rule`. */
function openedAt(rawLines: readonly string[], rule: number, questionStart: number): PromptDetails | typeof OFF_SCREEN | null {
  const opening = rawLines[rule] ?? '';
  const box = /^\s*[╭┌]/.test(opening);
  const segment = rawLines.slice(rule + 1, questionStart);
  // A box already closed above the question (Codex's banner) is not this prompt's.
  if (box && segment.some((line) => /^\s*[╰└]/.test(line))) return codexDetails(rawLines, questionStart);
  const first = segment[0];
  if (first === undefined) return null;
  // A command's own line straight under a rule: the prompt's top is gone.
  if (!box && MARGIN.test(first)) return OFF_SCREEN;
  // Lines in a box are padded to its width, so where they end says nothing.
  return readBlock(segment, box ? Number.POSITIVE_INFINITY : opening.trimEnd().length);
}

/**
 * Codex's approval: no rule, a paragraph group above the question, opened by
 * its own title. Nothing else without a rule has details.
 */
function codexDetails(rawLines: readonly string[], questionStart: number): PromptDetails | null {
  const start = paragraphStart(rawLines, questionStart);
  if (!CODEX_TITLE.test(rawLines[start] ?? '')) return null;
  return readBlock(rawLines.slice(start, questionStart), Number.POSITIVE_INFINITY);
}

/**
 * Title, summary, body and notes from a prompt's lines, title first. `width`
 * is the pane's, from the prompt's rule, for telling a wrap from a newline.
 */
function readBlock(raws: readonly string[], width: number): PromptDetails | null {
  const rows = raws.map(frameRow);
  while (rows.length > 0 && (rows[rows.length - 1]?.text ?? '').trim().length === 0) rows.pop();
  const first = rows[0];
  if (first === undefined) return null;
  const title = first.text.trim();
  if (title.length === 0 || QUESTION_HEADER.test(title) || isFrameLine(title) || CONVERSATION_MARKER.test(first.text)) return null;

  // The header runs to a blank line, a rule or the body's margin.
  let index = 1;
  const header: FrameRow[] = [];
  for (; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === undefined || row.text.trim().length === 0 || row.margin || isFrameLine(row.text)) break;
    header.push(row);
  }
  const prose = unwrap(header, width).map((line) => line.trim()).filter((line) => !isTip(line));
  let summary = prose.length > 0 ? prose.join('\n') : null;

  // Two plain rules frame the body (2.1.299's dashed ones) and the notes
  // follow the second; one separates the body from the notes.
  const rest = rows.slice(index);
  const rules = rest.flatMap((row, at) => (!row.margin && PLAIN_RULE.test(row.text) ? [at] : []));
  const lastRule = rules[rules.length - 1];
  const bodyRows = (lastRule === undefined ? rest : rest.slice(0, lastRule)).filter((row) => !isFrameLine(row.text));
  const notes = lastRule === undefined ? [] : unwrap(rest.slice(lastRule + 1), width).map((line) => line.trim()).filter((line) => line.length > 0 && !isTip(line));

  const bodyLines = unwrap(bodyRows, width);
  // Without a separator, a warning paragraph at the end is still notes.
  if (lastRule === undefined) {
    const trailing: string[] = [];
    while (bodyLines.length > 0) {
      const line = (bodyLines[bodyLines.length - 1] ?? '').trim();
      if (line.length === 0 && trailing.length > 0) break;
      if (line.length > 0 && !isWarning(line)) break;
      bodyLines.pop();
      if (line.length > 0) trailing.unshift(line);
    }
    notes.unshift(...trailing);
  }

  const deadline = notes.map((line) => DEADLINE.exec(line)?.[1]).find((match) => match !== undefined) ?? null;
  let body = dedent(bodyLines);
  // Older Claude (2.1.280) draws a Bash prompt's description under the command,
  // at the same indent, with no line between them. Left in the body it reads as
  // a second command line, and copying the body would paste it into a shell.
  const last = body[body.length - 1];
  if (summary === null && title.startsWith('Bash') && body.length > 1 && (body[body.length - 2] ?? '').length > 0 && last !== undefined && isProse(last)) {
    summary = last.trim();
    body = body.slice(0, -1);
  }
  return { title, summary, body, notes, deadline };
}

/**
 * Codex's approval asks "Would you like to run the following command?" and puts
 * the command (`$ date …`) straight above its menu, where it becomes the
 * question, with the environment and the reason as the block's lines. Turned
 * round, the command is the body that can be copied and the prose its summary;
 * the question stays what Codex drew.
 */
function codexCommand(details: PromptDetails | null, question: string): PromptDetails | null {
  if (details === null || !/the following command\?$/.test(details.title ?? '') || !question.startsWith('$ ')) return details;
  const prose = [details.summary, ...details.body].filter((line): line is string => line !== null && line.trim().length > 0);
  return { ...details, summary: prose.length > 0 ? prose.join('\n') : null, body: [question.slice(2)] };
}

/**
 * Whether a line reads as a sentence rather than a shell command: a capital,
 * words, and none of the shell's operators, redirections or substitutions.
 */
function isProse(line: string): boolean {
  const text = line.trim();
  return /^[A-Z][a-z]/.test(text) && text.includes(' ') && !/[|&;<>$`\\=(){}*]/.test(text);
}

/** Claude's auto-deny line, with the time as it printed it. */
const DEADLINE = /automatically deny this request in (\d+:\d{2}|about \d+ (?:minutes?|seconds?))/;

/** AskUserQuestion's header tabs and review markers, never a tool line. */
const QUESTION_HEADER = /^[←→☐☒☑✔✓□■●◯]/;

/** A Grok option row once its `┃` gutter is gone: `2 (○) Yes, proceed`. */
const GROK_OPTION = /^([1-9]) \([●○]\) (.+)$/;

/** Codex's approval titles: "Would you like to run the following command?". */
const CODEX_TITLE = /^\s*Would you like to /;

/**
 * Lines that belong to the conversation above a prompt, never to it: Claude's
 * and Codex's message, tool and spinner marks, and a typed prompt's `>`. Only
 * near the left edge; a prompt's own body is indented or inside a box.
 */
const CONVERSATION_MARKER = /^ {0,2}[⏺⎿❯›•✻✳✢✶✽>]/;

/** Rule characters: solid, and the dashed ones 2.1.299 frames a command with. */
const RULE_CHARS = '─━▔╌╍┄┅┈┉';

/** A line that is only a rule, solid or dashed, once its borders are gone. */
const PLAIN_RULE = new RegExp(`^\\s*[${RULE_CHARS}]{3,}\\s*$`);

/** A command's left margin in 2.1.299 (`│ `), with no right border. */
const MARGIN = /^\s{0,2}[│┃](?:\s|$)(?!.*[│┃]\s*$)/;

/**
 * How many columns short of the pane's width a line may end and still have
 * wrapped. Claude pads its prompt by a column a side; the rest is slack, so a
 * wrap is never missed (a missed wrap splits a command in two).
 */
const WRAP_SLACK = 2;

/** A rule across the screen, solid or dashed, or the top of a box. */
function isRuleLine(raw: string): boolean {
  const text = raw.trim();
  return new RegExp(`^[${RULE_CHARS}]{8,}$`).test(text) || /^[╭┌][─━]{6,}[╮┐]$/.test(text);
}

/** The rule that opens a prompt: solid, or a box top. Dashed rules are inside one. */
function isOpeningRule(raw: string): boolean {
  const text = raw.trim();
  return /^[─━▔]{8,}$/.test(text) || /^[╭┌][─━]{6,}[╮┐]$/.test(text);
}

/** A line drawn only with box characters, once its borders are gone. */
function isFrameLine(line: string): boolean {
  return new RegExp(`^\\s*[${RULE_CHARS}╭╮╰╯┌┐└┘├┤┬┴┼]{3,}\\s*$`).test(line);
}

function isWarning(line: string): boolean {
  return line.startsWith('⚠') || DEADLINE.test(line);
}

/** Claude's hint under a tool line ("Tip: auto mode handles …"), not the prompt's content. */
function isTip(line: string): boolean {
  return line.startsWith('Tip:');
}

/**
 * Where the paragraph group above the question starts: up through single blank
 * lines, stopping at two in a row, an option of an older menu, or a line from
 * the conversation.
 */
function paragraphStart(rawLines: readonly string[], questionStart: number): number {
  let start = questionStart;
  let blanks = 0;
  for (let index = questionStart - 1; index >= 0; index -= 1) {
    const raw = rawLines[index] ?? '';
    const line = clean(raw);
    if (line.length === 0) {
      blanks += 1;
      if (blanks >= 2 && start < questionStart) break;
      continue;
    }
    if (CONVERSATION_MARKER.test(raw) || parseOption(line) !== null) break;
    blanks = 0;
    start = index;
  }
  return start;
}

/** A prompt's line with its frame gone, and where on the screen it ended. */
interface FrameRow {
  text: string;
  /** Whether it sat in 2.1.299's `│ ` margin: a command's line. */
  margin: boolean;
  /** The column its text ends at, frame included: how close to the edge it ran. */
  used: number;
}

/**
 * Drop a box's side borders (nested boxes too) and trailing padding, keeping
 * the indent, or a command's left-only `│ ` margin.
 */
function frameRow(raw: string): FrameRow {
  let line = raw.trimEnd();
  const used = line.length;
  while (/^\s*[│┃]/.test(line) && /[│┃]$/.test(line) && line.trim().length > 1) {
    line = line.replace(/^\s*[│┃]/, '').replace(/[│┃]$/, '').trimEnd();
  }
  if (MARGIN.test(line)) return { text: line.replace(/^\s*[│┃] ?/, ''), margin: true, used };
  return { text: line, margin: false, used };
}

/**
 * Join the lines the terminal wrapped. A line wrapped when the next one's
 * first word would not have fitted after it within `width`; a real newline
 * leaves room. A word longer than the line was broken mid-word and joins
 * without a space. A warning or a Tip always starts its own line.
 */
function unwrap(rows: readonly FrameRow[], width: number): string[] {
  const out: string[] = [];
  let previous: FrameRow | null = null;
  for (const row of rows) {
    const text = row.text;
    const before = out[out.length - 1];
    const next = firstWord(text);
    const wrapped =
      previous !== null &&
      before !== undefined &&
      before.trim().length > 0 &&
      next.length > 0 &&
      previous.margin === row.margin &&
      !isWarning(text.trim()) &&
      !isTip(text.trim()) &&
      previous.used + 1 + next.length > width - WRAP_SLACK;
    if (wrapped && previous !== null) {
      const broken = previous.used >= width - WRAP_SLACK && lastWord(before).length + next.length > width - WRAP_SLACK * 2;
      out[out.length - 1] = `${before}${broken ? '' : ' '}${text.trimStart()}`;
    } else {
      out.push(text);
    }
    previous = row;
  }
  return out;
}

function firstWord(line: string): string {
  return line.trimStart().split(' ')[0] ?? '';
}

function lastWord(line: string): string {
  return line.trimEnd().split(' ').pop() ?? '';
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Remove the indent every non-blank line shares; blank lines become empty. */
function dedent(lines: readonly string[]): string[] {
  const trimmed = [...lines];
  while (trimmed.length > 0 && (trimmed[0] ?? '').trim().length === 0) trimmed.shift();
  while (trimmed.length > 0 && (trimmed[trimmed.length - 1] ?? '').trim().length === 0) trimmed.pop();
  const indents = trimmed.filter((line) => line.trim().length > 0).map(indentOf);
  const common = indents.length === 0 ? 0 : Math.min(...indents);
  return trimmed.map((line) => (line.trim().length === 0 ? '' : line.slice(common)));
}

/**
 * Claude's folder-trust question, asked the first time it starts in a folder
 * (Claude Code 2.1.286):
 *
 *     Accessing workspace:
 *
 *     /Users/me/Workspace/youtube
 *     …
 *     ❯ No, exit
 *       Yes, I trust this folder
 *
 *     Enter to confirm · Esc to cancel
 *
 * Until it is answered Claude takes no prompt, and herdr refuses one with
 * `agent_input_pending` while still calling the agent idle, so a new chat in
 * a new folder could not be started from the phone at all.
 *
 * The menu has no numbers. The cursor starts on "No, exit", and Enter takes
 * whatever row it is on, so a bare Enter (the generic Confirm) closes Claude.
 * Each option therefore carries its own keys: the arrows from the cursor's
 * row to its row, then Enter. Recognised by the heading and the answer
 * together, never by an unnumbered list alone.
 */
export function parseTrustPrompt(raw: string): BlockedPrompt | null {
  const lines = raw.split('\n').map(clean);
  const heading = lines.lastIndexOf(TRUST_HEADING);
  if (heading < 0) return null;
  const rest = lines.slice(heading + 1);
  const answer = rest.findIndex((line) => withoutCursor(line) === TRUST_ANSWER);
  if (answer < 0) return null;

  // The menu is the run of rows around the answer, one of them under the cursor.
  let start = answer;
  while (start > 0 && (rest[start - 1] ?? '').length > 0) start -= 1;
  let end = answer;
  while (end + 1 < rest.length && (rest[end + 1] ?? '').length > 0) end += 1;
  const rows = rest.slice(start, end + 1);
  const cursor = rows.findIndex((line) => TRUST_CURSORS.some((mark) => line.startsWith(mark)));
  if (cursor < 0) return null;

  const options = rows.map((line, index): BlockedOption => {
    const steps = index - cursor;
    const arrows = Array.from({ length: Math.abs(steps) }, () => (steps > 0 ? 'Down' : 'Up'));
    return { number: index + 1, label: withoutCursor(line), keys: [...arrows, 'Enter'] };
  });
  // The folder is the paragraph under the heading, when it reads as a path; a
  // narrow pane wraps a long one over several rows, mid-name.
  const first = rest.findIndex((line) => line.length > 0);
  const paragraph = first < 0 ? [] : rest.slice(first, rest.findIndex((line, at) => at > first && line.length === 0));
  const folder = paragraph.join('');
  // The agent names itself: "Antigravity CLI requires permission to read…".
  const agent = rest.map((line) => /^(.+?) requires permission to /.exec(line)?.[1]).find((name) => name !== undefined) ?? 'Claude Code';
  const question = /^[/~]/.test(folder)
    ? `Trust ${folder}? ${agent} will be able to read, edit and run files there.`
    : `Trust this folder? ${agent} will be able to read, edit and run files here.`;
  return { question, options, details: null, unnumbered: true };
}

const TRUST_HEADING = 'Accessing workspace:';
const TRUST_ANSWER = 'Yes, I trust this folder';
/** Claude's cursor, and Antigravity's. */
const TRUST_CURSORS = ['❯', '>'];

function withoutCursor(line: string): string {
  const mark = TRUST_CURSORS.find((candidate) => line.startsWith(candidate));
  return mark === undefined ? line : line.slice(mark.length).trim();
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
  // The tool, its description and the whole command: a different command under
  // the same "Do you want to proceed?" is a different decision, and commands in
  // one repo usually share their first line (`cd /repo &&`). Not the notes,
  // which hold the deadline: it ticks every second and would make every poll a
  // new prompt.
  const details = prompt.details ?? null;
  const subject = details === null ? [] : [details.title ?? '', details.summary ?? '', ...details.body];
  return [prompt.question ?? '', ...subject, ...prompt.options.map((o) => `${o.number}.${tick(o)}${o.label}`)].join('\n');
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

  // Grok draws a choice as `2 (○) Yes, proceed`: the key, a radio that marks
  // the focused row, the label (herdr's grok.toml, Grok 1.0.34). Its letter
  // rows (`z (○) Type your answer here`) take typing, not a key, and are left out.
  const radio = GROK_OPTION.exec(text);
  if (radio !== null) return { number: Number(radio[1]), label: (radio[2] ?? '').trim() };

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
