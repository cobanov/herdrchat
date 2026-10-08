import { resolveHostTheme } from '@/lib/theme/resolve';
import { darkPalette, lightPalette } from '@/theme/tokens';

import { hostThemeSummary } from '../hostThemeSummary';

const resolve = (text: string) =>
  resolveHostTheme({ kind: 'present', mtime: 1, text }, { light: lightPalette, dark: darkPalette });

describe('hostThemeSummary', () => {
  it('says Off when the switch is off, whatever the host has', () => {
    expect(hostThemeSummary(false, resolve('{"name":"Warm","accent":"#D08A3E"}'), 'box')).toEqual({
      value: 'Off',
      detail: null,
      attention: false,
    });
  });

  it('says Default before the first check and when there is no file', () => {
    expect(hostThemeSummary(true, undefined, 'box').value).toBe('Default');
    const missing = resolveHostTheme({ kind: 'missing' }, { light: lightPalette, dark: darkPalette });
    expect(hostThemeSummary(true, missing, 'box')).toEqual({ value: 'Default', detail: null, attention: false });
  });

  it('names the theme and counts its colours from the host', () => {
    expect(hostThemeSummary(true, resolve('{"name":"Warm","accent":"#D08A3E"}'), 'box')).toEqual({
      value: 'Warm',
      detail: '1 colour from box',
      attention: false,
    });
  });

  it('says Custom for a theme without a name', () => {
    const summary = hostThemeSummary(true, resolve('{"accent":"#D08A3E","dark":{"tint":"#E9A25A"}}'), 'box');
    expect(summary.value).toBe('Custom');
    expect(summary.detail).toBe('2 colours from box');
  });

  it('counts what was ignored, in the attention colour', () => {
    const summary = hostThemeSummary(true, resolve('{"accent":"#D08A3E","light":{"tnit":"#000"}}'), 'box');
    expect(summary).toEqual({ value: 'Custom', detail: '1 colour, 1 ignored', attention: true });
  });

  it('says Default when the file could not be used at all', () => {
    expect(hostThemeSummary(true, resolve('{"accent":'), 'box')).toEqual({
      value: 'Default',
      detail: 'theme.json could not be used',
      attention: true,
    });
    const unreadable = resolveHostTheme({ kind: 'unreadable', mtime: 3 }, { light: lightPalette, dark: darkPalette });
    expect(hostThemeSummary(true, unreadable, 'box').value).toBe('Default');
  });
});
