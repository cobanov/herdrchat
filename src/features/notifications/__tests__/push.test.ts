import { deviceFileId, errorDetail } from '../push';

/**
 * `deviceFileId` builds a filename that is interpolated into a shell path on the
 * host. Anything that survives the filter and is not inert there is a command
 * injection on the user's own machine, so the filter is pinned rather than
 * trusted.
 */
describe('deviceFileId', () => {
  it('keeps characters that are already inert', () => {
    expect(deviceFileId('A1b2-c3D4')).toBe('A1b2-c3D4');
  });

  it('replaces every shell metacharacter', () => {
    expect(deviceFileId('a;rm -rf /')).toBe('a-rm--rf--');
    expect(deviceFileId('$(whoami)')).toBe('--whoami-');
    expect(deviceFileId('`id`')).toBe('-id-');
    expect(deviceFileId("a'b\"c")).toBe('a-b-c');
  });

  it('refuses to emit a path that escapes the token directory', () => {
    // Dots are not in the allow-list, so traversal collapses to dashes rather
    // than reaching a parent directory.
    expect(deviceFileId('../../etc/passwd')).toBe('------etc-passwd');
    expect(deviceFileId('..')).toBe('--');
  });

  it('never returns an empty name', () => {
    // An empty id would write to "<dir>/.json" — a shared file every install
    // would clobber, rather than one file per device.
    expect(deviceFileId('')).toBe('device');
    expect(deviceFileId('!!!')).toBe('---');
  });
});

/**
 * The detail line under a failed registration. It exists because a TestFlight
 * build has no console: if the real error is not on screen it is unreachable.
 */
describe('errorDetail', () => {
  it('takes the message from an Error', () => {
    expect(errorDetail(new Error('no valid aps-environment entitlement'))).toBe(
      'no valid aps-environment entitlement'
    );
  });

  it('stringifies a non-Error', () => {
    expect(errorDetail('plain string failure')).toBe('plain string failure');
    expect(errorDetail(42)).toBe('42');
  });

  it('is undefined when there is nothing to show', () => {
    // An empty detail would render as a blank line under the note, which reads
    // as a layout bug rather than as an absence.
    expect(errorDetail(new Error(''))).toBeUndefined();
    expect(errorDetail('   ')).toBeUndefined();
    expect(errorDetail(undefined)).toBeUndefined();
  });
});
