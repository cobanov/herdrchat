import { SymbolView, type AndroidSymbol } from 'expo-symbols';
import type { ComponentProps, ReactNode } from 'react';
import { Platform, Text as RNText, View } from 'react-native';

import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';

type SFSymbolName = Extract<ComponentProps<typeof SymbolView>['name'], string>;

/**
 * The Material Symbol drawn for each SF Symbol on Android: its name, and the
 * codepoint that draws it in the font `app.json` bundles.
 *
 * Every icon the app uses is a key here, and `IconName` is derived from the
 * keys, so a new icon without an Android glyph is a type error rather than the
 * "•" fallback it used to render (#4 acceptance). The name is what a person
 * reads; the codepoint is what draws, and a test pins one to the other against
 * expo-symbols' own table.
 *
 * The bundled font is Material Symbols at FILL 0, so a `.fill` symbol draws the
 * outlined glyph. Where filled and outlined mean different things, the pair is
 * two different glyphs instead: an unread chat is `radio_button_checked`
 * beside a read one's `radio_button_unchecked`, where a filled circle was the
 * same ring as an empty one.
 */
const MATERIAL = {
  'arrow.clockwise': ['refresh', 0xe5d5],
  'arrow.down.circle.fill': ['arrow_circle_down', 0xf181],
  'arrow.up.circle': ['arrow_circle_up', 0xf182],
  'arrow.up.circle.fill': ['arrow_circle_up', 0xf182],
  'arrow.up.right': ['north_east', 0xf1e1],
  'asterisk': ['asterisk', 0xf525],
  'bell': ['notifications', 0xe7f4],
  'bell.slash': ['notifications_off', 0xe7f6],
  'bell.slash.fill': ['notifications_off', 0xe7f6],
  'bubble.left.and.bubble.right': ['forum', 0xe0bf],
  'bubble.left.and.bubble.right.fill': ['forum', 0xe0bf],
  'checklist': ['checklist', 0xe6b1],
  'checkmark': ['check', 0xe5ca],
  'checkmark.circle': ['check_circle', 0xe86c],
  'checkmark.square.fill': ['check_box', 0xe834],
  'chevron.down': ['expand_more', 0xe5cf],
  'chevron.left': ['chevron_left', 0xe5cb],
  'chevron.left.forwardslash.chevron.right': ['code', 0xe86f],
  'chevron.right': ['chevron_right', 0xe5cc],
  'chevron.right.2': ['keyboard_double_arrow_right', 0xeac9],
  'chevron.up': ['expand_less', 0xe5ce],
  'circle': ['radio_button_unchecked', 0xe836],
  'circle.fill': ['radio_button_checked', 0xe837],
  'cpu': ['memory', 0xe322],
  'desktopcomputer': ['computer', 0xe30a],
  'doc.on.clipboard': ['content_paste', 0xe14f],
  'doc.text': ['description', 0xe873],
  'ellipsis.circle': ['pending', 0xef64],
  // A bubble with "!", not `chat_error`, which is a bubble with an X: the bar
  // asks a question, nothing failed.
  'exclamationmark.bubble.fill': ['feedback', 0xe87f],
  'exclamationmark.circle': ['error', 0xe000],
  'exclamationmark.triangle': ['warning', 0xe002],
  'exclamationmark.triangle.fill': ['warning', 0xe002],
  'folder.fill': ['folder', 0xe2c7],
  'gearshape': ['settings', 0xe8b8],
  'gearshape.fill': ['settings', 0xe8b8],
  'globe': ['language', 0xe894],
  'keyboard': ['keyboard', 0xe312],
  'keyboard.chevron.compact.down': ['keyboard_hide', 0xe31a],
  'magnifyingglass': ['search', 0xe8b6],
  'network': ['lan', 0xeb2f],
  'pencil': ['edit', 0xe3c9],
  'person.2': ['group', 0xe7ef],
  'photo': ['image', 0xe3f4],
  'photo.on.rectangle': ['photo_library', 0xe413],
  'pin': ['push_pin', 0xf10d],
  'pin.fill': ['push_pin', 0xf10d],
  'pin.slash': ['keep_off', 0xe6f9],
  'plus': ['add', 0xe145],
  'puzzlepiece.extension': ['extension', 0xe87b],
  'questionmark.bubble': ['contact_support', 0xe94c],
  'server.rack': ['dns', 0xe875],
  'slider.horizontal.3': ['tune', 0xe429],
  'sparkles': ['auto_awesome', 0xe65f],
  'square': ['check_box_outline_blank', 0xe835],
  'square.and.pencil': ['edit_square', 0xf88d],
  'square.stack.3d.up': ['stacks', 0xf500],
  'star.fill': ['star', 0xe838],
  'stop.circle': ['stop_circle', 0xef71],
  'terminal': ['terminal', 0xeb8e],
  'tray': ['inbox', 0xe156],
  'wrench.and.screwdriver': ['build', 0xe869],
  'wrench.and.screwdriver.fill': ['build', 0xe869],
  'xmark': ['close', 0xe5cd],
  'xmark.circle.fill': ['cancel', 0xe5c9],
} as const satisfies Partial<Record<SFSymbolName, readonly [AndroidSymbol, number]>>;

