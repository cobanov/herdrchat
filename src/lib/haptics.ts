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
 *
 * Android uses the view's own haptic constants rather than expo-haptics' iOS
 * calls, which Android can only imitate with the vibrator motor: a buzz, not a
 * tick, and one that ignores the system's touch-feedback setting. Android was
 * once left out entirely, which made the Haptics switch in Settings a switch
 * that did nothing there.
 */
function enabled(): boolean {
  return settingsSnapshot().haptics;
}

function play(ios: () => Promise<void>, android: Haptics.AndroidHaptics): void {
  if (!enabled()) return;
  void (Platform.OS === 'android' ? Haptics.performAndroidHapticsAsync(android) : ios());
}

export const haptics = {
  selection() {
    play(() => Haptics.selectionAsync(), Haptics.AndroidHaptics.Clock_Tick);
  },
  light() {
    play(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), Haptics.AndroidHaptics.Context_Click);
  },
  medium() {
    play(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), Haptics.AndroidHaptics.Long_Press);
  },
  success() {
    play(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), Haptics.AndroidHaptics.Confirm);
  },
  error() {
    play(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error), Haptics.AndroidHaptics.Reject);
  },
};
