import { execFileSync } from 'node:child_process';
import { layout, size, spacing } from '@/theme/tokens';

/**
 * The scale, enforced.
 *
 * CLAUDE.md has always said "no magic numbers outside `src/theme/`", and the app
 * still ended up using every value from 2 to 10. The rule was never broken in
 * the way it was written to catch — nobody wrote `padding: 6`. They wrote
 * `padding: spacing.xs + 2`, which mentions a token and is therefore invisible
 * to a rule about literals.
 *
 * A convention that can be defeated by adding `+ 2` is not a convention, so this
 * is a test rather than a paragraph. It greps the source, because the thing being
 * checked is what the source SAYS — a runtime assertion would only ever see the
 * resulting number, by which point the evidence is gone.
 */

/**
 * Source files that must obey the scale. The theme defines it, so it is exempt,
 * and so are the tests that assert about it.
 *
 * `execFileSync` with an argument array rather than a shell string: no shell
 * means a path containing a space or a quote is passed through as one argument
 * instead of being re-split, which is the whole class of bug that makes
 * repo-scanning tests flaky on someone else's checkout.
 */
function sourceFiles(): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', 'src/**/*.ts', 'src/**/*.tsx', 'app/**/*.ts', 'app/**/*.tsx'],
    { encoding: 'utf8', cwd: process.cwd() }
  );
  return out
    .trim()
    .split('\n')
    .filter((file) => file.length > 0)
    .filter((file) => !file.startsWith('src/theme/') && !file.includes('__tests__'));
}

function grepSource(pattern: string): string[] {
  const files = sourceFiles();
  if (files.length === 0) return [];
  try {
    const out = execFileSync('grep', ['-nE', pattern, ...files], {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    return out.trim().split('\n').filter(Boolean);
  } catch {
    // grep exits 1 when it matches nothing, which is the passing case.
    return [];
  }
}

describe('the spacing scale', () => {
  it('is base-4 above the hairline step', () => {
    const values = Object.values(spacing).filter((value) => value > 2);
    expect(values.every((value) => value % 4 === 0)).toBe(true);
  });

  it('is closed — no call site adjusts a token by a literal', () => {
    // `spacing.sm + 1` is the number 9 wearing a token's name. If a layout needs
    // 9, that is a token in `size`, not an adjustment here.
    const offenders = grepSource(
      '(spacing|radius|minTouchTarget|screenPadding|composerLineHeight|headerTitleLine)(\\.[a-zA-Z]+)? *[-+*/] *[0-9]'
    );
    expect(offenders).toEqual([]);
  });

  it('has no bare numeric spacing left outside the theme', () => {
    // 0 and 1 are exempt: 0 is a position, 1 is a hairline the platform draws at
    // one physical pixel. Everything else is a spacing decision and needs a name.
    const offenders = grepSource(
      '(padding|margin|gap)[A-Za-z]*: *([2-9]|[1-9][0-9]+)'
    );
    expect(offenders).toEqual([]);
  });

  it('separates component padding from layout gaps', () => {
    // Two namespaces, so a button's inside and a page's rhythm can move
    // independently. They are allowed to share a value; they are not allowed to
    // share a name.
    expect(Object.keys(layout)).toEqual(['componentPadding', 'gap']);
    expect(layout.componentPadding).not.toBe(layout.gap);
  });

  it('resolves every semantic name to a value on the scale', () => {
    const scale: number[] = Object.values(spacing);
    const semantic = [...Object.values(layout.componentPadding), ...Object.values(layout.gap)];
    expect(semantic.every((value) => scale.includes(value))).toBe(true);
  });

  it('keeps off-scale dimensions named rather than derived', () => {
    // Each of these was an expression at a call site before. The point is not the
    // number, it is that the number now has somewhere to live and something to
    // say for itself.
    expect(size.bubbleGutterMin).toBe(44);
    expect(size.floatingBarClearance).toBe(96);
    expect(size.headerControl).toBe(32);
  });
});
