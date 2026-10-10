/**
 * What an agent CLI writes into the user side of a transcript that the user
 * never typed, and how to show the parts they did.
 *
 * Claude Code and Codex both record their own plumbing as user turns: task
 * notifications, scheduled prompts, command output, pasted-text wrappers,
 * editor context. Read naively, a phone shows "You: <task-notification>…",
 * and the chat list's preview and unread dot follow it (#77, #78, #79). One
 * module, so the thread, the preview and the unread logic all read the same
 * rules.
 *
 * Measured against Claude Code 2.1.270-2.1.280 and Codex 0.153-0.155. The
 * structured fields are preferred where they exist; the tags are the fallback
 * for older versions that only wrote the text.
 */

import { stripAnsi } from './ansi';

/**
 * A Claude `user` line the user did not type, judged by its structured fields.
 *
 * - `isMeta`: skill bodies, scheduled `/loop` fires, image notes, caveats.
 * - `promptSource: "system"`: task notifications and other injected turns.
 * - `origin.kind` other than `human`: task notifications, peer messages.
 * - `isCompactSummary`: the summary a compaction feeds the model.
 */
export function isClaudeHarnessLine(raw: Record<string, unknown>): boolean {
  if (raw.isMeta === true || raw.isCompactSummary === true) return true;
  if (raw.promptSource === 'system') return true;
  const origin = raw.origin;
  if (typeof origin === 'object' && origin !== null) {
    const kind = (origin as Record<string, unknown>).kind;
    if (typeof kind === 'string' && kind !== 'human') return true;
  }
  return false;
}

/**
 * A Claude user turn its structured fields mark as typed by a person: it
 * carries a `promptId` or an `origin` of kind `human`, and is not a harness
 * line. Absent both (older versions), only the tags can tell.
 */
export function isClaudeTypedLine(raw: Record<string, unknown>): boolean {
  if (isClaudeHarnessLine(raw)) return false;
  if (typeof raw.promptId === 'string' && raw.promptId.length > 0) return true;
  const origin = raw.origin;
  return typeof origin === 'object' && origin !== null && (origin as Record<string, unknown>).kind === 'human';
}

/**
 * The text a Claude user turn should show, or null to show nothing.
 *
 * - `<pasted_content id="N">…</pasted_content id="N">` (2.1.278+) is unwrapped,
 *   keeping any text typed around it.
 * - A slash command (`<command-name>/model</command-name>` with its message
 *   and args) becomes what was typed: `/model` plus the args.
 * - Shell mode (`<bash-input>ls</bash-input>`) becomes `! ls`.
 * - A turn made only of harness elements (command output, a caveat, a task
 *   notification, a system reminder) shows nothing.
 *
 * `typed`: the line is one a person typed (`isClaudeTypedLine`). A
 * `<task-notification>` or `<agent-message>` there was pasted, since the
 * harness writes those only as its own turns, so it stays in the text. Peeled,
 * a message that was only the paste had no bubble, and one that led with it
 * lost it, and either way the phone's echo never confirmed ("Failed to send").
 * Context the harness does attach to a typed turn (IDE selections, reminders)
 * is still peeled.
 */
export function claudeUserText(text: string, typed = false): string | null {
  const unwrapped = text.replace(PASTED, (_match, _id: string, inner: string) =>
    inner.replace(/^\n|\n$/g, '')
  );

  const command = element(unwrapped, 'command-name');
  if (command !== null) {
    const args = element(unwrapped, 'command-args') ?? '';
    return args.trim().length === 0 ? command.trim() : `${command.trim()} ${args.trim()}`;
  }

  const shell = element(unwrapped, 'bash-input');
  if (shell !== null) return `! ${shell.trim()}`;

  const rest = peelHarness(unwrapped, typed ? OWN_TURN_TAGS : NO_TAGS);
  return rest.length === 0 ? null : rest;
}

/**
 * What a local slash command printed, or null when this is not that.
 *
 * Claude records `/model`, `/effort` and the like as a user turn holding only
 * `<local-command-stdout>` ("Set effort level to medium (this session only):
 * …"). That line is the one sign in the chat that the command did anything,
 * so it is shown as a note rather than hidden with the rest of the harness.
 * Empty output (most panels close with nothing to say) shows nothing.
 */
