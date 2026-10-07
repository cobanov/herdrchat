/**
 * Pinned and muted chats: choices made on this phone about one conversation.
 *
 * Kept per workspace but stamped with the session, like read markers: herdr
 * reuses workspace slots, and a new chat landing in a pinned or muted slot
 * must not inherit either. A pref whose session no longer matches is simply
 * not in force; it is replaced the next time that slot is pinned or muted.
 */

export interface ChatPref {
  /** `sessionSignature` of the chat when the choice was made. */
  sessionSig: string;
  /** When it was pinned, which orders the pinned group; null when not pinned. */
  pinnedAt: number | null;
  muted: boolean;
}

/** The pref in force for a chat, or null. A chat with no session id yet has none. */
export function activePref(
  prefs: ReadonlyMap<string, ChatPref>,
  workspaceId: string,
  sessionSig: string | null
): ChatPref | null {
  if (sessionSig === null) return null;
  const pref = prefs.get(workspaceId);
  return pref !== undefined && pref.sessionSig === sessionSig ? pref : null;
}

/**
 * The agent session ids the host's watcher should stay quiet about.
 *
 * The watcher sees raw session values (`agent_session.value`), while a
 * signature joins every agent's and marks Codex ones (`codex:<id>`) and Pi or
 * OMP ones (`pi:` / `omp:<kind>:<encoded value>`, often a path), so this undoes them. Muting by session rather than workspace is what keeps a later chat in
 * the same slot audible.
 */
export function mutedSessionIds(prefs: Iterable<ChatPref>): string[] {
  const ids = new Set<string>();
  for (const pref of prefs) {
    if (!pref.muted) continue;
    for (const part of pref.sessionSig.split(',')) {
      const id = rawSessionValue(part);
      if (id.length > 0) ids.add(id);
    }
  }
  return [...ids].sort();
}

/** One part of a session signature back to herdr's `agent_session.value`. */
function rawSessionValue(part: string): string {
  if (part.startsWith('codex:')) return part.slice('codex:'.length);
  const journal = /^(?:pi|omp):[a-z]+:(.*)$/.exec(part);
  if (journal === null) return part;
  try {
    return decodeURIComponent(journal[1] ?? '');
  } catch {
    return '';
  }
}
