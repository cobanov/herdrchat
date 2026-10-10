import { decodeListMode } from '@/lib/listModes';
import { SETTINGS_DEFAULTS, decodeBool, encodeBool, settingsSnapshot, useSettings } from '../settings';

describe('returnSends', () => {
  afterEach(() => useSettings.getState().hydrate(SETTINGS_DEFAULTS));

  // A chat app on a keyboard sends on Return; #113's newline is the opt-out.
  it('is on by default', () => {
    expect(SETTINGS_DEFAULTS.returnSends).toBe(true);
    expect(useSettings.getState().returnSends).toBe(true);
  });

  it('round-trips through its stored form', () => {
    expect(encodeBool(false)).toBe('0');
    expect(encodeBool(true)).toBe('1');
    expect(decodeBool(encodeBool(false), SETTINGS_DEFAULTS.returnSends)).toBe(false);
    expect(decodeBool(encodeBool(true), SETTINGS_DEFAULTS.returnSends)).toBe(true);
  });

  // An install from before the setting existed has no row: it gets the default.
  it('reads a missing row as the default', () => {
    expect(decodeBool(null, SETTINGS_DEFAULTS.returnSends)).toBe(true);
  });

  it('is mirrored into the snapshot', () => {
    useSettings.getState().set('returnSends', false);
    expect(settingsSnapshot().returnSends).toBe(false);
  });
});

describe('listMode', () => {
  afterEach(() => useSettings.getState().hydrate(SETTINGS_DEFAULTS));

  // The chats list opens on the view it always had until someone picks Agents.
  it('is Spaces by default', () => {
    expect(SETTINGS_DEFAULTS.listMode).toBe('spaces');
    expect(useSettings.getState().listMode).toBe('spaces');
  });

  it('round-trips through its stored form and into the snapshot', () => {
    useSettings.getState().set('listMode', 'agents');
    expect(settingsSnapshot().listMode).toBe('agents');
    expect(decodeListMode(String(useSettings.getState().listMode))).toBe('agents');
    useSettings.getState().hydrate({ listMode: decodeListMode(null) });
    expect(useSettings.getState().listMode).toBe('spaces');
  });
});
