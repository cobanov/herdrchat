import { buildSheet } from '../actionSheet';
import {
  DEFAULT_LIST_MODE, LIST_MODE_SHEET_TITLE, decodeListMode, isListMode, listModeAccessibilityLabel,
  listModeActions, listModeTitle, listModes,
} from '../listModes';

describe('listModes', () => {
  it('lists Spaces then Agents, ticking the current one', () => {
    expect(listModes('spaces')).toEqual([
      { mode: 'spaces', label: 'Spaces ✓', current: true },
      { mode: 'agents', label: 'Agents', current: false },
    ]);
    expect(listModes('agents').map((choice) => choice.label)).toEqual(['Spaces', 'Agents ✓']);
  });

  it('names each view as the list\'s title says it', () => {
    expect(listModeTitle('spaces')).toBe('Spaces');
    expect(listModeTitle('agents')).toBe('Agents');
    expect(LIST_MODE_SHEET_TITLE).toBe('Show');
    expect(listModeAccessibilityLabel('spaces')).toBe('Showing Spaces. Change view.');
  });
});

describe('listModeActions', () => {
  it('switches to the other view, and does nothing on the one already shown', () => {
    const choose = jest.fn();
    const [spaces, agents] = listModeActions('spaces', choose);
    spaces?.onPress();
    expect(choose).not.toHaveBeenCalled();
    agents?.onPress();
    expect(choose).toHaveBeenCalledWith('agents');
  });

  it('builds a sheet in that order, with Cancel last and nothing red', () => {
    const sheet = buildSheet(listModeActions('agents', jest.fn()));
    expect(sheet.options).toEqual(['Spaces', 'Agents ✓', 'Cancel']);
    expect(sheet.destructiveButtonIndices).toEqual([]);
  });
});

describe('decodeListMode', () => {
  // An install from before the picker has no row, and opens on the list it had.
  it('reads a missing or unknown row as Spaces', () => {
    expect(DEFAULT_LIST_MODE).toBe('spaces');
    expect(decodeListMode(null)).toBe('spaces');
    expect(decodeListMode('')).toBe('spaces');
    expect(decodeListMode('threads')).toBe('spaces');
  });

  it('round-trips each mode through its stored form', () => {
    expect(decodeListMode(String('agents'))).toBe('agents');
    expect(decodeListMode(String('spaces'))).toBe('spaces');
    expect(isListMode('agents')).toBe(true);
    expect(isListMode(1)).toBe(false);
  });
});
