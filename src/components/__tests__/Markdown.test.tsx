import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { StyleSheet } from 'react-native';

import { haptics } from '../haptics';
import { Markdown } from '../Markdown';
import { minTouchTarget, motion, spacing } from '@/theme/tokens';

// Each colour is its own name, so a test can tell which one was used.
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: (_target, name) => `colors.${String(name)}` }) }),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../haptics', () => ({ haptics: { success: jest.fn() } }));
// The glyph by its name and tint, so a test can see which one is drawn and how.
jest.mock('../Icon', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Icon: ({ name, tintColor }: { name: string; tintColor?: string }) => (
      <Text testID={`icon-tint:${tintColor ?? 'none'}`}>{`icon:${name}`}</Text>
    ),
  };
});

const TABLE = [
  '| Name | Type | Note |',
  '|---|:-:|--:|',
  '| `id` | number | short |',
  '| title | string | a much longer note that wraps onto a second line in its column |',
].join('\n');

function layout(height: number) {
  return { nativeEvent: { layout: { x: 0, y: 0, width: 100, height } } };
}

// HC-111: a fill on inline code ran from where it wrapped to the line's end.
it('sets inline code in the monospace face, with no fill, and the text as it is', async () => {
  await render(<Markdown text="Waiting for `/ready` before probing fixes it." />);
  const code = screen.getByText('/ready');
  expect(StyleSheet.flatten(code.props.style)).not.toHaveProperty('backgroundColor');
});

// Built row by row, each cell was as wide as its own text and every row put its
// column boundaries somewhere else. Built as columns, a column is as wide as
// its widest cell, which only works if each column holds that column's cells.
it('lays a table out as columns, each holding its own cells top to bottom', async () => {
  await render(<Markdown text={TABLE} />);
  const type = within(screen.getByTestId('table-column-1'));
  expect(type.getByText('Type')).toBeOnTheScreen();
  expect(type.getByText('number')).toBeOnTheScreen();
  expect(type.getByText('string')).toBeOnTheScreen();
  expect(type.queryByText('title')).toBeNull();
});

// Columns do not see each other's row heights. A wrapped cell must lift its
// whole row, or the separators below it stop lining up across columns.
it('holds every cell in a row to the row\'s tallest cell', async () => {
  await render(<Markdown text={TABLE} />);
  await fireEvent(screen.getByText('title'), 'layout', layout(26));
  await fireEvent(screen.getByText('string'), 'layout', layout(26));
  await fireEvent(screen.getByText(/a much longer note/), 'layout', layout(44));

  for (const column of [0, 1, 2]) {
    expect(screen.getByTestId(`table-cell-2-${column}`)).toHaveStyle({ minHeight: 44 });
  }
  // A row whose cells have not wrapped is left at its natural height.
  expect(screen.getByTestId('table-cell-1-0')).toHaveStyle({ minHeight: 0 });
});

// The alignment is the paragraph's, so it sits on the cell's outer text, not on
// the span inside it that getByText finds.
it('aligns a column as its separator row says', async () => {
  await render(<Markdown text={TABLE} />);
  const paragraph = (text: string) => screen.getByText(text).parent;
  expect(paragraph('number')).toHaveStyle({ textAlign: 'center' });
  expect(paragraph('short')).toHaveStyle({ textAlign: 'right' });
  expect(paragraph('Name')).not.toHaveStyle({ textAlign: 'center' });
});

// The markup is formatted, not shown: `**` and backticks in a cell were raw.
it('formats inline markup inside a cell', async () => {
  await render(<Markdown text={TABLE} />);
  expect(screen.getByText('id')).toBeOnTheScreen();
  expect(screen.queryByText(/`id`/)).toBeNull();
});

const TWO_BLOCKS = ['Check first:', '```sh', 'git status --short', '```', 'then:', '```', '  npm ci', '', '```'].join('\n');

