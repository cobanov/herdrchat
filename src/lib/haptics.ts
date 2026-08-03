import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { settingsSnapshot } from '@/state/settings';

/**
 * Haptics, in one place, respecting the user's preference.
 *
 * Every call site used to reach for `expo-haptics` directly, which meant the
 * "off" setting could only ever be honoured by remembering to check it — and
 * the calibration (which weight means what) was re-decided per call site.
 *
 * Calibration: `selection` for toggles, tabs and pickers; `light` for sends and
 * confirmations; `medium` for destructive intent; the notification types for
 * outcomes. Never on scroll.
 */
function enabled(): boolean {
  return Platform.OS === 'ios' && settingsSnapshot().haptics;
}

export const haptics = {
  selection() {
    if (enabled()) void Haptics.selectionAsync();
  },
  light() {
    if (enabled()) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  },
  medium() {
    if (enabled()) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  },
  success() {
    if (enabled()) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  },
  error() {
    if (enabled()) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  },
};
