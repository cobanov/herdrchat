import * as Clipboard from 'expo-clipboard';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { Text } from '@/components/Text';
import { haptics } from '@/lib/haptics';
import type { PromptDetails as Details } from '@/lib/transcript/blockedPrompt';
import { useTheme } from '@/theme/ThemeProvider';
import { motion, radius, size, spacing } from '@/theme/tokens';

/**
 * What a permission prompt is asking to do, above its question in the blocked
 * bar: the tool, its description, the command or diff, and Claude's warnings.
 *
 * Without it the bar said only "Do you want to proceed?", and the one thing a
 * person needs to answer that, what would run, was on a terminal they could
 * not see.
 *
 * The body is a terminal's lines, so it scrolls sideways rather than wrapping
 * (a wrapped command line reads as a different command), and folds past
 * `size.blockedBodyLines` so the choices stay on a phone's screen. The fold is
 * keyed by the caller to the prompt, so a new command opens folded.
 *
 * The deadline is shown as Claude last printed it. There is no countdown here:
 * the phone's clock is not the agent's, and each poll brings the real figure.
 */
export function PromptDetails({ details }: { details: Details }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const { body } = details;
  const folds = body.length > size.blockedBodyLines;
  const shown = folds && !open ? body.slice(0, size.blockedBodyLines) : body;
  const text = body.join('\n');

  const copy = useCallback(() => {
    void Clipboard.setStringAsync(text);
    haptics.success();
  }, [text]);
  // The native recognizer, as on a message bubble: a Pressable would become
  // the JS responder and stop the body scrolling sideways.
  const longPress = useMemo(
    () => Gesture.LongPress().minDuration(motion.longPress).runOnJS(true).onStart(() => copy()),
    [copy]
  );

  const [tool, ...rest] = (details.title ?? '').split(' · ');
  const origin = rest.join(' · ');
  // The deadline has its own line; the sentence it came from would say it twice.
  const notes = details.deadline === null ? details.notes : details.notes.filter((note) => !note.includes(details.deadline ?? ''));

  return (
    <View testID="blocked-details" style={{ gap: spacing.xs }}>
      {details.title !== null && (
        <Text variant="footnote" testID="blocked-details-title">
          <Text variant="footnote" weight="700">
            {tool}
          </Text>
          {origin.length > 0 ? ` · ${origin}` : ''}
        </Text>
      )}
      {details.summary !== null && (
        <Text variant="footnote" color="secondary">
          {details.summary}
        </Text>
      )}
      {body.length > 0 && (
        <GestureDetector gesture={longPress}>
          <View
            testID="blocked-details-body"
            accessible
            accessibilityLabel={text}
            accessibilityHint="Long press to copy"
            accessibilityActions={[{ name: 'longpress', label: 'Copy' }]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'longpress') copy();
            }}
            style={{ borderRadius: radius.xs, backgroundColor: colors.fillSubtle, padding: spacing.sm }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Text variant="caption" mono selectable>
                {shown.join('\n')}
              </Text>
            </ScrollView>
          </View>
        </GestureDetector>
      )}
      {folds && (
        <Pressable
          onPress={() => setOpen(!open)}
          accessibilityRole="button"
          testID="blocked-details-fold"
          hitSlop={spacing.sm}>
          <Text variant="caption" color="tint" weight="600">
            {open ? 'Show less' : `Show all ${body.length} lines`}
          </Text>
        </Pressable>
      )}
      {notes.map((note, index) => (
        <Text key={index} variant="caption" color="attention">
          {note}
        </Text>
      ))}
      {details.deadline !== null && (
        <Text variant="caption" color="attention" weight="600" testID="blocked-details-deadline">
          {`Auto-denies in ${details.deadline}`}
        </Text>
      )}
    </View>
  );
}
