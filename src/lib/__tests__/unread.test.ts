import { isThreadUnread, type ThreadRead, type UnreadPreview } from '../unread';

const agentAt = (timestamp: number | null): UnreadPreview => ({ timestamp, fromUser: false });
const mineAt = (timestamp: number): UnreadPreview => ({ timestamp, fromUser: true });
const read = (openedAt: number, sessionSig = 'sess-a'): ThreadRead => ({ sessionSig, openedAt });

describe('isThreadUnread', () => {
  it('is unread when the agent spoke after you last looked', () => {
    expect(isThreadUnread(agentAt(200), 'sess-a', read(100))).toBe(true);
  });

  it('is read when you looked after the agent spoke', () => {
    expect(isThreadUnread(agentAt(100), 'sess-a', read(200))).toBe(false);
  });

  it('is read at the exact instant you opened it', () => {
    // Opening the thread records "now", and the message you are looking at can
    // share that millisecond. Strictly-greater keeps the dot from reappearing
    // on the chat you just closed.
    expect(isThreadUnread(agentAt(150), 'sess-a', read(150))).toBe(false);
  });

  it('never marks your own message unread', () => {
    expect(isThreadUnread(mineAt(999), 'sess-a', read(1))).toBe(false);
  });

  it('is unread when the thread has never been opened', () => {
    expect(isThreadUnread(agentAt(200), 'sess-a', undefined)).toBe(true);
  });

  it('has nothing to report without a preview', () => {
    expect(isThreadUnread(null, 'sess-a', undefined)).toBe(false);
  });

  it('stays read when the message has no usable timestamp', () => {
    // A dot the user cannot dismiss is worse than one that never appears.
    expect(isThreadUnread(agentAt(null), 'sess-a', read(100))).toBe(false);
    expect(isThreadUnread(agentAt(null), 'sess-a', undefined)).toBe(false);
  });

  it('ignores a marker left by a different chat in the same workspace slot', () => {
    // herdr reuses workspace ids. The old chat's marker says the slot was read
    // at t=999, which must not silence a new conversation's first message.
    expect(isThreadUnread(agentAt(200), 'sess-b', read(999, 'sess-a'))).toBe(true);
  });

  it('honours the marker once the session matches again', () => {
    expect(isThreadUnread(agentAt(200), 'sess-b', read(999, 'sess-b'))).toBe(false);
  });

  it('trusts the marker while the session is still unknown', () => {
    // Before an agent reports its session there is nothing to compare, and
    // treating that as a mismatch would light every row up on every launch.
    expect(isThreadUnread(agentAt(100), null, read(200))).toBe(false);
  });
});
