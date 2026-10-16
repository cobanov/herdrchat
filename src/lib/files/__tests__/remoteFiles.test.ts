import { childPath, downloadCommand, isUploadName, listCommand, parentPath, parseListing, uploadFileCommands } from '../remoteFiles';

const { execFileSync } = jest.requireActual<typeof import('node:child_process')>('node:child_process');
const { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } = jest.requireActual<typeof import('node:fs')>('node:fs');
const { tmpdir } = jest.requireActual<typeof import('node:os')>('node:os');
const path = jest.requireActual<typeof import('node:path')>('node:path');

/** Runs a command the way the host's shell would, in `sh`. */
const sh = (command: string) => execFileSync('sh', ['-c', command], { encoding: 'utf8' });

describe('remote files, against a real shell', () => {
  let root = '';
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'herdrchat files '));
    mkdirSync(path.join(root, 'Season 01'));
    writeFileSync(path.join(root, "it's a file.txt"), 'hello');
    writeFileSync(path.join(root, '.hidden'), '');
    symlinkSync(path.join(root, 'Season 01'), path.join(root, 'link'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('lists a folder with spaces and quotes in its names, folders first', () => {
    const listing = parseListing(sh(listCommand(root)));
    expect(listing?.path).toBe(execFileSync('sh', ['-c', `cd -- '${root}' && pwd`], { encoding: 'utf8' }).trim());
    expect(listing?.entries).toEqual([
      { name: 'Season 01', kind: 'dir', size: expect.any(Number) },
      { name: '.hidden', kind: 'file', size: 0 },
      { name: "it's a file.txt", kind: 'file', size: 5 },
      { name: 'link', kind: 'link', size: expect.any(Number) },
    ]);
  });

  it('sends a file there and back without touching one already there', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 255, 10, 13]);
    for (const command of uploadFileCommands(root, 'blob.bin', bytes.toString('base64'), 4)) sh(command);
    expect(readFileSync(path.join(root, 'blob.bin'))).toEqual(bytes);
    expect(sh(listCommand(root))).not.toContain('herdrchat-part');
    expect(Buffer.from(sh(downloadCommand(path.join(root, 'blob.bin'))), 'base64')).toEqual(bytes);
    // A second upload of the same name refuses and leaves the first alone.
    const again = uploadFileCommands(root, 'blob.bin', Buffer.from('other').toString('base64'));
    for (const command of again.slice(0, -1)) sh(command);
    expect(() => sh(again[again.length - 1] ?? '')).toThrow();
    expect(readFileSync(path.join(root, 'blob.bin'))).toEqual(bytes);
  });

  it('refuses to download a folder', () => {
    expect(() => sh(downloadCommand(path.join(root, 'Season 01')))).toThrow();
  });
});

describe('remote file paths', () => {
  it('joins and climbs paths, from the root too', () => {
    expect(childPath('/', 'etc')).toBe('/etc');
    expect(childPath('/home/me', 'a b')).toBe('/home/me/a b');
    expect(parentPath('/home/me')).toBe('/home');
    expect(parentPath('/home')).toBe('/');
    expect(parentPath('/')).toBeNull();
  });

  it('takes no upload name that could leave the folder', () => {
    expect(isUploadName('photo.jpg')).toBe(true);
    for (const name of ['', '.', '..', 'a/b', '../x']) expect(isUploadName(name)).toBe(false);
    expect(() => uploadFileCommands('/tmp', '../evil', 'AA==')).toThrow();
  });

  it('reads nothing but a listing', () => {
    expect(parseListing('ls: cannot open')).toBeNull();
  });
});

describe('the Demo as a computer in Files', () => {
  // Imported here so the real-shell tests above run without the Demo's fixtures.
  const { DemoHost } = jest.requireActual<typeof import('../../demo/host')>('../../demo/host');
  const { downloadFile, listFolder, uploadFile } = jest.requireActual<typeof import('../remoteFiles')>('../remoteFiles');

  it('lists its home folder, opens a folder in it, and moves a file each way', async () => {
    const host = new DemoHost();
    const home = await listFolder(host, null, 1000);
    expect(home.ok && home.value.path).toBe('/home/demo');
    expect(home.ok && home.value.entries.map((entry) => entry.name)).toEqual(['code', 'notes', '.zshrc', 'README.md']);
    const code = await listFolder(host, '/home/demo/code', 1000);
    expect(code.ok && code.value).toEqual({ path: '/home/demo/code', entries: [] });
    const file = await downloadFile(host, '/home/demo/README.md', 1000);
    expect(file.ok && Buffer.from(file.value, 'base64').toString()).toContain('HerdrChat demo');
    await expect(uploadFile(host, '/home/demo', 'photo.jpg', 'AAAA', 1000)).resolves.toEqual({ ok: true, value: '/home/demo/photo.jpg' });
  });
});
