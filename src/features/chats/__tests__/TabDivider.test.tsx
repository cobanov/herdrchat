import { render } from '@testing-library/react-native';

import { TabDivider } from '../TabDivider';
import type { ChatSummary } from '../useWorkspaces';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));

const api: ChatSummary = {
  workspaceId: 'w6', title: 'api', number: 6, status: 'idle', agents: [], panes: [],
  preview: null, sessionSig: null, shellPanes: [], tabs: [], layouts: [], activeTabId: null, tabCount: 0, paneCount: 0, restoreError: null, sessionTitle: null, agentName: null,
};

// A tab herdr only numbered, after the first: the line alone, no label.
it('draws only the line for an unnamed tab after the first', async () => {
  const screen = await render(<TabDivider summary={api} tabId="w6:t2" label={null} first={false} />);
  expect(screen.getByTestId('tab-divider-w6:t2')).toBeOnTheScreen();
  expect(screen.queryByTestId('tab-header-w6:t2')).toBeNull();
});

it('draws the line and the name for a named tab after the first', async () => {
  const screen = await render(<TabDivider summary={api} tabId="w6:t2" label="server" first={false} />);
  expect(screen.getByTestId('tab-divider-w6:t2')).toBeOnTheScreen();
  expect(screen.getByTestId('tab-header-w6:t2')).toHaveTextContent('server');
});

// No line above the first tab: the card is right there.
it('draws only the name for a named first tab', async () => {
  const screen = await render(<TabDivider summary={api} tabId="w6:t1" label="api" first />);
  expect(screen.queryByTestId('tab-divider-w6:t1')).toBeNull();
  expect(screen.getByTestId('tab-header-w6:t1')).toHaveTextContent('api');
});
