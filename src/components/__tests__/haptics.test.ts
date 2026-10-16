import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { haptics } from '@/components/haptics';

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  performAndroidHapticsAsync: jest.fn(async () => {}),
}));

let mockEnabled = true;
jest.mock('@/state/settings', () => ({ settingsSnapshot: () => ({ haptics: mockEnabled }) }));

const originalOS = Object.getOwnPropertyDescriptor(Platform, 'OS');
function on(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}
afterEach(() => {
  if (originalOS) Object.defineProperty(Platform, 'OS', originalOS);
  mockEnabled = true;
  jest.clearAllMocks();
});

// Android was left out entirely, so the Haptics switch in Settings did nothing
// there.
it('plays Android’s own haptic constants on Android, not the vibrator imitation', () => {
  on('android');
  haptics.selection();
  haptics.light();
  haptics.medium();
  haptics.success();
  haptics.error();
  expect(jest.mocked(Haptics.performAndroidHapticsAsync).mock.calls.map(([type]) => type)).toEqual([
    Haptics.AndroidHaptics.Clock_Tick,
    Haptics.AndroidHaptics.Context_Click,
    Haptics.AndroidHaptics.Long_Press,
    Haptics.AndroidHaptics.Confirm,
    Haptics.AndroidHaptics.Reject,
  ]);
  expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
});

it('keeps iOS on its own feedback generators', () => {
  on('ios');
  haptics.selection();
  haptics.medium();
  expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Medium);
  expect(Haptics.performAndroidHapticsAsync).not.toHaveBeenCalled();
});

it.each(['ios', 'android'] as const)('stays silent on %s when the setting is off', (os) => {
  on(os);
  mockEnabled = false;
  haptics.selection();
  haptics.error();
  expect(Haptics.performAndroidHapticsAsync).not.toHaveBeenCalled();
  expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
});
