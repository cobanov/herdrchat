import { attentionBadge } from '../attentionBadge';

// The tab bar's badge was the only sign of a blocked agent while Hosts or
// Settings was open (#154 review); the count now sits beside their Done.
describe('attentionBadge', () => {
  it('draws nothing when no chat wants you', () => {
    expect(attentionBadge(0)).toBeNull();
    expect(attentionBadge(-1)).toBeNull();
    expect(attentionBadge(Number.NaN)).toBeNull();
  });

  it('shows the count, and says it for VoiceOver', () => {
    expect(attentionBadge(1)).toEqual({ text: '1', spoken: '1 chat needs you' });
    expect(attentionBadge(3)).toEqual({ text: '3', spoken: '3 chats need you' });
  });

  it('caps a count that would push Done off the title line', () => {
    expect(attentionBadge(99)?.text).toBe('99');
    expect(attentionBadge(140)).toEqual({ text: '99+', spoken: '99+ chats need you' });
  });
});
