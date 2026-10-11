import { peekReducer, type Peek } from '../spaces/peek';

const anchor = { x: 260, y: 200, width: 44, height: 44 };
const host = { x: 0, y: 0, width: 320, height: 900 };
const show = (key: string, how: 'hover' | 'pin') => ({ type: 'show' as const, key, how, anchor, host });
const run = (...events: Parameters<typeof peekReducer>[1][]): Peek | null => events.reduce<Peek | null>(peekReducer, null);

describe('the floating layout card', () => {
  it('shows while the pointer is on the button, and goes when it leaves', () => {
    expect(run(show('w6', 'hover'))).toMatchObject({ key: 'w6', pinned: false, overButton: true });
    expect(run(show('w6', 'hover'), { type: 'leave-button', key: 'w6' })).toBeNull();
  });

  // Moving from the button onto the card must not drop it on the way.
  it('stays while the pointer is on the card, and goes when it leaves both', () => {
    const onCard = run(show('w6', 'hover'), { type: 'card', over: true }, { type: 'leave-button', key: 'w6' });
    expect(onCard).toMatchObject({ overButton: false, overCard: true });
    expect(peekReducer(onCard, { type: 'card', over: false })).toBeNull();
  });

  it('stays pinned after a tap until it is closed', () => {
    const pinned = run(show('w6', 'pin'), { type: 'leave-button', key: 'w6' }, { type: 'card', over: false });
    expect(pinned).toMatchObject({ pinned: true });
    expect(run(show('w6', 'hover'), { type: 'pin' }, { type: 'leave-button', key: 'w6' })).toMatchObject({ pinned: true });
    expect(peekReducer(pinned, { type: 'close' })).toBeNull();
  });

  it("moves to another button's workspace, and ignores the old button leaving", () => {
    const moved = run(show('w6', 'hover'), show('w1', 'hover'));
    expect(moved).toMatchObject({ key: 'w1', overButton: true, pinned: false });
    expect(peekReducer(moved, { type: 'leave-button', key: 'w6' })).toBe(moved);
    // A pin is the workspace's own: hovering another button is not pinned.
    expect(run(show('w6', 'pin'), show('w1', 'hover'))).toMatchObject({ key: 'w1', pinned: false });
  });
});
