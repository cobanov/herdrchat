import { execFileSync } from 'node:child_process';

import { commandWord, shellCommand } from '../herdr/shell';

describe('commandWord (#106)', () => {
  it('expands a leading ~/ to $HOME and keeps the rest quoted', () => {
    expect(commandWord('~/.local/bin/herdr')).toBe(`"$HOME"/'.local/bin/herdr'`);
    expect(commandWord("~/we'ird dir/herdr")).toBe(`"$HOME"/'we'\\''ird dir/herdr'`);
  });

  it('leaves every other path exactly quoted', () => {
    expect(commandWord('/opt/herdr')).toBe(`'/opt/herdr'`);
    expect(commandWord('herdr')).toBe(`'herdr'`);
    expect(commandWord('~user/herdr')).toBe(`'~user/herdr'`);
  });

  it('resolves under a real shell', () => {
    const out = execFileSync('sh', ['-c', `printf '%s' ${commandWord('~/bin/x')}`], {
      encoding: 'utf8',
      env: { ...process.env, HOME: '/home/someone' },
    });
    expect(out).toBe('/home/someone/bin/x');
  });

  it('treats only the program word that way', () => {
    expect(shellCommand(['~/herdr', 'pane', '~/not-a-program'])).toBe(`"$HOME"/'herdr' 'pane' '~/not-a-program'`);
  });
});
