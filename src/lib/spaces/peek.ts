import type { Frame } from './popover';

/**
 * The iPad's floating layout card, as state: whose it is, where, and what
 * keeps it on screen. A pointer resting on a space card's layout button shows
 * it; moving onto the card keeps it; leaving both hides it. A tap pins it
 * until a tap outside, Esc, or its own close. Pure, so the hover rules are
 * tested without a pointer.
 */
export interface Peek {
  /** The workspace's row key. */
  key: string;
  /** The button it hangs from, the column of chats it came from, and the window, in window points. */
  anchor: Frame;
  column: Frame;
  window: Frame;
  pinned: boolean;
  overButton: boolean;
  overCard: boolean;
}

export type PeekEvent =
  | { type: 'show'; key: string; anchor: Frame; column: Frame; window: Frame; how: 'hover' | 'pin' }
  | { type: 'leave-button'; key: string }
  | { type: 'card'; over: boolean }
  | { type: 'pin' }
  | { type: 'close' };

export function peekReducer(peek: Peek | null, event: PeekEvent): Peek | null {
  switch (event.type) {
    case 'show': {
      const same = peek !== null && peek.key === event.key;
      return {
        key: event.key,
        anchor: event.anchor,
        column: event.column,
        window: event.window,
        pinned: event.how === 'pin' || (same && peek.pinned),
        overButton: event.how === 'hover' || (same && peek.overButton),
        overCard: same && peek.overCard,
      };
    }
    case 'leave-button':
      return peek === null || peek.key !== event.key ? peek : settle({ ...peek, overButton: false });
    case 'card':
      return peek === null ? peek : settle({ ...peek, overCard: event.over });
    case 'pin':
      return peek === null ? peek : { ...peek, pinned: true };
    case 'close':
      return null;
  }
}

/** A card nothing keeps on screen any more is gone. */
function settle(peek: Peek): Peek | null {
  return peek.pinned || peek.overButton || peek.overCard ? peek : null;
}
