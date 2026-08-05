import { Pressable, TextInput, View, type TextInputProps } from 'react-native';

import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, radius, spacing, typography } from '@/theme/tokens';

export interface FieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  mono?: boolean;
}

/** A labelled text field. */
export function Field({ label, mono = false, multiline, ...rest }: FieldProps) {
  const { colors } = useTheme();

  return (
    <View style={{ gap: spacing.xs + 2 }}>
      <Text variant="footnote" color="secondary">
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.tertiaryLabel}
        multiline={multiline}
        autoCorrect={false}
        style={{
          minHeight: multiline === true ? 120 : minTouchTarget,
          borderRadius: radius.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm + 2,
          backgroundColor: colors.secondarySystemBackground,
          color: colors.label,
          fontSize: mono ? typography.footnote.fontSize : typography.body.fontSize,
          ...(mono ? { fontFamily: 'Menlo' } : {}),
          textAlignVertical: multiline === true ? 'top' : 'center',
        }}
        {...rest}
      />
    </View>
  );
}

/**
 * A segmented picker for a small, mutually exclusive choice.
 *
 * `string | number` rather than `string`: the poll-rate preference is genuinely
 * numeric (it multiplies an interval), and stringifying it just to satisfy the
 * picker would mean parsing it back at every use.
 */
export function SegmentedField<T extends string | number>({
  label,
  options,
  value,
  onChange,
  labelInset = 0,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  /**
   * Left inset for the label only.
   *
   * Zero on a form, where the label sits above a full-width control and lines up
   * with the `Field` labels around it. Settings passes the group inset instead,
   * so this label starts at the same x as the row labels inside the cards below
   * it rather than half a step to their left.
   */
  labelInset?: number;
}) {
  const { colors } = useTheme();

  return (
    <View style={{ gap: spacing.xs + 2 }}>
      <Text variant="footnote" color="secondary" style={{ paddingHorizontal: labelInset }}>
        {label}
      </Text>
      <View
        accessibilityRole="radiogroup"
        style={{
          flexDirection: 'row',
          padding: 3,
          borderRadius: radius.sm,
          backgroundColor: colors.secondarySystemBackground,
          gap: 3,
        }}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              onPress={() => onChange(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              testID={`segment-${option.value}`}
              style={{
                flex: 1,
                minHeight: minTouchTarget - 8,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.sm - 3,
                backgroundColor: selected ? colors.systemBackground : 'transparent',
              }}>
              <Text variant="subhead" weight={selected ? '600' : '400'} color={selected ? 'label' : 'secondary'}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
