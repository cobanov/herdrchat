import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { BubbleImage } from '../BubbleImage';
import { size } from '@/theme/tokens';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').lightPalette, reduceMotion: true }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/state/attachmentFiles', () => ({ localImageUri: (path: string) => `file://${path}` }));

// A bubble started square until its picture loaded, and the thread recycles
// rows: every picture jumped in height each time it scrolled back into view.
it('starts a picture it has loaded before at its own proportions', async () => {
  const first = await render(<BubbleImage path="/up/wide.png" onTint={false} />);
  fireEvent(first.getByTestId('bubble-image-picture'), 'load', { nativeEvent: { source: { width: 400, height: 200 } } });
  first.unmount();

  const again = await render(<BubbleImage path="/up/wide.png" onTint={false} />);
  const style = StyleSheet.flatten(again.getByTestId('bubble-image-picture').props.style);
  expect(style.width).toBe(size.bubbleImage);
  expect(style.height).toBe(size.bubbleImage / 2);
});
