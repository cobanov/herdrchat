import { useState } from 'react';

import { Glass } from '@/components/Glass';
import { Text } from '@/components/Text';
import type { Note } from '@/lib/youShouldKnow/notes';
import { radius, spacing } from '@/theme/tokens';
import { discussHere, dismissAbout, knowAbout, learnMoreAbout, openLearningPage } from './actions';
import { NoteCard } from './NoteCard';

/**
 * The note "You should know" is showing for this chat's session, above the
 * composer, as the terminal shows it above its prompt box: the line, the
 * explanation once Learn more has been pressed, and the same choices.
 * Discuss in chat puts the plugin's own draft in the composer and lets the
 * note go, as the terminal's "Chat in main session" does.
 *
 * Over the controls, never in the thread: the list's position belongs to
 * `useThreadScroll` alone.
 */
export function ChatNoteBar({ connectionId, note, onDraft }: {
  connectionId: string;
  note: Note;
  /** Replaces the composer's text. */
  onDraft: (text: string) => void;
}) {
  // Kept with the note it was about: a different note starts with no error from the last one.
  const [error, setError] = useState<{ noteKey: string; message: string } | null>(null);
  const noteKey = `${note.sessionId}/${note.view.kind}/${note.view.shownAt}`;
  const shownError = error?.noteKey === noteKey ? error.message : null;

  return (
    <Glass testID="ysk-chat-bar" style={{ borderRadius: radius.lg, overflow: 'hidden', padding: spacing.md, gap: spacing.sm }}>
      <NoteCard
        note={note}
        idPrefix="ysk-chat"
        bounded
        actions={{
          onLearnMore: () => learnMoreAbout(connectionId, note),
          onKnow: () => knowAbout(connectionId, note),
          onDismiss: () => dismissAbout(connectionId, note),
          onDiscuss: () => discussHere(connectionId, note, onDraft),
          onOpenPage: openLearningPage,
          onError: (message) => setError({ noteKey, message }),
        }}
      />
      {shownError !== null && (
        <Text testID="ysk-chat-error" variant="footnote" color="destructive">{shownError}</Text>
      )}
    </Glass>
  );
}
