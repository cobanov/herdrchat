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
 * The text a Claude user turn should show, or null to show nothing.
 *
 * - `<pasted_content id="N">…</pasted_content id="N">` (2.1.278+) is unwrapped,
 *   keeping any text typed around it.
 * - A slash command (`<command-name>/model</command-name>` with its message
 *   and args) becomes what was typed: `/model` plus the args.
 * - Shell mode (`<bash-input>ls</bash-input>`) becomes `! ls`.
 * - A turn made only of harness elements (command output, a caveat, a task
 *   notification, a system reminder) shows nothing.
 */
export function claudeUserText(text: string): string | null {
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

  const rest = peelHarness(unwrapped);
  return rest.length === 0 ? null : rest;
}

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

/**
 * `text` with harness elements peeled off its front, trimmed. Empty when the
 * text was nothing else (`<bash-stdout>…</bash-stdout><bash-stderr></bash-stderr>`
 * is two of them).
 */
function peelHarness(text: string): string {
  let rest = text.trim();
  for (;;) {
    const lead = LEADING_ELEMENT.exec(rest);
    if (lead === null || !isHarnessTag(lead[1] ?? '')) return rest;
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
