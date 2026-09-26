/**
 * Images sent from the phone travel as files. The app uploads each one to the
 * host (see `src/lib/attachments`) and puts its absolute path in the prompt, on
 * a line of its own. The agents record that differently:
 *
 * - Claude Code turns the line into an attachment. The user text gains an
 *   `[Image #1]` token where it was, the picture is stored as an image block,
 *   and a separate text block reads `[Image: source: /path]`.
 * - Codex keeps the line as typed.
 *
 * Either way the bubble should show the picture, not the plumbing, and the text
 * left over must equal what was typed: that is how a sent message's echo is
 * matched to its transcript line.
 */

/** Where uploads land, relative to the host user's home. */
export const UPLOAD_DIR = '.cache/herdrchat/uploads';

/** An upload's path as the prompt carries it: absolute, in the upload folder. */
const UPLOAD_PATH = /^\/\S*\/\.cache\/herdrchat\/uploads\/[A-Za-z0-9._-]+\.(?:jpe?g|png|heic|webp)$/;
/** Claude's placeholder for an attachment, left in the text where the path was. */
const CLAUDE_IMAGE_TOKEN = /\[Image #\d+\]/g;
/** Claude's own note of where an attachment came from. */
const CLAUDE_IMAGE_SOURCE = /^\[Image: source: ([^\]\n]+)\]$/;

/** User text with its image references taken out, and the paths they named. */
export function splitImages(text: string): { text: string; paths: string[] } {
  const paths: string[] = [];
  const kept: string[] = [];
  for (const line of text.replace(CLAUDE_IMAGE_TOKEN, '').split('\n')) {
    const trimmed = line.trim();
    const source = CLAUDE_IMAGE_SOURCE.exec(trimmed);
    if (source?.[1] !== undefined) paths.push(source[1].trim());
    else if (UPLOAD_PATH.test(trimmed)) paths.push(trimmed);
    else kept.push(line);
  }
  return { text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(), paths };
}

/** The prompt for a message with pictures: what was typed, then one path a line. */
export function promptWithImages(text: string, paths: readonly string[]): string {
  const typed = text.trim();
  if (paths.length === 0) return typed;
  return typed.length === 0 ? paths.join('\n') : `${typed}\n\n${paths.join('\n')}`;
}

/** The file name a path ends in, which is also what the phone keeps its copy under. */
export function imageName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
