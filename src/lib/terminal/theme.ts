import type { Palette } from '../../theme/tokens';
import {
  composite,
  contrastRatio,
  fromHsl,
  MIN_TEXT_CONTRAST,
  parseColor,
  toHex,
  toHsl,
  WHITE,
  type Rgba,
} from '../theme/color';

/**
 * The terminal's colours, from the app's palette.
 *
 * The palette is the one on screen, a host theme (`~/.herdrchat/theme.json`)
 * included, so a host that recolours the app recolours its terminal too. The
 * shape is what `TerminalView` (modules/herdr-terminal) takes: every colour a
 * `#RRGGBB` string and exactly sixteen ANSI colours, since the native view
 * ignores a set of any other length.
 */
export interface TerminalColors {
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
  /** Black, red, green, yellow, blue, magenta, cyan, white, then the bright eight. */
  ansi: readonly string[];
  dark: boolean;
}

/**
 * What the cursor must reach against the background. WCAG's figure for a
 * graphical object: the cursor is a block or a bar, not text.
 */
export const MIN_CURSOR_CONTRAST = 3;

/**
 * Bright black is the dim text of a prompt, an autosuggestion or a comment:
 * meant to recede, still meant to be read.
 */
export const MIN_DIM_CONTRAST = 3;

/** How much of the tint the selection wash takes. */
const SELECTION_ALPHA = 0.35;

/** Hues for the two colours the palette has no role for. */
const MAGENTA_HUE = 300;
const CYAN_HUE = 185;

/** Where black, white and their brights sit between the background (0) and the foreground (1). */
const GREYS = {
  dark: { black: 0.2, brightBlack: 0.55, white: 0.85, brightWhite: 1 },
  // A light screen's "black" is the ink and its "white" is a pale grey:
  // programs assume black is dark (black on white highlights), whatever the
  // background.
  light: { black: 1, brightBlack: 0.6, white: 0.3, brightWhite: 0.08 },
} as const;

/** How far a bright colour moves from its normal one, in lightness. */
const BRIGHT_STEP = 0.12;

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

export function terminalTheme(palette: Palette, dark: boolean): TerminalColors {
  const background = opaque(palette.systemBackground, dark ? BLACK : WHITE);
  const foreground = composite(parse(palette.label, dark ? WHITE : BLACK), background);
  const greys = dark ? GREYS.dark : GREYS.light;
  const grey = (t: number) => mix(background, foreground, t);

  const tint = composite(parse(palette.tint, foreground), background);
  const hues: Rgba[] = [
    composite(parse(palette.destructive, foreground), background),
    composite(parse(palette.positive, foreground), background),
    composite(parse(palette.attention, foreground), background),
    tint,
    rotate(tint, MAGENTA_HUE),
    rotate(tint, CYAN_HUE),
  ];
  const normal = hues.map((colour) => readable(colour, background, MIN_TEXT_CONTRAST, dark));
  const bright = normal.map((colour) => brighten(colour, background, dark));

  const ansi = [
    grey(greys.black),
    ...normal,
    grey(greys.white),
    readable(grey(greys.brightBlack), background, MIN_DIM_CONTRAST, dark),
    ...bright,
    grey(greys.brightWhite),
  ].map(toHex);

  return {
    background: toHex(background),
    foreground: toHex(foreground),
    cursor: toHex(contrastRatio(tint, background) >= MIN_CURSOR_CONTRAST ? tint : foreground),
    selection: toHex(composite({ ...tint, a: SELECTION_ALPHA }, background)),
    ansi,
    dark,
  };
}

function parse(colour: string, fallback: Rgba): Rgba {
  return parseColor(colour) ?? fallback;
}

/** A background colour laid over what is behind the app, so it is opaque. */
function opaque(colour: string, behind: Rgba): Rgba {
  return composite(parse(colour, behind), behind);
}

function mix(from: Rgba, to: Rgba, t: number): Rgba {
  const at = (a: number, b: number) => a + (b - a) * t;
  return { r: at(from.r, to.r), g: at(from.g, to.g), b: at(from.b, to.b), a: 1 };
}

/** The same saturation and lightness at another hue. */
function rotate(colour: Rgba, hue: number): Rgba {
  const hsl = toHsl(colour);
  return fromHsl({ ...hsl, h: hue });
}

/**
 * The colour, moved away from the background in lightness until it reaches
 * `minimum` against it: lighter on a dark screen, darker on a light one. A
 * colour that already reaches it is kept. Measured on the rounded hex, which
 * is what the terminal will draw.
 */
function readable(colour: Rgba, background: Rgba, minimum: number, dark: boolean): Rgba {
  const hsl = toHsl(colour);
  let lightness = hsl.l;
  for (;;) {
    const candidate = parseColor(toHex(fromHsl({ ...hsl, l: lightness })))!;
    const done = dark ? lightness >= 1 : lightness <= 0;
    if (contrastRatio(candidate, background) >= minimum || done) return candidate;
    lightness = dark ? Math.min(1, lightness + 1 / 255) : Math.max(0, lightness - 1 / 255);
  }
}

/**
 * The bright variant: lighter on a dark screen. On a light one, lighter would
 * fade into the page, so it is more saturated instead and kept readable.
 */
function brighten(colour: Rgba, background: Rgba, dark: boolean): Rgba {
  const hsl = toHsl(colour);
  const moved = dark
    ? fromHsl({ ...hsl, l: Math.min(1, hsl.l + BRIGHT_STEP) })
    : fromHsl({ ...hsl, s: Math.min(1, hsl.s + BRIGHT_STEP), l: Math.min(1, hsl.l + BRIGHT_STEP / 2) });
  return readable(moved, background, MIN_DIM_CONTRAST, dark);
}
