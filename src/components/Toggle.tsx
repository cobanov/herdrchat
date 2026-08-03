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
        trackColor={{ true: colors.tint, false: colors.fillSubtle }}
        accessibilityLabel={label}
        accessibilityHint={detail}
        testID={testID}
      />
    </View>
  );
}
