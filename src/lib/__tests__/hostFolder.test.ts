import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hostFolderCommand } from '../herdr/client';

/** The command under a real `sh`, with `home` as `$HOME`. */
function run(path: string, home: string) {
  const result = spawnSync('sh', ['-c', hostFolderCommand(path)], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  return { status: result.status, folder: result.stdout.trim() };
}

describe('the folder New chat starts in', () => {
  const home = mkdtempSync(join(tmpdir(), 'hc-home-'));
  mkdirSync(join(home, 'proj'));
  mkdirSync(join(home, "it's here"));

  it('reads ~ as the home folder', () => {
    expect(run('~', home)).toEqual({ status: 0, folder: home });
    expect(run('~/proj', home)).toEqual({ status: 0, folder: join(home, 'proj') });
  });

  it('keeps an absolute folder, quotes and all', () => {
    expect(run(join(home, 'proj'), home)).toEqual({ status: 0, folder: join(home, 'proj') });
    expect(run(join(home, "it's here"), home)).toEqual({ status: 0, folder: join(home, "it's here") });
  });

  // Any failure will do: macOS's sh exits 1 for a failed cd, Linux's dash 2.
  it('fails, printing nothing, for a folder that is not there', () => {
    for (const path of [join(home, 'missing'), '~/missing']) {
      const { status, folder } = run(path, home);
      expect(status).not.toBe(0);
      expect(folder).toBe('');
    }
  });
});
