import { darkPalette, lightPalette, type Palette } from '@/theme/tokens';
import { checkPalette, OPAQUE_KEYS, pairFloor, TEXT_KEYS, TEXT_PAIRS } from '../theme/check';
import { contrastRatio, MIN_TEXT_CONTRAST, parseColor } from '../theme/color';
import { accentColors, applyOverrides, resolveHostTheme } from '../theme/resolve';
import { PALETTE_KEY_DESCRIPTIONS } from '../theme/schema';

const base = { light: lightPalette, dark: darkPalette };
const resolve = (value: unknown) =>
  resolveHostTheme({ kind: 'present', version: '1 1', text: JSON.stringify(value) }, base);
const ratio = (palette: Palette, text: keyof Palette, surface: keyof Palette) =>
  contrastRatio(parseColor(palette[text])!, parseColor(palette[surface])!);

describe('the checked pairs', () => {
  it('hold for the app’s own palettes, at each pair’s floor', () => {
    for (const palette of [lightPalette, darkPalette]) {
      for (const pair of TEXT_PAIRS) expect(ratio(palette, ...pair)).toBeGreaterThanOrEqual(pairFloor(palette, pair));
    }
    expect(checkPalette(lightPalette, { ...lightPalette }, String)).toEqual({ overrides: { ...lightPalette }, problems: [] });
  });

  // The stock dark secondaryLabel is an alpha ink; a file has to write a
  // solid one, as the light palette already does (an alpha ink reads
  // differently on each surface). Leaving it out keeps the stock value.
  it('holds a file to solid text even where the stock dark ink is not', () => {
    expect(checkPalette(darkPalette, { secondaryLabel: darkPalette.secondaryLabel }, String).problems).toEqual([
      'secondaryLabel: "rgba(235, 235, 245, 0.6)" is translucent and must be opaque, ignored',
    ]);
  });

  // White on the dark tint is 3.12:1 in the stock palette; the bar there is
  // that, not 4.5:1, or the app's own colours would fail its own check.
  it('is 4.5:1, or the stock ratio where that is lower', () => {
    expect(pairFloor(lightPalette, ['label', 'systemBackground'])).toBe(MIN_TEXT_CONTRAST);
    expect(pairFloor(darkPalette, ['onTint', 'tint'])).toBeCloseTo(3.12, 2);
  });

  it('are said in the schema: every text and opaque key is described as opaque', () => {
    for (const key of [...TEXT_KEYS, ...OPAQUE_KEYS]) expect(PALETTE_KEY_DESCRIPTIONS[key]).toMatch(/\bOpaque\b/);
  });
});

