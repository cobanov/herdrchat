import { MAX_SEGMENTS, STACK_ABOVE_FONT_SCALE, segmentsStack } from '../Field';

jest.mock('@/theme/ThemeProvider', () => ({ useTheme: () => ({ colors: {} }) }));

// HC-114: six agents side by side wrapped "Claude Code" onto two lines and
// broke "Antigravity" mid-word on a phone.
it('lays few choices side by side and stacks more than fit as rows', () => {
  expect(segmentsStack(1, MAX_SEGMENTS)).toBe(false);
  expect(segmentsStack(1, MAX_SEGMENTS + 1)).toBe(true);
  // And any number of them at the accessibility sizes, as before.
  expect(segmentsStack(STACK_ABOVE_FONT_SCALE, 2)).toBe(true);
});
