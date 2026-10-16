import { shownStatus } from '../statusMark';

describe('shownStatus', () => {
  it('keeps blocked and working as herdr says them, read or not', () => {
    expect(shownStatus('blocked', false)).toBe('blocked');
    expect(shownStatus('working', true)).toBe('working');
  });

  // herdr's done is "finished, not seen yet"; reading the chat here is seeing it.
  it('says done while the reply is unread, and idle once it is read', () => {
    expect(shownStatus('done', true)).toBe('done');
    expect(shownStatus('done', false)).toBe('idle');
    expect(shownStatus('idle', true)).toBe('done');
    expect(shownStatus('idle', false)).toBe('idle');
  });

  it('leaves a state herdr does not know as unknown once read', () => {
    expect(shownStatus('unknown', false)).toBe('unknown');
  });
});
