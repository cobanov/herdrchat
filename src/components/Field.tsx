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
          borderRadius: radius.card,
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

/** A segmented picker for a small, mutually exclusive choice. */
export function SegmentedField<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  const { colors } = useTheme();

  return (
    <View style={{ gap: spacing.xs + 2 }}>
      <Text variant="footnote" color="secondary">
        {label}
      </Text>
      <View
        accessibilityRole="radiogroup"
        style={{
          flexDirection: 'row',
          padding: 3,
          borderRadius: radius.card,
          backgroundColor: colors.secondarySystemBackground,
          gap: 3,
        }}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
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
                borderRadius: radius.card - 3,
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
