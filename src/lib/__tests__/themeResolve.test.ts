import { avatarColor, avatarPalette, darkPalette, lightPalette } from '@/theme/tokens';
import { parseThemeFile } from '../theme/parse';
import { accentColors, applyOverrides, resolveHostTheme, type HostThemeFile } from '../theme/resolve';

const base = { light: lightPalette, dark: darkPalette };
const present = (value: unknown, mtime = 100): HostThemeFile => ({
  kind: 'present',
  mtime,
  text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
});

describe('parseThemeFile', () => {
  it('reads a whole theme', () => {
    const file = parseThemeFile(
      JSON.stringify({ name: '  Warm dusk ', accent: '#D08A3E', light: { tint: '#B06A1E' }, dark: { label: 'rgb(250, 250, 250)' }, avatars: ['#123', '#456'] })
    );
    expect(file).toEqual({
      name: 'Warm dusk',
      accent: '#D08A3E',
      light: { tint: '#B06A1E' },
      dark: { label: 'rgb(250, 250, 250)' },
      avatars: ['#123', '#456'],
      problems: [],
      unusable: false,
    });
  });

  it('applies the good keys and names each bad one', () => {
    const file = parseThemeFile(
      JSON.stringify({
        accent: 'orange',
        light: { tint: '#B06A1E', tnit: '#000', label: 12 },
        dark: 'dark please',
        avatars: ['#123', 'nope'],
        colour: '#fff',
      })
    );
    expect(file.light).toEqual({ tint: '#B06A1E' });
    expect(file.dark).toEqual({});
    expect(file.accent).toBeNull();
    expect(file.avatars).toEqual(['#123']);
    expect(file.problems).toEqual([
      'colour: not a theme key, ignored',
      'accent: "orange" is not a colour, ignored',
      'light.tnit: not a palette key, ignored',
      'light.label: 12 is not a colour, ignored',
      'dark: must be an object of palette keys, ignored',
      'avatars[1]: "nope" is not a colour, ignored',
    ]);
  });

  it('says on which line the JSON breaks', () => {
    const text = '{\n  "name": "x",\n  "accent": "#fff"\n  "light": {}\n}';
    expect(parseThemeFile(text).problems).toEqual(['theme.json: not valid JSON at line 4, column 3']);
    expect(parseThemeFile('{"a": [1, 2,]}').problems).toEqual(['theme.json: not valid JSON at line 1, column 13']);
    expect(parseThemeFile('{"a": 1} x').problems).toEqual(['theme.json: not valid JSON at line 1, column 10']);
    expect(parseThemeFile('{"a": "\\q"}').problems[0]).toMatch(/^theme.json: not valid JSON at line 1/);
  });

  it('accepts what JSON accepts', () => {
    const text = '\uFEFF{ "name": "Caf\\u00e9 \\"x\\"", "x": [true, false, null, -1.5e3, {}], "light": {} }';
    const file = parseThemeFile(text);
    expect(file.name).toBe('Café "x"');
    expect(file.problems).toEqual(['x: not a theme key, ignored']);
  });

  it('refuses a file that is not an object, or empty', () => {
    expect(parseThemeFile('[]').problems).toEqual(['theme.json: the top level must be an object']);
    expect(parseThemeFile('  \n').problems).toEqual(['theme.json: the file is empty']);
  });

  it('cuts a long name to 40 characters and treats a blank one as none', () => {
    expect(parseThemeFile(JSON.stringify({ name: 'x'.repeat(60) })).name).toBe('x'.repeat(40));
    expect(parseThemeFile(JSON.stringify({ name: '   ' })).name).toBeNull();
    expect(parseThemeFile(JSON.stringify({ name: 7 })).problems).toEqual(['name: must be a string, ignored']);
  });
});

describe('accentColors', () => {
  it('derives the four colours that move together', () => {
    expect(accentColors('#5459D4', 'light', { label: lightPalette.label })).toEqual({
      tint: '#5459D4',
      tintMuted: 'rgba(84, 89, 212, 0.12)',
      onTint: '#FFFFFF',
      bubbleOutgoing: '#5459D4',
    });
  });

  it('darkens the bubble for white text, at the dark wash', () => {
    expect(accentColors('#E9A25A', 'dark', { label: darkPalette.label })).toEqual({
      tint: '#E9A25A',
      tintMuted: 'rgba(233, 162, 90, 0.2)',
      onTint: '#FFFFFF',
      bubbleOutgoing: '#AF6417',
    });
  });

  // A light accent in light mode: white cannot reach 4.5:1 on it and the dark
  // label can, so the label takes over and the bubble keeps the accent — darkening
  // it would only take it toward its own text.
  it('falls back to the label on a light accent, and keeps the bubble readable under it', () => {
    expect(accentColors('#F5D90A', 'light', { label: lightPalette.label })).toEqual({
      tint: '#F5D90A',
      tintMuted: 'rgba(245, 217, 10, 0.12)',
      onTint: lightPalette.label,
      bubbleOutgoing: '#F5D90A',
    });
  });

  it('measures onTint against the tint a file sets, not the accent', () => {
    expect(accentColors('#5459D4', 'light', { label: lightPalette.label, tint: '#F5D90A' }).onTint).toBe(lightPalette.label);
  });
});

