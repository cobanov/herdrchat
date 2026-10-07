import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { Markdown } from '../Markdown';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));

const TABLE = [
  '| Name | Type | Note |',
  '|---|:-:|--:|',
  '| `id` | number | short |',
  '| title | string | a much longer note that wraps onto a second line in its column |',
].join('\n');

function layout(height: number) {
  return { nativeEvent: { layout: { x: 0, y: 0, width: 100, height } } };
}

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

// Built as columns, a screen reader walking the views would read down each
// column. The table is one element that reads row by row instead.
it('reads to a screen reader row by row, with each cell\'s header', async () => {
  await render(<Markdown text={TABLE} />);
  expect(screen.getByLabelText(/^Name: id, Type: number, Note: short\. Name: title/)).toBeOnTheScreen();
});
