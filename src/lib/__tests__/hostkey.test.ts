import {
  fingerprintMatchesPin,
  formatFingerprint,
  isHostKeyChangedMessage,
  normalizeFingerprint,
  shouldResetPin,
} from '../hostkey';

describe('shouldResetPin', () => {
  const saved = { host: '100.64.0.7', port: 22 };

  it('re-pins a brand-new server', () => {
    expect(shouldResetPin(null, saved)).toBe(true);
  });

  it('keeps the pin across a cosmetic edit (same endpoint)', () => {
    expect(shouldResetPin(saved, { host: '100.64.0.7', port: 22 })).toBe(false);
  });

  it('re-pins when the host changes', () => {
    expect(shouldResetPin(saved, { host: '100.64.0.8', port: 22 })).toBe(true);
  });

  it('re-pins when the port changes', () => {
    expect(shouldResetPin(saved, { host: '100.64.0.7', port: 2222 })).toBe(true);
  });
});

describe('fingerprint format', () => {
  const padded = 'kD3Y7l9m0aJ2bQ8pR1sT4uV6wX9yZ0aB2cD4eF6gH8=';
  const bare = 'kD3Y7l9m0aJ2bQ8pR1sT4uV6wX9yZ0aB2cD4eF6gH8';

  it('strips base64 padding', () => {
    expect(normalizeFingerprint(padded)).toBe(bare);
    expect(normalizeFingerprint(bare)).toBe(bare);
  });

  it('matches an old padded pin against the new unpadded fingerprint', () => {
    expect(fingerprintMatchesPin(padded, bare)).toBe(true);
  });

  it('does not match a different key', () => {
    expect(fingerprintMatchesPin(padded, 'ZZZY7l9m0aJ2bQ8pR1sT4uV6wX9yZ0aB2cD4eF6gH8')).toBe(false);
  });

  it('displays the form ssh-keygen prints', () => {
    expect(formatFingerprint(padded)).toBe(`SHA256:${bare}`);
  });
});

describe('isHostKeyChangedMessage', () => {
  it('recognises the native mismatch message', () => {
    expect(
      isHostKeyChangedMessage(
        "The server's SSH key DIFFERS from the saved one (possible MITM, or the server was reinstalled). If you trust it, edit and save the server to reset the pin."
      )
    ).toBe(true);
  });

  it('leaves an ordinary failure to the generic banner', () => {
    expect(isHostKeyChangedMessage("Couldn't reach the host.")).toBe(false);
    expect(isHostKeyChangedMessage(null)).toBe(false);
  });
});
