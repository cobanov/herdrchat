import {
  Text as RNText,
  useWindowDimensions,
  type TextProps as RNTextProps,
  type TextStyle,
} from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { maxFontScale, typography, type TypographyToken } from '@/theme/tokens';

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
 *
 * LINE HEIGHT IS SCALED BY HAND, and it has to be. React Native applies the
 * user's Dynamic Type factor to `fontSize` and leaves `lineHeight` exactly as
 * written — so a token pair of 34/41 rendered 60pt glyphs inside a 41pt line box
 * at the largest accessibility size, and the overflow collided with whatever was
 * next to it. The screen header and the empty state underneath it were drawn on
 * top of each other.
 *
 * Which made the claim above quietly false: Dynamic Type was never switched off,
 * and was broken anyway. Honouring a rule in letter while defeating it in effect
 * is apparently this codebase's favourite mistake.
 *
 * `useWindowDimensions` rather than `PixelRatio.getFontScale()` because it is
 * reactive: changing the setting in iOS Settings re-renders, instead of leaving
 * the app correct only until the next cold start.
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
  const { fontScale } = useWindowDimensions();
  const scale = typography[variant];
  // Display sizes are capped; content is not. See `maxFontScale`.
  const cap = maxFontScale[variant];
  const effective = cap === undefined ? fontScale : Math.min(fontScale, cap);

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
      maxFontSizeMultiplier={cap}
      style={[
        {
          fontSize: scale.fontSize,
          lineHeight: scale.lineHeight * effective,
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
