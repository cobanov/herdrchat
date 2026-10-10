import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { HostThemeOverrides } from '@/lib/theme/resolve';
import { ThemeProvider, themeColors, useTheme } from '../ThemeProvider';
import { avatarPalette, darkPalette, lightPalette } from '../tokens';

const overrides: HostThemeOverrides = {
  light: { tint: '#B5562F', systemBackground: '#FBF7F2' },
  dark: { tint: '#E9A25A' },
  avatars: ['#111111', '#222222'],
};

describe('themeColors', () => {
  it('is the stock palette with no host theme', () => {
    expect(themeColors('light')).toEqual({ colors: lightPalette, avatarPalette });
    expect(themeColors('dark', {}).colors).toBe(darkPalette);
  });

  it('lays each scheme\'s keys over that scheme only', () => {
    const light = themeColors('light', overrides).colors;
    expect(light.tint).toBe('#B5562F');
    expect(light.systemBackground).toBe('#FBF7F2');
    expect(light.label).toBe(lightPalette.label);
    const dark = themeColors('dark', overrides).colors;
    expect(dark.tint).toBe('#E9A25A');
    expect(dark.systemBackground).toBe(darkPalette.systemBackground);
  });

  it('takes the host\'s avatars only when there is at least one', () => {
    expect(themeColors('light', overrides).avatarPalette).toEqual(['#111111', '#222222']);
    expect(themeColors('light', { avatars: [] }).avatarPalette).toBe(avatarPalette);
  });
});

it('renders the host theme it is given, and its name', async () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ThemeProvider preference="light" overrides={overrides} hostThemeName="Warm dusk">
      {children}
    </ThemeProvider>
  );
  const { result } = await renderHook(() => useTheme(), { wrapper });
  expect(result.current.colors.tint).toBe('#B5562F');
  expect(result.current.avatarPalette).toEqual(['#111111', '#222222']);
  expect(result.current.hostThemeName).toBe('Warm dusk');
});

it('renders the stock theme without one', async () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ThemeProvider preference="dark">{children}</ThemeProvider>
  );
  const { result } = await renderHook(() => useTheme(), { wrapper });
  expect(result.current.colors).toBe(darkPalette);
  expect(result.current.avatarPalette).toBe(avatarPalette);
  expect(result.current.hostThemeName).toBeNull();
});
