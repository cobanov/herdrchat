import { screenText } from '../transcript/screen';

describe('an agent screen as a chat shows it', () => {
  it('drops colour, trailing space and blank runs, and keeps its shape', () => {
    const raw = '\n\n\u001b[1m> fix the build\u001b[0m   \n│ Reading package.json │\n\n\n\n    if (ok) {\n✓ Done.  \n\n\n';
    expect(screenText(raw)).toBe('> fix the build\n│ Reading package.json │\n\n    if (ok) {\n✓ Done.');
  });

  it('is null for a blank screen, so the thread waits', () => {
    expect(screenText('\n  \n\u001b[0m\n')).toBeNull();
  });
});
