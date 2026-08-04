/**
 * Design tokens. Nothing outside `src/theme/` may hardcode a colour, radius,
 * duration or spacing value — if a screen needs a number that isn't here, the
 * number belongs here.
 */

/**
 * Spacing on an 8pt grid, with a 2 and a 4 for the sub-grid cases that actually
 * occur (hairline gaps inside a bubble, the offset between stacked glass
 * shapes). Named by size rather than by use, so a token can't drift from its
 * meaning when a layout changes.
 */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/**
 * Radii, one scale rather than a value per component.
 *
 * Five steps, each visibly different from the next. The previous set had 6/9/12
 * and 18/19/22, differences no one can see but that every new component had to
 * choose between — which is how a codebase ends up with eleven corner radii and
 * no rule.
 */
export const radius = {
  /** Inline chips and code blocks — small enough to read as inline. */
  xs: 8,
  /** Cards, list rows, form fields. */
  sm: 12,
  /** Message bubbles. The iMessage corner. */
  md: 18,
  /** Floating controls: the composer, the blocked bar, the jump button. */
  lg: 22,
  full: 999,
  /**
   * The small corner the LAST bubble of a run gets. Not part of the scale — it
   * is a deliberate notch, and what makes a run read as one utterance instead of
   * a stack of boxes.
   */
  bubbleTail: 6,
} as const;

/**
 * One-line composer height. `radius.lg` is deliberately just under half of this:
 * at one line the rounded rect reads as a capsule, and as the field grows it
 * keeps the same corners instead of inflating into a stadium the way a real
 * capsule (radius tied to height) would.
 */
export const composerLineHeight = 44;

/** Minimum touch target, per the HIG. Nothing interactive may be smaller. */
export const minTouchTarget = 44;


/**
 * The horizontal margin every screen's content starts at.
 *
 * One value, used by headers, list rows, forms and the composer alike. Mixing
 * 12 and 16 across screens is the single most visible alignment error in an app
 * like this: a title and the rows under it not sharing a left edge reads as
 * sloppiness even to someone who can't name what's wrong.
 */
export const screenPadding = spacing.lg;

/**
 * Motion. Springs, not timing curves — a linear ease reads as a web page.
 * Durations are only for opacity crossfades, where a spring has nothing to
 * overshoot.
 */
export const motion = {
  /** Interruptible, no bounce. For press states and anything under a finger. */
  press: { damping: 30, stiffness: 420, mass: 0.7 },
  /** The default for layout and presence changes. */
  standard: { damping: 22, stiffness: 260, mass: 0.9 },
  /** Softer, for a bar animating in under the composer. */
  enter: { damping: 20, stiffness: 180, mass: 1 },
  fade: 200,
  fadeFast: 120,
} as const;

/**
 * Type scale, iOS. Sizes are the system scale at the default Dynamic Type
 * setting; they are never locked — `allowFontScaling` stays on everywhere, so
 * these are starting points that grow with the user's setting.
 */
export const typography = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700' },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '600' },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: '600' },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400' },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: '400' },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: '400' },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  caption2: { fontSize: 11, lineHeight: 13, fontWeight: '400' },
} as const;

export type TypographyToken = keyof typeof typography;

/**
 * The line the large title occupies in a screen header.
 *
 * Fixed, and equal to the largeTitle line height, so the title sits at the same
 * y on every screen whether or not that screen has a subtitle under it. A
 * heading that moves when you switch tabs is the most visible alignment error
 * an app can have, because you see it as motion rather than as layout.
 */
export const headerTitleLine = typography.largeTitle.lineHeight;


/**
 * Brand ink: a mid periwinkle, `#6E74E6`, drawn from the app logo's indigo-navy
 * and lavender. One accent, used sparingly — outgoing bubbles, the send control,
 * working presence.
 *
 * It is not a token, because neither scheme can use it as-is: on the light
 * canvas it measures 3.6:1 and on black it is muddy. Each palette carries its
 * own step along that hue instead, chosen so the accent clears 4.5:1 where it
 * lands. The hue is the brand; the lightness belongs to the scheme.
 */

/** The logo's light periwinkle, for accents sitting on dark surfaces. */
const LAVENDER = '#C3C7F9';

/**
 * Semantic colours, light and dark. Named for role, never for hue, so a
 * redesign changes this file and nothing else.
 *
 * Attention rides system orange rather than red: a blocked agent is waiting,
 * not broken, and orange also pops against the cool blue tint in a way red
 * fights with.
 */
export interface Palette {
  tint: string;
  tintMuted: string;
  lavender: string;
  attention: string;
  destructive: string;
  positive: string;

  label: string;
  secondaryLabel: string;
  tertiaryLabel: string;
  /** Text on top of the tint (outgoing bubbles, filled controls). */
  onTint: string;

