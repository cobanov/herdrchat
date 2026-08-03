import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { typography, type TypographyToken } from '@/theme/tokens';

type ColorRole = 'label' | 'secondary' | 'tertiary' | 'tint' | 'attention' | 'onTint' | 'destructive';

export interface TextProps extends RNTextProps {
  variant?: TypographyToken;
  color?: ColorRole;
  weight?: TextStyle['fontWeight'];
  mono?: boolean;
}

/**
 * The app's only text primitive.
 *
 * Two things it guarantees that a bare `<Text>` does not: every string picks its
 * size from the scale rather than a magic number, and Dynamic Type is never
 * switched off — `allowFontScaling` stays at its default, so a caller has to go
 * out of its way to break accessibility rather than getting it wrong by
 * omission.
 */
export function Text({
  variant = 'body',
  color = 'label',
  weight,
  mono = false,
  style,
  ...rest
}: TextProps) {
  const { colors } = useTheme();
  const scale = typography[variant];

  const palette: Record<ColorRole, string> = {
    label: colors.label,
    secondary: colors.secondaryLabel,
    tertiary: colors.tertiaryLabel,
    tint: colors.tint,
    attention: colors.attention,
    onTint: colors.onTint,
    destructive: colors.destructive,
  };

  return (
    <RNText
      style={[
        {
          fontSize: scale.fontSize,
          lineHeight: scale.lineHeight,
          fontWeight: weight ?? (scale.fontWeight as TextStyle['fontWeight']),
          color: palette[color],
        },
        // The system font is the correct choice here, so it is left unset rather
        // than named. Monospace is the one deliberate departure: tool activity
        // should read as terminal output, not as prose.
        mono && { fontFamily: 'Menlo' },
        style,
      ]}
      {...rest}
    />
  );
}
