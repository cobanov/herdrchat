import { create } from 'zustand';

/**
 * Unsent composer text, per chat, for as long as the app runs.
 *
 * It lived in the thread screen's state, so backing out of a chat threw away
 * whatever was half typed (#113). Each draft remembers which conversation it
 * was written for: herdr reuses workspace slots, and text typed to one agent
 * must not turn up in the composer of the next chat in the same slot.
 */
export interface Draft {
  text: string;
  /** `sessionSignature` of the chat when it was typed; null before one was known. */
  sessionSig: string | null;
}

interface DraftsState {
  drafts: Readonly<Record<string, Draft>>;
  save: (key: string, text: string, sessionSig: string | null) => void;
}

export const draftKey = (connectionId: string, workspaceId: string): string =>
  `${connectionId}\n${workspaceId}`;

export const useDrafts = create<DraftsState>((set) => ({
  drafts: {},
  save: (key, text, sessionSig) =>
    set((state) => {
      const drafts = Object.fromEntries(Object.entries(state.drafts).filter(([existing]) => existing !== key));
      if (text.length > 0) drafts[key] = { text, sessionSig };
      return { drafts };
    }),
}));

/**
 * The text to show for a stored draft now that the chat's session is `sessionSig`.
 *
 * Empty when both are known and differ: the draft belongs to the conversation
 * that used to hold this slot. Worked out while rendering rather than by
 * deleting the entry in an effect; the next keystroke overwrites it anyway.
 */
export function visibleDraft(draft: Draft | undefined, sessionSig: string | null): string {
  if (draft === undefined) return '';
  if (draft.sessionSig !== null && sessionSig !== null && draft.sessionSig !== sessionSig) return '';
  return draft.text;
}
