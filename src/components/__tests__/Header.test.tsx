import { fireEvent, render } from '@testing-library/react-native';

import { Header } from '../Header';
import { haptics } from '@/lib/haptics';
import { spacing } from '@/theme/tokens';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));
jest.mock('@/lib/haptics', () => ({ haptics: { selection: jest.fn() } }));
jest.mock('../Icon', () => ({ Icon: () => null }));

beforeEach(() => jest.mocked(haptics.selection).mockClear());

describe('Header trailing controls', () => {
  it('shows the action and the menu side by side, each with its own label', async () => {
    // Chats needs both once the tab bar is gone: "+" for a new chat, and the
    // menu that holds Hosts and Settings.
    const screen = await render(
      <Header title="Chats" actionSymbol="square.and.pencil" actionLabel="New chat" onAction={() => {}} menuTestID="chats-menu" onMenu={() => {}} />
    );
    expect(screen.getByTestId('header-action')).toHaveProp('accessibilityLabel', 'New chat');
    expect(screen.getByTestId('chats-menu')).toHaveProp('accessibilityLabel', 'Menu');
  });

  it('opens the menu with a selection haptic, like the other header actions', async () => {
    const onMenu = jest.fn();
    const screen = await render(<Header title="Chats" menuTestID="chats-menu" onMenu={onMenu} />);
    await fireEvent.press(screen.getByTestId('chats-menu'));
    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(haptics.selection).toHaveBeenCalledTimes(1);
  });

  it('draws no menu on a screen that does not ask for one', async () => {
    const screen = await render(<Header title="Hosts" onClose={() => {}} />);
    expect(screen.queryByTestId('header-menu')).toBeNull();
    expect(screen.getByTestId('header-close')).toHaveProp('accessibilityLabel', 'Done');
  });

  it('keeps Done apart from "+" on a sheet that has both, with Done outermost', async () => {
    // Hosts: "Done" used to sit flush against "+", and the glyph's hitSlop
    // reached over the end of the word, so closing the sheet opened "Add a host".
    const screen = await render(
      <Header title="Hosts" onClose={() => {}} actionSymbol="plus" actionLabel="Add a host" onAction={() => {}} />
    );
    const close = screen.getByTestId('header-close');
    expect(close).toHaveStyle({ marginLeft: spacing.xl });
    // Outermost: the last control on the title line.
    const controls = screen.getAllByRole('button').filter((node) => node.props.testID !== 'server-switcher');
    expect(controls.map((node) => node.props.testID)).toEqual(['header-action', 'header-close']);
  });

  it('puts no margin before Done when it is the only control', async () => {
    const screen = await render(<Header title="New chat" onClose={() => {}} closeLabel="Cancel" />);
    expect(screen.getByTestId('header-close')).toHaveStyle({ marginLeft: 0 });
  });
});

describe('Header title menu', () => {
  it('makes the title a button that names the view and opens the menu with a selection haptic', async () => {
    const onPress = jest.fn();
    const screen = await render(
      <Header title="Spaces" titleMenu={{ label: 'Showing Spaces. Change view.', testID: 'chats-view', onPress }} subtitle="Demo" />
    );
    const title = screen.getByTestId('chats-view');
    expect(title).toHaveProp('accessibilityLabel', 'Showing Spaces. Change view.');
    expect(title).toHaveProp('accessibilityRole', 'button');
    expect(screen.getByText('Spaces')).toBeTruthy();
    await fireEvent.press(title);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(haptics.selection).toHaveBeenCalledTimes(1);
  });

  // The title sits on the same line on every screen; a menu must not move it.
  it('gives the title control no height of its own, and draws a plain title without one', async () => {
    const screen = await render(<Header title="Agents" titleMenu={{ label: 'x', testID: 'chats-view', onPress: () => {} }} />);
    expect(screen.getByTestId('chats-view')).not.toHaveStyle({ minHeight: expect.anything() });
    const plain = await render(<Header title="Settings" />);
    expect(plain.queryByTestId('chats-view')).toBeNull();
    expect(plain.queryAllByRole('button')).toHaveLength(0);
  });
});
