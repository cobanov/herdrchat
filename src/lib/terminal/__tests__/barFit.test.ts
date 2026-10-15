import { minTouchTarget, screenPadding, size, spacing, terminal } from '@/theme/tokens';
import { essentialsInView, keysInView, keysRoom, keyWidth, narrowestDetailWidth, type BarMetrics } from '../barFit';
import { ACCESSORY_KEYS } from '../keys';

/** The measures `AccessoryBar.tsx` draws with. */
const bar: BarMetrics = {
  padding: screenPadding,
  gap: spacing.sm,
  control: minTouchTarget,
  controls: 2,
  inset: spacing.xs,
  keyGap: terminal.keyGap,
  keyMin: minTouchTarget,
  keyPadding: spacing.sm,
  labelAdvance: terminal.keyLabelAdvance,
};

const narrowest = narrowestDetailWidth(size.tabletBreakpoint, size.tabletSidebarWidth);

it('takes the narrowest iPad column as the breakpoint less the sidebar', () => {
  expect(narrowest).toBe(size.tabletBreakpoint - size.tabletSidebarWidth);
});

// The terminal beside the sidebar, at the narrowest two-column window: the
// keys a shell cannot do without show without a scroll.
it('keeps Esc, Tab, Ctrl and Alt in view beside the iPad sidebar at its narrowest', () => {
  expect(essentialsInView(narrowest, ACCESSORY_KEYS, bar)).toBe(true);
});

it('scrolls the rest rather than fitting them all into the narrow column', () => {
  const shown = keysInView(narrowest, ACCESSORY_KEYS, bar);
  expect(shown).toBeGreaterThanOrEqual(4);
  expect(shown).toBeLessThan(ACCESSORY_KEYS.length);
});

it('shows more keys as the column widens, and none where there is no room', () => {
  expect(keysInView(size.contentMaxWidth, ACCESSORY_KEYS, bar)).toBeGreaterThan(keysInView(narrowest, ACCESSORY_KEYS, bar));
  expect(keysRoom(minTouchTarget, bar)).toBe(0);
  expect(keysInView(minTouchTarget, ACCESSORY_KEYS, bar)).toBe(0);
  expect(essentialsInView(minTouchTarget, ACCESSORY_KEYS, bar)).toBe(false);
});

it('never draws a key under its touch target, and widens one for a long label', () => {
  const byId = (id: string) => {
    const key = ACCESSORY_KEYS.find((candidate) => candidate.id === id);
    if (key === undefined) throw new Error(`no key ${id}`);
    return key;
  };
  expect(keyWidth(byId('slash'), bar)).toBe(minTouchTarget);
  expect(keyWidth(byId('home'), bar)).toBeGreaterThan(minTouchTarget);
});

// The rule's limit, written down. A narrow iPad window is one column, the
// terminal alone in it: at Split View's one third (320pt) Alt scrolls in, as
// it does on a 320pt phone. From a 375pt window up the four fit.
it('fits the essentials from a 375pt window, and scrolls Alt in at 320pt', () => {
  expect(essentialsInView(375, ACCESSORY_KEYS, bar)).toBe(true);
  expect(essentialsInView(320, ACCESSORY_KEYS, bar)).toBe(false);
  expect(keysInView(320, ACCESSORY_KEYS, bar)).toBe(3);
});
