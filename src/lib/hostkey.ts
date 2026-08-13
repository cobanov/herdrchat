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
