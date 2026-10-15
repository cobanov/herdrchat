import type { IconName } from '@/components/Icon';
import type { ChatSelection } from '@/state/chatSelection';

/** How the terminal's header draws its leading control. */
export interface TerminalBackControl {
  symbol: Extract<IconName, 'chevron.left' | 'xmark'>;
  label: string;
}

/** The phone's, and a narrow iPad window's, where the terminal is the screen. */
export const TERMINAL_BACK: TerminalBackControl = { symbol: 'chevron.left', label: 'Back' };

/**
 * The terminal's leading control. Alone on the screen it is Back. Beside the
 * chats a chat in the same column has no back control at all, so the
 * terminal's says what it does there: back to the chat it was opened from, by
 * name, or, opened with nothing open, Close, which empties the column.
 */
export function terminalBackControl(wide: boolean, from: ChatSelection | null): TerminalBackControl {
  if (!wide) return TERMINAL_BACK;
  return from === null ? { symbol: 'xmark', label: 'Close' } : { symbol: 'chevron.left', label: `Back to ${from.title}` };
}
