/**
 * The theme file's vocabulary, said once.
 *
 * The key list below is what the parser accepts, what the JSON Schema on the
 * host lists and what the README there explains. It is checked against the
 * `Palette` interface by `satisfies`, so a colour added to the palette and not
 * here fails the typecheck, and a key here that the palette dropped does too:
 * the file an agent edits can never describe a palette the app no longer has.
 */
import type { Palette } from '../../theme/tokens';
import { COLOUR_FORMATS, COLOUR_PATTERN } from './color';

export const PALETTE_KEY_DESCRIPTIONS = {
  tint: 'The accent: back chevron, links, focused rims, the send control. Keep it at 4.5:1 or more on systemBackground.',
  tintMuted: 'A faint wash of the accent behind selected or highlighted controls. Usually the tint at 12% (light) or 20% (dark) alpha.',
  attentionMuted: 'A faint wash behind a control that answers a waiting agent.',
  lavender: 'A soft accent for details that sit on dark surfaces.',
  attention: 'An agent waiting on you: badges, the blocked bar, warnings. Text-safe on systemBackground.',
  destructive: 'Delete, close and other actions that lose something.',
  positive: 'Success and done states.',
  label: 'Primary text.',
  secondaryLabel: 'Secondary text: previews, timestamps, captions.',
  tertiaryLabel: 'Placeholders and disabled glyphs only; it is not required to reach 4.5:1.',
  onTint: 'Text and glyphs drawn on the tint or on bubbleOutgoing.',
  systemBackground: 'The canvas behind every screen.',
  secondarySystemBackground: 'Grouped surfaces on the canvas, such as Settings sections.',
  bubbleIncoming: "The agent's message bubbles and other inset surfaces.",
  bubbleOutgoing: 'Your message bubbles. White (onTint) text sits on it, so keep that at 4.5:1 or more.',
  fillSubtle: 'Subtle fills: tool chips, code blocks, inactive controls.',
  separator: 'Hairlines between rows.',
  chatCard: 'A chat row in the chat list.',
  chatCardPressed: 'A chat row under a finger. Keep it opaque: it covers the swipe actions.',
  swipeNeutral: 'A swipe action that is neither the tint nor destructive (Rename, Mute). Opaque.',
  attentionBorder: 'The rim around a chat that is waiting on you.',
  controlTrack: 'The track of a switch that is off. It must stand out from the card it sits on.',
  glassFallback: 'The solid stand-in for glass on Android and under Reduce Transparency. Opaque.',
  backdropTop: 'The top of the gradient behind glass surfaces.',
  backdropBottom: 'The bottom of the gradient behind glass surfaces.',
} as const satisfies Record<keyof Palette, string>;

export type PaletteKey = keyof typeof PALETTE_KEY_DESCRIPTIONS;

export const PALETTE_KEYS = Object.keys(PALETTE_KEY_DESCRIPTIONS) as PaletteKey[];

export function isPaletteKey(key: string): key is PaletteKey {
  return Object.prototype.hasOwnProperty.call(PALETTE_KEY_DESCRIPTIONS, key);
}

/** Longest theme name Settings shows; a longer one is cut. */
export const THEME_NAME_MAX = 40;

/** Where the theme lives on a host, relative to its home directory. */
export const THEME_DIR = '.herdrchat';
export const THEME_FILE = 'theme.json';
export const THEME_SCHEMA_FILE = 'theme.schema.json';
export const THEME_README_FILE = 'README.md';
export const THEME_EXAMPLE_FILE = 'theme.example.json';
/** The path as a person reads it, for Settings and the agent prompt. */
export const THEME_PATH_DISPLAY = `~/${THEME_DIR}/${THEME_FILE}`;

const colour = (description: string) => ({ type: 'string', pattern: COLOUR_PATTERN, description });

function scheme(which: 'light' | 'dark') {
  return {
    type: 'object',
    description: `Colours for ${which} mode. Any subset of the palette keys; keys left out keep the app's own colour (or the accent's, when accent is set).`,
    additionalProperties: false,
    properties: Object.fromEntries(PALETTE_KEYS.map((key) => [key, colour(PALETTE_KEY_DESCRIPTIONS[key])])),
  };
}

/**
 * The JSON Schema (draft-07) for theme.json.
 *
 * `additionalProperties: false` is stricter than the app, which ignores an
 * unknown key and reports it rather than refusing the file. The schema is for
 * the agent writing the file, and a misspelt key is exactly what it should be
 * told about before the phone has to.
 */
export function themeJsonSchema(): Record<string, unknown> {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'HerdrChat host theme',
    description: `Restyles the HerdrChat app while this host is the selected connection. Every key is optional. Colours are ${COLOUR_FORMATS}.`,
    type: 'object',
    additionalProperties: false,
    properties: {
      $schema: { type: 'string', description: 'Optional: the path or URL of this schema, for editors.' },
      name: {
        type: 'string',
        maxLength: THEME_NAME_MAX,
        description: `Shown in Settings > Appearance. At most ${THEME_NAME_MAX} characters.`,
      },
      accent: colour(
        'One colour that sets tint, tintMuted, bubbleOutgoing and onTint in both modes. Keys set explicitly under light or dark win over it.'
      ),
      light: scheme('light'),
      dark: scheme('dark'),
      avatars: {
        type: 'array',
        minItems: 1,
        items: colour('An avatar circle colour. An emoji sits on it, so keep it fairly dark.'),
        description: 'Replaces the chat avatar colours. Each chat keeps its position in the list, so the same chat gets the same slot.',
      },
    },
  };
}

/** The schema as the file the app writes, two-space indented with a final newline. */
export function themeSchemaText(): string {
  return `${JSON.stringify(themeJsonSchema(), null, 2)}\n`;
}
