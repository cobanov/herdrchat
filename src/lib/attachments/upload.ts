import type { HerdrTransport } from '../herdr/transport';
import { UPLOAD_DIR } from '../transcript/images';

/**
 * Sending a picture: its bytes go to the host over the SSH connection the app
 * already has, and the prompt carries the path (see `transcript/images`).
 *
 * A command is capped at `MAX_COMMAND_BYTES` (a host shell takes it as one
 * argument), so the base64 travels in pieces appended to a `.part` file, which
 * the last command decodes into place and answers with the absolute path.
 * Nothing but the user's own machine sees the picture on the way; uploads older
 * than a week are cleared as new ones arrive.
 */

/** A picture ready to send: its upload name and its bytes as base64. */
export interface OutgoingImage {
  name: string;
  base64: string;
}

/** Base64 per command, well inside the cap with the session and PATH prefixes. */
export const UPLOAD_CHUNK_CHARS = 96 * 1024;
/** Days an upload is kept on the host. */
export const UPLOAD_KEEP_DAYS = 7;
const NAME = /^[A-Za-z0-9-]+\.(?:jpg|png)$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** A fresh upload name: sortable by time, unguessable enough not to collide. */
export function newImageName(now: number = Date.now(), random: () => number = Math.random): string {
  const tail = Math.floor(random() * 36 ** 8).toString(36).padStart(8, '0');
  return `${now.toString(36)}-${tail}.jpg`;
}

/** The commands that write `base64` to the host as `name`, in order. */
export function uploadCommands(name: string, base64: string, chunk: number = UPLOAD_CHUNK_CHARS): string[] {
  if (!NAME.test(name)) throw new Error(`Not an upload name: ${name}`);
  if (!BASE64.test(base64)) throw new Error('Not base64');
  const dir = `"$HOME/${UPLOAD_DIR}"`;
  const part = `"$HOME/${UPLOAD_DIR}/${name}.part"`;
  const file = `"$HOME/${UPLOAD_DIR}/${name}"`;
  const pieces: string[] = [];
  for (let start = 0; start < base64.length; start += chunk) pieces.push(base64.slice(start, start + chunk));
  if (pieces.length === 0) pieces.push('');
  const commands = pieces.map((piece, index) =>
    index === 0
      ? `umask 077 && mkdir -p ${dir} && printf '%s' '${piece}' > ${part}`
      : `printf '%s' '${piece}' >> ${part}`
  );
  // `base64 -d` on Linux and current macOS, `-D` on older macOS.
  commands.push(
    `{ base64 -d < ${part} 2>/dev/null || base64 -D < ${part}; } > ${file} && rm -f ${part} && ` +
      `{ find ${dir} -type f -mtime +${UPLOAD_KEEP_DAYS} -delete 2>/dev/null; printf '%s\\n' ${file}; }`
  );
  return commands;
}

export type UploadResult = { ok: true; path: string } | { ok: false; message: string };

/** Writes one picture to the host and returns where it landed. */
export async function uploadImage(
  transport: HerdrTransport,
  image: OutgoingImage,
  timeoutMs: number
): Promise<UploadResult> {
  const commands = uploadCommands(image.name, image.base64);
  let stdout = '';
  for (const command of commands) {
    const result = await transport.exec(command, timeoutMs);
    if (!result.ok) return { ok: false, message: result.message };
    if (result.exitCode !== 0) {
      return { ok: false, message: result.stderr.trim() || `The host could not save the picture (exit ${result.exitCode}).` };
    }
    stdout = result.stdout;
  }
  const path = stdout.trim().split('\n').pop()?.trim() ?? '';
  if (!path.startsWith('/') || !path.endsWith(`/${image.name}`)) {
    return { ok: false, message: 'The host saved the picture somewhere unexpected.' };
  }
  return { ok: true, path };
}
