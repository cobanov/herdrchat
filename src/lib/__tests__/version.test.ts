import {
  AGENT_VERBS_VERSION,
  MIN_HERDR_VERSION,
  RECOMMENDED_HERDR_VERSION,
  atLeast,
  parseVersion,
  versionAdvice,
  versionVerdict,
} from '../herdr/version';

describe('parseVersion', () => {
  it('parses what herdr actually reports', () => {
    // Measured on this machine: `herdr --version` prints "herdr 0.8.0", and the
    // snapshot's `version` field carries just the number.
    expect(parseVersion('0.8.0')).toEqual({ major: 0, minor: 8, patch: 0 });
    expect(parseVersion('0.7.4')).toEqual({ major: 0, minor: 7, patch: 4 });
  });

  it('tolerates a leading v and trailing metadata', () => {
    // The value comes off the wire from a host we do not control.
    expect(parseVersion('v0.8.0')).toEqual({ major: 0, minor: 8, patch: 0 });
    expect(parseVersion('0.8.0-preview.2')).toEqual({ major: 0, minor: 8, patch: 0 });
  });

  it('returns null rather than throwing on anything else', () => {
    for (const bad of [null, undefined, '', 'unknown', 'herdr', '1.2']) {
      expect(parseVersion(bad)).toBeNull();
    }
  });
});

describe('atLeast', () => {
  it('compares numerically, not lexically', () => {
    // The bug a string compare would produce: "0.10.0" < "0.8.0".
    expect(atLeast('0.10.0', '0.8.0')).toBe(true);
    expect(atLeast('0.8.0', '0.10.0')).toBe(false);
  });

  it('treats equal as satisfied', () => {
    expect(atLeast('0.8.0', '0.8.0')).toBe(true);
  });

  it('answers false for an unknown version, every time', () => {
    // The safe direction: a false negative costs the legacy path, a false
    // positive sends a flag the host rejects.
    expect(atLeast(null, '0.8.0')).toBe(false);
    expect(atLeast('nonsense', '0.8.0')).toBe(false);
  });
});

describe('versionVerdict', () => {
  it('calls 0.9.5 current, and anything newer', () => {
    expect(versionVerdict('0.9.5')).toEqual({ kind: 'current', version: '0.9.5' });
    expect(versionVerdict('0.10.0').kind).toBe('current');
  });

  it('calls 0.8.0 to 0.9.4 outdated — every verb, but not the fixes the app leans on', () => {
    expect(versionVerdict('0.8.0')).toEqual({ kind: 'outdated', version: '0.8.0' });
    expect(versionVerdict('0.9.4').kind).toBe('outdated');
  });

  it('calls 0.7.4 legacy rather than broken', () => {
    // 0.7.4 works. It just has no `agent prompt`, so the app falls back. Saying
    // "unsupported" here would be crying wolf.
    expect(versionVerdict('0.7.4')).toEqual({ kind: 'legacy', version: '0.7.4' });
  });

  it('calls anything below the floor unsupported', () => {
    expect(versionVerdict('0.6.9').kind).toBe('unsupported');
  });

  it('reports unknown when the host said nothing', () => {
    expect(versionVerdict(null)).toEqual({ kind: 'unknown' });
  });

  it('keeps the thresholds in the right order', () => {
    expect(atLeast(AGENT_VERBS_VERSION, MIN_HERDR_VERSION)).toBe(true);
    expect(atLeast(RECOMMENDED_HERDR_VERSION, AGENT_VERBS_VERSION)).toBe(true);
  });
});

describe('versionAdvice', () => {
  it('says nothing at all when the host is fine', () => {
    // A banner that is always there is furniture.
    expect(versionAdvice({ kind: 'current', version: '0.9.5' })).toBeNull();
  });

  it('names the version and the fix for every other state', () => {
    for (const verdict of [
      { kind: 'outdated', version: '0.9.1' },
      { kind: 'legacy', version: '0.7.4' },
      { kind: 'unsupported', version: '0.6.0' },
      { kind: 'unknown' },
    ] as const) {
      const advice = versionAdvice(verdict);
      expect(advice).not.toBeNull();
      expect(advice).toMatch(/herdr/);
    }
  });

  // A plain `herdr update` leaves the running server, the version reported
  // here, where it was: the advice stayed after a person had followed it.
  it('never sends a person to a plain `herdr update`', () => {
    for (const verdict of [
      { kind: 'outdated', version: '0.9.1' },
      { kind: 'legacy', version: '0.7.4' },
      { kind: 'unsupported', version: '0.6.0' },
    ] as const) {
      expect(versionAdvice(verdict)).not.toMatch(/`herdr update`/);
      expect(versionAdvice(verdict)).toContain('Update herdr');
    }
  });

  it('quotes the actual version back, so a bug report carries it', () => {
    expect(versionAdvice({ kind: 'legacy', version: '0.7.4' })).toContain('0.7.4');
  });
});
