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
 */
const MAX_LENGTH = 40;

export function agentName(label: string, fallback = 'chat'): string {
  const slug = label
    .normalize('NFKD')
    // Strip combining marks, so "café" becomes "cafe" rather than "caf".
    .replaceAll(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, MAX_LENGTH)
    // Slicing can leave a trailing dash that the trim above already removed
    // once; a name ending in punctuation reads as truncated even when it is not.
    .replaceAll(/-+$/g, '');

  return slug.length > 0 ? slug : fallback;
}