describe('a host theme that would make the app unreadable', () => {
  // The review's first example: a light canvas in dark mode left the white
  // label at 1.13:1 and secondaryLabel at 1.03:1, with no problem reported,
  // and the Use host themes switch unreadable where you would turn it off.
  it('drops a canvas the stock text cannot be read on, and says so', () => {
    const resolved = resolve({ dark: { systemBackground: '#F5F0E8' } });
    expect(resolved.overrides.dark).toBeUndefined();
    expect(resolved.problems).toEqual(['dark.systemBackground: label on systemBackground is 1.13:1, below 4.5:1, ignored']);
    expect(resolved.colours).toBe(0);
    expect(resolved.ignored).toBe(1);
  });

  // The review's second example: a fully transparent label was accepted.
  it('refuses translucent text', () => {
    const resolved = resolve({ light: { label: '#FFFFFF00' } });
    expect(resolved.overrides.light).toBeUndefined();
    expect(resolved.problems).toEqual(['light.label: "#FFFFFF00" is translucent and must be opaque, ignored']);
  });

  it('refuses alpha on a key the schema calls opaque, and keeps it on one it does not', () => {
    const resolved = resolve({ dark: { chatCardPressed: 'rgba(32, 35, 58, 0.5)', fillSubtle: 'rgba(1, 2, 3, 0.2)' } });
    expect(resolved.overrides.dark).toEqual({ fillSubtle: 'rgba(1, 2, 3, 0.2)' });
    expect(resolved.problems).toEqual(['dark.chatCardPressed: "rgba(32, 35, 58, 0.5)" is translucent and must be opaque, ignored']);
  });

  it('applies a whole custom scheme that reads, with nothing reported', () => {
    const paper = {
      systemBackground: '#F5F0E8',
      chatCard: '#EDE6DA',
      bubbleIncoming: '#E8E0D2',
      label: '#1A1714',
      secondaryLabel: '#5A5148',
    };
    const resolved = resolve({ name: 'Paper', dark: paper });
    expect(resolved.problems).toEqual([]);
    expect(resolved.overrides.dark).toEqual(paper);
    expect(resolved.colours).toBe(5);
  });

  // Both set and failing: the ink goes first, and the canvas stays if the
  // app's own ink reads on it.
  it('drops the text before the surface it sits on', () => {
    const resolved = resolve({ light: { label: '#CCCCCC', systemBackground: '#D8D8D8' } });
    expect(resolved.overrides.light).toEqual({ systemBackground: '#D8D8D8' });
    expect(resolved.problems).toEqual(['light.label: label on systemBackground is 1.12:1, below 4.5:1, ignored']);
    expect(ratio(applyOverrides(lightPalette, resolved.overrides.light), 'label', 'systemBackground')).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it('says when a colour came from the accent', () => {
    // Dark text was chosen for the accent; the file's own bubble is navy.
    const resolved = resolve({ accent: '#F5D90A', light: { bubbleOutgoing: '#112244' } });
    expect(resolved.problems[0]).toMatch(/^light\.onTint \(from accent\): onTint on bubbleOutgoing is /);
    const light = applyOverrides(lightPalette, resolved.overrides.light);
    for (const pair of TEXT_PAIRS) expect(ratio(light, ...pair)).toBeGreaterThanOrEqual(pairFloor(lightPalette, pair));
  });

  it('leaves every pair readable, whatever the file says', () => {
    const files = [
      { dark: { systemBackground: '#FFFFFF', chatCard: '#FFFFFF', label: '#FFFFFF', secondaryLabel: '#EEEEEE' } },
      { accent: '#FFFF00', light: { onTint: '#FFFFFF', tint: '#FFFFFE' } },
      { light: { bubbleIncoming: '#15161C', chatCard: '#000000' }, dark: { bubbleOutgoing: '#FFFFFF' } },
    ];
    for (const file of files) {
      const resolved = resolve(file);
      for (const scheme of ['light', 'dark'] as const) {
        const palette = applyOverrides(base[scheme], resolved.overrides[scheme]);
        for (const pair of TEXT_PAIRS) expect(ratio(palette, ...pair)).toBeGreaterThanOrEqual(pairFloor(base[scheme], pair));
      }
      expect(resolved.problems.length).toBeGreaterThan(0);
    }
  });
});

describe('the accent in dark mode', () => {
  // The dark label is white too, so a light accent used to keep white text on
  // it at about 2:1; the check would then drop the tint altogether.
  it('puts dark text on a light accent, and the bubble on the accent under it', () => {
    const colors = accentColors('#E9A25A', 'dark', {
      label: darkPalette.label,
      ink: lightPalette.label,
      floor: pairFloor(darkPalette, ['onTint', 'tint']),
    });
    expect(colors.onTint).toBe(lightPalette.label);
    expect(colors.bubbleOutgoing).toBe('#E9A25A');
    expect(resolve({ accent: '#E9A25A' }).problems).toEqual([]);
  });

  it('keeps white on an accent white reads on as well as on the app’s own tint', () => {
    expect(resolve({ accent: darkPalette.tint }).overrides.dark).toMatchObject({ onTint: '#FFFFFF', bubbleOutgoing: expect.any(String) });
    expect(resolve({ accent: darkPalette.tint }).problems).toEqual([]);
  });
});
