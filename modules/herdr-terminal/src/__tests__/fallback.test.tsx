import { render } from '@testing-library/react-native';

import { TerminalView, feed, isTerminalAvailable } from '..';

const theme = {
  background: '#000000', foreground: '#ffffff', cursor: '#ff9900', selection: '#333333',
  ansi: Array.from({ length: 16 }, () => '#808080'), dark: true,
};

// Jest has no native side, as Android and an older dev client have none: the
// screen must still render, and the Demo's feed must report it went nowhere.
it('renders a plain view and feeds nothing without the native terminal', async () => {
  expect(isTerminalAvailable).toBe(false);
  expect(feed('t1', 'aGk=')).toBe(false);
  const screen = await render(
    <TerminalView testID="terminal" shellId="t1" theme={theme} fontSize={13} minFontSize={8} maxFontSize={28} />
  );
  expect(screen.getByTestId('terminal')).toBeTruthy();
});
