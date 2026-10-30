import type { AccessoryKey } from './keys';

/**
 * Whether the terminal's accessory bar fits where it is drawn.
 *
 * The bar is its keys, which scroll sideways, then Paste and the keyboard's
 * show/hide, which do not. On iPad the terminal is the detail beside the
 * chats, so the bar is as narrow as that column: the window less the sidebar.
 * The rule is that the keys scroll rather than shrink or wrap, and that the
 * fixed controls never take so much that the keys a shell cannot do without
 * (Esc, Tab, Ctrl, Alt) need a scroll to reach.
 */

/** The bar's measures, from the theme's tokens (`AccessoryBar.tsx` draws with the same). */
export interface BarMetrics {
  /** The bar's own padding, each side. */
  padding: number;
  /** Between the keys' strip and each fixed control. */
  gap: number;
  /** A fixed control (Paste, keyboard), square. */
  control: number;
  /** How many fixed controls sit beside the keys. */
  controls: number;
  /** The keys' strip's own leading inset. */
  inset: number;
  /** Between two keys. */
  keyGap: number;
  /** A key's narrowest: its touch target. */
  keyMin: number;
  /** A key's padding, each side of its label. */
  keyPadding: number;
  /** A label's advance per character. */
  labelAdvance: number;
}

/** The keys that must show without a scroll: what a shell cannot do without. */
export const ESSENTIAL_KEY_IDS: readonly string[] = ['esc', 'tab', 'ctrl', 'alt'];

/** The narrowest the detail column beside the chats gets: two columns start at the breakpoint. */
export function narrowestDetailWidth(breakpoint: number, sidebar: number): number {
  return breakpoint - sidebar;
}

/** A key's width as drawn: its label and padding, never under its touch target. */
export function keyWidth(key: AccessoryKey, metrics: BarMetrics): number {
  return Math.max(metrics.keyMin, key.label.length * metrics.labelAdvance + 2 * metrics.keyPadding);
}

/** The room the keys' strip gets in a bar `width` wide, after the fixed controls. */
export function keysRoom(width: number, metrics: BarMetrics): number {
  const fixed = 2 * metrics.padding + metrics.controls * (metrics.control + metrics.gap);
  return Math.max(0, width - fixed - metrics.inset);
}

/** How many keys, from the first, show whole without a scroll. */
export function keysInView(width: number, keys: readonly AccessoryKey[], metrics: BarMetrics): number {
  let room = keysRoom(width, metrics);
  let count = 0;
  for (const key of keys) {
    const need = keyWidth(key, metrics) + (count > 0 ? metrics.keyGap : 0);
    if (need > room) break;
    room -= need;
    count += 1;
  }
  return count;
}

/** Every essential key is among the first `keysInView`, so none needs a scroll. */
export function essentialsInView(width: number, keys: readonly AccessoryKey[], metrics: BarMetrics): boolean {
  const shown = keys.slice(0, keysInView(width, keys, metrics)).map((key) => key.id);
  return ESSENTIAL_KEY_IDS.every((id) => shown.includes(id));
}
