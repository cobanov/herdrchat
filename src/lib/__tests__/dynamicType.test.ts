import { execFileSync } from 'node:child_process';
import { STACK_ABOVE_FONT_SCALE } from '@/components/Field';
import { maxFontScale, typography, type TypographyToken } from '@/theme/tokens';

/**
 * Dynamic Type, enforced.
 *
 * `Text` used to set `fontSize` and a FIXED `lineHeight` from the same token
 * pair. React Native scales the first for the reader and leaves the second
 * alone, so at the largest accessibility size a 34/41 pair drew 60pt glyphs
 * inside a 41pt line box and the overflow landed on whatever was beside it —
 * the screen header and the empty state under it were drawn on top of each
 * other. Every one of the eleven variants was affected, which is to say every
 * string in the app.
 *
 * The file claimed "Dynamic Type is never switched off" the entire time. It was
 * true, and it was broken, which is the same shape as the spacing bug: a rule
 * honoured in letter and defeated in effect. So this is a test.
 */

function sourceFiles(): string[] {
  // Directories, filtered here. `app/**/*.tsx` misses top-level route files —
  // that hole made the spacing suite pass while a violation sat in one of them.
  const out = execFileSync('git', ['ls-files', 'src', 'app'], {
    encoding: 'utf8',
    cwd: process.cwd(),
  });
  return out
    .trim()
    .split('\n')
    .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'))
    .filter((file) => !file.includes('__tests__'));
}

function grepSource(pattern: string, exclude: string[] = []): string[] {
  const files = sourceFiles().filter((file) => !exclude.some((skip) => file.endsWith(skip)));
  if (files.length === 0) return [];
  try {
    return execFileSync('grep', ['-nE', pattern, ...files], {
      encoding: 'utf8',
      cwd: process.cwd(),
    })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

describe('Dynamic Type', () => {
  it('scales line height with the font, in the one component that sets it', () => {
    const source = execFileSync('cat', ['src/components/Text.tsx'], { encoding: 'utf8' });
    // A bare `lineHeight: scale.lineHeight` is the bug. It has to be multiplied.
    expect(source).toMatch(/lineHeight: scale\.lineHeight \* \w+/);
  });

  it('lets no other component set a raw lineHeight', () => {
    // Anything setting its own lineHeight bypasses the scaling above. The avatar
    // glyph is the documented exception and turns font scaling off entirely,
    // because it is a picture drawn with a font and sized to its container.
    //
    // `^[^/*]*` keeps this to real assignments: the type scale in `theme/` is
    // where these numbers are DEFINED, and a prose mention in a comment is not a
    // violation of anything.
    const offenders = grepSource('^[^/*]*lineHeight:', [
      'components/Text.tsx',
      'components/PresenceAvatar.tsx',
    ]).filter((hit) => !hit.startsWith('src/theme/'));
    expect(offenders).toEqual([]);
  });

  it('turns font scaling off in exactly one place, and says why', () => {
    const offenders = grepSource('allowFontScaling=\\{false\\}', ['components/PresenceAvatar.tsx']);
    expect(offenders).toEqual([]);
  });

  it('caps display sizes only, never content', () => {
    // Capping body copy is refusing the accessibility setting. Capping a screen
    // title that already took 40% of the display is not.
    const content: TypographyToken[] = [
      'body',
      'callout',
      'subhead',
      'footnote',
      'caption',
      'caption2',
      'headline',
    ];
    for (const token of content) {
      expect(maxFontScale[token]).toBeUndefined();
    }
    expect(maxFontScale.largeTitle).toBeDefined();
  });

  it('keeps every cap generous enough to be a real increase', () => {
    for (const cap of Object.values(maxFontScale)) {
      expect(cap).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('stacks horizontal pickers at the accessibility sizes', () => {
    // iOS accessibility text begins around 1.5x. Below that a segmented control
    // still fits three labels across a phone; above it, it does not.
    expect(STACK_ABOVE_FONT_SCALE).toBeGreaterThanOrEqual(1.3);
    expect(STACK_ABOVE_FONT_SCALE).toBeLessThanOrEqual(2);
  });

  it('has a line height above the font size for every variant', () => {
    // Not accessibility, but the invariant that makes the scaling above safe: a
    // line box smaller than its glyphs overflows at ANY scale.
    for (const [name, scale] of Object.entries(typography)) {
      expect(`${name}:${scale.lineHeight >= scale.fontSize}`).toBe(`${name}:true`);
    }
  });
});
