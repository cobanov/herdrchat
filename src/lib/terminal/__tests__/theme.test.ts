import { darkPalette, lightPalette } from '../../../theme/tokens';
import { contrastRatio, MIN_TEXT_CONTRAST, parseColor } from '../../theme/color';
import { MIN_CURSOR_CONTRAST, MIN_DIM_CONTRAST, terminalTheme } from '../theme';

const rgb = (hex: string) => parseColor(hex)!;
const HEX = /^#[0-9A-F]{6}$/;

describe.each([
  ['dark', darkPalette, true],
  ['light', lightPalette, false],
] as const)('terminalTheme (%s)', (_name, palette, dark) => {
  const theme = terminalTheme(palette, dark);
  const background = rgb(theme.background);

  it('takes the background and the text from the palette', () => {
    expect(theme.background).toBe(palette.systemBackground.toUpperCase());
    expect(theme.foreground).toBe(palette.label.toUpperCase());
    expect(theme.dark).toBe(dark);
  });

  it('has exactly sixteen ANSI colours, all #RRGGBB', () => {
    expect(theme.ansi).toHaveLength(16);
    for (const colour of [...theme.ansi, theme.background, theme.foreground, theme.cursor, theme.selection]) {
      expect(colour).toMatch(HEX);
    }
  });

  it('keeps the six colours readable as text on the background', () => {
    for (const colour of theme.ansi.slice(1, 7)) {
      expect(contrastRatio(rgb(colour), background)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
    for (const colour of theme.ansi.slice(9, 15)) {
      expect(contrastRatio(rgb(colour), background)).toBeGreaterThanOrEqual(MIN_DIM_CONTRAST);
    }
  });

  it('keeps dim text (bright black) readable', () => {
    expect(contrastRatio(rgb(theme.ansi[8]!), background)).toBeGreaterThanOrEqual(MIN_DIM_CONTRAST);
  });

  it('draws the cursor in the tint where it shows, against the background', () => {
    expect(contrastRatio(rgb(theme.cursor), background)).toBeGreaterThanOrEqual(MIN_CURSOR_CONTRAST);
    expect(theme.cursor).toBe(palette.tint.toUpperCase());
  });

  it('makes black dark and white light, whatever the background', () => {
    const lum = (hex: string) => {
      const { r, g, b } = rgb(hex);
      return r + g + b;
    };
    expect(lum(theme.ansi[0]!)).toBeLessThan(lum(theme.ansi[7]!));
    expect(lum(theme.ansi[8]!)).toBeLessThan(lum(theme.ansi[15]!));
  });

  it('reads red as red and green as green', () => {
    const red = rgb(theme.ansi[1]!);
    const green = rgb(theme.ansi[2]!);
    expect(red.r).toBeGreaterThan(red.g);
    expect(green.g).toBeGreaterThan(green.r);
  });
});

describe('terminalTheme with a host theme', () => {
  it('follows a host palette, and falls back to the text colour for a cursor that would vanish', () => {
    const theme = terminalTheme({ ...darkPalette, systemBackground: '#202020', tint: '#252525' }, true);
    expect(theme.background).toBe('#202020');
    expect(theme.cursor).toBe(theme.foreground);
  });

  it('lays a translucent label over the background', () => {
    const theme = terminalTheme({ ...darkPalette, label: 'rgba(255, 255, 255, 0.5)' }, true);
    expect(theme.foreground).toBe('#808080');
  });
});
