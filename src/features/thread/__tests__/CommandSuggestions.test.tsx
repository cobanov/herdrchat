import { fireEvent, render } from '@testing-library/react-native';
import { View as MockView, type ViewProps } from 'react-native';

import { paletteSections, type CatalogueCommand } from '@/lib/slashCommands';
import { CommandSuggestions, commandTestID } from '../CommandSuggestions';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));
jest.mock('@/components/Glass', () => ({ Glass: (props: ViewProps) => <MockView {...props} /> }));

const command = (over: Partial<CatalogueCommand> & { name: string }): CatalogueCommand =>
  ({ description: '', argumentHint: null, section: 'builtin', source: 'builtin', ...over });

const catalogue = [
  command({ name: 'compact', description: 'Free up context', argumentHint: '<instructions>' }),
  command({ name: 'usage', description: 'Show session cost' }),
  command({ name: 'release-notes', description: 'Write release notes', section: 'skills', source: 'user' }),
  command({ name: 'notes:summarise', description: 'Summarise the notes', section: 'commands', source: 'project' }),
  command({ name: 'demo-tools:lint', description: 'Lint', section: 'plugins', source: 'plugin' }),
];

it('names a namespaced command\'s row without its colon', () => {
  expect(commandTestID('demo-tools:lint')).toBe('command-suggestion-demo-tools-lint');
});

it('shows each section under its header, each row with its hint and description, and hands back the pick', async () => {
  const onPick = jest.fn();
  const screen = await render(<CommandSuggestions sections={paletteSections('/', catalogue)} onPick={onPick} />);
  for (const [section, title] of [['builtin', 'BUILT-IN'], ['skills', 'SKILLS'], ['commands', 'COMMANDS'], ['plugins', 'PLUGINS']]) {
    expect(screen.getByTestId(`command-section-${section}`)).toHaveTextContent(title!);
  }
  expect(screen.getByTestId('command-suggestion-compact')).toHaveTextContent(/\/compact <instructions>.*Free up context/);
  expect(screen.queryByTestId('command-suggestion-usage-hint')).toBeNull();
  expect(screen.getByTestId('command-palette')).toHaveProp('keyboardShouldPersistTaps', 'always');
  await fireEvent.press(screen.getByTestId('command-suggestion-notes-summarise'));
  expect(onPick).toHaveBeenCalledWith(catalogue[3]);
});

it('shows what matches a typed name as one ranked list, with no section headers', async () => {
  const screen = await render(<CommandSuggestions sections={paletteSections('/notes', catalogue)} onPick={() => {}} />);
  for (const section of ['builtin', 'skills', 'commands', 'plugins']) {
    expect(screen.queryByTestId(`command-section-${section}`)).toBeNull();
  }
  expect(screen.getByTestId('command-suggestion-notes-summarise')).toBeOnTheScreen();
  // A description match: "Write release notes".
  expect(screen.getByTestId('command-suggestion-release-notes')).toBeOnTheScreen();
  // The name match first, the description match after it, whatever their sections.
  const rows = screen.getAllByRole('button').map((row) => row.props.testID as string);
  expect(rows).toEqual(['command-suggestion-notes-summarise', 'command-suggestion-release-notes']);
});
