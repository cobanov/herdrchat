import { ActionSheetIOS, Alert, Platform } from 'react-native';

import { haptics } from '@/lib/haptics';
import { buildSheet, type SheetAction } from '@/lib/actionSheet';

/**
 * The ONLY file in the app that imports `ActionSheetIOS`.
 *
 * Same containment as `Glass.tsx`, for the same reason: the platform check and
 * the fallback have to live somewhere they cannot be forgotten, and the ordering
 * rule has to be somewhere a call site cannot opt out of.
 *
 * What the system sheet gives us that the `Alert` this replaces did not: a
 * dimmed backdrop, dismissal by tapping outside or dragging down, red styling on
 * destructive rows, and — the one that actually matters on a phone — placement
 * at the bottom of the screen instead of the middle, where the thumb already is.
 *
 * Android falls back to `Alert.alert`, which is that platform's own equivalent
 * surface. A JS imitation of an iOS sheet on Android would be worse than either.
 */

export type { SheetAction };

export interface ShowSheetOptions {
  /** What this sheet is about. Always set — an unlabelled list of verbs makes
   *  the reader reconstruct which object they are acting on. */
  title: string;
  /** A second line, for a consequence that the verbs alone do not convey. */
  message?: string;
  actions: SheetAction[];
  cancelLabel?: string;
}

/**
 * Present an action sheet.
 *
 * Fire-and-forget rather than a promise: every caller so far wants "run this
 * when tapped", and a promise would make dismissal an outcome each of them has
 * to remember to ignore.
 */
export function showActionSheet({
  title,
  message,
  actions,
  cancelLabel,
}: ShowSheetOptions): void {
  const sheet = buildSheet(actions, cancelLabel);

  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        message,
        options: sheet.options,
        destructiveButtonIndex: sheet.destructiveButtonIndices,
        cancelButtonIndex: sheet.cancelButtonIndex,
      },
      (index) => {
        // Tapping Cancel lands here too, on the no-op `buildSheet` puts in that
        // slot — which is why this needs no index comparison of its own.
        sheet.handlers[index]?.();
      }
    );
    return;
  }

  // Android. `Alert` renders buttons in the order given and has no notion of a
  // destructive one, so the ordering `buildSheet` applied is the only thing
  // separating Delete from the rows above it — which is an argument for the
  // rule living there rather than in the iOS branch.
  Alert.alert(
    title,
    message,
    sheet.options.map((label, index) => ({
      text: label,
      style: index === sheet.cancelButtonIndex ? 'cancel' : 'default',
      onPress: () => sheet.handlers[index]?.(),
    }))
  );
}

/**
 * A yes/no confirmation for something irreversible.
 *
 * Separate from `showActionSheet` because the shape is fixed — one destructive
 * verb and a way out — and spelling that out at each call site invites someone
 * to phrase the dangerous button as "OK".
 *
 * The haptic fires on presentation, not on confirm: it is the warning, and by
 * the time you have confirmed you no longer need to be told.
 */
export function confirmDestructive({
  title,
  message,
  confirmLabel,
  onConfirm,
}: {
  title: string;
  message?: string;
  confirmLabel: string;
  onConfirm: () => void;
}): void {
  haptics.medium();
  showActionSheet({
    title,
    message,
    actions: [{ label: confirmLabel, destructive: true, onPress: onConfirm }],
  });
}