  systemBackground: string;
  secondarySystemBackground: string;
  /** Incoming bubble / inset surfaces. */
  bubbleIncoming: string;
  /**
   * Outgoing bubble fill. Deliberately NOT `tint`.
   *
   * White on the accent measured 3.96:1 in light and 3.12:1 in dark — both
   * under the 4.5:1 needed for the timestamp, which is 11pt and therefore
   * normal text by every threshold. This is the same hue and saturation with
   * the lightness dropped until white clears 4.5:1, so the bubble still reads
   * as the brand while the label on it is legible.
   */
  bubbleOutgoing: string;
  /** Subtle fills: tool chips, code blocks, inactive controls. */
  fillSubtle: string;
  separator: string;

  /** Solid stand-in for glass, used on Android and under Reduce Transparency. */
  glassFallback: string;
  /** The depth wash behind glass. Flat grey makes the effect invisible. */
  backdropTop: string;
  backdropBottom: string;
}

/**
 * Light scheme.
 *
 * Three things this is built around, all of them corrections to the flat
 * white-on-white it replaces.
 *
 * **No pure white, no pure black.** `#FFFFFF` under a `#000000` label measures
 * 21:1, which is not a target — it is glare. The canvas drops to a soft off-white
 * and the ink lifts off black; the pair still measures 16.87:1, far past any
 * threshold, while the page stops being the brightest thing in the room.
 *
 * **The greys carry the brand hue.** Every surface and every ink here is the
 * periwinkle's hue at very low saturation rather than a neutral or a warm grey.
 * That is what makes the accent look like it belongs to the palette instead of
 * being dropped onto it, and it is the same cool cast the dark scheme's backdrop
 * already had.
 *
 * **The accents are re-measured for a light background, not reused from dark.**
 * The old orange measured 2.2:1 on white and was used as body text; every colour
 * below clears 4.5:1 against the canvas AND against the two surfaces that sit on
 * it. Ratios in the comments are against `systemBackground`.
 */
export const lightPalette: Palette = {
  // Deeper than the brand periwinkle: `PERIWINKLE` itself measures 3.6:1 on this
  // canvas, and this token draws the back chevron, links and focused rims — all
  // things you have to see, not just notice.
  tint: '#5459D4', // 5.23:1
  tintMuted: 'rgba(84, 89, 212, 0.12)',
  lavender: LAVENDER,
  attention: '#A05C08', // 4.87:1
  destructive: '#C22B2A', // 5.34:1
  positive: '#1B7A4F', // 4.98:1

  label: '#15161C', // 16.87:1
  // Solid, not an alpha. The app has three light surfaces and an alpha ink
  // renders a different contrast on each; a fixed value means "secondary" means
  // the same thing on a card as it does on the canvas.
  secondaryLabel: '#555766', // 6.67:1
  tertiaryLabel: '#7B7D92', // 3.78:1 — placeholders and disabled glyphs only
  onTint: '#FFFFFF',

  systemBackground: '#F6F7FC',
  secondarySystemBackground: '#EBEDF7',
  bubbleIncoming: '#E6E9F5',
  bubbleOutgoing: '#6167E4', // white on this: 4.60:1
  fillSubtle: 'rgba(84, 89, 212, 0.10)',
  separator: '#CDD1E2',

  glassFallback: 'rgba(246, 247, 252, 0.94)',
  backdropTop: '#F0F2FB',
  backdropBottom: '#E4E7F4',
};

export const darkPalette: Palette = {
  tint: '#8288F0',
  tintMuted: 'rgba(130, 136, 240, 0.20)',
  lavender: LAVENDER,
  attention: '#FF9F0A',
  destructive: '#FF6961',
  positive: '#37C98B',

  label: '#FFFFFF',
  secondaryLabel: 'rgba(235, 235, 245, 0.6)',
  tertiaryLabel: 'rgba(235, 235, 245, 0.3)',
  onTint: '#FFFFFF',

  systemBackground: '#000000',
  secondarySystemBackground: '#1C1C1E',
  bubbleIncoming: '#26262B',
  bubbleOutgoing: '#6067EC', // white on this: 4.52:1
  fillSubtle: 'rgba(118, 118, 128, 0.24)',
  separator: 'rgba(84, 84, 88, 0.65)',

  glassFallback: 'rgba(30, 30, 34, 0.92)',
  backdropTop: '#111119',
  backdropBottom: '#07070C',
};

/**
 * Stable avatar colours derived from a key. Chosen to sit beside the periwinkle
 * tint without competing with it, and to stay legible with white initials on
 * top in both schemes.
 */
export const avatarPalette: readonly string[] = [
  '#128C7E',
  '#3B76C4',
  '#9C5BD1',
  '#CB5A7A',
  '#CC7A2B',
  '#2E9E83',
  '#5A8F3C',
  '#3E8EA6',
];

/**
 * djb2 over UTF-8 — stable across launches, which a JS string hash is not
 * guaranteed to be. A workspace that changed colour on every cold start would
 * defeat the point of a per-workspace colour.
 */
export function avatarColor(key: string): string {
  let hash = 5381;
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash * 33) ^ key.charCodeAt(index)) >>> 0;
  }
  return avatarPalette[hash % avatarPalette.length] ?? avatarPalette[0]!;
}
