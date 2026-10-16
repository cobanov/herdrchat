import { ActionSheetIOS, Platform } from 'react-native';

import { haptics } from '@/components/haptics';
import { buildSheet, type SheetAction } from '@/lib/actionSheet';
import { useActionSheet } from '@/state/actionSheet';

/**
 * The ONLY file in the app that imports `ActionSheetIOS`.
 *
 * Same containment as `Glass.tsx`, for the same reason: the platform check and
 * the fallback have to live somewhere they cannot be forgotten, and the ordering
 * rule has to be somewhere a call site cannot opt out of.
 *
 * WHAT THIS ACTUALLY LOOKS LIKE ON iOS 26, measured on a simulator rather than
 * assumed: a CENTRED glass card, not a sheet anchored to the bottom edge. Apple
 * unified the alert and action-sheet presentations, and `UIAlertController`'s
 * `.actionSheet` style now centres on iPhone at any number of actions — a
 * three-action sheet centres exactly like a one-action confirmation does.
 *
 * So the claim to make for this module is narrower than "it is a bottom sheet":
 * what the system gives us, and the `Alert` it replaces did not, is a dimmed
 * backdrop, tap-outside-to-dismiss, red styling on destructive rows, and a
 * consistent ordering enforced in one place. It does NOT give bottom-edge
 * placement or a drag-to-dismiss grabber on this OS version. If either is ever
 * genuinely needed, that is a custom sheet and a deliberate decision — not
 * something to expect from here.
 *
 * Android shows a Material bottom sheet, `ActionSheetHost`, which is that
 * platform's own idiom for "actions on this thing". It used to fall back to
 * `Alert.alert`, which keeps three buttons and silently drops the rest: a chat's
 * long press lost Close chat and Cancel both.
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

  // Android: the host at the root draws it, from the same ordered config.
  useActionSheet.getState().present({ title, message, config: sheet });
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