describe('resolveHostTheme', () => {
  it('is the app’s own theme when there is no file', () => {
    expect(resolveHostTheme({ kind: 'missing' }, base)).toEqual({
      status: 'missing',
      raw: null,
      mtime: null,
      name: null,
      overrides: {},
      problems: [],
      colours: 0,
      ignored: 0,
    });
  });

  it('says an unreadable file is one', () => {
    const resolved = resolveHostTheme({ kind: 'unreadable', mtime: 5 }, base);
    expect(resolved.overrides).toEqual({});
    expect(resolved.problems).toEqual(['theme.json: cannot be read (check its permissions)']);
  });

  it('keeps the raw text and mtime, so a launch can resolve it again', () => {
    const file = present({ name: 'x' }, 42);
    const resolved = resolveHostTheme(file, base);
    expect(resolved.raw).toBe(file.kind === 'present' ? file.text : null);
    expect(resolved.mtime).toBe(42);
  });

  it('puts an explicit key over the accent and the accent over the base', () => {
    const resolved = resolveHostTheme(present({ accent: '#E9A25A', dark: { bubbleOutgoing: '#112233' } }), base);
    const dark = applyOverrides(darkPalette, resolved.overrides.dark);
    expect(dark.bubbleOutgoing).toBe('#112233'); // explicit
    expect(dark.tint).toBe('#E9A25A'); // from the accent
    expect(dark.label).toBe(darkPalette.label); // base
    const light = applyOverrides(lightPalette, resolved.overrides.light);
    expect(light.tint).toBe('#E9A25A');
    expect(light.onTint).toBe(lightPalette.label);
    expect(light.systemBackground).toBe(lightPalette.systemBackground);
  });

  it('falls back to the file’s own label when white will not do', () => {
    const resolved = resolveHostTheme(present({ accent: '#F5D90A', light: { label: '#202020' } }), base);
    expect(resolved.overrides.light?.onTint).toBe('#202020');
  });

  it('leaves a scheme alone when the file says nothing about it', () => {
    const resolved = resolveHostTheme(present({ light: { tint: '#B06A1E' } }), base);
    expect(resolved.overrides).toEqual({ light: { tint: '#B06A1E' } });
  });

  it('counts what applied and what was ignored', () => {
    const resolved = resolveHostTheme(
      present({ name: 'N', accent: '#123456', light: { tint: '#B06A1E', nope: '#000' }, dark: { label: 'x' }, avatars: ['#111', '#222'] }),
      base
    );
    expect(resolved.colours).toBe(4);
    expect(resolved.ignored).toBe(2);
    expect(resolved.overrides.avatars).toEqual(['#111', '#222']);
  });

  it('falls back to the default theme for a broken file, with nothing counted as ignored', () => {
    const resolved = resolveHostTheme(present('{ "accent": '), base);
    expect(resolved.status).toBe('present');
    expect(resolved.overrides).toEqual({});
    expect(resolved.ignored).toBe(0);
    expect(resolved.problems).toHaveLength(1);
  });

  it('keeps the app’s avatar colours when none of the file’s is valid', () => {
    expect(resolveHostTheme(present({ avatars: ['nope'] }), base).overrides.avatars).toBeUndefined();
  });
});

describe('applyOverrides', () => {
  it('is the base palette, the same object, without overrides', () => {
    expect(applyOverrides(lightPalette)).toBe(lightPalette);
  });
});

describe('avatarColor with a host palette', () => {
  const keys = ['herdrchat', 'notes', 'scratch', 'ledger', 'journal', 'w1', 'w2', 'w3'];

  it('is unchanged without one', () => {
    for (const key of keys) expect(avatarColor(key)).toBe(avatarColor(key, avatarPalette));
  });

  // Same hash, same slot: a palette of the same length moves every chat to the
  // colour at its old position, so the list keeps its pattern.
  it('keeps each chat in its slot', () => {
    const custom = avatarPalette.map((_, index) => `#00000${index}`);
    for (const key of keys) {
      expect(avatarColor(key, custom)).toBe(custom[avatarPalette.indexOf(avatarColor(key))]);
    }
  });

  it('uses only the given colours, and the app’s for an empty list', () => {
    expect(avatarColor('anything', ['#ABCDEF'])).toBe('#ABCDEF');
    expect(avatarPalette).toContain(avatarColor('anything', []));
  });
});
