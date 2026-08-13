/**
 * Host-key pin lifecycle decisions, pure so a test can pin them.
 *
 * A pin binds a saved server to the key of one endpoint (host + port). When
 * that binding survives an edit is policy, not plumbing, so it lives here
 * rather than in the editor screen.
 */

export interface HostEndpoint {
  host: string;
  port: number;
}

/**
 * True when saving `draft` must replace the stored pin with the fingerprint
 * the passing connection test observed; false when the stored pin is still the
 * host's identity and must survive the save untouched.
 *
 * `existing === null` is a new server: no pin exists, so the observed
 * fingerprint becomes the first one. An unchanged endpoint means the edit was
 * cosmetic (name, herdr path, session) and the pin still identifies the same
 * machine — dropping it there would re-open the trust-on-first-use window on
 * every edit. The same predicate, negated, says whether the pre-save test must
 * enforce the stored pin.
 */
export function shouldResetPin(existing: HostEndpoint | null, draft: HostEndpoint): boolean {
  if (existing === null) return true;
  return existing.host !== draft.host || existing.port !== draft.port;
}

// MARK: - Fingerprint format
//
// One format across both platforms and the UI: OpenSSH's, which is UNPADDED
// base64 of SHA-256 over the SSH wire encoding of the key, shown as
// `SHA256:<b64>`. That is exactly what `ssh-keygen -lf` prints, so a suspicious
// user can compare the two by eye instead of taking our word for it.

/**
 * The stored form of a fingerprint: base64 with any `=` padding removed.
 *
 * Migration, and the reason this is a function rather than a rule: pins written
 * before the formats were unified are the old ones. iOS wrote the same digest
 * with padding, so stripping it on both sides makes an old pin match its new
 * equivalent. Android hashed the X.509 SPKI encoding instead of the SSH wire
 * blob — a different digest of the same key, NOT derivable from the new one. An
 * Android pin from before this change therefore reads as a key change, and the
 * UI's key-change recovery is what covers it. That is the honest outcome: we
 * cannot prove the old pin and the new fingerprint describe one key.
 */
export function normalizeFingerprint(fingerprint: string): string {
  return fingerprint.replace(/=+$/, '');
}

/** True when a stored pin and an observed fingerprint name the same key. */
export function fingerprintMatchesPin(pin: string, observed: string): boolean {
  return normalizeFingerprint(pin) === normalizeFingerprint(observed);
}

/** For display: `SHA256:<b64>`, the form `ssh-keygen -lf` prints. */
export function formatFingerprint(fingerprint: string): string {
  return `SHA256:${normalizeFingerprint(fingerprint)}`;
}

// MARK: - Key-change detection in the chat list

/**
 * The one sentence both native layers emit for `host_key_changed`.
 *
 * The chat list's poll publishes its failure as a message, not as the
 * `HerdrError` it came from, so this is what the list has to recognise. When
 * that poll starts carrying the code, match on the code and delete this.
 */
const KEY_CHANGED_MARKER = 'SSH key DIFFERS';

/** True when a poll failure is a host-key mismatch rather than an ordinary one. */
export function isHostKeyChangedMessage(message: string | null): boolean {
  return message !== null && message.includes(KEY_CHANGED_MARKER);
}
