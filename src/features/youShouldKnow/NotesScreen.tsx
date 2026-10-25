import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { askedAt, notesForYou } from '@/lib/youShouldKnow/notes';
import { useTheme } from '@/theme/ThemeProvider';
import { screenPadding, spacing } from '@/theme/tokens';
import { discussInChat, dismissAbout, goToNoteChat, knowAbout, learnMoreAbout, openLearningPage } from './actions';
import { NoteCard } from './NoteCard';
import { useAllNotes, type HostNote } from './useHostNotes';
import { useReadNotes } from './useReadNotes';

/** Where a note is from: its chat (and host, with several), or another session on its computer. */
function from(entry: HostNote, showHost: boolean): string {
  if (entry.chat === null) return `another session on ${entry.hostName}`;
  return showHost ? `${entry.chat.title} · ${entry.hostName}` : entry.chat.title;
}

/**
 * "You should know": every note the plugin is showing on the listed hosts,
 * newest first, each with the terminal's choices. A note for a session no
 * chat here runs (every Claude Code session on a computer shares the store)
 * can only be known or dismissed. Opened from the chats' bar, and reads the
 * stores itself while open, since the list's poll is paused under it.
 */
export default function NotesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { notes, connectionIds } = useAllNotes();
  useReadNotes(connectionIds);
  const hostCount = connectionIds.length;
  const [error, setError] = useState<string | null>(null);
  // When the screen opened: "Today" means the day it was read on.
  const [now] = useState(() => Date.now());

  return (
    <Screen presentation="sheet">
      <Header title="You should know" onClose={() => router.back()} />
      {error !== null && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      <ScrollView
        testID="ysk-list"
        contentContainerStyle={{ paddingHorizontal: screenPadding, paddingBottom: insets.bottom + spacing.xl, gap: spacing.md }}>
        <Text testID="ysk-summary" variant="subhead" color="secondary">
          {notes.length === 0 ? 'No notes for you.' : notesForYou(notes.length)}
        </Text>
        {notes.map((entry, index) => {
          const { note, connectionId, chat } = entry;
          return (
            <View
              key={`${connectionId}/${note.sessionId}`}
              testID={`ysk-row-${note.sessionId}`}
              style={{ paddingVertical: spacing.sm, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: colors.separator }}>
              <NoteCard
                note={note}
                idPrefix="ysk"
                header={
                  <Text testID={`ysk-from-${note.sessionId}`} variant="caption" color="secondary">
                    {`${from(entry, hostCount > 1)} · ${askedAt(note.view.shownAt, now)}`}
                  </Text>
                }
                actions={{
                  // Only for a listed chat: another session's note is known or dismissed, never explained here.
                  onLearnMore: chat === null ? undefined : () => learnMoreAbout(connectionId, note),
                  onKnow: () => knowAbout(connectionId, note),
                  onDismiss: () => dismissAbout(connectionId, note),
                  onDiscuss: chat === null ? undefined : () => discussInChat(connectionId, note, chat),
                  onGo: chat === null ? undefined : () => goToNoteChat(connectionId, chat),
                  onOpenPage: openLearningPage,
                  onError: setError,
                }}
              />
            </View>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
