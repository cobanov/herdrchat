import {
  Pressable,
  TextInput,
  useWindowDimensions,
  View,
  type TextInputProps,
} from 'react-native';

import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, nestedRadius, radius, size, spacing, typography } from '@/theme/tokens';

export interface FieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  mono?: boolean;
}

/** A labelled text field. */
export function Field({ label, mono = false, multiline, ...rest }: FieldProps) {
  const { colors } = useTheme();

  return (
    <View style={{ gap: spacing.sm }}>
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
          paddingVertical: spacing.md,
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
  const { fontScale } = useWindowDimensions();
  /**
   * The one place this app has a breakpoint, and the axis is TEXT SIZE, not
   * screen width.
   *
   * Three labels side by side stop fitting a phone long before the largest
   * accessibility size: at AX5 "System" rendered as "Syst" with "em" wrapped
   * underneath, which leaves the reader unable to tell what they are choosing
   * between. A segmented control is a horizontal idiom, and past a certain size
   * the honest thing is to stop being one — so it becomes a stack of radio rows,
   * which is what a picker looks like when it has room to be read.
   *
   * 1.5 is where the accessibility sizes begin. Below it nothing changes.
   */
  const stacked = fontScale >= STACK_ABOVE_FONT_SCALE;

  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="footnote" color="secondary" style={{ paddingHorizontal: labelInset }}>
        {label}
      </Text>
      <View
        accessibilityRole="radiogroup"
        style={{
          flexDirection: stacked ? 'column' : 'row',
          padding: size.segmented.inset,
          borderRadius: radius.sm,
          backgroundColor: colors.secondarySystemBackground,
          gap: size.segmented.inset,
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
                // Stacked rows size to their content; side-by-side segments
                // share the width equally. `flex: 1` in a column would make each
                // row a third of the control's height, which is not the same
                // thing at all.
                ...(stacked ? { alignSelf: 'stretch' } : { flex: 1 }),
                minHeight: size.segmented.height,
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: stacked ? spacing.sm : 0,
                borderRadius: nestedRadius(radius.sm, size.segmented.inset),
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

/**
 * Where a horizontal picker gives up and stacks.
 *
 * Exported so a test can assert the threshold rather than re-deriving it, and
 * so the number has one home — this is the app's only breakpoint and it should
 * not turn into a literal sprinkled across components.
 */
export const STACK_ABOVE_FONT_SCALE = 1.5;
