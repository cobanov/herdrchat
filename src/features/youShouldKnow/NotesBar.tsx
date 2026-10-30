import { Pressable, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { haptics } from '@/components/haptics';
import { notesBarLine, notesBarText, notesForYou, type Note } from '@/lib/youShouldKnow/notes';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, radius, screenPadding, size, spacing } from '@/theme/tokens';
import { NoteHead } from './NoteCard';

/**
 * The chats' "You should know" line, under the title: the one note as the
 * terminal shows it above its prompt box, `✦ Heads up · <line>`, or
 * `✦ 3 notes for you` over every listed host whose Claude Code has the plugin
 * on. A tap opens the notes. Nothing at all with none, which is also every
 * host without the plugin.
 *
 * Its own sign, not folded into the "need you" count of chats: a chat that
 * needs you is waiting at its prompt; a note is something to know, and the
 * session it is for may be busy with something else.
 */
export function NotesBar({ notes, onPress }: { notes: readonly Note[]; onPress: () => void }) {
  const { colors } = useTheme();
  const bar = notesBarText(notes);
  if (bar === null) return null;
  return (
    <View style={{ paddingHorizontal: screenPadding, paddingBottom: spacing.sm }}>
      <Pressable
        testID="ysk-bar"
        accessibilityRole="button"
        accessibilityLabel={notesBarLine(bar)}
        accessibilityHint="Opens You should know"
        onPress={() => {
          haptics.selection();
          onPress();
        }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          minHeight: minTouchTarget,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderRadius: radius.sm,
          backgroundColor: pressed ? colors.chatCardPressed : colors.chatCard,
        })}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {bar.kind === 'one' ? (
            <NoteHead note={bar.note} numberOfLines={1} />
          ) : (
            <Text variant="subhead" weight="600" numberOfLines={1}>
              <Text variant="subhead" color="tint">{'✦ '}</Text>
              {notesForYou(bar.count)}
            </Text>
          )}
        </View>
        <Icon name="chevron.right" size={size.rowChevron} tintColor={colors.tertiaryLabel} />
      </Pressable>
    </View>
  );
}