export function claudeCommandOutput(text: string): string | null {
  const trimmed = text.trim();
  const tag = COMMAND_OUTPUT_TAGS.find((candidate) => isSingleElement(trimmed, candidate));
  if (tag === undefined) return null;
  const output = stripAnsi(element(trimmed, tag) ?? '').replaceAll('`', '').trim();
  if (output.length === 0) return null;
  return output.length > COMMAND_OUTPUT_MAX ? `${output.slice(0, COMMAND_OUTPUT_MAX)}…` : output;
}

const COMMAND_OUTPUT_TAGS = ['local-command-stdout', 'local-command-stderr'] as const;

/**
 * A shell-mode exchange, as Claude Code records it, or null when the turn is
 * anything else.
 *
 * A line typed with a leading `!` runs in the agent's shell, not the model,
 * and Claude writes two user turns back to back: `<bash-input> pwd</bash-input>`
 * (with or without a leading space, depending on the version and how it was
 * typed, so the command is trimmed), then
 * `<bash-stdout>…</bash-stdout><bash-stderr>…</bash-stderr>`. Read as text, the
 * first became a bubble and the second was peeled away as harness, so the
 * phone showed that a command ran and never what it printed.
 *
 * Either half may be absent (`command` null on an output-only turn, `output`
 * null on an input-only one); a turn holding both is read as both. Anything
 * else in the turn means it is not shell mode, and it is left to
 * `claudeUserText`.
 *
 * The output is matched greedily. Claude escapes `&`, `<` and `>` in what a
 * command printed (`main -&gt; main` from a `git push`), so its own closing
 * tags cannot occur inside it, but a persisted output (below) is written
 * unescaped and can hold anything. The command itself is never escaped.
 */
export function claudeShell(text: string): ClaudeShell | null {
  let rest = text.trim();
  let command: string | null = null;
  const input = SHELL_INPUT.exec(rest);
  if (input !== null) {
    command = (input[1] ?? '').trim();
    rest = rest.slice(input[0].length).trim();
  }
  if (rest.length === 0) return command === null ? null : { command, output: null };
  const output = SHELL_OUTPUT.exec(rest);
  if (output === null) return null;
  return {
    command,
    output: { stdout: shellText(output[1] ?? output[3] ?? ''), stderr: shellText(output[2] ?? output[4] ?? '') },
  };
}

export interface ClaudeShell {
  command: string | null;
  output: { stdout: string; stderr: string } | null;
}

/** `<bash-input>…</bash-input>` at the start of a turn. A command never holds its own closing tag. */
const SHELL_INPUT = /^<bash-input>([\s\S]*?)<\/bash-input>/;

/** Both output elements, or either one alone. */
const SHELL_OUTPUT = /^(?:<bash-stdout>([\s\S]*)<\/bash-stdout>\s*<bash-stderr>([\s\S]*)<\/bash-stderr>|<bash-stdout>([\s\S]*)<\/bash-stdout>|<bash-stderr>([\s\S]*)<\/bash-stderr>)$/;

/** What Claude writes for a command that printed nothing. Shown as nothing, which the block words itself. */
const NO_OUTPUT = '(Bash completed with no output)';

/**
 * Output as the block shows it: unescaped, no colour codes, no blank lines
 * around it, nothing for Claude's "no output" note.
 *
 * Claude escapes `&`, `<` and `>` in the output (Claude Code 2.1.296), except
 * when the output was too large and it saved it to a file on the host: then
 * the stream is `<persisted-output>` holding a note saying where, and a
 * preview, written as is. The tags are dropped and the note and preview kept.
 */
function shellText(raw: string): string {
  const persisted = PERSISTED.exec(raw);
  const body = persisted !== null ? persisted[1] ?? '' : unescapeShell(raw);
  const text = stripAnsi(body).replace(/^\n+|\s+$/g, '');
  return text === NO_OUTPUT ? '' : text;
}

/** A stream Claude saved to a file on the host, the tags around its note and preview. */
const PERSISTED = /^<persisted-output>([\s\S]*?)(?:<\/persisted-output>\s*)?$/;

