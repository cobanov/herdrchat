import { buildSheet, type SheetAction } from '../actionSheet';

const act = (label: string, destructive = false): SheetAction => ({
  label,
  destructive,
  onPress: () => {},
});

describe('buildSheet', () => {
  it('keeps safe actions in the order they were given', () => {
    const { options } = buildSheet([act('Rename'), act('Duplicate'), act('Pin')]);
    expect(options).toEqual(['Rename', 'Duplicate', 'Pin', 'Cancel']);
  });

  it('moves a destructive action below every safe one', () => {
    const { options } = buildSheet([act('Close', true), act('Rename')]);
    expect(options).toEqual(['Rename', 'Close', 'Cancel']);
  });

  it('points destructiveButtonIndices at the moved action, not its original slot', () => {
    // The bug this exists to catch: an index written by hand against the input
    // order, which then styles "Rename" red.
    const { destructiveButtonIndices, options } = buildSheet([act('Close', true), act('Rename')]);
    expect(destructiveButtonIndices).toEqual([1]);
    expect(options[1]).toBe('Close');
  });

  it('handles more than one destructive action', () => {
    // iOS takes a list of indices, so "delete" and "block" on one object is an
    // ordinary sheet rather than a case to reject.
    const { options, destructiveButtonIndices } = buildSheet([
      act('Block', true),
      act('Rename'),
      act('Delete', true),
    ]);
    expect(options).toEqual(['Rename', 'Block', 'Delete', 'Cancel']);
    expect(destructiveButtonIndices).toEqual([1, 2]);
  });

  it('reports no destructive indices when nothing is destructive', () => {
    expect(buildSheet([act('Copy')]).destructiveButtonIndices).toEqual([]);
  });

  it('puts cancel last and points cancelButtonIndex at it', () => {
    const { options, cancelButtonIndex } = buildSheet([act('Rename'), act('Close', true)]);
    expect(cancelButtonIndex).toBe(2);
    expect(options[cancelButtonIndex]).toBe('Cancel');
  });

  it('runs the handler belonging to the tapped index after reordering', () => {
    // The whole point of returning aligned handlers: with the destructive
    // action moved, index 1 is Close even though it was written first.
    const ran: string[] = [];
    const { handlers } = buildSheet([
      { label: 'Close', destructive: true, onPress: () => ran.push('close') },
      { label: 'Rename', onPress: () => ran.push('rename') },
    ]);
    handlers[0]?.();
    handlers[1]?.();
    expect(ran).toEqual(['rename', 'close']);
  });

  it('gives cancel a handler rather than a hole', () => {
    const { handlers, cancelButtonIndex } = buildSheet([act('Copy')]);
    expect(handlers).toHaveLength(2);
    expect(() => handlers[cancelButtonIndex]?.()).not.toThrow();
  });

  it('is still a valid sheet with no actions at all', () => {
    // Reachable: a sheet whose actions are conditional can end up empty.
    expect(buildSheet([])).toMatchObject({
      options: ['Cancel'],
      cancelButtonIndex: 0,
      destructiveButtonIndices: [],
    });
  });

  it('takes a custom cancel label', () => {
    const { options } = buildSheet([act('Keep waiting')], 'Not now');
    expect(options).toEqual(['Keep waiting', 'Not now']);
  });
});
