import { size } from '@/theme/tokens';
import { isFoldableModel, sidebarWidth, type SplitSizes } from '../splitView';

const sizes: SplitSizes = {
  breakpoint: size.splitBreakpoint,
  sidebar: size.splitSidebarWidth,
  compactSidebar: size.splitSidebarCompactWidth,
  fullSidebarFrom: size.splitSidebarFullFrom,
};

// Measured on the iPhone Duo simulator's two screens (its profile's displays,
// 1398 × 2034 and 2007 × 2853 px at 3x).
const duoCover = 466;
const duoOpen = 669;

it('knows the iPhone Duo unfolds, and no other model', () => {
  expect(isFoldableModel('iPhone19,4')).toBe(true);
  expect(isFoldableModel('iPhone19,1')).toBe(false);
  expect(isFoldableModel('arm64')).toBe(false);
  expect(isFoldableModel(null)).toBe(false);
});

it('gives the folded Duo one column and the open Duo two', () => {
  expect(sidebarWidth(duoCover, sizes)).toBeNull();
  expect(sidebarWidth(duoOpen, sizes)).toBe(size.splitSidebarCompactWidth);
});

// The open Duo's chat beside the chats is never cramped: no narrower than
// an iPhone 18 Pro's whole screen.
it('leaves the open Duo a chat column as wide as a phone', () => {
  expect(duoOpen - (sidebarWidth(duoOpen, sizes) ?? 0)).toBeGreaterThanOrEqual(375);
});

it('narrows the sidebar below an iPad width and keeps it whole from there', () => {
  expect(sidebarWidth(size.splitBreakpoint - 1, sizes)).toBeNull();
  expect(sidebarWidth(size.splitBreakpoint, sizes)).toBe(size.splitSidebarCompactWidth);
  expect(sidebarWidth(size.splitSidebarFullFrom - 1, sizes)).toBe(size.splitSidebarCompactWidth);
  expect(sidebarWidth(size.splitSidebarFullFrom, sizes)).toBe(size.splitSidebarWidth);
  expect(sidebarWidth(1032, sizes)).toBe(size.splitSidebarWidth);
});
