/**
 * From a host's theme file to the overrides the ThemeProvider merges.
 *
 * Precedence, per scheme and per key: a key written under `light` or `dark`,
 * then what the accent derives, then the app's own palette. The accent is a
 * shorthand for the four colours that have to move together to change the
 * app's colour without breaking its contrast, and an explicit key is how a
 * file says "except this one".
 */
import type { Palette } from '../../theme/tokens';
import { contrastRatio, darkenForWhiteText, MIN_TEXT_CONTRAST, parseColor, toHex, toRgba, WHITE } from './color';
import { parseThemeFile } from './parse';
import { PALETTE_KEYS, THEME_FILE } from './schema';

export type ColorScheme = 'light' | 'dark';

/** What the app knows about a host's theme.json, as fetched. */
export type HostThemeFile =
  | { kind: 'missing' }
  | { kind: 'present'; mtime: number; text: string }
  /** There, but `cat` could not read it (permissions). */
  | { kind: 'unreadable'; mtime: number };

/** The shape `ThemeProvider` takes. A scheme or the avatars are absent when the file changes nothing there. */
export interface HostThemeOverrides {
  light?: Partial<Palette>;
  dark?: Partial<Palette>;
  avatars?: readonly string[];
}

export interface ResolvedHostTheme {
  status: HostThemeFile['kind'];
  /** The file's text, kept so a launch can re-resolve it without the host. */
  raw: string | null;
  /** Seconds since the epoch, as the host's `stat` printed it. */
  mtime: number | null;
  name: string | null;
  overrides: HostThemeOverrides;
  /** Verbatim lines for Settings, in file order. */
  problems: string[];
  /** Colour entries that applied: the accent, explicit keys in both schemes, avatar colours. */
  colours: number;
  /** Entries left out because they were wrong. A whole-file problem (not JSON) counts none: nothing was read. */
  ignored: number;
}

/** The fraction of the accent `tintMuted` takes, per scheme: the stock palettes' own washes. */
export const TINT_MUTED_ALPHA: Record<ColorScheme, number> = { light: 0.12, dark: 0.2 };

/**
 * What one accent colour sets in a scheme.
 *
 * - `tint` is the accent as written.
 * - `tintMuted` is the accent as a wash, at the stock palette's alpha.
 * - `onTint` is white when white text reaches 4.5:1 on the tint (the accent,
 *   or the scheme's own `tint` when the file sets one). When it does not, the
 *   scheme's `label` takes its place if that reads better.
 * - `bubbleOutgoing` carries `onTint` too, so it follows that choice: under
 *   white text it is the accent darkened until white clears 4.5:1 (the rule
 *   the stock bubble was made by); under dark text it is the tint itself, the
 *   colour that dark text was chosen against. Not the accent: when the file
 *   sets its own tint, the label picked for a light tint can sit on a dark
 *   accent at barely 1:1.
 */
export function accentColors(
  accent: string,
  scheme: ColorScheme,
  around: { label: string; tint?: string }
): Partial<Palette> {
  const parsed = parseColor(accent);
  if (parsed === null) return {};
  const opaque = { ...parsed, a: 1 };
  const tint = { ...(parseColor(around.tint ?? accent) ?? parsed), a: 1 };
  const labelColor = parseColor(around.label);
  const whiteRatio = contrastRatio(WHITE, tint);
  const labelRatio = labelColor === null ? 0 : contrastRatio(labelColor, tint);
  const whiteText = whiteRatio >= MIN_TEXT_CONTRAST || whiteRatio >= labelRatio;
  return {
    tint: accent,
    tintMuted: toRgba(parsed, TINT_MUTED_ALPHA[scheme]),
    onTint: whiteText ? toHex(WHITE) : around.label,
    bubbleOutgoing: whiteText ? darkenForWhiteText(opaque) : toHex(tint),
  };
}

/** A scheme's palette with overrides laid over it. What the ThemeProvider renders. */
export function applyOverrides(base: Palette, overrides?: Partial<Palette>): Palette {
  return overrides === undefined ? base : { ...base, ...overrides };
}

const DEFAULT: Omit<ResolvedHostTheme, 'status' | 'raw' | 'mtime'> = {
  name: null,
  overrides: {},
  problems: [],
  colours: 0,
  ignored: 0,
};

/**
 * Resolve a fetched (or cached) file against the app's palettes.
 *
 * `base` is passed in rather than imported, so this stays free of React
 * Native: the palettes live in `src/theme/tokens.ts`, which reads the platform.
 * The base matters only for `onTint`, which may fall back to the scheme's
 * label.
 */
export function resolveHostTheme(file: HostThemeFile, base: Record<ColorScheme, Palette>): ResolvedHostTheme {
  if (file.kind === 'missing') return { status: 'missing', raw: null, mtime: null, ...DEFAULT };
  if (file.kind === 'unreadable') {
    return {
      status: 'unreadable',
      raw: null,
      mtime: file.mtime,
      ...DEFAULT,
      problems: [`${THEME_FILE}: cannot be read (check its permissions)`],
    };
  }

  const contents = parseThemeFile(file.text);
  const scheme = (which: ColorScheme): Partial<Palette> | undefined => {
    const explicit = contents[which];
    const label = explicit.label ?? base[which].label;
    const derived =
      contents.accent === null
        ? {}
        : accentColors(contents.accent, which, explicit.tint === undefined ? { label } : { label, tint: explicit.tint });
    const merged: Partial<Palette> = { ...derived, ...explicit };
    return PALETTE_KEYS.some((key) => merged[key] !== undefined) ? merged : undefined;
  };

  const overrides: HostThemeOverrides = {};
  const light = scheme('light');
  const dark = scheme('dark');
  if (light !== undefined) overrides.light = light;
  if (dark !== undefined) overrides.dark = dark;
  if (contents.avatars.length > 0) overrides.avatars = contents.avatars;

  return {
    status: 'present',
    raw: file.text,
    mtime: file.mtime,
    name: contents.name,
    overrides,
    problems: contents.problems,
    colours:
      (contents.accent === null ? 0 : 1) +
      Object.keys(contents.light).length +
      Object.keys(contents.dark).length +
      contents.avatars.length,
    ignored: contents.unusable ? 0 : contents.problems.length,
  };
}
