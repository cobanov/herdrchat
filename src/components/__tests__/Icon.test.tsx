import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render } from '@testing-library/react-native';
import { Platform, StyleSheet } from 'react-native';

import appConfig from '../../../app.json';
import { Icon, MATERIAL_GLYPHS } from '../Icon';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: { label: '#111111' } }),
}));

const originalOS = Object.getOwnPropertyDescriptor(Platform, 'OS');
afterEach(() => {
  if (originalOS) Object.defineProperty(Platform, 'OS', originalOS);
});
function onAndroid() {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
}

// The codepoint is what draws; the name is what a reader checks. They are held
// together against expo-symbols' own table, the one its SymbolView draws from.
it('draws each Android glyph by the codepoint of the Material symbol it names', () => {
  const table = JSON.parse(
    readFileSync(path.join(path.dirname(require.resolve('expo-symbols')), 'android', 'symbols.json'), 'utf8')
  ) as Record<string, number>;
  for (const [name, [material, codepoint]] of Object.entries(MATERIAL_GLYPHS)) {
    expect(`${name}: ${material} ${codepoint.toString(16)}`).toBe(`${name}: ${material} ${table[material]?.toString(16)}`);
  }
});

// SymbolView drew a font-scaled Text in a fixed box, so with the system font
// size above default every glyph outgrew its box: clipped, and off the centre
// of its button.
it('keeps an Android glyph its own size at any font size, in the bundled font', async () => {
  onAndroid();
  const screen = await render(<Icon name="chevron.left" size={20} tintColor="#123456" />);
  const glyph = screen.getByText(String.fromCharCode(MATERIAL_GLYPHS['chevron.left'][1]), { includeHiddenElements: true });
  expect(glyph.props.allowFontScaling).toBe(false);

  const style = StyleSheet.flatten(glyph.props.style);
  expect(style).toMatchObject({ fontSize: 20, lineHeight: 20, color: '#123456', includeFontPadding: false });

  // Android names an asset font after its file: the family drawn here must be
  // the file app.json bundles, or every icon is a box.
  const plugin = appConfig.expo.plugins.find((entry) => Array.isArray(entry) && entry[0] === 'expo-font');
  const fonts = (plugin as [string, { android: { fonts: string[] } }])[1].android.fonts;
  expect(fonts.map((file) => path.basename(file, '.ttf'))).toContain(style.fontFamily);
  for (const file of fonts) expect(() => readFileSync(file)).not.toThrow();
});

it('falls back to the theme label colour', async () => {
  onAndroid();
  const screen = await render(<Icon name="plus" />);
  const glyph = screen.getByText(String.fromCharCode(MATERIAL_GLYPHS.plus[1]), { includeHiddenElements: true });
  expect(StyleSheet.flatten(glyph.props.style).color).toBe('#111111');
});

// The bundled font is outlined only, so a `.fill` symbol draws its outline. An
// unread chat's filled circle came out as the same ring as a read one's.
it('draws unread and read chats as different glyphs on Android', () => {
  expect(MATERIAL_GLYPHS['circle.fill'][1]).not.toBe(MATERIAL_GLYPHS.circle[1]);
});
