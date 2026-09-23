import { checkDoneMark, DONE_MARK, withDoneMark } from '../herdr/doneMark';

describe('done mark (#103)', () => {
  it('follows the command with a mark that prints only on exit 0', () => {
    expect(withDoneMark("herdr pane run 'w1:p1' hi")).toBe(`herdr pane run 'w1:p1' hi && printf '%s' '${DONE_MARK}'`);
  });

  it('drops trailing separators that would make && a syntax error', () => {
    expect(withDoneMark('true; \n')).toBe(`true && printf '%s' '${DONE_MARK}'`);
  });

  it('strips the mark from a command that finished', () => {
    expect(checkDoneMark({ ok: true, exitCode: 0, stdout: `{"ok":1}\n${DONE_MARK}`, stderr: '' })).toEqual({
      ok: true,
      exitCode: 0,
      stdout: '{"ok":1}\n',
      stderr: '',
    });
  });

  it('reports a command that "exited 0" without the mark as cut off', () => {
    // What the iOS SSH library reports for `printf partial; kill -TERM $$`.
    expect(checkDoneMark({ ok: true, exitCode: 0, stdout: 'partial', stderr: '' })).toMatchObject({
      ok: false,
      code: 'transport_failed',
    });
  });

  it('passes a non-zero exit through untouched', () => {
    const failed = { ok: true as const, exitCode: 44, stdout: '', stderr: '' };
    expect(checkDoneMark(failed)).toBe(failed);
  });
});
