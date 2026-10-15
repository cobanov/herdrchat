/**
 * What keeps a host theme from making the app unreadable.
 *
 * Every screen is themed, Settings included, and a cached file is reapplied
 * at launch even with the host offline. So a scheme's overrides are checked
 * after they are laid over the app's own palette, where the colours actually
 * meet: text against each surface it is drawn on, and the keys the schema
 * calls opaque for any alpha. A key that fails is dropped, so the app's own
 * colour stays, and a problem line names it. Nothing else in the file is
 * affected.
 */
import type { Palette } from '../../theme/tokens';
import { contrastRatio, MIN_TEXT_CONTRAST, parseColor, type Rgba } from './color';
import type { PaletteKey } from './schema';

/** Keys drawn as text, held to `MIN_TEXT_CONTRAST` and to full opacity. */
export const TEXT_KEYS = ['label', 'secondaryLabel', 'onTint'] as const satisfies readonly PaletteKey[];

/**
 * Surfaces that must be opaque: the three that cover a swipe action or stand
 * in for glass, and the four every text pair is measured on (a measure
 * against a see-through surface says nothing about what shows through it).
 * The schema's descriptions say "Opaque" for each, from this list.
 */
export const OPAQUE_KEYS = [
  'systemBackground',
  'chatCard',
  'bubbleIncoming',
  'bubbleOutgoing',
  'chatCardPressed',
  'swipeNeutral',
  'glassFallback',
] as const satisfies readonly PaletteKey[];

/** Text and the surfaces it sits on: the pairs the README tells an agent to keep readable. */
export const TEXT_PAIRS: readonly (readonly [text: PaletteKey, surface: PaletteKey])[] = [
  ['label', 'systemBackground'],
  ['label', 'chatCard'],
  ['label', 'bubbleIncoming'],
  ['secondaryLabel', 'systemBackground'],
  ['secondaryLabel', 'chatCard'],
  ['secondaryLabel', 'bubbleIncoming'],
  ['onTint', 'tint'],
  ['onTint', 'bubbleOutgoing'],
];

const MUST_BE_OPAQUE = new Set<PaletteKey>([...TEXT_KEYS, ...OPAQUE_KEYS]);

/** How a ratio is written in a problem line. */
const ratioText = (ratio: number) => `${Math.floor(ratio * 100) / 100}:1`;

function measure(palette: Palette, [text, surface]: readonly [PaletteKey, PaletteKey]): number {
  const foreground: Rgba | null = parseColor(palette[text]);
  const background: Rgba | null = parseColor(palette[surface]);
  return foreground === null || background === null ? 0 : contrastRatio(foreground, background);
}

/**
 * The least a pair must reach: 4.5:1, or the app's own ratio for that pair
 * when that is lower. A theme is never held to more than the stock palette
 * holds itself to (white on the dark tint is 3.12:1), or no theme could set
 * that pair at all, the stock values included.
 */
export function pairFloor(base: Palette, pair: readonly [PaletteKey, PaletteKey]): number {
  return Math.min(MIN_TEXT_CONTRAST, measure(base, pair));
}

export interface PaletteCheck {
  /** The overrides that passed. */
  overrides: Partial<Palette>;
  /** One line per key dropped, in the order they were dropped. */
  problems: string[];
}

/**
 * Check one scheme's overrides against its base palette.
 *
 * `label` names a key in a problem line, so a key the accent derived can say
 * so (`dark.onTint (from accent)`) and the person knows to look at the accent.
 *
 * Contrast is checked on the merged palette, pair by pair, until every pair
 * passes. In a failing pair the text key is dropped first, when the theme set
 * it, since a surface usually carries more of a theme than one ink does; then
 * the surface. Dropping only ever goes back to the stock palette, which passes
 * every pair by `pairFloor`, so the loop ends.
 */
export function checkPalette(
  base: Palette,
  overrides: Partial<Palette>,
  label: (key: PaletteKey) => string
): PaletteCheck {
  const kept: Partial<Palette> = { ...overrides };
  const problems: string[] = [];

  for (const key of Object.keys(kept) as PaletteKey[]) {
    const value = kept[key];
    if (!MUST_BE_OPAQUE.has(key) || value === undefined) continue;
    const alpha = parseColor(value)?.a ?? 1;
    if (alpha < 1) {
      delete kept[key];
      problems.push(`${label(key)}: ${JSON.stringify(value)} is translucent and must be opaque, ignored`);
    }
  }

  let failing = true;
  while (failing) {
    failing = false;
    for (const pair of TEXT_PAIRS) {
      const palette = { ...base, ...kept };
      const ratio = measure(palette, pair);
      const floor = pairFloor(base, pair);
      if (ratio >= floor) continue;
      const [text, surface] = pair;
      const drop = kept[text] !== undefined ? text : surface;
      // Neither is the theme's: the base itself fails, which `pairFloor` rules out.
      if (kept[drop] === undefined) continue;
      delete kept[drop];
      problems.push(`${label(drop)}: ${text} on ${surface} is ${ratioText(ratio)}, below ${ratioText(floor)}, ignored`);
      failing = true;
      break;
    }
  }

  return { overrides: kept, problems };
}
