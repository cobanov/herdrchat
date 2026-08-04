import { Switch, View } from 'react-native';

import { Text } from './Text';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, spacing } from '@/theme/tokens';

/**
 * A labelled switch row, with an optional line of explanation underneath.
 *
 * The explanation is not decoration: every toggle in this app changes what you
 * see or what leaves the device, and a switch labelled only "Tool activity"
 * makes you flip it to find out what it does.
 */
export function Toggle({
  label,
  detail,
  value,
  onChange,
  disabled = false,
  testID,
}: {
  label: string;
  detail?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        // Padding, not a centred minHeight. Rows sit directly against the
        // dividers between them, so with a height floor the gap depended on how
        // long the row's own explanation was: a two-line detail overflowed the
        // floor and touched the rule, while a one-line one was centred inside it
        // and sat well clear. Padding gives every row the same space above and
        // below regardless of how much it has to say.
        paddingVertical: spacing.sm,
        // The row owns its horizontal inset rather than inheriting it from the
        // card, so a divider can stop short of the label's left edge — and so
        // every row type in a group starts at the same x whether it holds a
        // switch, a value or a button.
        paddingHorizontal: spacing.md,
        // Still a floor, for a platform whose switch renders shorter than ours.
        minHeight: minTouchTarget,
        opacity: disabled ? 0.5 : 1,
      }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body">{label}</Text>
        {detail !== undefined && (
          <Text variant="footnote" color="secondary">
            {detail}
          </Text>
        )}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          haptics.selection();
          onChange(next);
        }}
        // The off track is what makes a switch visible when it is off — the knob
        // is white and iOS draws no border around it.
        trackColor={{ true: colors.tint, false: colors.controlTrack }}
        // iOS tints the knob, not the track, when this is set; leaving it unset
        // keeps the system's white knob and its shadow, which is the thing that
        // separates knob from track at all.
        ios_backgroundColor={colors.controlTrack}
        accessibilityLabel={label}
        accessibilityHint={detail}
        testID={testID}
      />
    </View>
  );
}
