import {
  blockedPromptSignature,
  isPendingKeys,
  resolveBlockedPending,
  type BlockedPending,
  type BlockedPrompt,
} from '../transcript/blockedPrompt';

/**
 * A blocked-prompt reply only leaves the screen when a status poll observes the
 * agent move on — up to ten seconds on the slowest poll setting. A second tap
 * inside that window sent a second digit + Enter into a live agent. These pin
 * the decision of what one poll observation means for the reply in flight.
 */

const PROMPT: BlockedPrompt = {
  question: 'Allow Bash?',
  options: [
    { number: 1, label: 'Yes' },
    { number: 2, label: 'Yes, and don’t ask again' },
  ],
};

const pendingFor = (prompt: BlockedPrompt | null, sentAt = 1_000): BlockedPending => ({
  keys: ['1', 'Enter'],
  promptSig: blockedPromptSignature(prompt),
  sentAt,
});

const observe = (
  pending: BlockedPending,
  observed: { blocked: boolean; prompt: BlockedPrompt | null; now?: number }
) =>
  resolveBlockedPending(pending, {
    blocked: observed.blocked,
    promptSig: blockedPromptSignature(observed.prompt),
    now: observed.now ?? 2_000,
    timeoutMs: 12_000,
  });

describe('resolveBlockedPending', () => {
  it('keeps waiting while the same prompt is still on screen', () => {
    expect(observe(pendingFor(PROMPT), { blocked: true, prompt: PROMPT })).toBe('waiting');
  });

  it('resolves when the agent leaves blocked — the keys landed', () => {
    expect(observe(pendingFor(PROMPT), { blocked: false, prompt: null })).toBe('delivered');
  });

  it('resolves when a DIFFERENT prompt appears: a new question is a new decision', () => {
    const next: BlockedPrompt = {
      question: 'Overwrite the file?',
      options: [
        { number: 1, label: 'Yes' },
        { number: 2, label: 'No' },
      ],
    };
    expect(observe(pendingFor(PROMPT), { blocked: true, prompt: next })).toBe('superseded');
  });

  it('does NOT treat an unreadable pane as a new prompt', () => {
    // The parse flickers: same question, but this poll got nothing out of the
    // pane. Re-enabling the options here reopens the double-tap window.
    expect(observe(pendingFor(PROMPT), { blocked: true, prompt: null })).toBe('waiting');
  });

  it('times out when the same prompt outlives the deadline', () => {
    const pending = pendingFor(PROMPT, 1_000);
    expect(observe(pending, { blocked: true, prompt: PROMPT, now: 12_999 })).toBe('waiting');
    expect(observe(pending, { blocked: true, prompt: PROMPT, now: 13_000 })).toBe('timed_out');
  });

  it('handles a reply sent from the generic chips (nothing was parsed)', () => {
    const pending = pendingFor(null);
    expect(observe(pending, { blocked: true, prompt: null })).toBe('waiting');
    expect(observe(pending, { blocked: false, prompt: null })).toBe('delivered');
    // The pane became parseable: a real menu is on screen that the chips never
    // showed, so the pending must not lock it.
    expect(observe(pending, { blocked: true, prompt: PROMPT })).toBe('superseded');
  });
});

describe('blockedPromptSignature', () => {
  it('is null for nothing parsed', () => {
    expect(blockedPromptSignature(null)).toBeNull();
    expect(blockedPromptSignature({ question: 'stray text', options: [] })).toBeNull();
  });

  it('changes when the question changes, even with identical options', () => {
    const other = { ...PROMPT, question: 'Delete the branch?' };
    expect(blockedPromptSignature(other)).not.toBe(blockedPromptSignature(PROMPT));
  });

  it('changes when an option label changes', () => {
    const other: BlockedPrompt = {
      question: PROMPT.question,
      options: [PROMPT.options[0]!, { number: 2, label: 'No' }],
    };
    expect(blockedPromptSignature(other)).not.toBe(blockedPromptSignature(PROMPT));
  });
});

describe('isPendingKeys', () => {
  it('marks exactly the tapped choice', () => {
    const pending = pendingFor(PROMPT);
    expect(isPendingKeys(pending, ['1', 'Enter'])).toBe(true);
    expect(isPendingKeys(pending, ['2', 'Enter'])).toBe(false);
    expect(isPendingKeys(pending, ['1'])).toBe(false);
    expect(isPendingKeys(null, ['1', 'Enter'])).toBe(false);
  });
});
