import type { ExecResult } from '../../../modules/herdr-ssh/src';
import { HerdrClient } from '../herdr/client';
import { HerdrError } from '../herdr/protocol';
import type { HerdrTransport } from '../herdr/transport';

/**
 * The folder picker used to be unable to tell "nothing in here" from "I never
 * got in". The listing command ended in `; true`, so a missing path and a
 * permission denial both came back as exit 0 with no output, and the picker
 * confidently reported "No subfolders here" about a directory it had failed to
 * open. These pin the three answers apart.
 */
class ListTransport implements HerdrTransport {
  readonly sent: string[] = [];
  constructor(private readonly result: Omit<ExecResult & { ok: true }, 'ok'>) {}
  async exec(command: string): Promise<ExecResult> {
    this.sent.push(command);
    return { ok: true, ...this.result };
  }
  async *streamLines(): AsyncIterable<string> {}
}

describe('HerdrClient.listDirectories', () => {
  it('returns the subdirectories, files and the trailing slash dropped', async () => {
    const transport = new ListTransport({
      stdout: 'src/\nREADME.md\nnode_modules/\n',
      stderr: '',
      exitCode: 0,
    });
    await expect(new HerdrClient(transport).listDirectories('/home/ege')).resolves.toEqual([
      'node_modules',
      'src',
    ]);
  });

  it('reads a readable but empty directory as empty, not as a failure', async () => {
    const transport = new ListTransport({ stdout: '', stderr: '', exitCode: 0 });
    await expect(new HerdrClient(transport).listDirectories('/tmp/empty')).resolves.toEqual([]);
  });

  it('reports an unreadable directory instead of an empty one', async () => {
    const transport = new ListTransport({ stdout: '', stderr: '', exitCode: 3 });
    await expect(
      new HerdrClient(transport).listDirectories('/root')
    ).rejects.toMatchObject({ code: 'dir_unreadable' });
  });

  it('names the path it could not read, so the message means something', async () => {
    const transport = new ListTransport({ stdout: '', stderr: '', exitCode: 4 });
    const thrown = await new HerdrClient(transport)
      .listDirectories('/root/private')
      .catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(HerdrError);
    expect((thrown as HerdrError).message).toContain('/root/private');
  });

  it('never swallows the exit status with `; true`', async () => {
    const transport = new ListTransport({ stdout: '', stderr: '', exitCode: 0 });
    await new HerdrClient(transport).listDirectories('/home/ege');
    const command = transport.sent[0] ?? '';
    expect(command).toContain("cd '/home/ege'");
    expect(command).toContain('ls -1Lp');
    expect(command).not.toContain('; true');
  });
});
