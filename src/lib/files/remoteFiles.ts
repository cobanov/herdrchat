import { shellQuote } from '../herdr/shell';
import type { HerdrTransport } from '../herdr/transport';
import { decodeBase64, UPLOAD_CHUNK_CHARS } from '../attachments/upload';

/**
 * The Files tab's whole protocol: plain POSIX commands over the SSH connection
 * the app already holds, parsed here.
 *
 * shortcut: commands over the exec channel rather than the SSH SFTP subsystem,
 * which the native module does not speak; a transfer is one base64 string in
 * memory, so it is capped at MAX_TRANSFER_BYTES. Upgrade to SFTP in
 * modules/herdr-ssh (Citadel has a client) when files bigger than that matter.
 */

export const MAX_TRANSFER_BYTES = 25 * 1024 * 1024;

export type RemoteEntryKind = 'dir' | 'file' | 'link';

export interface RemoteEntry {
  name: string;
  kind: RemoteEntryKind;
  /** Bytes, as `ls` reports them; a link's is the link's own. */
  size: number;
}

export interface RemoteListing {
  /** The folder's absolute path, as the host resolved it. */
  path: string;
  entries: RemoteEntry[];
}

/** List a folder, or the home folder for null: its absolute path, then `ls -lnA` in the C locale. */
export function listCommand(path: string | null): string {
  const cd = path === null ? 'cd' : `cd -- ${shellQuote(path)}`;
  return `${cd} && pwd && LC_ALL=C ls -lnA`;
}

// `-rw-r--r--  1 501  20  1234 Oct 15 23:47 name`, GNU and BSD alike with `-n`
// in the C locale; the date is `Mon dd hh:mm` or `Mon dd  yyyy`.
const LINE = /^([-dlcbps])\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+[A-Z][a-z]{2}\s+\d{1,2}\s+(?:\d{1,2}:\d{2}|\d{4})\s(.+)$/;

/** Folders first, then files, each by name; `.` and `..` never listed. */
export function parseListing(stdout: string): RemoteListing | null {
  const lines = stdout.split('\n');
  const path = lines[0]?.trim() ?? '';
  if (!path.startsWith('/')) return null;
  const entries: RemoteEntry[] = [];
  for (const line of lines.slice(1)) {
    const match = LINE.exec(line);
    if (match === null) continue;
    const [, type, size, rest] = match as unknown as [string, string, string, string];
    // shortcut: a name containing " -> " is cut there on a link; such names are rare.
    const name = type === 'l' ? rest.split(' -> ')[0] ?? rest : rest;
    if (name === '.' || name === '..') continue;
    entries.push({ name, kind: type === 'd' ? 'dir' : type === 'l' ? 'link' : 'file', size: Number(size) });
  }
  entries.sort((a, b) => (a.kind === 'dir') === (b.kind === 'dir') ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1);
  return { path, entries };
}

/** A child's path: joined with one slash, from `/` too. */
export function childPath(folder: string, name: string): string {
  return folder === '/' ? `/${name}` : `${folder}/${name}`;
}

/** The folder above, or null at `/`. */
export function parentPath(path: string): string | null {
  if (path === '/') return null;
  const cut = path.replace(/\/+$/, '').lastIndexOf('/');
  return cut <= 0 ? '/' : path.slice(0, cut);
}

/** A file's bytes as one base64 line, refused above the cap before anything is read. */
export function downloadCommand(path: string): string {
  const file = shellQuote(path);
  return `[ -f ${file} ] || { echo 'Not a file' >&2; exit 2; }; ` +
    `[ "$(wc -c < ${file})" -le ${MAX_TRANSFER_BYTES} ] || { echo 'Too big to download here' >&2; exit 3; }; ` +
    `base64 < ${file} | tr -d '\\n'`;
}

/** A name a person can give an uploaded file: no slash, no NUL, not `.` or `..`. */
export function isUploadName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\0');
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * The commands that write `base64` to `folder/name`, in order: pieces appended
 * to a hidden part file, then decoded into place. An existing file is never
 * replaced: the last command refuses (exit 17) and leaves it as it was.
 */
export function uploadFileCommands(folder: string, name: string, base64: string, chunk: number = UPLOAD_CHUNK_CHARS): string[] {
  if (!isUploadName(name)) throw new Error(`Not a file name: ${name}`);
  if (!BASE64.test(base64)) throw new Error('Not base64');
  const target = shellQuote(childPath(folder, name));
  const part = shellQuote(childPath(folder, `.${name}.herdrchat-part`));
  const pieces: string[] = [];
  for (let start = 0; start < base64.length; start += chunk) pieces.push(base64.slice(start, start + chunk));
  if (pieces.length === 0) pieces.push('');
  const commands = pieces.map((piece, index) => `printf '%s' '${piece}' ${index === 0 ? '>' : '>>'} ${part}`);
  commands.push(
    `if [ -e ${target} ]; then rm -f ${part}; echo 'A file with that name is already there' >&2; exit 17; fi; ` +
      `${decodeBase64(part)} > ${target} && rm -f ${part}`
  );
  return commands;
}

export type FilesResult<T> = { ok: true; value: T } | { ok: false; message: string };

async function run(transport: HerdrTransport, command: string, timeoutMs: number): Promise<FilesResult<string>> {
  const result = await transport.exec(command, timeoutMs);
  if (!result.ok) return { ok: false, message: result.message };
  if (result.exitCode !== 0) return { ok: false, message: result.stderr.trim() || `The command failed (exit ${result.exitCode}).` };
  return { ok: true, value: result.stdout };
}

export async function listFolder(transport: HerdrTransport, path: string | null, timeoutMs: number): Promise<FilesResult<RemoteListing>> {
  const out = await run(transport, listCommand(path), timeoutMs);
  if (!out.ok) return out;
  const listing = parseListing(out.value);
  return listing === null ? { ok: false, message: 'The host answered with something that is not a folder listing.' } : { ok: true, value: listing };
}

export async function downloadFile(transport: HerdrTransport, path: string, timeoutMs: number): Promise<FilesResult<string>> {
  const out = await run(transport, downloadCommand(path), timeoutMs);
  if (!out.ok) return out;
  const base64 = out.value.trim();
  return BASE64.test(base64) ? { ok: true, value: base64 } : { ok: false, message: 'The host sent the file back garbled.' };
}

export async function uploadFile(transport: HerdrTransport, folder: string, name: string, base64: string, timeoutMs: number): Promise<FilesResult<string>> {
  for (const command of uploadFileCommands(folder, name, base64)) {
    const out = await run(transport, command, timeoutMs);
    if (!out.ok) return out;
  }
  return { ok: true, value: childPath(folder, name) };
}
