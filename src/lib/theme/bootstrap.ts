/**
 * The files the app leaves on a host so an agent there can restyle it.
 *
 * An agent asked to "make HerdrChat warmer" has only the machine to go on. So
 * the machine carries the instructions: a JSON Schema to edit against, a README
 * saying what each colour is for and how the accent works, and an example that
 * is itself a valid theme. They are written once and never overwritten, so a
 * person's own notes in them survive, and they sit beside theme.json without
 * ever being theme.json: the app never writes the theme itself.
 */
import { shellQuote, withPath } from '../herdr/shell';
import { COLOUR_FORMATS, MIN_TEXT_CONTRAST } from './color';
import { TINT_MUTED_ALPHA } from './resolve';
import {
  PALETTE_KEY_DESCRIPTIONS,
  PALETTE_KEYS,
  THEME_DIR,
  THEME_EXAMPLE_FILE,
  THEME_FILE,
  THEME_NAME_MAX,
  THEME_README_FILE,
  THEME_SCHEMA_FILE,
  themeSchemaText,
} from './schema';

/** The example theme: warm, every kind of key once, and valid (a test pins that it parses with no problems). */
export const THEME_EXAMPLE = {
  $schema: `./${THEME_SCHEMA_FILE}`,
  name: 'Warm dusk',
  accent: '#D08A3E',
  light: { tint: '#B06A1E', systemBackground: '#FBF7F2' },
  dark: { tint: '#E9A25A' },
  avatars: ['#8C4A12', '#2E6B5E', '#7A4E8C', '#A0453A', '#3F6E8C', '#6B7A2E'],
} as const;

export function themeExampleText(): string {
  return `${JSON.stringify(THEME_EXAMPLE, null, 2)}\n`;
}

/** What `Copy prompt for an agent` puts on the clipboard; the person types their wish after it. */
export const AGENT_PROMPT =
  `Restyle HerdrChat for me. Edit ~/${THEME_DIR}/${THEME_FILE} on this machine; the schema is in ` +
  `~/${THEME_DIR}/${THEME_SCHEMA_FILE} and ${THEME_README_FILE} explains the keys. ` +
  `Keep text contrast at or above ${MIN_TEXT_CONTRAST}:1. I would like: `;

const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

export function themeReadmeText(): string {
  return [
    '# HerdrChat host theme',
    '',
    `HerdrChat, the phone app, reads \`~/${THEME_DIR}/${THEME_FILE}\` on this machine and uses it to`,
    'restyle itself while this host is the one selected. Each host can have its own',
    'theme, so the colours also tell you which machine you are on.',
    '',
    `The app wrote this README, \`${THEME_SCHEMA_FILE}\` and \`${THEME_EXAMPLE_FILE}\`. It never`,
    `writes \`${THEME_FILE}\` itself and never overwrites these files; edit them freely.`,
    '',
    '## The file',
    '',
    'Every key is optional. A missing file is the app\'s own theme.',
    '',
    '```json',
    themeExampleText().trimEnd(),
    '```',
    '',
    `- \`name\`: shown in Settings > Appearance, at most ${THEME_NAME_MAX} characters.`,
    '- `accent`: one colour that sets `tint`, `tintMuted`, `bubbleOutgoing` and `onTint` in both',
    '  modes (see below).',
    '- `light`, `dark`: any of the palette keys below, per mode. A key set here wins over the accent.',
    '- `avatars`: a list of colours that replaces the chat avatar colours. Each chat keeps its slot.',
    '',
    `Colours are ${COLOUR_FORMATS}. A value that is not a colour, or a key the app does`,
    'not know, is left out and listed in Settings; the rest of the file still applies.',
    '',
    '## The accent',
    '',
    'Per mode, `accent` sets:',
    '',
    '- `tint` to the accent itself;',
    `- \`tintMuted\` to the accent at ${percent(TINT_MUTED_ALPHA.light)} alpha (light) or ${percent(TINT_MUTED_ALPHA.dark)} (dark);`,
    `- \`onTint\` to white when white text reaches ${MIN_TEXT_CONTRAST}:1 on the tint (the accent, or the`,
    '  mode\'s own `tint` if set), otherwise to `label` when that reads better;',
    `- \`bubbleOutgoing\` to the accent; when \`onTint\` is white, darkened (same hue) until white text`,
    `  clears ${MIN_TEXT_CONTRAST}:1 on it.`,
    '',
    `Keep text at ${MIN_TEXT_CONTRAST}:1 or more against what it sits on: \`label\` and \`secondaryLabel\``,
    'on `systemBackground`, `chatCard` and `bubbleIncoming`; `onTint` on `tint` and `bubbleOutgoing`.',
    '',
    '## Palette keys',
    '',
    ...PALETTE_KEYS.map((key) => `- \`${key}\`: ${PALETTE_KEY_DESCRIPTIONS[key]}`),
    '',
    '## Seeing a change',
    '',
    'The phone reloads within about 30 s; Settings > Appearance > Reload theme forces it.',
    `Reset to default there renames \`${THEME_FILE}\` to \`${THEME_FILE}.bak\` rather than deleting it.`,
    '',
  ].join('\n');
}

/** The delimiter of each heredoc. A file's text must not contain it on a line of its own. */
export const HEREDOC_END = 'HERDRCHAT_EOF';

/** The files, by name, in the order they are written. */
export function bootstrapFiles(): readonly { name: string; text: string }[] {
  return [
    { name: THEME_SCHEMA_FILE, text: themeSchemaText() },
    { name: THEME_README_FILE, text: themeReadmeText() },
    { name: THEME_EXAMPLE_FILE, text: themeExampleText() },
  ];
}

/**
 * One round-trip that writes whichever of the files is missing, and nothing
 * else: `[ -e f ] ||` before each, so an existing file, edited or not, is never
 * touched. Run through `sh -c` so the heredocs mean the same under any login
 * shell. It prints nothing; success is the exit status.
 */
export function bootstrapCommand(): string {
  const script = [
    `mkdir -p "$HOME/${THEME_DIR}" && cd "$HOME/${THEME_DIR}" || exit 1`,
    ...bootstrapFiles().map(({ name, text }) =>
      [`[ -e ${name} ] || cat > ${name} <<'${HEREDOC_END}'`, text.endsWith('\n') ? text.slice(0, -1) : text, HEREDOC_END].join('\n')
    ),
  ].join('\n');
  return withPath(`sh -c ${shellQuote(script)}`);
}
