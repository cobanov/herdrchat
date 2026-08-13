import { shouldResetPin } from '../hostkey';

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
