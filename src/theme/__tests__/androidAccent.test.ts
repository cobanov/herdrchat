import { darkPalette, lightPalette } from '@/theme/tokens';

// A config plugin runs in Node and cannot import the theme, so the accent it
// writes into the Android theme is a copy. Without this the copy drifts the
// first time the palette moves, and the cursor and selection go back to a
// colour the app no longer uses.
const { ACCENT, HIGHLIGHT } = jest.requireActual('../../../plugins/withAndroidAccent') as {
  ACCENT: { light: string; dark: string };
  HIGHLIGHT: { light: string; dark: string };
};

it('gives the Android theme the palette tint, in both schemes', () => {
  expect(ACCENT).toEqual({ light: lightPalette.tint, dark: darkPalette.tint });
});

it('highlights selected text with that tint, translucent', () => {
  for (const scheme of ['light', 'dark'] as const) {
    expect(HIGHLIGHT[scheme]).toMatch(/^#[0-9A-F]{8}$/);
    expect(HIGHLIGHT[scheme].slice(3)).toBe(ACCENT[scheme].slice(1));
    // Readable text under it: well short of opaque.
    expect(parseInt(HIGHLIGHT[scheme].slice(1, 3), 16)).toBeLessThan(0x80);
  }
});
