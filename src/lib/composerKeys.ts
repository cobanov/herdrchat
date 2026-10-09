/**
 * What a key does in the composer. Every way of pressing Return lands here —
 * the software keyboard's Return, a hardware Return, Shift-Return and
 * Command-Return from the iPad key commands — so the rule lives in one table a
 * test can walk row by row, instead of in four handlers that drift apart.
 */

export type ReturnAction = 'send' | 'newline' | 'none';

export interface ReturnKey {
  /** The "Return sends" setting. Off, Return is a newline as #113 made it. */
  returnSends: boolean;
  shift: boolean;
  command: boolean;
  /** No text worth sending (blank or whitespace) and no pictures. */
  draftEmpty: boolean;
  /** A send is in flight, the chat cannot take one, or pictures are uploading. */
  disabled: boolean;
}

export function returnAction({ returnSends, shift, command, draftEmpty, disabled }: ReturnKey): ReturnAction {
  const sendable = !draftEmpty && !disabled;
  // Command-Return always sends, whichever way the setting points: it is the
  // shortcut iPad users already have in their hands (#113).
  if (command) return sendable ? 'send' : 'none';
  // Shift-Return is how a multi-line prompt gets typed once Return sends.
  if (shift) return 'newline';
  if (!returnSends) return 'newline';
  // Return on nothing, or while a send is in flight, does nothing at all:
  // not an empty send, and not a stray newline in a draft that is about to go.
  return sendable ? 'send' : 'none';
}

/**
 * Put a newline where the caret is, replacing any selection, and say where the
 * caret goes after it. Offsets are UTF-16 units, which is what both a JS string
 * and the text field's selection events count in.
 */
export function insertNewline(
  text: string,
  selection: { start: number; end: number }
): { text: string; caret: number } {
  const clamp = (value: number) => Math.max(0, Math.min(text.length, value));
  const start = clamp(Math.min(selection.start, selection.end));
  const end = clamp(Math.max(selection.start, selection.end));
  return { text: `${text.slice(0, start)}\n${text.slice(end)}`, caret: start + 1 };
}

export type PasteAction = 'image' | 'system';

/**
 * Command-V in the composer. A picture is attached only when the pasteboard has
 * no text: text on the pasteboard is what a person most likely meant (a copied
 * web page carries both), and the system paste must keep working exactly as it
 * did. With no room for another picture, the system paste gets it too.
 */
export function pasteAction({ hasImage, hasText, room }: { hasImage: boolean; hasText: boolean; room: boolean }): PasteAction {
  return hasImage && !hasText && room ? 'image' : 'system';
}
