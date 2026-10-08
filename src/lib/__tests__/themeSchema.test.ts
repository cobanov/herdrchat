import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { darkPalette, lightPalette } from '@/theme/tokens';
import {
  AGENT_PROMPT,
  bootstrapCommand,
  bootstrapFiles,
  HEREDOC_END,
  themeExampleText,
  themeReadmeText,
} from '../theme/bootstrap';
import { parseThemeFile } from '../theme/parse';
import { PALETTE_KEY_DESCRIPTIONS, PALETTE_KEYS, themeJsonSchema, themeSchemaText } from '../theme/schema';

describe('the palette key list', () => {
  // `satisfies Record<keyof Palette, string>` holds this at compile time; the
  // test says it again at run time against the palettes themselves.
  it('is exactly the palette', () => {
    expect([...PALETTE_KEYS].sort()).toEqual(Object.keys(lightPalette).sort());
    expect([...PALETTE_KEYS].sort()).toEqual(Object.keys(darkPalette).sort());
  });

  it('describes every key in a sentence', () => {
    for (const key of PALETTE_KEYS) expect(PALETTE_KEY_DESCRIPTIONS[key].length).toBeGreaterThan(8);
  });
});

describe('the JSON Schema', () => {
  const schema = themeJsonSchema() as {
    $schema: string;
    properties: Record<string, { properties?: Record<string, { description: string; pattern: string }> }>;
  };

  it('is draft-07 and lists every palette key, described, in both schemes', () => {
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    for (const scheme of ['light', 'dark']) {
      const keys = schema.properties[scheme]!.properties!;
      expect(Object.keys(keys)).toEqual(PALETTE_KEYS);
      for (const key of PALETTE_KEYS) expect(keys[key]!.description).toBe(PALETTE_KEY_DESCRIPTIONS[key]);
    }
  });

  it('is the text the app writes, valid JSON', () => {
    expect(JSON.parse(themeSchemaText())).toEqual(schema);
    expect(themeSchemaText().endsWith('}\n')).toBe(true);
  });
});

describe('the bootstrap files', () => {
  it('ships an example that is a theme with nothing wrong in it', () => {
    const example = parseThemeFile(themeExampleText());
    expect(example.problems).toEqual([]);
    expect(example.name).toBe('Warm dusk');
    expect(example.avatars.length).toBeGreaterThan(0);
  });

  it('explains every key, the accent and how to reload', () => {
    const readme = themeReadmeText();
    for (const key of PALETTE_KEYS) expect(readme).toContain(`\`${key}\``);
    expect(readme).toContain('Settings > Appearance > Reload theme');
    expect(readme).toContain('about 30 s');
    expect(readme).toContain('theme.json.bak');
  });

  it('never lets a file end its own heredoc', () => {
    for (const { text } of bootstrapFiles()) expect(text.split('\n')).not.toContain(HEREDOC_END);
  });

  it('asks the agent for contrast and leaves the wish to the person', () => {
    expect(AGENT_PROMPT).toBe(
      'Restyle HerdrChat for me. Edit ~/.herdrchat/theme.json on this machine; the schema is in ~/.herdrchat/theme.schema.json and README.md explains the keys. Keep text contrast at or above 4.5:1. I would like: '
    );
  });

  // Run by a real shell, because the command is quoting inside quoting inside
  // heredocs, and only a shell can say whether it means what it looks like.
  describe('in a real shell', () => {
    function run(home: string): void {
      execFileSync('sh', ['-c', bootstrapCommand()], { env: { ...process.env, HOME: home } });
    }

    it('writes the three files byte for byte', () => {
      const home = mkdtempSync(join(tmpdir(), 'herdrchat-theme-'));
      run(home);
      for (const { name, text } of bootstrapFiles()) {
        expect(readFileSync(join(home, '.herdrchat', name), 'utf8')).toBe(text);
      }
      expect(existsSync(join(home, '.herdrchat', 'theme.json'))).toBe(false);
    });

    it('never overwrites a file that is already there', () => {
      const home = mkdtempSync(join(tmpdir(), 'herdrchat-theme-'));
      run(home);
      writeFileSync(join(home, '.herdrchat', 'README.md'), 'my notes\n');
      run(home);
      expect(readFileSync(join(home, '.herdrchat', 'README.md'), 'utf8')).toBe('my notes\n');
    });
  });
});