/** Undo Claude's escaping of an output stream; `&amp;` last, so `&amp;lt;` stays `&lt;`. */
function unescapeShell(text: string): string {
  return text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

/** A note, not a transcript: the rest stays in the terminal. */
const COMMAND_OUTPUT_MAX = 600;

/**
 * The text a Codex user message should show, or null to show nothing.
 *
 * - Leading context elements are dropped and the typed text after them kept
 *   (`<in-app-browser-context …>…</in-app-browser-context>` then the prompt).
 * - `<image name=… path="…">` references are dropped: the image itself arrives
 *   as its own `input_image` block, and the path is a temp file on the host.
 * - `<send_user_message_question_reply>` is the user's answer to a question,
 *   so its content is shown.
 * - Anything else made only of harness elements (`<heartbeat>`,
 *   `<recommended_plugins>`, `<environment_context>`, …) shows nothing, as do
 *   the AGENTS.md and permission preambles.
 */
export function codexUserText(text: string): string | null {
  const trimmed = text.trim();
  if (/^# AGENTS\.md instructions(?: for [^\n]+)?\s*\n/.test(trimmed)) return null;
  if (/^<permissions instructions>[\s\S]*<\/permissions instructions>$/.test(trimmed)) return null;

  const reply = element(trimmed, 'send_user_message_question_reply');
  if (reply !== null && isSingleElement(trimmed, 'send_user_message_question_reply')) {
    return reply.trim().length === 0 ? null : reply.trim();
  }

  // Context elements come first; what follows them is the prompt.
  const rest = peelHarness(trimmed.replace(IMAGE_REFERENCE, ''));
  return rest.length === 0 ? null : rest;
}

// MARK: - Internals

/** `<pasted_content id="N">…</pasted_content id="N">`, the id repeated on the closing tag. */
const PASTED = /<pasted_content id="([^"]*)">([\s\S]*?)<\/pasted_content id="\1">/g;

/** Codex's reference to a pasted image, with or without a closing tag. */
const IMAGE_REFERENCE = /<image\b[^>]*>(?:\s*<\/image>)?/g;

/** One element at the very start of a string: `<tag …>…</tag>`. */
const LEADING_ELEMENT = /^<([a-z][a-z0-9_-]*)\b[^>]*>[\s\S]*?<\/\1>/;

/**
 * Tags only a harness writes. Multi-word names (with `_` or `-`) are the
 * convention every one of them follows; a person typing `<div>…</div>` into a
 * chat is not hidden. The single-word ones are listed.
 */
function isHarnessTag(tag: string): boolean {
  return /[_-]/.test(tag) || SINGLE_WORD_HARNESS_TAGS.has(tag);
}

const SINGLE_WORD_HARNESS_TAGS = new Set(['heartbeat', 'image']);

/** Tags the harness writes only as a turn of its own, never inside a typed one. */
const OWN_TURN_TAGS: ReadonlySet<string> = new Set(['task-notification', 'agent-message']);

const NO_TAGS: ReadonlySet<string> = new Set();

/**
 * `text` with harness elements peeled off its front, trimmed. Empty when the
 * text was nothing else (`<bash-stdout>…</bash-stdout><bash-stderr></bash-stderr>`
 * is two of them).
 */
function peelHarness(text: string, keep: ReadonlySet<string> = NO_TAGS): string {
  let rest = text.trim();
  for (;;) {
    const lead = LEADING_ELEMENT.exec(rest);
    const tag = lead?.[1] ?? '';
    if (lead === null || !isHarnessTag(tag) || keep.has(tag)) return rest;
    rest = rest.slice(lead[0].length).trim();
  }
}

function isSingleElement(text: string, tag: string): boolean {
  return new RegExp(`^<${tag}\\b[^>]*>[\\s\\S]*</${tag}>$`).test(text.trim());
}

/** The content of the first `<tag>…</tag>` in `text`, or null. */
function element(text: string, tag: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(text);
  return match === null ? null : match[1] ?? '';
}

/**
 * Codex with memories on ends a reply with an `<oai-mem-citation>` block: the
 * memory file lines it drew on and rollout ids, laid out for Codex's own UI to
 * render as a footnote. As text it is a stack of `MEMORY.md:627-640|note=[…]`
 * lines under every answer. An unterminated block (a reply cut off mid-block)
 * goes too.
 */
const MEMORY_CITATION = /\s*<oai-mem-citation>[\s\S]*?(?:<\/oai-mem-citation>|$)/g;

export function codexAssistantText(text: string): string {
  return text.replace(MEMORY_CITATION, '').trimEnd();
}
