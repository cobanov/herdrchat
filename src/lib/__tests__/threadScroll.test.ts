import type { ChatMessage } from '../transcript/message';
import { continueWindow } from '../transcript/window';
import { scrollStep, type ScrollEvent, type ScrollMode } from '../threadScroll';

const SLACK = 40;
function run(events: ScrollEvent[], start: ScrollMode = 'following') {
  let mode = start;
  const toEnd: boolean[] = [];
  for (const event of events) {
    const step = scrollStep(mode, event, SLACK);
    mode = step.mode;
    toEnd.push(step.toEnd);
  }
  return { mode, toEnd };
}

describe('where the thread scrolls', () => {
  it('keeps a follower at the end as the conversation grows', () => {
    expect(run([{ kind: 'resized' }, { kind: 'resized' }]).toEnd).toEqual([true, true]);
  });

  it('leaves a reader in history while messages arrive', () => {
    const { mode, toEnd } = run([{ kind: 'readerScrolled', distanceFromEnd: 900 }, { kind: 'resized' }, { kind: 'resized' }]);
    expect(mode).toBe('reading');
    expect(toEnd).toEqual([false, false, false]);
  });

  // Reported: coming back to the app threw a reader to the bottom mid-read.
  it('does not pull a reader to the end when the app comes back', () => {
    expect(run([{ kind: 'readerScrolled', distanceFromEnd: 900 }, { kind: 'resumed' }]).toEnd).toEqual([false, false]);
    expect(run([{ kind: 'resumed' }]).toEnd).toEqual([true]);
  });

  // Reported: a sent message stayed off screen for a reader who was not at the end.
  it('goes to the end when the reader sends, from anywhere', () => {
    const { mode, toEnd } = run([{ kind: 'readerScrolled', distanceFromEnd: 5000 }, { kind: 'wantsEnd' }, { kind: 'resized' }]);
    expect(mode).toBe('following');
    expect(toEnd).toEqual([false, true, true]);
  });

  it('follows again once the reader scrolls back to the end themselves', () => {
    const { mode } = run([{ kind: 'readerScrolled', distanceFromEnd: 900 }, { kind: 'readerScrolled', distanceFromEnd: 12 }]);
    expect(mode).toBe('following');
  });
});

describe('continuing the window after a stream restart', () => {
  const message = (id: string): ChatMessage => ({
    id, role: 'assistant', segments: [{ kind: 'text', text: id }], timestamp: null, agentLabel: null, isSidechain: false,
  });
  const ids = (list: ChatMessage[] | null) => list?.map((item) => item.id) ?? null;

  it('keeps the older history the reader paged back to', () => {
    const current = ['a', 'b', 'c', 'd', 'e'].map(message);
    const latest = ['c', 'd', 'e', 'f'].map(message);
    expect(ids(continueWindow(current, latest))).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('takes a new window that reaches further back', () => {
    expect(ids(continueWindow(['c', 'd'].map(message), ['a', 'b', 'c', 'd', 'e'].map(message)))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('cannot continue across a gap, or from nothing', () => {
    expect(continueWindow(['a', 'b'].map(message), ['x', 'y'].map(message))).toBeNull();
    expect(continueWindow([], ['x'].map(message))).toBeNull();
  });
});