/** SF Symbol names with an Android glyph, so callers can't invent one. */
export type IconName = keyof typeof MATERIAL;

/** Exported for the test that pins each codepoint to its name. */
export const MATERIAL_GLYPHS: Readonly<Record<IconName, readonly [AndroidSymbol, number]>> = MATERIAL;

/**
 * The font family of the Material Symbols file the expo-font plugin copies into
 * the Android assets (see `app.json`). Android names an asset font after its
 * file, so this string and that path change together.
 */
const MATERIAL_FONT = 'MaterialSymbols_400Regular';

/**
 * SF Symbols on iOS, Material Symbols on Android.
 *
 * A thin wrapper so screens can take an `IconName` prop rather than a bare
 * string — the symbol set is typed, and a typo'd name renders nothing at all on
 * a device, which is exactly the sort of thing that survives review.
 *
 * Android draws the glyph itself rather than through expo-symbols' SymbolView,
 * which renders an ordinary font-scaled Text in a fixed `size` box. With the
 * system font size above default the glyph outgrew its box: clipped on the
 * right and pushed below the centre of every round button, the misalignment
 * people saw. A symbol keeps its size here, as an SF Symbol does on iOS, and
 * the font is bundled rather than loaded per icon, which drew every icon empty
 * for a frame each time a row mounted.
 *
 * Named `Icon`, not `Symbol`: the latter shadows the global `Symbol`
 * constructor, which TypeScript reports as an unrelated JSX error.
 */
export function Icon({
  name,
  size = 17,
  tintColor,
  fallback,
  type,
}: {
  name: IconName;
  size?: number;
  tintColor?: string;
  fallback?: ReactNode;
  type?: ComponentProps<typeof SymbolView>['type'];
}) {
  const { colors } = useTheme();

  if (Platform.OS === 'android') {
    const [, codepoint] = MATERIAL[name];
    return (
      <View
        importantForAccessibility="no-hide-descendants"
        style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        {/* The bare Text, not ours: ours keeps Dynamic Type on, and a glyph
            that scales with body text is exactly the overflow above. */}
        <RNText
          allowFontScaling={false}
          style={{
            fontFamily: MATERIAL_FONT,
            fontSize: size,
            lineHeight: size,
            color: tintColor ?? colors.label,
            includeFontPadding: false,
            textAlign: 'center',
            textAlignVertical: 'center',
          }}>
          {String.fromCharCode(codepoint)}
        </RNText>
      </View>
    );
  }

  return (
    <SymbolView
      name={name}
      size={size}
      type={type}
      tintColor={tintColor}
      fallback={fallback ?? <Text variant="caption">•</Text>}
    />
  );
}
