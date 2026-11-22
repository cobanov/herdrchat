/**
 * A herdr agent name derived from a workspace label.
 *
 * The name is not decoration: `agent start <name>` registers it, and it is what
 * `herdr agent list` shows on the desktop. Someone looking at that list should
 * see the same thing the phone calls the chat, or the two views of one machine
 * stop being about the same machine.
 *
 * Conservative about characters, because this ends up as a shell argument, a
 * herdr identifier and probably a filename somewhere. Letters, digits, dash.
 * Everything else collapses to a single dash, and a label that survives none of
 * that gets a stable fallback rather than an empty name.
 *
 * herdr itself accepts `[a-z][a-z0-9_-]{0,31}`: a lowercase letter first and at
 * most 32 characters. A name outside that is refused with `invalid_agent_name`
 * and the chat never starts, so a folder called `2024-notes` gets the fallback
 * in front of it, and a long one is cut to fit.
 */
const MAX_LENGTH = 32;

export function agentName(label: string, fallback = 'chat'): string {
  const slug = label
    .normalize('NFKD')
    // Strip combining marks, so "café" becomes "cafe" rather than "caf".
    .replaceAll(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');

  if (slug.length === 0) return fallback;
  return fit(/^[a-z]/.test(slug) ? slug : `${fallback}-${slug}`, MAX_LENGTH);
}

/**
 * The `n`th name for the same label: `myapp-2`, `myapp-3`, …
 *
 * herdr wants a name to be unique among live agents, and a second chat in the
 * same folder derives the same name as the first. The suffix always survives:
 * the base is shortened to make room for it, so a numbered name never comes out
 * longer than herdr allows, and never the same as the one it replaces.
 */
export function numberedAgentName(name: string, n: number): string {
  const suffix = `-${n}`;
  return fit(name, MAX_LENGTH - suffix.length) + suffix;
}

function fit(name: string, length: number): string {
  // Slicing can leave a trailing dash; a name ending in punctuation reads as
  // truncated even when it is not.
  return name.slice(0, length).replaceAll(/-+$/g, '');
}
