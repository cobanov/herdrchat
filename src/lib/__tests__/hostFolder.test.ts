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

  it('fails, printing nothing, for a folder that is not there', () => {
    expect(run(join(home, 'missing'), home)).toEqual({ status: 1, folder: '' });
    expect(run('~/missing', home).status).not.toBe(0);
  });
});
