import { render } from '@testing-library/react-native';
import { IOSConfig } from '@expo/config-plugins';
import type { ExpoConfig } from '@expo/config-types';
import { Text } from 'react-native';

import appConfig from '../../../app.json';
import { Screen } from '../Screen';
import { size } from '@/theme/tokens';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: { systemBackground: '#000000' } }),
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
});
