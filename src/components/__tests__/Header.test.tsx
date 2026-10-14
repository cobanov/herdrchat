import { fireEvent, render } from '@testing-library/react-native';

import { Header } from '../Header';
import { Platform } from 'react-native';

import { Icon, MATERIAL_GLYPHS } from '../Icon';
import { haptics } from '@/lib/haptics';
import { spacing } from '@/theme/tokens';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));
jest.mock('@/lib/haptics', () => ({ haptics: { selection: jest.fn() } }));
jest.mock('../Icon', () => ({ Icon: jest.fn(() => null), MATERIAL_GLYPHS: jest.requireActual<typeof import('../Icon')>('../Icon').MATERIAL_GLYPHS }));

const originalOS = Object.getOwnPropertyDescriptor(Platform, 'OS');
function onAndroid() {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
}
beforeEach(() => jest.mocked(haptics.selection).mockClear());
afterEach(() => {
  if (originalOS) Object.defineProperty(Platform, 'OS', originalOS);
});

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

  it('reads the menu by the label it is given', async () => {
    const screen = await render(<Header title="Chats" menuTestID="chats-menu" menuLabel="More: Hosts, Settings" onMenu={() => {}} />);
    expect(screen.getByTestId('chats-menu')).toHaveProp('accessibilityLabel', 'More: Hosts, Settings');
  });

  it('draws the menu as each platform draws "more"', async () => {
    const symbols: string[] = [];
    jest.mocked(Icon).mockImplementation(({ name }) => {
      symbols.push(name);
      return <></>;
    });
    await render(<Header title="Chats" onMenu={() => {}} />);
    onAndroid();
    await render(<Header title="Chats" onMenu={() => {}} />);
    expect(symbols).toEqual(['ellipsis.circle', 'ellipsis']);
    expect(MATERIAL_GLYPHS.ellipsis[0]).toBe('more_vert');
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

  // The tab bar's badge was the only sign of a blocked agent while Hosts or
  // Settings was open (#154 review); the count sits beside their Done now.
  it('shows how many chats want you beside Done, and says it as a value', async () => {
    const screen = await render(<Header title="Hosts" onClose={() => {}} closeBadge={3} />);
    expect(screen.getByTestId('header-close-badge')).toHaveTextContent('3');
    expect(screen.getByTestId('header-close')).toHaveProp('accessibilityLabel', 'Done');
    expect(screen.getByTestId('header-close')).toHaveProp('accessibilityValue', { text: '3 chats need you' });
    await screen.rerender(<Header title="Hosts" onClose={() => {}} closeBadge={0} />);
    expect(screen.queryByTestId('header-close-badge')).toBeNull();
  });

  it('puts no margin before Done when it is the only control', async () => {
    const screen = await render(<Header title="New chat" onClose={() => {}} closeLabel="Cancel" />);
    expect(screen.getByTestId('header-close')).toHaveStyle({ marginLeft: 0 });
  });
});
