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
 * Brand ink: a mid periwinkle drawn from the app logo's indigo-navy and
 * lavender. One accent, used sparingly — outgoing bubbles, the send control,
 * working presence.
 */
const PERIWINKLE = '#6E74E6';
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
  /** Subtle fills: tool chips, code blocks, inactive controls. */
  fillSubtle: string;
  separator: string;

  /** Solid stand-in for glass, used on Android and under Reduce Transparency. */
  glassFallback: string;
  /** The depth wash behind glass. Flat grey makes the effect invisible. */
  backdropTop: string;
  backdropBottom: string;
}

export const lightPalette: Palette = {
  tint: PERIWINKLE,
  tintMuted: 'rgba(110, 116, 230, 0.14)',
  lavender: LAVENDER,
  attention: '#F08C1E',
  destructive: '#D7373F',
  positive: '#2A9D6B',

  label: '#000000',
  secondaryLabel: 'rgba(60, 60, 67, 0.6)',
  tertiaryLabel: 'rgba(60, 60, 67, 0.3)',
  onTint: '#FFFFFF',

  systemBackground: '#FFFFFF',
  secondarySystemBackground: '#F2F2F7',
  bubbleIncoming: '#EDEDF2',
  fillSubtle: 'rgba(118, 118, 128, 0.12)',
  separator: 'rgba(60, 60, 67, 0.18)',

  glassFallback: 'rgba(247, 247, 250, 0.94)',
  backdropTop: '#F6F6FB',
  backdropBottom: '#EDEEF7',
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
