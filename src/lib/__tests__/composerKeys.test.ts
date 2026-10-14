import { followCaret, insertNewline, pasteAction, returnAction, type ReturnAction, type ReturnKey } from '../composerKeys';

const flags = [false, true] as const;
const sources = ['hardware', 'software'] as const;

/** The table written out independently of the implementation's branches. */
function expected({ source, returnSends, shift, option, command, draftEmpty, disabled }: ReturnKey): ReturnAction {
  if (source === 'software') return 'newline';
  const sendable = !draftEmpty && !disabled;
  if (command) return sendable ? 'send' : 'none';
  if (shift || option) return 'newline';
  if (returnSends) return sendable ? 'send' : 'none';
  return 'newline';
}

describe('returnAction', () => {
  const rows: ReturnKey[] = [];
  for (const source of sources)
    for (const returnSends of flags)
      for (const shift of flags)
        for (const option of flags)
          for (const command of flags)
            for (const draftEmpty of flags)
              for (const disabled of flags) rows.push({ source, returnSends, shift, option, command, draftEmpty, disabled });

  it('covers every combination', () => {
    expect(rows).toHaveLength(128);
  });

  it.each(rows)('%o', (key) => {
    expect(returnAction(key)).toBe(expected(key));
  });

  // The rows a person feels, pinned by name so a wrong table above cannot hide them.
  // Hardware keys reach `returnAction` through the iOS key commands
  // (HerdrKeysModule.swift): Return, Shift-Return, Option-Return, Command-Return.
  const key = (extra: Partial<ReturnKey>): ReturnKey => ({
    source: 'hardware', returnSends: true, shift: false, option: false, command: false,
    draftEmpty: false, disabled: false, ...extra,
  });

  it('sends on a hardware Return when the setting is on', () => {
    expect(returnAction(key({}))).toBe('send');
  });

  it('breaks the line on Shift-Return', () => {
    expect(returnAction(key({ shift: true }))).toBe('newline');
  });

  it('breaks the line on Option-Return, the same as Shift-Return', () => {
    expect(returnAction(key({ option: true }))).toBe('newline');
    expect(returnAction(key({ option: true, shift: true }))).toBe('newline');
  });

  // #155: on a phone, Return sent a half-written prompt and no newline was possible.
  it('never sends on the software keyboard\'s Return, setting on or off', () => {
    expect(returnAction(key({ source: 'software' }))).toBe('newline');
    expect(returnAction(key({ source: 'software', returnSends: false }))).toBe('newline');
    expect(returnAction(key({ source: 'software', draftEmpty: true }))).toBe('newline');
  });

  it('breaks the line on a hardware Return when the setting is off (#113)', () => {
    expect(returnAction(key({ returnSends: false }))).toBe('newline');
  });

  it('still sends on Command-Return when the setting is off', () => {
    expect(returnAction(key({ returnSends: false, command: true }))).toBe('send');
  });

  it('does nothing on Return with nothing to send: no empty send, no newline', () => {
    expect(returnAction(key({ draftEmpty: true }))).toBe('none');
  });

  it('does nothing on Return while a send is in flight, so the draft stays', () => {
    expect(returnAction(key({ disabled: true }))).toBe('none');
    expect(returnAction(key({ disabled: true, command: true }))).toBe('none');
  });
});

describe('insertNewline', () => {
  it('puts a newline at the caret and moves the caret past it', () => {
    expect(insertNewline('ab', { start: 1, end: 1 })).toEqual({ text: 'a\nb', caret: 2 });
    expect(insertNewline('', { start: 0, end: 0 })).toEqual({ text: '\n', caret: 1 });
    expect(insertNewline('ab', { start: 2, end: 2 })).toEqual({ text: 'ab\n', caret: 3 });
  });

  it('replaces a selection, whichever way it was dragged', () => {
    expect(insertNewline('abcd', { start: 1, end: 3 })).toEqual({ text: 'a\nd', caret: 2 });
    expect(insertNewline('abcd', { start: 3, end: 1 })).toEqual({ text: 'a\nd', caret: 2 });
  });

  it('counts in UTF-16 units, as the field does', () => {
    // An emoji is two units; the caret after it is at 2.
    expect(insertNewline('😀x', { start: 2, end: 2 })).toEqual({ text: '😀\nx', caret: 3 });
  });

  it('clamps a selection left over from a longer draft', () => {
    expect(insertNewline('ab', { start: 9, end: 9 })).toEqual({ text: 'ab\n', caret: 3 });
  });
});

describe('followCaret', () => {
  it('lands at the end when a picked command replaces what was typed', () => {
    // "/mo" with the caret at 3, then "/model " from the suggestions.
    expect(followCaret('/mo', { start: 3, end: 3 }, '/model ')).toEqual({ start: 7, end: 7 });
    expect(insertNewline('/model ', followCaret('/mo', { start: 3, end: 3 }, '/model ')).text).toBe('/model \n');
  });

  it('lands at the start when a send clears the draft, and at the end when a refusal puts it back', () => {
    expect(followCaret('hello', { start: 5, end: 5 }, '')).toEqual({ start: 0, end: 0 });
    expect(followCaret('', { start: 0, end: 0 }, 'hello')).toEqual({ start: 5, end: 5 });
  });

  it('keeps the distance from the end, as the field does', () => {
    expect(followCaret('abcd', { start: 1, end: 1 }, 'xxabcd')).toEqual({ start: 3, end: 3 });
  });

  it('collapses a selection to its start and stays inside the new text', () => {
    expect(followCaret('abcd', { start: 3, end: 1 }, 'abcdef')).toEqual({ start: 3, end: 3 });
    expect(followCaret('abcdef', { start: 1, end: 1 }, 'ab')).toEqual({ start: 0, end: 0 });
    expect(followCaret('ab', { start: 9, end: 9 }, 'abc')).toEqual({ start: 3, end: 3 });
  });
});

describe('pasteAction', () => {
  it.each([
    [{ hasImage: true, hasText: false, room: true }, 'image'],
    [{ hasImage: true, hasText: true, room: true }, 'system'],
    [{ hasImage: true, hasText: false, room: false }, 'system'],
    [{ hasImage: true, hasText: true, room: false }, 'system'],
    [{ hasImage: false, hasText: true, room: true }, 'system'],
    [{ hasImage: false, hasText: false, room: true }, 'system'],
    [{ hasImage: false, hasText: true, room: false }, 'system'],
    [{ hasImage: false, hasText: false, room: false }, 'system'],
  ] as const)('%o -> %s', (input, result) => {
    expect(pasteAction(input)).toBe(result);
  });
});
