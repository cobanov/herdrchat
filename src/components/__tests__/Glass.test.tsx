import { render } from '@testing-library/react-native';
import { Text, View as MockView, type ViewProps } from 'react-native';

import { Glass } from '../Glass';

let mockScheme = 'dark';
let mockReduceTransparency = false;
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ scheme: mockScheme, reduceTransparency: mockReduceTransparency, colors: { glassFallback: '#222222' } }),
}));
jest.mock('expo-blur', () => ({ BlurView: (props: ViewProps) => <MockView testID="blur" {...props} /> }));
jest.mock('expo-glass-effect', () => ({
  GlassView: (props: ViewProps) => <MockView {...props} testID="liquid-glass" />,
  isGlassEffectAPIAvailable: () => true,
}));

it.each(['dark', 'light'])('uses continuous %s navigation material but keeps floating Liquid Glass', async scheme => {
  mockScheme = scheme;
  mockReduceTransparency = false;
  const screen = await render(<Glass edgeAttached><Text>Title</Text></Glass>);
  expect(screen.getByTestId('blur')).toHaveProp('tint', scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight');
  expect(screen.getByTestId('blur')).toHaveProp('intensity', 100);
  expect(screen.queryByTestId('liquid-glass')).toBeNull();
  await screen.rerender(<Glass><Text>Composer</Text></Glass>);
  expect(screen.getByTestId('liquid-glass')).toHaveProp('colorScheme', scheme);
  mockReduceTransparency = true;
  await screen.rerender(<Glass edgeAttached testID="fallback"><Text>Title</Text></Glass>);
  expect(screen.getByTestId('fallback')).toHaveStyle({ backgroundColor: '#222222' });
  expect(screen.queryByTestId('blur')).toBeNull();
  expect(screen.getByText('Title')).toBeOnTheScreen();
});
