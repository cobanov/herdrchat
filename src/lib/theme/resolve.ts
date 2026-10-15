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
import { checkPalette, pairFloor } from './check';
import { contrastRatio, darkenForWhiteText, MIN_TEXT_CONTRAST, parseColor, toHex, toRgba, WHITE } from './color';
import { parseThemeFile } from './parse';
import { PALETTE_KEYS, THEME_FILE, THEME_MAX_BYTES, type PaletteKey } from './schema';

export type ColorScheme = 'light' | 'dark';

/** Why a theme.json that is there was not read. */
export type UnreadableReason =
  /** The permissions say no. */
  | 'permissions'
  /** A directory, a FIFO, a device: anything but a regular file. */
  | 'notFile'
  /** Over `THEME_MAX_BYTES`. */
  | 'tooLarge';

/**
 * What the app knows about a host's theme.json, as fetched.
 *
 * `version` is the host's fingerprint of the file's contents (see
 * `themeFetchCommand`): when the host prints the one the phone holds, the
 * file is unchanged and its text is not sent again.
 */
export type HostThemeFile =
  | { kind: 'missing' }
  | { kind: 'present'; version: string; text: string }
  /** There, but not read. Only a file too large has a version, since only it was fingerprinted. */
  | { kind: 'unreadable'; reason: UnreadableReason; version: string | null };

/** The shape `ThemeProvider` takes. A scheme or the avatars are absent when the file changes nothing there. */
export interface HostThemeOverrides {
  light?: Partial<Palette>;
  dark?: Partial<Palette>;
  avatars?: readonly string[];
}

export interface ResolvedHostTheme {
  status: HostThemeFile['kind'];
  /** The file as fetched, kept so a launch can re-resolve it without the host, and the next check can send its version. */
  file: HostThemeFile;
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
 * - `onTint` is white when white text reads on the tint (the accent, or the
 *   scheme's own `tint` when the file sets one) at least as well as the
 *   scheme's floor for that pair (`floor`: 4.5:1, or the stock palette's own
 *   ratio when lower). When it does not, the scheme's `label` takes its place
 *   if that reaches 4.5:1, then `ink` (the other scheme's label, a dark ink in
 *   dark mode, where the label is white too), and failing all three whichever
 *   reads best. A light accent in dark mode used to keep white text on it at
 *   about 2:1, since the dark label is white as well.
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
  around: { label: string; tint?: string; ink?: string; floor?: number }
): Partial<Palette> {
  const parsed = parseColor(accent);
  if (parsed === null) return {};
  const opaque = { ...parsed, a: 1 };
  const tint = { ...(parseColor(around.tint ?? accent) ?? parsed), a: 1 };
  const ratioOn = (text: string) => {
    const color = parseColor(text);
    return color === null ? 0 : contrastRatio(color, tint);
  };
  const white = toHex(WHITE);
  const inks = [around.label, ...(around.ink === undefined ? [] : [around.ink])];
  const best = [white, ...inks].reduce((a, b) => (ratioOn(b) > ratioOn(a) ? b : a));
  const onTint =
    ratioOn(white) >= (around.floor ?? MIN_TEXT_CONTRAST)
      ? white
      : inks.find((ink) => ratioOn(ink) >= MIN_TEXT_CONTRAST) ?? best;
  // `best` keeps white on a tie, so an ink that is white too never takes its place.
  const whiteText = onTint === white;
  return {
    tint: accent,
    tintMuted: toRgba(parsed, TINT_MUTED_ALPHA[scheme]),
    onTint,
    bubbleOutgoing: whiteText ? darkenForWhiteText(opaque) : toHex(tint),
  };
}

/** A scheme's palette with overrides laid over it. What the ThemeProvider renders. */
export function applyOverrides(base: Palette, overrides?: Partial<Palette>): Palette {
  return overrides === undefined ? base : { ...base, ...overrides };
}

const DEFAULT: Omit<ResolvedHostTheme, 'status' | 'file'> = {
  name: null,
  overrides: {},
  problems: [],
  colours: 0,
  ignored: 0,
};

/** The one line Settings shows for a file that was not read. */
export const UNREADABLE_PROBLEM: Record<UnreadableReason, string> = {
  permissions: `${THEME_FILE}: cannot be read (check its permissions)`,
  notFile: `${THEME_FILE} is not a regular file; ignored`,
  tooLarge: `${THEME_FILE} is larger than ${THEME_MAX_BYTES / 1024} KB; ignored`,
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
  if (file.kind === 'missing') return { status: 'missing', file, ...DEFAULT };
  if (file.kind === 'unreadable') {
    return { status: 'unreadable', file, ...DEFAULT, problems: [UNREADABLE_PROBLEM[file.reason]] };
  }

  const contents = parseThemeFile(file.text);
  const problems = [...contents.problems];
  let explicitKept = 0;
  const scheme = (which: ColorScheme): Partial<Palette> | undefined => {
    const explicit = contents[which];
    const label = explicit.label ?? base[which].label;
    const derived =
      contents.accent === null
        ? {}
        : accentColors(contents.accent, which, {
            label,
            ink: base[which === 'light' ? 'dark' : 'light'].label,
            floor: pairFloor(base[which], ['onTint', 'tint']),
            ...(explicit.tint === undefined ? {} : { tint: explicit.tint }),
          });
    const named = (key: PaletteKey) => (key in explicit ? `${which}.${key}` : `${which}.${key} (from accent)`);
    // Checked merged, not key by key: whether a colour reads depends on what
    // it meets, which is often a key the file did not set.
    const checked = checkPalette(base[which], { ...derived, ...explicit }, named);
    problems.push(...checked.problems);
    explicitKept += Object.keys(explicit).filter((key) => key in checked.overrides).length;
    const merged = checked.overrides;
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
    file,
    name: contents.name,
    overrides,
    problems,
    colours: (contents.accent === null ? 0 : 1) + explicitKept + contents.avatars.length,
    ignored: contents.unusable ? 0 : problems.length,
  };
}