// Reported from a phone: the only way to copy code was the bubble's long press,
// which joined every block in the message. Each block copies itself alone.
describe('a code block\'s Copy', () => {
  beforeEach(() => {
    jest.mocked(Clipboard.setStringAsync).mockClear();
    jest.mocked(haptics.success).mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('is drawn on every block, numbered within the text, with or without a language', async () => {
    await render(<Markdown text={TWO_BLOCKS} />);
    expect(screen.getByTestId('code-copy-0')).toBeOnTheScreen();
    expect(screen.getByTestId('code-copy-1')).toBeOnTheScreen();
    expect(screen.queryByTestId('code-copy-2')).toBeNull();
    expect(screen.getAllByLabelText('Copy code')).toHaveLength(2);
  });

  // A hitSlop around the 14pt glyph was clipped to about 37 by 22 on a
  // device: the block's view drops touches outside it, and the code's scroll
  // view, drawn later, wins below the header. The button itself is the target.
  it('is a full touch target in its own right, inside the block and above the code', async () => {
    await render(<Markdown text={TWO_BLOCKS} />);
    const button = screen.getByTestId('code-copy-0');
    expect(button.props.hitSlop).toBeUndefined();
    const style = StyleSheet.flatten(button.props.style);
    expect(style.minWidth).toBeGreaterThanOrEqual(minTouchTarget);
    expect(style.minHeight).toBeGreaterThanOrEqual(minTouchTarget);
    // It reaches into the block's padding, never past it, where a touch is dropped.
    expect(style.marginTop).toBeGreaterThanOrEqual(-spacing.sm);
    expect(style.marginRight).toBeGreaterThanOrEqual(-spacing.sm);
    expect(style.marginBottom ?? 0).toBeGreaterThanOrEqual(0);
  });

  it('is drawn on the tint as well, in the tint\'s colour', async () => {
    await render(<Markdown text={TWO_BLOCKS} onTint />);
    const button = screen.getByTestId('code-copy-1');
    expect(within(button).getByTestId('icon-tint:colors.onTint')).toBeOnTheScreen();
  });

  it('is drawn in the secondary colour off the tint', async () => {
    await render(<Markdown text={TWO_BLOCKS} />);
    const button = screen.getByTestId('code-copy-1');
    expect(within(button).getByTestId('icon-tint:colors.secondaryLabel')).toBeOnTheScreen();
  });

  // A reply still streaming "Run:\n```sh\n" is a block with nothing in it.
  // Copying it put '' on the clipboard, wiping what was there, and showed a tick.
  it('is not drawn on a block with nothing in it yet', async () => {
    await render(<Markdown text={'Run:\n```sh\n'} />);
    expect(screen.getByText('sh')).toBeOnTheScreen();
    expect(screen.queryByTestId('code-copy-0')).toBeNull();

    await render(<Markdown text={'```\n  \n```\n\n```sh\nls\n```'} />);
    expect(screen.queryByTestId('code-copy-0')).toBeNull();
    // Numbered within the text, so the block with code keeps its place.
    expect(screen.getByTestId('code-copy-1')).toBeOnTheScreen();
    expect(screen.getAllByLabelText('Copy code')).toHaveLength(1);
  });

  it('puts only its own block on the clipboard, as written less the trailing newline', async () => {
    await render(<Markdown text={TWO_BLOCKS} />);
    await fireEvent.press(screen.getByTestId('code-copy-1'));
    expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(1);
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('  npm ci');
    expect(haptics.success).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByTestId('code-copy-0'));
    expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith('git status --short');
  });

  it('shows a tick for a moment after the tap, then goes back', async () => {
    jest.useFakeTimers();
    await render(<Markdown text={TWO_BLOCKS} />);
    await fireEvent.press(screen.getByTestId('code-copy-0'));

    const button = screen.getByTestId('code-copy-0');
    expect(button).toHaveAccessibleName('Copied');
    expect(within(button).getByText('icon:checkmark')).toBeOnTheScreen();
    // The other block's Copy is untouched.
    expect(screen.getByTestId('code-copy-1')).toHaveAccessibleName('Copy code');

    await act(() => jest.advanceTimersByTime(motion.copiedFeedback));
    expect(screen.getByTestId('code-copy-0')).toHaveAccessibleName('Copy code');
    expect(within(screen.getByTestId('code-copy-0')).getByText('icon:doc.on.doc')).toBeOnTheScreen();
  });
});
