import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { Markdown } from '@/components/Markdown';
import { Text } from '@/components/Text';
import { haptics } from '@/components/haptics';
import type { Note } from '@/lib/youShouldKnow/notes';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, size, spacing } from '@/theme/tokens';

/**
 * What a note's buttons do. Each resolves to null, or the sentence saying why
 * it did not happen. An action left out is not offered.
 */
export interface NoteActions {
  /** Only when the note's chat is listed. */
  onLearnMore?: () => Promise<string | null>;
  onKnow: () => Promise<string | null>;
  onDismiss: () => Promise<string | null>;
  /** Only when the note's chat is listed. */
  onDiscuss?: () => Promise<string | null>;
  /** Only when the note's chat is listed and is not the one on screen. */
  onGo?: () => void;
  onOpenPage: (url: string) => Promise<string | null>;
  onError: (message: string) => void;
}

/** A small action, as the terminal lists its choices under a note. */
function Action({ label, testID, onPress, disabled = false }: {
  label: string;
  testID: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={spacing.xs}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      style={({ pressed }) => ({
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: radius.full,
        backgroundColor: pressed || disabled ? colors.fillSubtle : colors.tintMuted,
      })}>
      <Text variant="footnote" weight="600" color={disabled ? 'secondary' : 'tint'}>{label}</Text>
    </Pressable>
  );
}

/** `✦ Heads up · <line>`: the star in the accent colour and the tag dimmed, as the terminal draws it. */
export function NoteHead({ note, numberOfLines }: { note: Pick<Note, 'tag' | 'view'>; numberOfLines?: number }) {
  return (
    <Text variant="subhead" weight="600" numberOfLines={numberOfLines}>
      <Text variant="subhead" color="tint">{'✦ '}</Text>
      <Text variant="subhead" color="secondary">{`${note.tag} · `}</Text>
      {note.view.line}
    </Text>
  );
}

/**
 * One note with what can be done about it, by what the terminal is showing:
 *
 * - offered: Learn more (when the side agent wrote the explanation; without
 *   one only the terminal can have it written), Knew this already, Discuss
 *   in chat, Dismiss, Go.
 * - explained: the explanation, then Understood, Discuss in chat, Dismiss, Go.
 * - a learning page made: its address, and Dismiss.
 *
 * `idPrefix` keeps the screen's and a chat's buttons apart for the UI tests;
 * `bounded` keeps a long explanation to a scrollable box, for the chat's bar.
 */
export function NoteCard({ note, actions, idPrefix, bounded = false, header }: {
  note: Note;
  actions: NoteActions;
  idPrefix: string;
  bounded?: boolean;
  /** Under the line: where the note is from and when, on the screen. */
  header?: ReactNode;
}) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const id = (name: string) => `${idPrefix}-${name}-${note.sessionId}`;
  const { view } = note;

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    let error: string | null;
    try {
      error = await work();
    } catch {
      error = 'Something went wrong. Try again.';
    } finally {
      setBusy(false);
    }
    if (error !== null) actions.onError(error);
  };

  const discuss = actions.onDiscuss;
  const learnMore = actions.onLearnMore;
  const explanation = view.kind === 'explained' ? view.text : null;
  const body = explanation === null ? null : <Markdown text={explanation} />;

  return (
    <View testID={id('note')} style={{ gap: spacing.xs }}>
      <NoteHead note={note} />
      {header}
      {body !== null && (
        <View testID={id('explanation')} style={{ paddingTop: spacing.xs }}>
          {bounded ? <ScrollView style={{ maxHeight: size.noteExplanationMaxHeight }} nestedScrollEnabled>{body}</ScrollView> : body}
        </View>
      )}
      {view.kind === 'ready' && (
        <Pressable
          testID={id('page')}
          accessibilityRole="link"
          onPress={() => void run(() => actions.onOpenPage(view.url))}>
          <Text variant="footnote" color="secondary">
            {'Learning page ready: '}
            <Text variant="footnote" color="tint">{view.url}</Text>
          </Text>
        </Pressable>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xs }}>
        {view.kind === 'offer' && view.explanation !== null && learnMore !== undefined && (
          <Action label="Learn more" testID={id('learn-more')} disabled={busy} onPress={() => void run(learnMore)} />
        )}
        {view.kind === 'offer' && (
          <Action label="Knew this already" testID={id('knew')} disabled={busy} onPress={() => void run(actions.onKnow)} />
        )}
        {view.kind === 'explained' && (
          <Action label="Understood" testID={id('understood')} disabled={busy} onPress={() => void run(actions.onKnow)} />
        )}
        {view.kind !== 'ready' && discuss !== undefined && (
          <Action label="Discuss in chat" testID={id('discuss')} disabled={busy} onPress={() => void run(discuss)} />
        )}
        <Action label="Dismiss" testID={id('dismiss')} disabled={busy} onPress={() => void run(actions.onDismiss)} />
        {view.kind !== 'ready' && actions.onGo !== undefined && (
          <Action label="Go" testID={id('go')} onPress={actions.onGo} />
        )}
        {busy && <ActivityIndicator size="small" color={colors.secondaryLabel} />}
      </View>
    </View>
  );
}
