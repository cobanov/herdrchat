import { composerInset, floatingKeyboardGap } from '../composerInset';

// An iPhone with a home indicator, and the spacing the controls keep.
const SAFE = 34;
const MIN = 12;

it('clears the home indicator when nothing covers it', () => {
  expect(composerInset(0, SAFE, MIN)).toBe(SAFE);
});

it('keeps only the breathing room above a software keyboard', () => {
  expect(composerInset(336, SAFE, MIN)).toBe(MIN);
});

// An iPad with a hardware keyboard shows only its input-assistant bar. The
// composer was drawn under it: the bar counts as keyboard like any other.
it('keeps only the breathing room above an iPad input-assistant bar', () => {
  expect(composerInset(55, 20, MIN)).toBe(MIN);
});

// While a finger drags the keyboard down, the controls follow it rather than
// jumping by the safe-area inset once the drag is over.
it('changes continuously as the keyboard slides over the home indicator', () => {
  expect(composerInset(10, SAFE, MIN)).toBe(24);
  expect(composerInset(20, SAFE, MIN)).toBe(14);
  expect(composerInset(22, SAFE, MIN)).toBe(MIN);
});

it('never goes below the breathing room, even without a safe area', () => {
  expect(composerInset(0, 0, MIN)).toBe(MIN);
});

it('treats a negative height, as some frames report on the way down, as none', () => {
  expect(composerInset(-5, SAFE, MIN)).toBe(SAFE);
});

describe('floatingKeyboardGap', () => {
  // An 11-inch iPad in portrait.
  const SCREEN = 1194;

  it('is zero for a software keyboard docked on the bottom edge', () => {
    expect(floatingKeyboardGap({ screenY: SCREEN - 400, height: 400 }, SCREEN)).toBe(0);
  });

  // The floating Writing Tools bar: 55pt tall, its bottom 20pt above the
  // screen's. Lifting by the height alone left the composer 20pt behind it.
  it('is the gap under an input-assistant bar that floats above the edge', () => {
    expect(floatingKeyboardGap({ screenY: SCREEN - 75, height: 55 }, SCREEN)).toBe(20);
  });

  it('is zero for a hidden or undocked keyboard, which reports no height', () => {
    expect(floatingKeyboardGap({ screenY: SCREEN, height: 0 }, SCREEN)).toBe(0);
    expect(floatingKeyboardGap({ screenY: 0, height: 0 }, SCREEN)).toBe(0);
  });

  it('is zero for a keyboard sliding off the bottom on its way out', () => {
    expect(floatingKeyboardGap({ screenY: SCREEN, height: 400 }, SCREEN)).toBe(0);
  });
});
