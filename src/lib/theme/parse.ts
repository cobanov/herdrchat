/**
 * Reading theme.json into overrides and problems.
 *
 * A theme file is written by an agent, or a person, on request, and the phone
 * is the one place its mistakes show. So nothing in it is all-or-nothing:
 * every key is checked on its own, a bad one is left out and named, and the
 * good ones apply. A file with twenty-three good colours and two typos looks
 * twenty-three colours different, with two lines in Settings saying why the
 * other two did not take.
 */
import type { Palette } from '../../theme/tokens';
import { isColor } from './color';
import { parseJson } from './json';
import { isPaletteKey, THEME_FILE, THEME_NAME_MAX } from './schema';

export interface ThemeFileContents {
  /** Trimmed and cut to `THEME_NAME_MAX`, or null when absent or empty. */
  name: string | null;
  /** The accent as written, when it is a colour. */
  accent: string | null;
  /** Explicit keys only; the accent's are added by `resolveHostTheme`. */
  light: Partial<Palette>;
  dark: Partial<Palette>;
  /** The valid avatar colours, in order. Empty means the app's own. */
  avatars: string[];
  /** One line per thing that did not apply, in file order. */
  problems: string[];
  /** The file as a whole could not be read as a theme (not JSON, not an object), so nothing applied. */
  unusable: boolean;
}

/** Top-level keys the file may carry. `$schema` is there for editors and means nothing to the app. */
const TOP_LEVEL = new Set(['$schema', 'name', 'accent', 'light', 'dark', 'avatars']);

/** How much of a bad value a problem quotes. Enough to recognise, not enough to wrap twice. */
const QUOTE_MAX = 32;

function quote(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX - 1)}…` : text;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const empty = (problems: string[]): ThemeFileContents => ({
  name: null,
  accent: null,
  light: {},
  dark: {},
  avatars: [],
  problems,
  unusable: true,
});

function schemeOverrides(scheme: 'light' | 'dark', value: unknown, problems: string[]): Partial<Palette> {
  if (value === undefined) return {};
  if (!isObject(value)) {
    problems.push(`${scheme}: must be an object of palette keys, ignored`);
    return {};
  }
  const overrides: Partial<Palette> = {};
  for (const [key, colour] of Object.entries(value)) {
    if (!isPaletteKey(key)) problems.push(`${scheme}.${key}: not a palette key, ignored`);
    else if (!isColor(colour)) problems.push(`${scheme}.${key}: ${quote(colour)} is not a colour, ignored`);
    else overrides[key] = colour.trim();
  }
  return overrides;
}

/** Parse the text of theme.json. Never throws; an unusable file is the default theme plus a problem. */
export function parseThemeFile(input: string): ThemeFileContents {
  // A byte-order mark is invisible in every editor and fatal to JSON.
  const text = input.startsWith('﻿') ? input.slice(1) : input;
  if (text.trim().length === 0) return empty([`${THEME_FILE}: the file is empty`]);

  const parsed = parseJson(text);
  if (!parsed.ok) return empty([`${THEME_FILE}: not valid JSON at line ${parsed.line}, column ${parsed.column}`]);
  if (!isObject(parsed.value)) return empty([`${THEME_FILE}: the top level must be an object`]);

  const file = parsed.value;
  const problems: string[] = [];
  for (const key of Object.keys(file)) {
    if (!TOP_LEVEL.has(key)) problems.push(`${key}: not a theme key, ignored`);
  }

  let name: string | null = null;
  if (file.name !== undefined) {
    if (typeof file.name !== 'string') problems.push(`name: must be a string, ignored`);
    else name = [...file.name.trim()].slice(0, THEME_NAME_MAX).join('').trim() || null;
  }

  let accent: string | null = null;
  if (file.accent !== undefined) {
    if (isColor(file.accent)) accent = file.accent.trim();
    else problems.push(`accent: ${quote(file.accent)} is not a colour, ignored`);
  }

  const light = schemeOverrides('light', file.light, problems);
  const dark = schemeOverrides('dark', file.dark, problems);

  const avatars: string[] = [];
  if (file.avatars !== undefined) {
    if (!Array.isArray(file.avatars)) {
      problems.push('avatars: must be a list of colours, ignored');
    } else {
      file.avatars.forEach((colour: unknown, index) => {
        if (isColor(colour)) avatars.push(colour.trim());
        else problems.push(`avatars[${index}]: ${quote(colour)} is not a colour, ignored`);
      });
    }
  }

  return { name, accent, light, dark, avatars, problems, unusable: false };
}
