import { render } from '@testing-library/react-native';
import { IOSConfig } from '@expo/config-plugins';
import type { ExpoConfig } from '@expo/config-types';
import { Platform, Text } from 'react-native';

import appConfig from '../../../app.json';
import { Screen } from '../Screen';
import { radius, size } from '@/theme/tokens';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: { systemBackground: '#000000' } }),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 48, right: 0, bottom: 24, left: 0 }),
}));

describe('tablet support', () => {
  it('generates a universal app with all iPad orientations, keeping iPhone portrait', () => {
    const config = appConfig.expo as ExpoConfig;
    expect(IOSConfig.DeviceFamily.getDeviceFamilies(config)).toEqual([1, 2]);
    expect(config.orientation).toBe('portrait');
    const plist = IOSConfig.RequiresFullScreen.setRequiresFullScreen(
      config,
      IOSConfig.Orientation.setOrientation(config, {})
    );
    expect(plist.UIRequiresFullScreen).toBe(false);
    expect(plist.UISupportedInterfaceOrientations).not.toContain('UIInterfaceOrientationLandscapeLeft');
    expect(plist['UISupportedInterfaceOrientations~ipad']).toEqual([
      'UIInterfaceOrientationPortrait',
      'UIInterfaceOrientationPortraitUpsideDown',
      'UIInterfaceOrientationLandscapeLeft',
      'UIInterfaceOrientationLandscapeRight',
    ]);
  });

  it.each(['full', 'sheet'] as const)('keeps %s content flexible with a readable width cap', async (presentation) => {
    const screen = await render(<Screen presentation={presentation}><Text>Conversation</Text></Screen>);
    expect(screen.getByTestId('screen-content')).toHaveStyle({
      flex: 1,
      width: '100%',
      maxWidth: size.contentMaxWidth,
      alignSelf: 'center',
    });
    expect(size.contentMaxWidth).toBeGreaterThan(600);
    expect(screen.getByText('Conversation')).toBeOnTheScreen();
  });

  it('lets edge-attached chrome fill the window without changing other screen modes', async () => {
    const screen = await render(<Screen presentation="edge-to-edge"><Text>Conversation</Text></Screen>);
    expect(screen.getByTestId('screen-content').props.style.maxWidth).toBeUndefined();
    expect(screen.getByTestId('screen-content')).toHaveStyle({ flex: 1, width: '100%' });
  });
});

describe('form sheet', () => {
  const originalOS = Object.getOwnPropertyDescriptor(Platform, 'OS');
  afterEach(() => {
    if (originalOS) Object.defineProperty(Platform, 'OS', originalOS);
  });

  // Android's bottom sheet: a status-bar inset was an empty band above Rename's
  // title, the gesture bar sat over its last line, and its corners were square.
  it('clears the gesture bar on Android, follows the sheet\'s corners, and never insets the top', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
    const screen = await render(<Screen presentation="form-sheet"><Text>Rename</Text></Screen>);
    expect(screen.getByTestId('form-sheet')).toHaveStyle({
      paddingBottom: 24,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
    });
    expect(screen.getByTestId('form-sheet').props.style.paddingTop).toBeUndefined();
  });

  it('leaves the iOS sheet to the system', async () => {
    const screen = await render(<Screen presentation="form-sheet"><Text>Rename</Text></Screen>);
    expect(screen.getByTestId('form-sheet')).toHaveStyle({ paddingBottom: 0, borderTopLeftRadius: 0 });
  });
});
