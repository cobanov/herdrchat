import { darkPalette, lightPalette } from '@/theme/tokens';
import {
  COLOUR_PATTERN,
  contrastRatio,
  darkenForWhiteText,
  fromHsl,
  isColor,
  MIN_TEXT_CONTRAST,
  parseColor,
  toHex,
  toHsl,
  toRgba,
  WHITE,
} from '../theme/color';

const c = (text: string) => parseColor(text)!;

describe('parseColor', () => {
  it('reads every form a theme file may use', () => {
    expect(parseColor('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 1 });
    expect(parseColor('#5459D4')).toEqual({ r: 84, g: 89, b: 212, a: 1 });
    expect(parseColor('#5459D480')).toEqual({ r: 84, g: 89, b: 212, a: 128 / 255 });
    expect(parseColor('rgb(84, 89, 212)')).toEqual({ r: 84, g: 89, b: 212, a: 1 });
    expect(parseColor('rgba(84,89,212,0.12)')).toEqual({ r: 84, g: 89, b: 212, a: 0.12 });
    expect(parseColor('  RGBA( 1 , 2 , 3 , .5 ) ')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
  });

  // Each of these would reach React Native as a colour it draws as nothing, or
  // as something other than what the file meant.
  it.each([
    'blue',
    '',
    '#12',
    '#1234',
    '#12345',
    '#GGGGGG',
    '5459D4',
    'rgb(256, 0, 0)',
    'rgb(1, 2)',
    'rgb(1, 2, 3, 0.5)',
    'rgba(1, 2, 3)',
    'rgba(1, 2, 3, 1.5)',
    'rgb(-1, 0, 0)',
    'hsl(0, 0%, 0%)',
  ])('refuses %j', (text) => {
    expect(parseColor(text)).toBeNull();
    expect(isColor(text)).toBe(false);
  });

  it('refuses what is not a string', () => {
    expect(isColor(12)).toBe(false);
    expect(isColor(null)).toBe(false);
  });

  // The schema's pattern is a guide for the agent; it must never flag a file
  // the app would accept.
  it('agrees with the schema pattern on everything it accepts', () => {
    const pattern = new RegExp(COLOUR_PATTERN);
    for (const text of ['#abc', '#5459D4', '#5459D480', 'rgb(84, 89, 212)', 'rgba(84,89,212,0.12)', 'rgba(1, 2, 3, .5)', 'rgba(0,0,0,1)', 'rgba(0,0,0,0)', 'rgb(1.5, 2, 3)']) {
      expect(parseColor(text)).not.toBeNull();
      expect(pattern.test(text)).toBe(true);
    }
  });
});

describe('contrast', () => {
  // Pinned against the ratios tokens.ts documents for the stock palettes, which
  // were measured with other tools: if these drift, the formula is wrong.
  it('measures the stock palette as its comments say', () => {
    expect(contrastRatio(c('#5459D4'), c('#F6F7FC'))).toBeCloseTo(5.23, 2);
    expect(contrastRatio(c('#15161C'), c('#F6F7FC'))).toBeCloseTo(16.87, 2);
    expect(contrastRatio(WHITE, c('#6167E4'))).toBeCloseTo(4.6, 2);
    expect(contrastRatio(WHITE, c('#6067EC'))).toBeCloseTo(4.52, 2);
  });

  it('runs from 1 to 21 and does not care which side is which', () => {
    expect(contrastRatio(WHITE, c('#000'))).toBeCloseTo(21, 5);
    expect(contrastRatio(c('#777'), c('#777'))).toBe(1);
    expect(contrastRatio(c('#5459D4'), c('#F6F7FC'))).toBeCloseTo(contrastRatio(c('#F6F7FC'), c('#5459D4')), 10);
  });

  it('measures translucent text as it lands on the background', () => {
    // Half-transparent black on white is mid grey, not black.
    expect(contrastRatio(c('rgba(0, 0, 0, 0.5)'), WHITE)).toBeCloseTo(contrastRatio(c('#808080'), WHITE), 1);
  });
});

describe('lightness', () => {
  it('round-trips through HSL', () => {
    for (const text of ['#5459D4', '#B5562F', '#2E9E83', '#777777']) {
      expect(toHex(fromHsl(toHsl(c(text))))).toBe(text);
    }
  });

  // The stock outgoing bubble was made by exactly this rule from the brand
  // periwinkle, so the function must give back the colour already shipped.
  it('darkens the brand periwinkle to the stock light bubble', () => {
    expect(darkenForWhiteText(c('#6E74E6'))).toBe('#6167E4');
  });

  it('keeps a colour that white text already clears', () => {
    expect(darkenForWhiteText(c('#5459D4'))).toBe('#5459D4');
  });

  it.each(['#E9A25A', '#F5D90A', '#8288F0', '#FFFFFF', '#37C98B'])('darkens %s until white clears 4.5:1, and no further than needed', (text) => {
    const darker = darkenForWhiteText(c(text));
    const ratio = contrastRatio(WHITE, c(darker));
    expect(ratio).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(ratio).toBeLessThan(MIN_TEXT_CONTRAST + 0.15);
  });

  it('keeps the hue while it darkens', () => {
    const before = toHsl(c('#E9A25A'));
    const after = toHsl(c(darkenForWhiteText(c('#E9A25A'))));
    expect(Math.abs(after.h - before.h)).toBeLessThan(2);
    expect(after.l).toBeLessThan(before.l);
  });

  it('writes a wash the way the palette does', () => {
    expect(toRgba(c('#5459D4'), 0.12)).toBe('rgba(84, 89, 212, 0.12)');
  });
});

describe('the app’s own palettes', () => {
  // Settings lists a theme.json's problems in the attention colour on a card;
  // the light token cleared the canvas but read at 4.46:1 there.
  it('keeps attention text readable on the canvas and on the cards', () => {
    for (const palette of [lightPalette, darkPalette]) {
      for (const surface of [palette.systemBackground, palette.secondarySystemBackground, palette.chatCard]) {
        expect(contrastRatio(c(palette.attention), c(surface))).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      }
    }
  });
});
