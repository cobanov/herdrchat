/**
 * Colour arithmetic for host themes: reading the strings a theme file may hold,
 * measuring contrast the way WCAG does, and moving a colour's lightness.
 *
 * React Native takes a colour string as it is, so nothing here converts a
 * colour for display. Parsing exists for two reasons: to refuse a string the
 * app would render as nothing (a typo turns a surface transparent, silently),
 * and to measure the colours the accent rule derives.
 */

/** Red, green and blue in 0–255, alpha in 0–1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Hue in degrees, saturation and lightness in 0–1. */
export interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** WCAG 2's threshold for normal-size text, the one every label in the app is held to. */
export const MIN_TEXT_CONTRAST = 4.5;

/** What a theme file may write, said once so the schema, the README and the problems agree. */
export const COLOUR_FORMATS = '#RGB, #RRGGBB, #RRGGBBAA, rgb(r, g, b) or rgba(r, g, b, a)';

/**
 * The accepted forms as one pattern, for the JSON Schema an agent edits against.
 * It is a guide, looser than `parseColor` (it does not check that a channel is
 * at most 255); `parseColor` is the authority, and a test pins that every form
 * it accepts also matches here, so the schema never flags a valid file.
 */
export const COLOUR_PATTERN =
  '^(#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})|rgba?\\(\\s*\\d{1,3}(\\.\\d+)?\\s*,\\s*\\d{1,3}(\\.\\d+)?\\s*,\\s*\\d{1,3}(\\.\\d+)?\\s*(,\\s*(0|1|0?\\.\\d+|1\\.0+)\\s*)?\\))$';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTIONAL = /^(rgba?)\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;
const NUMBER = /^\d+(\.\d+)?$|^\.\d+$/;

function channel(text: string): number | null {
  if (!NUMBER.test(text)) return null;
  const value = Number(text);
  return value >= 0 && value <= 255 ? value : null;
}

/**
 * A colour string as RGBA, or null when it is not one of the accepted forms.
 *
 * `rgb` takes exactly three channels and `rgba` exactly four: React Native is
 * lenient about the mix, but a file an agent wrote should be read the way a
 * person reading it would, and `rgb(1, 2, 3, 0.5)` reads as a mistake.
 */
export function parseColor(input: string): Rgba | null {
  const text = input.trim();
  const hex = HEX.exec(text);
  if (hex !== null) {
    const digits = hex[1]!;
    const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits;
    const at = (index: number) => parseInt(full.slice(index, index + 2), 16);
    return { r: at(0), g: at(2), b: at(4), a: full.length === 8 ? at(6) / 255 : 1 };
  }
  const functional = FUNCTIONAL.exec(text);
  if (functional === null) return null;
  const isRgba = functional[1]!.toLowerCase() === 'rgba';
  const alphaText = functional[5];
  if (isRgba !== (alphaText !== undefined)) return null;
  const r = channel(functional[2]!);
  const g = channel(functional[3]!);
  const b = channel(functional[4]!);
  if (r === null || g === null || b === null) return null;
  if (alphaText === undefined) return { r, g, b, a: 1 };
  if (!NUMBER.test(alphaText)) return null;
  const a = Number(alphaText);
  return a <= 1 ? { r, g, b, a } : null;
}

export function isColor(input: unknown): input is string {
  return typeof input === 'string' && parseColor(input) !== null;
}

const pair = (value: number) => Math.round(value).toString(16).padStart(2, '0').toUpperCase();

/** `#RRGGBB`, alpha dropped. */
export function toHex({ r, g, b }: Rgba): string {
  return `#${pair(r)}${pair(g)}${pair(b)}`;
}

/** `rgba(r, g, b, a)`, in the style the palette already writes its washes. */
export function toRgba({ r, g, b }: Rgba, alpha: number): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

/** `top` laid over `bottom`, as the screen shows it. The result is opaque when `bottom` is. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const mix = (front: number, back: number) => front * top.a + back * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: bottom.a };
}

/** WCAG 2 relative luminance, 0 for black to 1 for white. Alpha is ignored. */
export function relativeLuminance({ r, g, b }: Rgba): number {
  const linear = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * WCAG 2 contrast ratio of text over a background, 1 to 21.
 *
 * Translucent text is measured as it lands, laid over the background; a
 * translucent background is measured as if opaque, since what is under it is
 * not known here.
 */
export function contrastRatio(text: Rgba, background: Rgba): number {
  const ground = { ...background, a: 1 };
  const one = relativeLuminance(composite(text, ground));
  const two = relativeLuminance(ground);
  return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
}

export function toHsl({ r, g, b }: Rgba): Hsl {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0);
  else if (max === gg) h = (bb - rr) / d + 2;
  else h = (rr - gg) / d + 4;
  return { h: h * 60, s, l };
}

export function fromHsl({ h, s, l }: Hsl, a = 1): Rgba {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255, a };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const k = h / 360;
  return { r: hue(k + 1 / 3) * 255, g: hue(k) * 255, b: hue(k - 1 / 3) * 255, a };
}

export const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/** Bisection steps on lightness; 2⁻²⁰ is far finer than the 1/255 a hex digit can say. */
const LIGHTNESS_STEPS = 20;

/**
 * The colour with its lightness dropped, hue and saturation kept, until white
 * text on it clears 4.5:1, as `#RRGGBB`. A colour that already clears it comes
 * back as it is (in hex): it is the brand, and darkening it further would only
 * make it muddier.
 *
 * This is the rule `bubbleOutgoing` was built by in the stock palettes. The
 * search finds the lightest step that passes, then checks the rounded hex,
 * since rounding a channel can cost the last hundredth of a ratio.
 */
export function darkenForWhiteText(color: Rgba): string {
  const opaque = { ...color, a: 1 };
  if (contrastRatio(WHITE, opaque) >= MIN_TEXT_CONTRAST) return toHex(opaque);
  const hsl = toHsl(opaque);
  let passing = 0;
  let failing = hsl.l;
  for (let step = 0; step < LIGHTNESS_STEPS; step += 1) {
    const middle = (passing + failing) / 2;
    if (contrastRatio(WHITE, fromHsl({ ...hsl, l: middle })) >= MIN_TEXT_CONTRAST) passing = middle;
    else failing = middle;
  }
  let lightness = passing;
  for (;;) {
    const hex = toHex(fromHsl({ ...hsl, l: lightness }));
    const parsed = parseColor(hex)!;
    if (contrastRatio(WHITE, parsed) >= MIN_TEXT_CONTRAST || lightness <= 0) return hex;
    lightness = Math.max(0, lightness - 1 / 255);
  }
}
