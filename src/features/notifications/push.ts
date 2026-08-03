import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { HerdrError } from '@/lib/herdr/protocol';
import { shellQuote, withPath } from '@/lib/herdr/shell';
import type { HerdrTransport } from '@/lib/herdr/transport';

/**
 * Push notifications, without a push server of ours.
 *
 * The host already knows when an agent blocks or finishes — it is the machine
 * running them. So the delivery path is: the phone gets an APNs device token
 * from Apple and writes it onto the host over the SSH connection it already
 * has; a watcher on the host (`scripts/herdr-apns-notifier.py`) signs a JWT
 * with an APNs `.p8` auth key and pushes straight to Apple.
 *
 * Nothing of ours sits in the middle, which is the same property the rest of
 * the app has: no account, no server, no third party holding your tokens.
 *
 * The token is not a secret in the credential sense — it only lets whoever
 * holds it send *this app on this device* a notification — but it identifies a
 * device, so it goes to the user's own machine and nowhere else.
 */

/** Where the host-side watcher looks for device tokens. */
const TOKEN_DIR = '"$HOME/.config/herdrchat/apns-tokens"';

export type PushStatus =
  | { state: 'unsupported'; reason: string }
  | { state: 'denied' }
  | { state: 'granted'; token: string };

/**
 * Ask for permission and get this device's APNs token.
 *
 * Returns `unsupported` rather than throwing on a simulator: the Simulator has
 * no APNs registration, and a settings screen that shows an error there would
 * be reporting a fault that doesn't exist.
 */
export async function requestPushToken(): Promise<PushStatus> {
  if (Platform.OS !== 'ios') {
    return { state: 'unsupported', reason: 'Push notifications are iOS-only in this build.' };
  }
  const existing = await Notifications.getPermissionsAsync();
  const granted =
    existing.granted ||
    existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    (await Notifications.requestPermissionsAsync()).granted;

  if (!granted) return { state: 'denied' };

  try {
    const token = await Notifications.getDevicePushTokenAsync();
    return { state: 'granted', token: String(token.data) };
  } catch (thrown) {
    // The Simulator has no APNs registration and fails here. Rather than carry
    // expo-device just to pre-check that, let the real call be the check — it
    // is the same answer, one dependency cheaper, and it also covers the case
    // where a real device fails to register for some other reason.
    return {
      state: 'unsupported',
      reason:
        'This device could not register for push. The Simulator never can; on a real device, check that the build has the push entitlement.',
    };
  }
}

/**
 * Write this device's token onto the host so its watcher can reach us.
 *
 * Idempotent and safe to call on every connect: the filename is stable per
 * install, so re-registering overwrites rather than accumulating. A device that
 * stops using a host leaves a stale file behind, which the watcher survives —
 * APNs simply reports the token as unregistered.
 */
export async function uploadPushToken(
  transport: HerdrTransport,
  deviceId: string,
  token: string,
  bundleId: string
): Promise<void> {
  const payload = JSON.stringify({ token, bundleId, env: 'production' });
  await run(
    transport,
    `mkdir -p ${TOKEN_DIR} && printf '%s' ${shellQuote(payload)} > ${TOKEN_DIR}/${shellQuote(deviceId)}.json`
  );
}

/** Remove this device's token from the host. */
export async function removePushToken(
  transport: HerdrTransport,
  deviceId: string
): Promise<void> {
  await run(transport, `rm -f ${TOKEN_DIR}/${shellQuote(deviceId)}.json`);
}

async function run(transport: HerdrTransport, command: string): Promise<void> {
  const result = await transport.exec(withPath(command));
  if (!result.ok) throw new HerdrError(result.code, result.message);
  if (result.exitCode !== 0) {
    throw new HerdrError(
      'push_registration_failed',
      `Couldn't write the device token on the host (exit ${result.exitCode}).`
    );
  }
}

/**
 * A stable per-install id, used as the token's filename on the host.
 *
 * Restricted to characters that are inert in a shell word, because it is
 * interpolated into a path.
 */
export function deviceFileId(installationId: string): string {
  const safe = installationId.replace(/[^A-Za-z0-9-]/g, '-');
  return safe.length > 0 ? safe : 'device';
}
